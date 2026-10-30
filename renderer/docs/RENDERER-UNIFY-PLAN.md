# RENDERER-UNIFY-PLAN —— 把「本仓渲染器」与「上游产物」两份实现合并的方案（2026-09-25）

> **用户原话（2026-09-21 用户第 30 条，`docs/USER-ITEMS-20260921.md:120`）**：
> 「为什么把渲染器分成两个？能不能整合成一个」。
>
> **本文的对象**：`:8902` 上的**两个渲染器表面** —— ①**本仓渲染器**（`demo.html` + `core/**`，GPL-3.0-or-later，
> 由 `/webloader/` 与 `:8899/` 供应）②**上游产物**（`demo/renderer/index.html` + `demo/assets/renderer-*.js`，
> 不可重建的 minified 构建产物，由 `/wallpaper-engine-webgl/renderer/index.html` 供应，测试台里叫「上游产物」档）。
>
> **不在本文范围**：端口/服务面的合并（`8899 → 8902`）。那件事**已经做完并有实测**，见
> `../docs/RENDERER-MERGE-PLAN.md:11`（8902 自带渲染器面）、`:15`（两个入口复用**同一份** `rendererRequestHandler`）、
> `:23-39`（真停 8899 后逐条 200 + `X-Bench-Served: local`）。本文**不重复**它，只引用结论。
>
> **方法与纪律**：纯静态阅读（源码 / 产物只读观察 / 现有文档与门禁），**未改任何代码、未跑测试套件、未起浏览器、未动 git**。
> 每条判断都给 `file:line`；读不到的按"没读到"写（见 §6）。

---

## 0. 一句话结论

**选 (B)：本仓渲染器是唯一实现，产物降格为"参考实现 / A-B 对照档"，逐项把还差的行为移植过来并各自留 A/B 判据；
(A) 是终点但今天做不到（产物还在关键路径上），(C) 只作过渡机制、不作长期形态。**

理由（三条硬证据）：① 用户已经拍板过方向 ——「结论：应该整合 —— 预览默认改成本仓渲染器，上游产物最多保留为『对照档』」
（`docs/USER-ITEMS-20260921.md:120`），且这一步**已落地**（默认档 = repo，`demo/bench-patch.js:1745`、
`tests/bench-renderer-source-test.mjs:51-54` 的 A1）；② 产物**字节不可改、不可重建、无源码行号**，任何"真正合成一份"都撞纪律
（`docs/PATCHES.md:4969`、`:4971`）；③ 产物**今天仍被 21 个非文档文件引用**（含 `build-pages.mjs` 的产物自检、
`tests/demo-check.mjs` 的 DOM 契约、测试台 web 档的 11 条夹具断言），删它是一次跨面手术，必须先清依赖。

---

## 1. 两份实现的全景对照（全部有出处）

### 1.1 身份、出处、许可

| 维度 | 本仓渲染器 | 上游产物（"上游档"） |
|---|---|---|
| 入口文件 | `demo.html`（620,710 B） | `demo/renderer/index.html`（1,814 B / 42 行；`body` 为空，渲染器就是 `:37` 那一条 `<script type="module" crossorigin src="../assets/renderer-BOSoB05I.js">`） |
| 主实现体 | `core/we-scene-bundle.js`（923,907 B，含 **16 个** `// ===== src/… =====` 分节标记，`:355`/`:441`/`:521`/`:1295`/`:3200`/`:3304`/`:3645`/`:5473`/`:6392`/`:7234` …） | `demo/assets/renderer-BOSoB05I.js`（809,476 B / **2,325 行** minified；`sha256 0b424f43…`） |
| 供应入口 | `/webloader/`（:8902 本地直供）、`/webloader/**` 由 `server/we-scene-demo-server-8902.mjs:1865-1867` 的 `serveRenderer` 处理；`:8899` 是同一份实现的旧入口 | `/wallpaper-engine-webgl/renderer/index.html`（静态面挂载点，`server/we-scene-demo-server-8902.mjs:1871` 的 `MOUNTS`） |
| 许可 | **GPL-3.0-or-later**（`THIRD-PARTY.md:527-537`；`LICENSE` = GPL v3 原文） | **MIT © oneincase**（`THIRD-PARTY.md:599-605`、`:6.4`；`demo/LICENSE-webwallgl-MIT.txt` + `demo/LICENSE-webwallgl` **两份声明随目录分发**） |
| 出处 / 版本 | 自研；借鉴台账 15 条在 `docs/COPYING-RULES.md:75-99` | 上游 `oneincase/webwallgl` 的**再分发预构建物**（`THIRD-PARTY.md:607-640`）；`docs/PATCHES.md:4969` 记"单提交引入（`987d9b3`, 2026-09-16）、此后未动、**仓库内不可重建**" |
| 版本口径（**仓库内不一致，需修正**） | — | `docs/PATCHES.md:4969` 写"1.3.23 的 minified 产物"；但产物自己往 `#app-version` 写的是 **`v1.3.16`**，仓库三处都在描述它（`demo/bench-patch.js:53`、`:274`、`:9766`），`docs/WEBWALLGL-UPSTREAM-STUDY.md:70,251` 也按"1.3.16 产物"论证（例如"1.3.16 产物没有 `setQuality`"）。⇒ **以"产物自报 v1.3.16"为证据面**，`PATCHES.md:4969` 的版本标签应更正 |
| 仓外参考源（**未 vendored**） | — | `<工作区>/vendor-ref/webwallgl`，本机 checkout HEAD = `b61e891`（1.3.16 期）；`vendor/we-scene/**` 16,570 行 + `renderer/src/*.ts` 8,224 行。**它不等于产物**：`THIRD-PARTY.md:607-613` 明写上游源码树"lives **outside** the repository and is excluded from the published tree"，且已 vendored 的转译器追的是更晚的 `9531aaf`（v1.4.1，`THIRD-PARTY.md:712-713`） |

### 1.2 模块划分

| | 本仓渲染器 | 上游产物 |
|---|---|---|
| 划分方式 | **多文件 + 单 bundle**：宿主 `demo.html`（装载链、脚本同步循环、蒙皮回调、上报、属性面板、多实例、显示选项）；渲染语义全在 `core/we-scene-bundle.js`（分节：pkg / texture / scene.parse / effects-parse / math / noise / particles / hlsl2glsl / effects / renderer）；另有 `core/*.mjs` 纯模块（`attach-transform`、`web-frame-geometry`、`web-frame-host`、`we-web-shim`、`we-pointer-source`、`we-particle-pointer`、`audio-band-array`…）与 `elysia/**`（CPU 对照渲染器 + 脚本宿主） | **单包 + 模块内私有函数**：产物把上游的 `renderer/src/*.ts`（`main/shell/dispatch/media/scene-mount/live-system/web/web-rewrite/video-loop/video-webcodecs/tex-decode/api`）与 `renderer/vendor/we-scene/**`（`render/pkg/render/scene`）打成**一个 ESM 文件**；公开面只有 `window.__wp` / `window.__we*` 与 DOM。**内部函数名（如 web 帧几何的 `nw()`/`Y1()`）是 minified 私有符号**（`docs/AUDIO-BAND-WIRING.md` §4.1 逐条记录了这一点） |
| 证据 | `docs/RENDERER-ARCHITECTURE.md:19-29`（文件所有权表）、`:31-93`（模块地图） | 产物静态：`getContext("webgl2",{premultipliedAlpha:!1,antialias:!1,alpha:!1,preser…})` 等短串可读，但函数名已压缩；仓外源树结构见 `vendor-ref/webwallgl/renderer/{src,vendor}` |

### 1.3 渲染管线逐项对照

| 管线环节 | 本仓渲染器 | 上游产物 | 差异性质 |
|---|---|---|---|
| **画布 / 上下文创建** | `glCanvasAttrs()` 是**唯一来源**（`core/we-scene-bundle.js:14836-14848`）：`{premultipliedAlpha:false, antialias: AA_MSAA_SAMPLES[tier.aa]>0, alpha:false, preserveDrawingBuffer:true, depth:true, stencil:false}`；宿主只有两处取上下文（`demo.html:1972-1988` 的 `mpwAcquireWebGL2` + `:8697` 的探测），并明写"同一个 canvas 只有一次 `getContext` 生效"（`:1973`） | 同族属性：`alpha:false / premultipliedAlpha:false / antialias:false / preserveDrawingBuffer:true`（产物静态串），且 `antialias` 恒 `false`（它的 MSAA 走离屏 FBO，见下行） | **口径相同、路线不同**：上游用"多重采样离屏 FBO/RBO + 帧末 resolve"（`docs/PATCHES.md:4810-4811` 记的是上游 1.3.23 的做法；产物的 `antialias:false` 与之自洽）；本仓是取舍后的**原生 `antialias`**，且 `msaa` 档与 `q!=off` 不能并用（`docs/PATCHES.md:4929`） |
| **画布尺寸 / DPR** | 活档位 `?res=dpr`：**显示尺寸 × 设备 DPR**，带总像素上限（3840×2160）与单边 ≤4096（`tests/bench-renderer-source-test.mjs:147-168` 的 B1–B5；实现 = `parseResTier` / `resolveLiveCanvasSize`，导出点在 `core/we-scene-bundle.js`，钉子见该测试 `:173-175`） | `clientWidth × min(devicePixelRatio, renderDpr)`，而工具条「DPR」缺省就是 `1` ⇒ **1× CSS 像素出图**（`demo/bench-patch.js:1741-1746`；A/B 读数 `tests/bench-renderer-source-test.mjs:66-67`，判据 D3 `:487-492`、D5 `:496-498`） | **用户可见的最大不一致**：同面板同包实测"上游 529×297、本仓 1056×594 @DPR2"（`demo/bench-patch.js:1744`），用户报的"预览糊"就是这一条（`docs/USER-ITEMS-20260921.md:125`） |
| **层类型覆盖** | 层循环 `renderScene` / `renderLayer`（`docs/RENDERER-ARCHITECTURE.md:58-59`）：image / sprite / particle / text / mesh(puppet) / sound(音频分析) / video（视频纹理档 `docs/VIDEOBASE-20260924.md`） | 上游 `dispatch.ts` 按 `cfg.type` 分四条挂载路径：`video|gif|image`、`scene`、`web`，缺省 `canvas`（仓外源树 `renderer/src/dispatch.ts:20-25`、`main.ts:426`） | **入口类型面**：本仓 `demo.html` 已补 `?type=web`（`:3414`，先于取包解析）、`?type=video` 自动路由 + `?video=`（`:3392-3407`）、其余走 scene；服务端 `/type/<id>` 判定含 video/gif（`server/we-scene-demo-server-8902.mjs:984,990,1064`）。**`type=canvas`（上游缺省档）本仓没有** |
| **效果链 / 后处理** | `resolveEffectChain` + `getFBO(w,h,tag)` 每效果命名空间 FBO 池 + COPYBG + 反馈环硬拦截（`docs/RENDERER-ARCHITECTURE.md:64-72`）；档位 `?q/?aa/?pp`（`docs/PATCHES.md:4857-4861`） | 同结构（上游 `pp` 三档门控 + bloom，`docs/PATCHES.md:4736-4762` 逐位置列出） | **两处已知分叉**：① `pp=off` 上游有 **3 处**门控、本仓只落 **2 处**（不解析 `isPostProcess`，`docs/PATCHES.md:4922-4925`，且该串在**产物里有 8 处实代码命中** ⇒ 只能从产物观察，不能从本仓源码补）；② `pq`（粒子质量 `off/low/medium/high`）**上游有、本仓刻意不引入**（`docs/README-DIAGNOSTICS.md:280-290`，理由是与本仓 `PARTICLE_BUDGET`/`?perf` 打架） |
| **粒子** | 已移植上游 `children` 子系/拖尾（`THIRD-PARTY.md` §15，照抄 + 语义移植，台账 #13）、`overbright`（`THIRD-PARTY.md` §16，按规格独立实现，台账 #14，落地 `PATCHES.md:11304`）、指针尾迹（§14，#12）；模拟档 `?psim=incr/replay`（`docs/README-DIAGNOSTICS.md` 主表） | 上游 `particles.js` 全量（含 `pq` 档、`instanceoverride.*`） | **残留**：`instanceoverride.brightness` **未接**（本仓只有 size/count/alpha/rate/speed/lifetime/colorn/color，`docs/PATCHES.md:11401-11402`） |
| **骨骼 / 蒙皮** | `renderMeshLayer`（顶点即模型空间、无 bbox 中心补偿）+ `core/puppet-skin.js` + `bindorder` 档 + `?submesh`/`?subtri`/`?bones` 探针（`docs/RENDERER-ARCHITECTURE.md:60`；`docs/README-DIAGNOSTICS.md` 主表四行）；MDLS 布局校验 + 变长布局重扫（P-152，`docs/PATCHES.md:11409`） | 上游 `mdl*.js` + `scene-mount.ts` 蒙皮 | **判据级对齐**：P-152 明写"只作判据引用、未照抄代码"（`docs/README-DIAGNOSTICS.md` 的 `mdls` 行） |
| **文本** | 官方度量（行高=字体度量、verticalalign 三落点、CSS 序 padding、宽度驱动省略号，RE-32）+ `{user,value}` 绑定解包（`docs/RENDERER-ARCHITECTURE.md:129-130`） | 上游 `text.js` / `text-layout.js`（Canvas2D `measureText`/`fillText`，`font-sanitize.js`） | 两边都有；本仓把度量写成不变量（不变量 12） |
| **视频 / 音频** | 视频纹理 + `videoStats` 台账（`docs/README-DIAGNOSTICS.md:340`）、音条四档 `?bandfeed=wallpaper|mic|sim|off`、音频面板（`:295` 段）、`window.__mpwAudio` | 上游 `media.js`/`media-logo.js`/`audio.js`；`mediaBase`/`liveSystem` 参数（产物静态命中） | **缺口两条**：① `$mediaThumbnail`/`usertextures` 槽 **本仓完全不解析**（`grep usertextures core/we-scene-bundle.js` = **0**；`docs/PATCHES.md:2537-2539`）；② 上游"模拟媒体源"内置品牌串（本仓已按品牌清理改成中性值，`demo/bench-patch.js:9064` 附近） |
| **脚本沙箱** | `elysia/nsl.js` 的 **`with (__nslCtx)`** 执行（剥 `'use strict'`）+ `scene-scripts.js` 的 ESM→可执行转译；**先全部 init 再逐帧 update**、4Hz 节流、沙箱内存 `localStorage`（`docs/RENDERER-ARCHITECTURE.md:83-85,131-132`）；共享持久是**显式档** `?scriptstore=persist`（P-153，`docs/PATCHES.md:11526`，缺省仍逐位 legacy） | 上游 `text.js` 的 `evalObjectScript`：`new Function(...)` + `Proxy` 构造器，宿主全局用**形参遮蔽**（仓外源树 `vendor/we-scene/render/text.js:691-695`、`:1679`、`:1772`），另有 `engine-timers.js` 管沙箱 `setTimeout/setInterval` | **机制不同 ⇒ 语义边界不同**（本仓不碰宿主存储是既有纪律，见 `tests/script-storage-test.mjs:5-9`）；上游"约 100KB 容量"本仓**没有实现**（`docs/PATCHES.md:11603`） |
| **诊断面** | **183 个 URL 开关**（代码 ↔ 主表双向 0 差异，`docs/README-DIAGNOSTICS.md:6`；抓取器 `tests/diag-flag-check.mjs`）+ `POST /report` 落盘 `reports/r*.json` + 层台账 `layerLedger` + 逐层 `?ln=N` + elysia CPU 对照 + `/diag` 流（`docs/RENDERER-ARCHITECTURE.md:88-93`） | **11 个 URL 参数**（`type/src/fit/renderDpr/sceneFps/muted/loop/filter/mediaBase/liveSystem/opaque`，`demo/bench-patch.js:1810` 注释；我对产物逐个静态 grep 也全部命中）+ `window.__we*` 控制面 8 个名（`__weSetPaused/__weSetFps/__weSetVolume/__wePushPointer/__wePushMedia/__weApplyProps/__weSeedProps/__wePointerLeave`）+ `"we-frame"` 消息 | **严重不对称**：`/diag`、`/report`、`/media|web/dev`、`/api` **被明确排除在"渲染器根路由"名单之外**（名单现在用于 :8902 的本地直供，注释在 `server/we-scene-demo-server-8902.mjs:1760-1768`；判据 = `tests/bench-renderer-source-test.mjs:188-192` 的 C4） |
| **宿主 API / 控制协议** | `window.__wp`（`demo.html:1911-1913` 发布、`:2247-2261` 宿主契约、`:2387` 自报"真能力 pause/resume/release/setFilter/setRenderDpr/setVolume/pushPointer/capture"）+ `window.__mpwLiveRes`/`__mpwWebFrame`/`__mpwPointer`/`__mpwAudio` 等诊断全局 | 上游 `window.__wp`（**14 个方法，无任何几何 setter**，`docs/AUDIO-BAND-WIRING.md` §4.1）+ `__we*` 家族 | 测试台**已经只走 `__wp`**（`demo/bench-patch.js:2523`、`:2886`、`:2914`、`:2935`、`:6117-6125`）⇒ 协议面**已基本合并**，这是整合里最成熟的一块 |

### 1.4 已经做完的整合（不重复，只引用）

| 已完成 | 证据 |
|---|---|
| 端口/服务面合并（8899 → 8902，复用**同一份**实现，不复制） | `../docs/RENDERER-MERGE-PLAN.md:11,15,23-39,67` |
| 测试台预览**默认** = 本仓渲染器；上游档降为**显式**才生效 | `demo/bench-patch.js:1745`（`RENDERER_SOURCE_DEFAULT='repo'`）、`demo/index.html:808-813`（`value="repo" selected`）、`tests/bench-renderer-source-test.mjs:51-54`（A1） |
| URL 改写链（保留原 query、补 `id`/`res`、幂等、反向映射） | `tests/bench-renderer-source-test.mjs:69-99`（A4–A11b），实现 `demo/bench-patch.js:1786-1854` |
| 上游档"逐字不改"、能被显式切回、画布口径未被破坏 | 同文件 `:77-78`（A5）、`:96-99`（A11b）、`:459-460`（D1）、`:496-498`（D5） |
| 能力降级**有词汇**：状态行五态 + `caps` 名单 | `demo/bench-patch.js:1884-…`（`rendererSourceStatusPlan`）、测试 `:101-113`（A12/A13） |
| 本仓渲染器页**自己**有 web 路径（`?type=web` + 原始 URL + 服务端注入 shim），web 帧真的挂上并报到 | `demo.html:3139,3414`；`tests/bench-ui-headless-test.mjs:343-368`（R3 / R3c / R3b） |

---

## 2. "合并"的三种可落地含义：可行性 / 代价 / 风险 / 验收

### (A) 单一实现：淘汰产物，两个入口都指向本仓渲染器

**可行性：今天是"不可完成"，清完依赖后是"可完成"。** 硬障碍不是技术，而是**引用面 + 纪律**：

- 产物仍被 **21 个非文档文件**引用（`grep -l` 实测）：`build-pages.mjs`、`demo/index.html`、`demo/renderer/index.html`、
  `demo/sw.js`、`demo/assets/bench-DSKWIqmS.js`、`demo/bench-patch.js`（26 处）、`server/we-scene-demo-server-8902.mjs`（12 处）、
  `tools/site-paths.mjs`、`tools/bench-8901-sync.mjs`、`elysia/scene-scripts.js`，以及 11 个测试。
- **最硬的一根**：`demo/bench-patch.js:1097` 的 `shimFromRendererSource` 在**运行时从产物文本里读出**上游自带的 WE shim
  （用法 `:9160`、`:9183`；台账 = `docs/COPYING-RULES.md` #15，明写"用的是**本仓已分发的**产物"）⇒ 删产物会当场打断 web 档注入。
  可行替代**已存在**：服务端注入（`X-Mpw-Shim: injected` + `data-mpw-we-shim`，`tests/bench-ui-headless-test.mjs:352-365` 的 R3c 独立核对）。
- **产物自检与 Pages 面**：`build-pages.mjs:192` 的 `MUST` 含 `demo/renderer/index.html`；`:167-178` 把 `demo/` 拷成第二份
  `/WEwebLoader/`，只因**产物 minified 里写死了** `/wallpaper-engine-webgl/…` 前缀（`THIRD-PARTY.md:628-632`、
  `server/we-scene-demo-server-8902.mjs:25-26`）⇒ 淘汰产物 = 在线 demo 的落地页必须换成 `demo.html`（本仓渲染器），
  并重排 `tools/site-paths.mjs` 的 `LEGACY_REDIRECTS`。
- **测试台"上游档"档位的处置**（用户点名要答）：**分两步**。第一步（依赖清完前）**保留但正名**为
  「上游产物（排障档，无诊断面）」，并把它从"web 档夹具"里摘出去；第二步（A 落地时）`#renderer-src`
  **降为单档**：DOM 上只留一个禁用态说明，或干脆删控件并把 `RENDERER_SOURCES` 收到 `['repo']`，
  同时把 `A1/A5/A11b/D1/D5` 这批"两档契约"断言按"改断言描述新契约"改写（**不许放宽容差**，
  用户对这条线给过的原话就是这句，`docs/USER-ITEMS-20260921.md:120`）。

**"还差什么能力"清单（A 的前置条件，逐条有依据）**：

| # | 还差的能力 | 依据 | 谁受影响 |
|---|---|---|---|
| A-1 | web 档的 11 条测试台断言（T/W 两组）现在**显式切到上游档**当夹具 | `tests/bench-ui-headless-test.mjs:377-382`（T0 自证）、`:808`；陈旧注释在同文件 `:803`（"本仓渲染器页只认 scene/video"）——与 `:343-368` 的 R3/R3b 已矛盾 | 测试台 + 这 11 条断言 |
| A-2 | web 帧盒几何（覆盖式视口 / 内容比例）的另一半在产物**私有函数**里，公开面 `__wp` 14 个方法无几何 setter | `docs/AUDIO-BAND-WIRING.md` §4.1（逐条引产物代码结构与 `?framegeom` 的"未接"说明，`docs/README-DIAGNOSTICS.md:52`） | web 档画质/指针口径 |
| A-3 | 上游 `__we*` 控制面与 `"we-frame"` 消息（bench 侧仍有兼容分支） | 产物静态命中 8 个 `__we*` 名 + `"we-frame"`；`docs/BRANDING-SWAP-20260923.md:48-54` 列出"上游产物写死、无法重建的协议名" | 测试台/插件宿主 |
| A-4 | `pq` 粒子质量档（上游有、本仓刻意不引入） | `docs/README-DIAGNOSTICS.md:280-290` | 测试台质量控件语义 |
| A-5 | `pp=off` 的整屏后期层门控（上游 3 处、本仓 2 处）与 AA 路线差 | `docs/PATCHES.md:4922-4925`、`:4810-4811`、`:4929` | 画质档语义 |
| A-6 | 尚未移植的行为：`$mediaThumbnail`/`usertextures` 槽（bundle 命中 0）、copybackground z 序、`instanceoverride.brightness`、hlsl2glsl 规则族 | `docs/PATCHES.md:2537-2539`、`:11401-11402`；`docs/UPSTREAM-PORT-PLAN-20260919.md:284-385`（§3）、`:672-704`（§7.1 排序）；`THIRD-PARTY.md:748-755` | 画面正确性 |
| A-7 | 上游档自带的 1× CSS 画布口径会**消失**（这是 A 的语义，不是缺口，但必须写清） | `tests/bench-renderer-source-test.mjs:487-498`（D3/D5） | 用户观感（只会变清楚） |
| A-8 | 在线 demo 落地页 / Pages 二次拷贝 / `LEGACY_REDIRECTS` 重排 | `THIRD-PARTY.md:628-632`、`build-pages.mjs:167-178,192`、`tools/site-paths.mjs:32` | 发布面 |
| A-9 | 台账与声明面改写：`THIRD-PARTY.md` §6.4 从"再分发静态构建"改为"不再分发"；两份 `demo/LICENSE-webwallgl*` 的去留（FXAA shim §6 与 vendored 转译器 §9 的 MIT 义务**仍然存在**） | `THIRD-PARTY.md:607-640`、`docs/COPYING-RULES.md:194-201`（publish-check 四条，第 ④ 条含"未 vendored 时按不适用记录"） | 许可合规 |

**代价**：跨 6 个子系统（tests / bench / server / build / pages / docs）+ 一次"改断言"的窗口；`#renderer-src` 这个用户可见控件消失（或变单档）。
**风险**：中高。最大风险是**在 A-6 未裁定前删产物 = 把"还差的行为"永久失去对照**（产物是唯一能现场对照的参考实现，且它是 v1.3.16、比上游当前版还旧，见 §5）。
**验收**：`bash check.sh`（四段：docs-check → publish-check → diag-flag-check → run-all-tests）全绿；`bash tests/run-all-tests.sh --list` = 167 项（当前实测值）逐项 PASS/SKIP 无 FAIL；`node build-pages.mjs` 干跑产物自检；页面级只保留 SKIP-able 的真机项。

### (B) 本仓当唯一实现，但从产物里继续吸收行为（产物 = 参考实现 / 对照档）

**可行性：高，且是现有机器已经在跑的路线。** 本仓已有一套成熟机制：产物档 A/B（`#renderer-src`）、
每项移植带独立回退开关（`?overbright=legacy`/`?mdls=legacy`/`?scriptstore=`/`?texwrap=`）、
每项移植带 Node 级门禁 + 变异自证（RED-IF-REVERTED）、每次引入都在 `docs/COPYING-RULES.md` §4 台账留六列 +
`THIRD-PARTY.md` 逐行"照抄/适配"对照表（#12–#15 就是四个样板）。

**做法（逐项移植 + A/B 判据）**：顺序按 `docs/UPSTREAM-PORT-PLAN-20260919.md:676-686`（§7.1 收益÷风险）**已落 4 项**：
`overbright`（P-149）、MDLS 校验（P-152）、`localStorage` 共享持久（P-153，显式档）、REPEAT 采样器（P-154/P-168）。
**剩余 2 项 + 2 个附加项**：

| 优先 | 项 | 现状证据 | A/B 判据（可判、可回退） |
|---|---|---|---|
| 1 | `$mediaThumbnail` / `usertextures` 槽（封面/相框/TV） | `grep usertextures core/we-scene-bundle.js` = 0；`docs/PATCHES.md:2537-2539` | 新增 `?mediaslot=legacy/on`；纯函数门禁（槽名解析 + 三级优先级）+ 语料计数；宿主已备好 `getCoverForTexture()` |
| 2 | copybackground z 序捕获（合成源不能预渲染） | `docs/UPSTREAM-PORT-PLAN-20260919.md:284-385`；`composite-zoomorder` 门禁**尚不存在**（`grep` = 0） | 新增 `composite-zoomorder` 门禁（mock-GL 调用序 + FBO 生命周期）+ `?copybg=legacy` |
| 3 | hlsl2glsl 规则族（`9/9a-2/9-3` 向量宽度 + `vertConflicts`） | `THIRD-PARTY.md:748-755`：**已 vendored 的副本**（`vendor/hlsl2glsl/`，追到 `9531aaf`）有这些规则，但渲染路径用的是 `core/we-scene-bundle.js` 里的**内联**版（arity 4，`hlsl2glsl-wiring-test.mjs` 钉住） | 覆盖率门禁 `hlsl2glsl-coverage-test.mjs` 的"绝不下降"规则 + 新夹具复现 `s *= 500.0/g_Texture0Resolution` 那类编译失败 |
| 4 | `instanceoverride.brightness` | `docs/PATCHES.md:11401-11402` | 与 P-149 同形的纯函数门禁 |

**关键约束**：B 的"吸收"**只能吸收产物里 v1.3.16 就有的行为**；更晚的上游改动必须走**已 vendored 的 MIT 文件**
（`vendor/hlsl2glsl/**`）或上游源树（仓外、只读行为对照），**不能靠反编译产物**（见 §4 红线）。
**代价**：每项 = 1 个开关 + 1 个门禁 + 1 段台账，估 S–M 级；且每项都会给 `docs/README-DIAGNOSTICS.md` 主表加行（`diag-flag-check` 双向比对必须同时改，否则立刻红）。
**风险**：低–中（每项都有 `=legacy` 回退与逐位不变断言）。已知唯一冲突：`P-149` 会让 `particle-children-test` 的"父系顶点流逐位不变"变红 ⇒ 同批调整该断言（`docs/UPSTREAM-PORT-PLAN-20260919.md:701`）。
**验收**：每项各自的门禁（Node，无浏览器）+ `diag-flag-check` 双向 0 差异 + `check.sh`；真机像素项一律 SKIP-able，不许假红（口径见 `tests/bench-renderer-source-test.mjs:13-21,287-293`）。

### (C) 运行时二选一 + 能力协商（保持两份，统一入口 / 诊断 / 属性面板）

**可行性：已经实现，且正是今天的形态。** 统一入口（`/webloader/` 与产物页都在 :8902）、统一诊断（`/report`、层台账、`/diag` 只给本仓档）、
统一属性面板（bench 自己的 `#props`，跨档不变）都已到位（`../docs/RENDERER-MERGE-PLAN.md:11`、`demo/index.html:808-813`、`tests/bench-renderer-source-test.mjs:188-204`）。
能力协商的词汇也已存在：`rendererSourceStatusPlan` 的五态 + `caps` 名单（`demo/bench-patch.js:1884-…`；测试 A12/A13 `:101-113`，其中 `repo-degraded` 就是"本仓档明确降级的能力"）。

**代价**：低（现状即此），但要**长期维护两套语义**：183 个开关只对本仓档生效、上游档只认 11 个参数。
**风险**：**这是用户报障的主源**。用户能看到的"不一致"场景（每条都有读数依据）：

1. **糊**：同面板同包，上游 1× CSS（`demo/bench-patch.js:1741-1746`，A/B 实测 529×297）vs 本仓 ×DPR（1056×594 @DPR2）。
2. **该透的地方发黑 / 粒子没了**：用户第 24 条的原始症状与归因（上下文属性被页面顶掉已修；粒子差异是保真度而非缺陷）——`docs/USER-ITEMS-20260921.md:76`。
3. **音条没有数据**：上游档不认 `?bandfeed=`，状态行会明说"这个渲染器没有回报音条数据源"（`demo/bench-patch.js` 的 i18n `bandfeed.noReport`）。
4. **诊断面缺失**：`/diag`、`/report`、`?ln=` 逐层、`/media|web/dev`、`/api` 明确不在渲染器根路由名单里（`server/we-scene-demo-server-8902.mjs:1760-1768`；判据 `tests/bench-renderer-source-test.mjs:188-192`）。
5. **web 档能力不同**：T/W 两组的夹具是上游档（`tests/bench-ui-headless-test.mjs:377-382`），而本仓档的 web 帧虽能挂上（R3b，`:368`）却少了帧盒几何那一半（`docs/AUDIO-BAND-WIRING.md` §4.1）。
6. **合成样例两套契约**：上游档走 `__wp.loadSceneFile(blob)`，本仓档走 `?id=sample-synthetic`（i18n `rendererSrcSample*`）。
7. **雨丝/粒子长度等保真度差异**：`docs/USER-ITEMS-20260921.md:76` ⑤（我们按官方 `common_particles.h:52-57` 公式，含 `textureRatio`）。

**验收（若坚持 C）**：必须把上述 7 条**做成能力表数据**而不是文案，并让状态行逐条显示"这一档少了什么"（复用 `caps`）；
再加一条门禁：两档的**面板列几何跨档逐字相同**（已有先例，`tests/bench-renderer-source-test.mjs:486-492` 的 D3 第一条不变量）。

---

## 3. 推荐路线与分阶段清单

**推荐 (B)，并把 (A) 作为有前置条件的终点，(C) 只作过渡机制。**
一句话理由：用户已经把方向定成"预览只跑本仓、上游最多作对照"（`docs/USER-ITEMS-20260921.md:120`），
而**产物无源码 ⇒ 不存在"两份合成一份"的技术路径**，能做的只有"把行为逐项搬过来"——这正是 B。
A 不是被否决，而是**必须先满足 A-1…A-9**（其中 A-6 的 4 项要么移植、要么书面放弃）；C 不是方案，是**当前状态**。

### 阶段总览

| 阶段 | 目标 | 是否可纯 Node 验证 | 前置 |
|---|---|---|---|
| P1 | 统一"能力面"（把两档差异变成数据）+ 修正 3 处陈旧口径 | ✅ 全部（无浏览器、无 Windows） | 无 |
| P2 | 逐项移植 A-6 的 4 项（各带独立开关与 A/B 判据） | ✅（mock-GL / 纯函数） | P1 的能力表 |
| P3 | 把 web 档夹具与 shim 来源从产物摘出去 | 部分（R3/R3c 的 Node 段 + 真机段 SKIP-able） | P2 之 1（媒体/媒体槽） |
| P4 | 淘汰产物（A 终点）+ 发布面与台账改写 | 部分（build/pages/docs 全 Node；画布级 SKIP-able） | P1–P3 |

### P1 —— 能力面统一 + 陈旧口径修正（本轮之后可立即开工）

**进度（2026-10-05）**：第 1 条的能力表已落地 —— `demo/bench-patch.js` 的 `RENDERER_SOURCE_CAPS` +
`rendererCapDifferences()`（差异**现算**），并把它钉进 `tests/bench-renderer-source-test.mjs` 的 A21–A27
（差异集合逐键点名、入口与代码常量一致、`webPath` 两档都为真、陈旧口径"本仓没有 web 路径"不许再出现）；
`RENDERER_SOURCE_DEFAULT` 上方那段旧注释同步更正。第 2–6 条**已完成**：`bench-ui-headless` 两处旧口径注释更正；`README-DIAGNOSTICS` 的 `framegeom` 行改成「上游产物的 web 帧私有函数不可注入 / 本仓 web 路径已接指针那一半」；`RENDERER-ARCHITECTURE` 新增「两个渲染器表面」一节（表 + 纪律）；`PATCHES` 那条版本口径更正为「产物自报 v1.3.16、1.3.23 是转译器 vendored 口径」。**P1 全部完成**：`rendererSourceStatusPlan` 的档位注记改为**按表渲染**（`rendererTierNote()` 只从 `RENDERER_SOURCE_CAPS` 取值，喂自定义表文案就跟着变 ⇒ 判据 A28–A31 直接钉住这条）；运行时的降级名单仍来自 `__mpwHostCaps`（"这次挂载真实降级了什么"），两者语义不同、**刻意不合并**。
`README-DIAGNOSTICS` 的 `framegeom` 行、`RENDERER-ARCHITECTURE` 新增一节、`PATCHES:4969` 更正）尚未做。

**改什么文件**
1. `demo/bench-patch.js`：新增**纯函数能力表**（建议 `RENDERER_SOURCE_CAPS = { upstream: {...}, repo: {...} }`，紧邻 `demo/bench-patch.js:1734` 的 `RENDERER_SOURCES`），
   把 A-1…A-9、C 的 7 条变成**数据**；`rendererSourceStatusPlan`（`:1884`）改为**按表渲染**降级名单（不再手写文案）。
   同时修正 `:1746-1747` 那段"web 壁纸路径本仓渲染器还没有"的陈旧注释（已与 `demo.html:3414` 和 R3b 矛盾）。
2. `tests/bench-renderer-source-test.mjs`：A 段新增两条纯函数断言 —— ①能力表是**唯一真源**（两档的差异集合与表一致，
   且"表里没有的差异"必须由断言点名）；②文案里**不许**再出现"本仓没有 web 路径"这类与实测相反的表述（防再次陈旧）。
3. `tests/bench-ui-headless-test.mjs:803`：把"本仓渲染器页只认 scene/video"这句旧口径改成"T/W 两组**当前**仍以产物档为夹具（P3 改）"。
4. `docs/README-DIAGNOSTICS.md:52` 的 `framegeom` 行：把"web 壁纸 iframe 尺寸路径本仓库不可注入 ⇒ 未接"改写为
   "**上游产物的** web 帧私有函数不可注入；本仓渲染器页自己的 web 路径（`?type=web`）已接指针口径那一半，帧盒那半见 §…"。
5. `docs/RENDERER-ARCHITECTURE.md`：新增一节「两个渲染器表面」（本文 §1 的浓缩版 + 指向本文件），
   并在文件头加一句"产物不是本仓源码、不可重建、字节不可改"。
6. `docs/PATCHES.md:4969`：把"上游 1.3.23 的 minified 产物"更正为"产物自报 `v1.3.16`（`demo/bench-patch.js:53`）"，
   并注明与 `THIRD-PARTY.md:712-713` 那条 `9531aaf` 的口径分属"产物"与"vendored 转译器"两件事。

**判据（全部 Node 级，无浏览器 / 无真机）**
`node tests/bench-renderer-source-test.mjs`（A/B/C 段必须全 PASS；D 段无 :8902 或无 Playwright 时按既有口径 SKIP）、
`node tests/bench-shell-fixes-test.mjs`（E2a–E2e 仍钉住产物 shim 提取这条路存在）、
`node tests/diag-flag-check.mjs`（不新增开关 ⇒ 必须仍是"183 == 183，0 差异"）、
`node tests/docs-check.mjs`（新引用的文件名/章节必须真实存在）。
**回退**：P1 只加纯函数与文档，不动任何渲染语义；`git revert` 后行为与今天逐位相同（默认档仍是 repo）。

### P2 —— 逐项移植（B 的主体）

对 A-6 的 4 项各做一次"P-149 式"闭环：**书面规格/契约 → 实现（新开关，缺省逐位不变）→ 门禁（Node + 变异自证）→ 台账（`COPYING-RULES.md` §4 六列 + `THIRD-PARTY.md` 新条目）→ 主表登记**。
顺序取 `docs/UPSTREAM-PORT-PLAN-20260919.md:676-686` 的收益/风险序：① `$mediaThumbnail` 槽（P-150a）② copybackground z 序（P-151）③ hlsl2glsl 规则族（走**已 vendored 的 MIT 文件**接线，`THIRD-PARTY.md:748-755`）④ `instanceoverride.brightness`。
**判据**：每项新门禁入 `tests/run-all-tests.sh`（当前 167 项）且 `diag-flag-check` 双向 0 差异；每项必须有 `?<name>=legacy` 且默认档逐位不变（`docs/COPYING-RULES.md` §4 的留痕要求、`docs/PATCHES.md:11409` 的 P-152 样板可照抄）。
**回退**：单项开关级回退 + 单项提交；不需要整体回滚。

### P3 —— 摘掉"产物在 web 路径上的两根线"

1. **夹具**：把 `tests/bench-ui-headless-test.mjs` 的 T/W 两组（`:377-382`、`:808`）改为**跑本仓档**，
   断言口径不变（帧真的挂上、媒体元素存在性按本仓 web 路径重取读数）；上游档保留为**排障**用途。
2. **shim 来源**：删掉 `demo/bench-patch.js:1097` 的 `shimFromRendererSource` 依赖链（`:9160`、`:9183`），
   改用**已有的**服务端注入（`X-Mpw-Shim: injected` + `data-mpw-we-shim`，R3c `:352-365`）或本仓自己的 shim 常量模块；
   `tests/bench-shell-fixes-test.mjs:186-194` 的 E2a–E2e 按"改断言描述新契约"改写（不许删断言/放宽容差）。
**判据**：`bench-ui-headless`（R1/R3/R3b/R3c/T/W）+ `bench-renderer-source-test`（A5/A11b 反向映射仍需成立）+ `web-frame-host-test`。
**回退**：`#renderer-src` 两档仍在，随时把夹具切回上游档。

### P4 —— 淘汰产物（A 终点）

删 `demo/renderer/index.html` + `demo/assets/renderer-*.js` 的引用链：`build-pages.mjs:192` 的 `MUST`、`:167-178` 的
`/WEwebLoader/` 二次拷贝（换成不再依赖产物写死前缀的落地页）、`demo/sw.js`、`demo/index.html:27`（台架 script）、
`tools/site-paths.mjs:32`、`tests/demo-check.mjs:806-807`（`data-webwallgl-gl` 契约）、`tests/pack-closure-test.mjs`、
`tools/bench-8901-sync.mjs`；`#renderer-src` 收成单档；`THIRD-PARTY.md:607-640` §6.4 改写为"不再分发"；
`docs/PATCHES.md` 记一条"产物退场"补丁，写明**哪些行为是书面放弃的**（A-4/A-5 的取舍类差异 + A-2 的帧盒那半）。
**判据**：`bash check.sh` 四段全绿；`bash tests/run-all-tests.sh --list` 167 项无 FAIL；
`publish-check.mjs` 0 阻塞（第 ④ 条按"未 vendored ⇒ 不适用"记录，`docs/COPYING-RULES.md:194-201`）；
画布级真机项（若跑）仍按 SKIP-able 口径，不许把"环境无 WebGL2"写成红（`tests/bench-renderer-source-test.mjs:287-293`）。
**回退**：产物字节**从未被改过**（`docs/PATCHES.md:4971`），单次 `git revert` 即可整体恢复。

---

## 4. 许可证红线（用仓库既有规则的原文作依据）

上游产物是 **MIT**，本仓是 **GPL-3.0-or-later**；MIT → GPL 是**允许的单向流动**（`docs/COPYING-RULES.md:29`：
"MIT 代码可以进 GPL 项目；进入后该副本按 GPL 分发，但**原 MIT 声明必须保留**"）。合并时**必须遵守**下列既有纪律：

1. **不得反向流动**（`docs/COPYING-RULES.md:32`）："GPL 代码**不得**进入插件（不得复制、改写、逐行翻译、粘贴注释/常量顺序）"；
   同理本仓的 GPL 代码不得流回 `oneincase/webwallgl`（`THIRD-PARTY.md:601-605`）。**合并的方向只能是 MIT → GPL。**
2. **不得把 minified 产物反编译/美化后塞进本仓源码**。三条既有依据叠加：
   ① 引入任何第三方代码必须先在台账登记，且**commit/tag 必填**（`docs/COPYING-RULES.md:102`）；
   产品不是一次可指的 commit 的文件级副本，反编译产物给不出"上游路径 + 行号 + blob"，**登记字段无法成立**；
   ② 本仓的"重写"动作有明确流程与差异举证要求（`docs/COPYING-RULES.md:107-118` §5：写规格 → 只依据规格实现 →
   必须可证明在**命名/分支顺序/常量组织/错误文案/边界处理**五个维度不同），且**不准自称"洁净室"**
   （`docs/COPYING-RULES.md:120-148` §5.1："本项目**主张的是『独立实现』，不是『洁净室重写』**"，
   理由 = 实现者接触过原件）；③ 产物本身是**明确保护对象**：`docs/PATCHES.md:4961`（"活引用的 vendored 预构建物，不是死文件"）、
   `:4971`（"**不改产物字节**：改了既不可重建，也破坏与上游的对拍口径"）。
   ⇒ **允许**：把产物当**行为证据**（读数、调用序、参数、DOM/协议名）写进规格，再按规格独立实现（台账写"按规格独立实现"）；
   **不允许**：把产物片段（或其美化/重命名版本）当作源码来源。
3. **照抄只在逐项登记 + 用户明示的前提下开**。本仓已开三处例外：`THIRD-PARTY.md` §6（FXAA shader）、
   §9（hlsl2glsl 两文件逐字节 vendored）、§14/§15（鼠标尾迹、粒子 `children`，用户直接指示"直接复制过来就算了"，
   `docs/COPYING-RULES.md` #12/#13）。**它们的共同前提是"能从上游 commit 里逐行核对"** —— 产物（minified、无行号）
   满足不了这个前提，所以**新开"从产物照抄"的口子在本仓现有纪律下不成立**。
4. **再分发义务随产物走，也随删除走**。今天：`demo/**` 是 MIT 构建的再分发，两份 MIT 声明必须在位
   （`THIRD-PARTY.md:614-640`；`publish-check.mjs` check ④ 强制"任何匹配 `webwallgl` 的路径必须伴随含 MIT 的
   `LICENSE`/`COPYING`"）。淘汰产物后：**FXAA shader（§6）与 vendored 转译器（§9，`vendor/hlsl2glsl/LICENSE`）
   的 MIT 义务不消失**（`THIRD-PARTY.md:535-537`："Nothing in §1–§4 is relicensed by this"），
   所以两份 `demo/LICENSE-webwallgl*` **不能顺手删**，只能改写适用范围；`publish-check` ④ 按"不适用"记录。
5. **打包分发不得把渲染器编进 MIT 宿主**（`THIRD-PARTY.md:502-523` §4B.1，律师点名的边界失效条件）：
   "渲染器 MUST remain a separate sidecar process. It must NOT be compiled into the same binary as the MIT plugin"。
   ⇒ 任何"合并成一个 app/单文件"的想法在此**已被否决**；本文三方案都保持 HTTP + `postMessage` 边界不变。
6. **工作流方向**（`docs/COPYING-RULES.md:51` §2.4，用户拍板）："以后**先改 MIT 的插件，GPL 的渲染器再借用**"，
   反向一律禁止。⇒ 若 P2/P3 要改 web shim/交互这类**同时存在于插件侧**的东西，先插件、后渲染器。

---

## 5. 风险与"做不到"（宁可如实说做不到）

**做不到（在现有条件下）**

1. **"真正合并成一份实现"做不到**：产物是 minified、无源码、**仓库内不可重建**（`docs/PATCHES.md:4969`），
   且**字节不可改**（`:4971`）。两份实现之间不存在"合代码"的操作，只存在"把行为搬过去 + 删旧的"。
2. **无法把产物当移植来源做逐行对照**：没有上游路径/行号/blob ⇒ 台账（`docs/COPYING-RULES.md:75-105`）的必填列填不出来，
   反编译后重写还会同时踩 §5/§5.1 的流程与口径。⇒ B 的移植只能"按规格独立实现"（行为契约先行）。
3. **产物不是上游当前行为**：产物自报 `v1.3.16`（`demo/bench-patch.js:53/274/9766`），
   仓外源树 HEAD 是 `b61e891`（1.3.16 期），而台账/已 vendored 的转译器追到 `9531aaf`（v1.4.1，`THIRD-PARTY.md:712-713`），
   另有 11 个新提交的差距（`docs/WEBWALLGL-UPSTREAM-STUDY.md:49`）。⇒ **从产物吸收到的行为是"旧上游"的**；
   更新的行为只能走 vendored MIT 文件或上游源树（只读行为对照）。而 `docs/PATCHES.md:4969` 现写的"1.3.23"与产物自报**矛盾**，
   这条口径必须先修正（P1 第 6 项），否则后续所有"上游语义"讨论都建在错版本上。
4. **两处相邻能力在产物里无法注入**：web 帧盒几何（`nw()`/`Y1()`）是 minified 模块内私有函数，公开面 `__wp` 的 14 个方法
   **没有任何几何 setter**（`docs/AUDIO-BAND-WIRING.md` §4.1）；`isPostProcess` 在本仓源码 0 命中、在产物有 8 处命中
   （`docs/PATCHES.md:4922-4925`）。⇒ "让两份共享这一段"物理上不可能，只能各自实现或放弃。
5. **有些差异不是缺陷、因此不可能"合并掉"，只能选一个**：分辨率口径（1× CSS × `renderDpr` 上限 vs 显示尺寸 × 设备 DPR）、
   AA 路线（离屏 MSAA+resolve vs 原生 `antialias`，`docs/PATCHES.md:4810-4811`）、`pq` 档（本仓刻意不引入，
   `docs/README-DIAGNOSTICS.md:280-290`）。A 的含义就是"保留本仓口径、放弃上游口径"，必须在文档里写成**取舍**而不是"修好了"。
6. **本机无法给出画布级证据**：本机（Android/PRoot，无 `/dev/dri`）无头 Firefox 建不了 WebGL2
   （`tests/bench-renderer-source-test.mjs:13-21`），所以 D3/D4/D5 这类判据在本机**必然 SKIP**；
   本文引用的画布读数都来自既有真机记录（`demo/bench-patch.js:1744`、`docs/USER-ITEMS-20260921.md:125`），
   **不是本轮新测**。本轮亦按约束未起浏览器。⇒ P1–P4 的"验收"必须区分 **Node 级判据（可当场验）** 与 **真机判据（SKIP-able）**。
7. **`?src=<itemId>` 直开在上游档不解析**（要宿主喂包），这条上游档的固有限制只能靠"淘汰该档"消失（`docs/OPEN-ITEMS-20260923.md:44`）。

**主要风险（可缓解）**

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| 上游档被"顺手改坏"，A/B 对照失效 | 有人为了统一而去动产物/改它的加载链 | 产物字节红线（`docs/PATCHES.md:4971`）+ A5/D5 断言（`tests/bench-renderer-source-test.mjs:77-78,496-498`） |
| 两档行为漂移到"用户以为坏了" | 长期保持 C 形态 | P1 的能力表 + 状态行逐条显示降级项（`caps`，A12/A13 已有判据） |
| 删除物产后"还差的行为"永久失去对照 | 跳过 A-6 直接进 P4 | P4 前置 = P2 完成或**书面放弃**；产物恢复成本 ≈ 一次 revert（字节从未改） |
| 文档陈旧导致误判（已发生） | 注释/表格停留在旧契约 | P1 把"陈旧表述"变成断言（不许出现与实测相反的文案）；`docs-check` 守引用 |
| 移植批次碰既有门禁 | 例如 P-149 让 `particle-children-test` 的"逐位不变"变红 | 同批调整该断言（`docs/UPSTREAM-PORT-PLAN-20260919.md:701`），**改断言描述新契约，不放宽容差** |

---

## 6. 证据索引（本文引用的关键 file:line）

| 主题 | 证据 |
|---|---|
| 端口合并已完成（不重复） | `../docs/RENDERER-MERGE-PLAN.md:11,15,23-39,67` |
| 两档契约 + 默认档 = repo | `demo/bench-patch.js:1734,1745,1786-1854`；`demo/index.html:808-813`；`tests/bench-renderer-source-test.mjs:51-54,69-99,101-113` |
| 上游档 = 1× CSS 画布（"糊"的根因） | `demo/bench-patch.js:1741-1746`；`tests/bench-renderer-source-test.mjs:66-67,487-498` |
| 本仓活档位（显示尺寸 × DPR，带上限） | `tests/bench-renderer-source-test.mjs:147-175`；`core/we-scene-bundle.js`（`parseResTier`/`resolveLiveCanvasSize`/`glCanvasAttrs:14836-14848`） |
| 本仓渲染器页已有 web 路径（与陈旧注释矛盾） | `demo.html:3139,3414`；`tests/bench-ui-headless-test.mjs:343-368`（R3/R3c/R3b）vs `:803` 与 `demo/bench-patch.js:1746-1747` |
| T/W 两组仍以上游档为夹具 | `tests/bench-ui-headless-test.mjs:377-382,808` |
| web 帧盒几何在产物私有函数里、不可注入 | `docs/AUDIO-BAND-WIRING.md` §4.1；`docs/README-DIAGNOSTICS.md:52` |
| 产物档案：活引用 / 不可重建 / 不可改字节 | `docs/PATCHES.md:4961,4969,4971` |
| 产物自报版本 v1.3.16 | `demo/bench-patch.js:53,274,9766`；`docs/WEBWALLGL-UPSTREAM-STUDY.md:70,251` |
| 产物再分发 + MIT 声明义务 | `THIRD-PARTY.md:599-640`；`docs/COPYING-RULES.md:194-201` |
| 许可单向流动 / 台账 / 独立实现口径 / L1–L5 | `docs/COPYING-RULES.md:29,32,36,51,75-105,107-118,120-148,216-…,314,341,424` |
| 边界失效条件（不得编进同一二进制） | `THIRD-PARTY.md:484-523` |
| 剩余可移植项与排序 | `docs/UPSTREAM-PORT-PLAN-20260919.md:284-385,676-686,701,705-724` |
| 未移植残留 | `docs/PATCHES.md:2537-2539`（`$mediaThumbnail`/`usertextures`）、`:11401-11402`（`instanceoverride.brightness`）、`:11603`（脚本存储容量）、`THIRD-PARTY.md:748-755`（hlsl2glsl 规则族） |
| 诊断面（183 开关 / `/report` / 台账 / elysia） | `docs/README-DIAGNOSTICS.md:6,52,280-290,340`；`docs/RENDERER-ARCHITECTURE.md:88-93` |
| 上游档不认 `?bandfeed=` 等能力差 | `demo/bench-patch.js` i18n `bandfeed.noReport` / `rendererSrcSample*`；`tests/bench-renderer-source-test.mjs:188-204`（C4/C5b） |
| 用户已定的方向与 web 档代价 | `docs/USER-ITEMS-20260921.md:120,125,132-134`；`docs/OPEN-ITEMS-20260923.md:44` |
| 产物引用面（删除代价） | `build-pages.mjs:167-178,192`；`tools/site-paths.mjs:32`；`tests/demo-check.mjs:806-807`；`demo/bench-patch.js:1097,9160,9183` |
| 门禁规模（本轮实测，只读） | `bash tests/run-all-tests.sh --list` → "共 167 项"；`check.sh` 四段 |

**复现本文数字的只读命令（本轮全部实际执行过，未起浏览器、未改文件）**

```bash
cd <工作区>/we-scene-demo
sha256sum demo/assets/renderer-BOSoB05I.js demo/renderer/index.html      # 产物指纹
node tests/diag-flag-check.mjs                                            # 183 == 183，0 差异
bash tests/run-all-tests.sh --list | head -2                              # 167 项
grep -rln "renderer-BOSoB05I\|bench-DSKWIqmS\|wallpaper-engine-webgl" . --include=*.mjs --include=*.js --include=*.html | grep -v node_modules
grep -c usertextures core/we-scene-bundle.js                              # 0（媒体槽未实现）
grep -n "RENDERER_SOURCES\|RENDERER_SOURCE_DEFAULT" demo/bench-patch.js
```

---

## 7. 本文不做的事

- 不改任何代码/测试/配置；不 `git add` / `git commit`；不起浏览器、不跑渲染（本机内存紧张且别的线在跑 Firefox）。
- 不重写、不复刻、不美化 `demo/assets/renderer-*.js`；本文对它的引用**只有**字符串命中计数、字节数/哈希、以及行数级静态观察。
- 不宣称"洁净室"：本文涉及的任何"按规格独立实现"都按 `docs/COPYING-RULES.md:120-148` §5.1 的口径表述。

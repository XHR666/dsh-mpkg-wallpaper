# docs/RENDERER-ARCHITECTURE.md — we-scene 渲染器架构地图（任务书 C3，2026-09-13）

> **参照来源许可声明**：本文档引用的 `wer-ref/` 是**第三方参考实现**
> （`Aromatic05/wallpaper-engine-renderer`，为 `catsout/wallpaper-scene-renderer` 的 fork，
> **GPL-2.0-only**），**不是 Wallpaper Engine 官方代码，也不是"真值源"**。
> 与本项目渲染器（GPL-3.0-or-later）**许可不兼容**：仅用于**行为对照**，
> **不得复制、改写、逐行翻译其代码、注释、常量组织或错误文案**。
> `we-layerd-ref/`（`Aromatic05/we-layerd`）**无任何许可**（保留所有权利），同样只可读行为结论。
> 血缘自查结论见 `<工作区>/docs/reverse/WER-REF-LICENSE-AUDIT.md`。

> 目的：**防第四次"CPU 预览对、真机 GL 错"事故**。三次事故（附件锚点整体偏移 / 脚本 origin 覆盖 /
> ownSizes 拉伸 1/1.9）的共同点：改动只落在浏览器路径、没有机器验收。本文给新会话三样东西：
> ①模块地图（语义在哪个函数）②官方语义不变量清单（哪些行为是"对"的定义）③连带影响地图（动哪
> 里会坏什么）。读完应能回答："某语义在哪、哪些是刻意 hack、回退开关是什么"。
>
> 行号会漂移，**以函数名/section 注释为准**（bundle 内有 `// ===== src/... =====` 分节标记）。
> 开关全集以 `node diag-flag-check.mjs` 抓取为准（当前 62 个，主表 `README-DIAGNOSTICS.md`）。

## 两个渲染器表面（2026-10-05 补，P1）

本仓有**两份**渲染实现同时在跑，工具条「渲染器」档决定预览用哪一份；口径差异的唯一真源是
`demo/bench-patch.js` 的 `RENDERER_SOURCE_CAPS`（差异由 `rendererCapDifferences()` 现算，
`tests/bench-renderer-source-test.mjs` 的 A21–A27 逐键点名）。要点：

| | 本仓渲染器（缺省档） | 上游产物 |
|---|---|---|
| 入口 | 同源 `/webloader/`（`:8902` 直供 `demo.html` + 本仓 `core/`） | `/wallpaper-engine-webgl/renderer/index.html` |
| 画布口径 | `?res=dpr` 活档位：显示尺寸 × 设备 DPR（上限 3840×2160 / 单边 4096，随尺寸重算） | `clientWidth × min(devicePixelRatio, renderDpr)`；DPR 档缺省 1 ⇒ 1× CSS 像素出图 |
| MSAA | 原生 `antialias`（与 `q!=off` 互斥） | 离屏多重采样 FBO/RBO + 帧末 resolve |
| 音条 | `?bandfeed=wallpaper|mic|sim|off` + `__mpwAudioBand*` | 不认该参数 |
| URL 开关 | 215 个（`tests/diag-flag-check.mjs` 双向 0 差异） | 11 个（`type/src/fit/renderDpr/sceneFps/muted/loop/filter/mediaBase/liveSystem/opaque`） |
| 宿主 API | `__wp` + `__mpw*` 诊断全局 | `__wp`（14 个方法、无几何 setter）+ `__we*` 家族 |
| web 壁纸 | **有**：`?type=web` + 原始 URL + 服务端注入 shim | 有：产物自己的 `video|gif|image|scene|web|canvas` 分派 |
| 场景包交接 | 按 `?id=` 取包（同源 `/pkg/<id>`） | 必须 `mediaBase` + `src` 同时给（否则 `canvases: []`） |

⚠ 纪律：产物**不是本仓源码**（minified、不可重建、字节不可改），只能在行为面参照与吸收；
合并路线与分阶段清单见 `docs/RENDERER-UNIFY-PLAN.md`。

## 0. 文件所有权（三会话并行约定）

| 文件 | 归属 | 内容 |
|---|---|---|
| `core/we-scene-bundle.js`（293KB） | A | 全部渲染语义：容器/纹理解析、parseScene 几何、GL 渲染器、效果链、粒子、混合 |
| `demo.html` | A | 浏览器宿主：加载链路、脚本同步循环、蒙皮回调、上报 payload、诊断开关 |
| `elysia/**` | A | CPU 对照渲染器（`?mode=elysia`）+ 脚本宿主（nsl.js/scene-scripts.js 被两端共用） |
| `core/attach-transform.mjs` | 共享 | elysia 四函数移植（`_mdlAnchors`/`_puppetBoneFinal`/`_attachmentOffset`/`resolveTransform`），浏览器+Node 零依赖共用 |
| `server/we-scene-demo-server.mjs` | A | :8899 演示服务器 + `/report` 上报接收 |
| `dsh-mpkg-wallpaper/**` | B | 插件/宿主 |
| `run-all-tests.sh`、`parity-check.mjs`、`preview.mjs`、`report-audit.mjs` 等工具 | C | 机器验收（本会话） |

## ① 模块地图（core/we-scene-bundle.js，按内部分节）

### 解析（PKG / TEX / MDL / MDAT）
| 函数（bundle 内位置） | 语义 |
|---|---|
| `parsePkg` / `getEntry` / `verifyLayout`（`src/pkg/container.js` 节） | PKGV/PKGM/v1.0 容器：头部→条目表→数据段；mpkg 只读小条目不读大视频 |
| `parseTex` / `TEXTURE_FORMATS` / `FIF`（`src/pkg/texture.js` 节） | .tex 头 + mip 链；format 5=半分辨率 BC3（RE-40） |
| `decodeMip0` / `decodeImageMip0` / `decodeMips` / `decodePixels` | mip0 解码：RGBA 直出 / PNG·JPEG 走位图 / BC1-3（LibSquish 移植，像素级一致）/ LZ4（`lz4Decompress`） |
| `spriteInfo` / `spriteMultiImages` / `spriteFrameImageRects` / `computeSpriteFrameUV` / `spriteFrameRectUV` | 精灵表：TEXS 帧布局（row-major 换行/回绕）、多图精灵（imageId 换图） |
| `extractAnimKf` / `animValueAt` / `evalPropAnimation` | 属性动画轨道采样（fps/尾帧 wrap 由这里定） |
| `snapshotAuthoredOrigins` / `syncScriptOrigins` / `detectBadAnimFrames` | 脚本 origin 增量同步（P-31 Bug B 修复）+ 坏帧检测（P-15） |

### 几何（矩阵 / 附件锚点 / 父链 / 对齐）
| 位置 | 语义 |
|---|---|
| `parseScene`（`src/scene/parse.js` 节，L954+） | **核心**：对象树→层数组；父链合并（origin += R(ang)·(child.origin×scale)，弧度直收）；`opts.attachCtx` 提供时经 `core/attach-transform.mjs` 计算附件锚点；末尾统一 y 翻转一次 |
| `core/attach-transform.mjs` | elysia 移植四函数：`_mdlAnchors`（MDL 的 MDAT0001 锚点表 name→{boneIdx,4×4}）、`_puppetBoneFinal`（bind 世界位姿 ⊕ animationlayers 增量×blend——与蒙皮同一份代码）、`_attachmentOffset`、`resolveTransform` |
| `mat4Identity/Multiply/Ortho/Translate/Scale/RotateZ/LookAt/TransformPoint`（`src/render/math.js` 节） | 列主序矩阵；`mat4RotateZ(m,−θ)`（负角） |
| `buildCamera`（L1456+） | ASPECTCROP cover 四分支 + `zoom` 除法（wer-ref VulkanRender.cpp:1531-1576 同式） |
| `alignmentOffsetForToken`（P-95 前名 `alignmentOffsetForToken`） | 行为规格 `docs/IMAGE-ALPHA-ALIGN-SPEC.md` §2：left→+w/2、top→−h/2（y-up），消费端 y 取反；原判定依据为第三方参考实现 wer-ref（`Aromatic05/wallpaper-engine-renderer`，GPL-2.0-only，仅行为对照），**已洁净室重写** |
| `resolveMaterial` / `resolveBuiltin` / `BUILTIN_MODELS/MATERIALS` | image→model.json→material.json→passes[0].textures[0] 材质链 + 内置模型 |

### 绘制（层循环 / compositeLayer / 网格路径）
| 位置 | 语义 |
|---|---|
| `createRenderer`（L3660+） | 渲染器工厂；opts 回调面：`onMeshLayer`（蒙皮层画 mesh）、`onLayerDraw`（台账）、`onLog`、`MPW_HOOK_SLOTS` 扩展钩子 |
| `renderScene`（L4586+，async） | 层循环 + 效果链 FBO 编排 + COPYBG + HDR/bloom 收口 + `__hdrRetry` |
| `renderLayer`（L4935+） | 单层分发：可见性/粒子/文本/网格退化早退、精灵帧 `__spriteUV` 计算 |
| `compositeLayer`（L4431+） | **quad 绘制核心**：mvp = viewProj·translate(origin)·rotZ(−θ)·scale(w,h)·alignment；UV 优先级 **精灵帧 > uvRect > 整图**；colorBlendMode≠0 走 `COPY_FRAG_SCREENBLEND`（先 blit 屏幕背景→u_Screen，shader 内混合，关固定混合）；视差官方公式在此叠加 |
| `renderMeshLayer`（L3811+） | puppet 网格：`wpos = origin + u_Scale·v`（顶点即模型空间，**无 bbox 中心补偿**，MCC 默认关）；g_bones 蒙皮 |
| `drawGuard`（L4413+） | 不可绘制拦截：isTexture 明确 false / 反馈环（采样=绘制目标）/ 尺寸退化 → 跳过+上报 |
| `layerQuadVerts` / `localQuadVerts` / `localQuadVertsUV` | 屏幕空间 quad / [-0.5,0.5] 局部 quad / uvRect 子窗映射 |

### 效果链（FBO 乒乓 / COPYBG / 反馈环）
| 位置 | 语义 |
|---|---|
| `hlsl2glsl` / `preprocess`（`src/render/hlsl2glsl.js` 节） | 官方 HLSL→GLSL 转译（内置 shader 13 个全过 `internal-shader-validate`） |
| `resolveEffectChain`（L1287+） | effect.json→passes/fbos/commands；C1-C17 对齐 wer-ref（P-15…P-18） |
| `getFBO(w,h,tag)`（L3999+） | FBO 池，**每效果命名空间**（tag）隔离，乒乓复用 |
| `resolveDisplacedUv/applyShakeMaskMix/applyWaterFlowOverlay/composeColorEffectStack`（`src/render/effects.js` 节） | CPU 侧效果参数求值（供 mock-GL 测试与 elysia 对照；洁净室重写见 `docs/EFFECTS-COMPUTE-SPEC.md`） |
| COPYBG（`copybackground`） | 层效果需要读"当前屏幕背景"时先拷贝再绘制（P-18 官方语义） |
| 反馈环断言 | 效果 pass 采样目标=自身颜色附件 → 跳过该 pass 绘制（P-36 升级为硬拦截） |

### 后处理（bloom / HDR）
| 位置 | 语义 |
|---|---|
| `BLOOM_EXTRACT_FS/BLUR_FS/COMPOSE_FS` + `ensureBloomProgs/VAO/SceneTex` | bloom 四 pass（extract→blur×2→compose） |
| `presentHdrScene` / `ensureHdrBlackTex` | HDR 浮点 RT 输出与 LDR 回退（`general.hdr` 跟随，`?hdr=0/1` 强制） |

### 脚本宿主（转译 / VM 语义 / API 面）
| 位置 | 语义 |
|---|---|
| `elysia/nsl.js` | node:vm 浏览器替身：**`with (__nslCtx)` 执行**（剥 'use strict'），顶层赋值即回写 context（P-33 根修）；沙箱内存 `localStorage`（WE get/set 命名） |
| `elysia/scene-scripts.js` | ESM→可执行转译（**保留同名绑定**：export function X 内部自调可用，P-35#1）；`scriptproperties` JSON 字符串先 parse；**先全部 init 再逐帧 update**（P-35#13）；4Hz 节流 |
| demo 同步循环（demo.html L1165-1177） | 每帧 raw→scene 同步 text/alpha/color；origin 走 `syncScriptOrigins`（判据=脚本**真的改过** authored origin 才施加增量）；`__texFrame/__texFrameForced/__texFramePlay` 三字段驱动精灵帧（P-39 接线） |
| API 面 | 131 段语料 `script-corpus-audit --strict` 缺 API 清零（P-35）：Vec2/Vec3.mix/WEColor.mix/getTransformMatrix/getParent 链/getTextureAnimation/enumerateLayers/MediaPlaybackEvent/localStorage… |

### 上报（diag / report / layerLedger / texStats）
| 位置 | 语义 |
|---|---|
| demo payload（L2199 附近） | `layers[]`（origin/size/v/tex/tn/skin/a/fx/ln/drawn）、`layerLedger[]`（**只记上屏趟**的设计坐标矩形+中心 readPixels+纹理种类，P-32/P-36 守卫）、`texStats[]`、`meshDraws/meshSkip`、`ctxLost`、`maxTextureSize`、log（过滤 `[we-scene]` 前缀，P-40⑤） |
| 逐层调试 | `?ln=N`（页内 ←/→ 翻层，Ctrl 进出组合，状态随上报落地） |
| 服务器 | `POST /report` → `reports/r*.json`（每 10s 自报；`?noreport` 关） |

## ② 官方语义不变量清单（"对"的定义，谁也不许静默改）

1. **坐标系**：scene.json 世界 **y-up**；`parseScene` 末尾**所有层统一** `PROJ_H − y` 翻转一次
   （`legacyAnimY` 例外已删，P-22）。渲染/台账侧设计坐标 **y-down**。
2. **矩阵约定**：列主序 + **行向量语义** + `uniformMatrix4fv(transpose=false)` → 转置约定；
   屏幕后 **NDC y 与设计坐标同向**（台账换算 `(ndc·0.5+0.5)·proj`，x/y 同式，P-32 mock-GL 逐位验证）。
   preview.mjs 是另一套等价约定（`m[5]=−2/ch` + `(1−ndy)/2`），**数学等价、勿混用换算式**。
3. **角度**：scene.json 角度**已是弧度**，直收不换算（lwe CImage.cpp:1097 注释、wer-ref AngleAxis、
   语料 3.14159=π 实证；曾 ×π/180 造成 5730 倍位置错误，P-22）。
4. **附件锚点公式**（POSITION-FINDINGS §4，elysia 逐字）：
   `origin += R(ang.z)·(anchorOffset × scale)`，锚点偏移取 `_puppetBoneFinal`（bind 位姿⊕动画增量），
   **不做任何网格包围盒中心补偿**（MCC 默认关 = 官方直算）。
5. **MDLA 轨道**：每动画自带 fps；尾帧 wrap 默认 pingpong（`?animloop=saw` 对照）；
   坏帧跳过+相位插值（P-15，`detectBadAnimFrames`）。
6. **层序与父链**：parseScene 单一合并（demo 的 hier 预合并已删——曾造成双重变换，探针
   299 底发 (2284,342)→(3454,230)）；`?hier=0` 是 refrender 绝对定位兜底，仅标定场景有效。
7. **回退开关现状**（全部登记 `README-DIAGNOSTICS.md`，diag-flag-check 双向比对）：
   - `uvRect` 长条眼窗：`EYE_HACK_SCENES=['3719111841']` 白名单 + `opts.eyeHack` 三态
     （`?eyehack=1` 强制开 / `=0` 凯尔希也关）。**对别的场景开=眼睛压成横条**（P-38）。
   - 精灵帧：仅 `__texFrameForced`（钉帧）/`__texFramePlay`（自动推进）才生效，无脚本驱动的
     sprite 层保持整图（不自发动画，P-39）。
   - `WHITE_FALLBACK`：缺纹理默认**透明不画**（`?whitefallback=1` 切回白块对照，P-34②）；
     texMissing 只统计 tn=1（声明了纹理名）的可见层（P-40②）。
   - `ownSizes`：默认**关**（曾把附件层 size 换成网格 bbox，实测 ~1/1.9 拉伸；`?ownsize=1` 回旧，W7）。
   - `piv`（子网格中心补偿）：仅"眼睛组合"名单层；`?piv=1/0` 全开/全关。
   - 蒙皮 `skin0`：**勿写进壁纸 URL**（存在即关蒙皮，历史事故 P-31 Bug A）。
8. **相机**：ASPECTCROP（cover 四分支）+ zoom 除法（=wer-ref）；节点相机贝塞尔/满幅层豁免（P-25）。
9. **视差**：官方公式 `((node_pos−cam_pos)+mouse)∘depth×amount`（RE-24，已实现），**默认关**
   （`?parallax=1` 开、`?parallax=legacy` 旧式）——16 层 parallaxDepth 包按旧公式校准过（P-34⑦）。
10. **混合**：`blendRgbByMode` 覆盖 0-32 + HSL 四模式，公式取自公开标准
    （W3C Compositing and Blending Level 1 / PDF 1.7 §11.3），逐个 id 的行为与 GPU 侧 Δ<0.02；
    `colorBlendMode≠0` = screenblend 路径（A=屏幕背景、B=本层，RE-18）。
11. **可见性（RE-06）**：可见性=条件匹配结果本身，authored `value` 仅属性缺失时兜底；
    父链级联（祖先不可见→不可见）。拿不到 project.json 属性时 user 条件层按**可见**（隐藏主体是灾难）。
12. **文本**：官方度量（行高=字体度量、verticalalign 三落点、CSS 序 padding、宽度驱动省略号，RE-32）；
    `pointsize/maxwidth/maxrows` 支持 `{user,value}` 用户属性绑定解包（P-38②）。
13. **脚本**：先全部 init 再逐帧 update；init 失败永久禁用该对象、update 失败跳帧保值（RE-35）；
    4Hz 时间/属性驱动；localStorage 为沙箱内存实现（不碰宿主存储）。
14. **纹理上传**：超 `min(4096, MAX_TEXTURE_SIZE)` 先降采样（cap>2048 源→2048）；位图路径失败按
    2048→1024 阶梯重试+记日志；`generateMipmap` 仅 POT（NPOT 大纹理会留 INVALID_OPERATION 旗标→
    假 0x502，P-36）；RG8 在 WebGL1 展开 RGBA 回退；上传前长度终检补零消毒。

## ③ 连带影响地图（"改哪里最容易坏什么"）

| 你想动的地方 | 会连带坏什么 | 必须一起过的门禁 |
|---|---|---|
| `parseScene` 的数值解析（角度/vec/color） | **所有场景**的几何（P-22 弧度教训：一处换算错=带旋转父级错 5730 倍） | alignment-test 184 checks、attach-transform-test 408 层 A/B、parity-check 全场景 |
| `compositeLayer` | 精灵帧 UV 优先级、uvRect 眼窗、screenblend、台账回调（mvp 反算）——四处语义共用这一个函数 | sprite-sheet 17、tex-upload-guard 39、mock-gl 12、parity-check rect 档 |
| 附件锚点（core/attach-transform.mjs / attachCtx 接线） | 19 个附件层（全部头发/衣袖/飘带/眼睛）整体偏移数百 px | attach-transform-test T1-T5、layer-rect-kal（标定 21/22 Δ<5px） |
| demo 脚本同步循环（raw→scene） | 把 `raw.origin` 直写 `l.origin` = 抹掉锚点（P-31 Bug B 设备铁证：设备值与 raw authored 逐位相同） | script-origin-sync-test T1-T4 |
| `ownSizes` / `piv` / MCC | 人物比例（拉伸 1/1.9、长发甩出屏外） | W7 验收 + parity rect 档 + ownSizes 嫌疑自动标注 |
| `makeTexture`/`makeTextureMip`/`generateMipmap` | 真机 0x502 三症状一根因（旗标残留→假报+纹理不完整→黑层，P-36） | tex-upload-guard-test 39 断言 |
| 效果链 FBO 命名空间/乒乓/COPYBG | 反馈环 0x502、灰白块、背景光晕消失（clearBgFx 权衡） | glsl-validate 128、bloom 14、hdr-bloom 17、render-closeout 22 |
| `applyRenderConfig`（hideUI 正则/RE-06/眼窗白名单/clearBgFx） | 层可见性面（提示框、时钟、伊蕾娜主体）；眼窗打错场景=眼睛压横条 | package-matrix --check 基线（drawnLayers 计数）、tex-upload-guard 白名单断言 |
| 蒙皮路径（`onMeshLayer`/`uploadMeshLayer`/g_bones） | 5 个 mesh 层退化成 quad（skin0 教训）；眨眼相位（P-24/P-30） | skin-order-verify、blink-phase 15、mesh-badframe |
| 上报 payload 字段名 | **C 的整条工具链**（report-audit/parity-check/package-matrix/known-issues 的判据）——改名=工具连锁红 | report-audit、parity-check、docs-check |
| demo/插件的浮层祖先样式（`backdrop-filter`/`isolation`/z-index） | 浮层虚化间歇消失（`docs/reports/GLM-ANSWER-PLUGIN-BLUR.md`：React 重挂载+内联样式竞争） | 插件侧 panel-smoke + 人眼验收 |
| `EYE_HACK_SCENES` 白名单 | 非凯尔希场景眼睛层 | tex-upload-guard 白名单 4 断言 |
| elysia 共用件（nsl.js/scene-scripts.js/textures.js import 我们的 parseTex） | 两端同时变（elysia 直接 import 我们解码器——by construction 一致） | script-corpus-audit --strict 131 段 |

## ④ 怎么验证你没踩坑（C 会话提供的机器验收）

```bash
bash run-all-tests.sh                     # 33 项门禁（+条件项 parity-check）
node parity-check.mjs                     # 平价基线：真机台账 vs CPU 期望逐层对账（无上报自动 SKIP）
node report-audit.mjs reports/rXXX.json   # 单份上报四段对账 + 层健康表 + 跨报告趋势
node parity-check.mjs --strict            # 审计模式：known-issues 白名单也计失败
```

- **改了几何/解析** → parity-check 的 rect 档是硬门禁（≤2px，历史三大事故全在这个口径上可检）。
- **改了绘制/纹理/效果链** → px 档的"clear-miss"（设备=清屏色而 CPU 有内容）与 >0.6 极端色差是铁证。
- **改了上报字段** → 先跑 report-audit + parity-check + docs-check，再提交（工具链判据依赖字段名）。

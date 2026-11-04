# ELYSIA-DIFF-AUDIT.md — 我们 vs elysia vs 官方 逐子系统差异审计（2026-09-13）

> **参照来源许可声明**：本文档引用的 `wer-ref/` 是**第三方参考实现**
> （`Aromatic05/wallpaper-engine-renderer`，为 `catsout/wallpaper-scene-renderer` 的 fork，
> **GPL-2.0-only**），**不是 Wallpaper Engine 官方代码，也不是"真值源"**。
> 与本项目渲染器（GPL-3.0-or-later）**许可不兼容**：仅用于**行为对照**，
> **不得复制、改写、逐行翻译其代码、注释、常量组织或错误文案**。
> `we-layerd-ref/`（`Aromatic05/we-layerd`）**无任何许可**（保留所有权利），同样只可读行为结论。
> 血缘自查结论见 `<工作区>/docs/reverse/WER-REF-LICENSE-AUDIT.md`。

> 任务书：`$MPW_ROOT/docs/archive/ZCODE-PROMPT-ELYSIA-DIFF.md` 第 1 步产出。
> 判定口径：**谁与 WE 官方行为一致**。行为对照依据 = 第三方参考实现 wer-ref（`Aromatic05/wallpaper-engine-renderer`，**GPL-2.0-only**，**仅行为对照、未取代码**）行号 / WE 官方资产原文 / WE 官方截图对照 /
> `refrender-3719111841.json`（早前按官方预览逐层标定的实绘矩形，只作裁判不作数据源）。
> 每条都有证据（文件:行号 / 命令输出 / 计数）；无法证实的标"待定"。
> 第 2 步（修复落地）见文末 §3 与 `PATCHES.md` P-21-ATTACH；验收见 `attach-transform-test.mjs`。

## 0. 一句话结论

**22 层标定裁判下，elysia 的父链/附件变换 19/22 层 Δ<5px，我们修复前中位误差 782px——错在附件锚点变换、
角度单位（弧度当度）、y 翻转例外、hier 预合并双重变换、网格中心补偿五处；其余子系统（相机/效果链/混合/
视差/文本/粒子/纹理/脚本）我们并不比 elysia 差，多数项我们更接近官方。** 修复后我们 = elysia（六包逐层
A/B Δ=0）并在标定裁判上优于 elysia（21/22 Δ<5px vs 19/22）。

复现：
```bash
cd we-scene-demo
node elysia-transform-check.mjs 3719111841        # elysia 基线：19/22 Δ<5px
node layer-rect-check.mjs 3719111841 --refrender  # 修复后：中位 0px、21/22 Δ=0、115 层 Δ=79px（**标定条目不可达，非渲染误差**，见 P-30）
node layer-rect-check.mjs 3719111841 --noattach --refrender  # 修复前行为：中位 782px
node attach-transform-test.mjs                    # 全绿（含 6 包移植保真度 A/B）
```

## 1. 审计总表

| # | 子系统 | 我们（位置=P-21-ATTACH 后） | elysia（位置） | 官方依据 | 判定 | 影响面 | 修复 |
|---|---|---|---|---|---|---|---|
| 1 | **父链/附件变换** | `core/we-scene-bundle.js` parseScene 静态合并 + `opts.attachCtx`（= `core/attach-transform.mjs` 移植 elysia 四函数） | `core.js` `_mdlAnchors`(L280)/`_puppetBoneFinal`(L314)/`_attachmentOffset`(L364)/`resolveTransform`(L421) | refrender 标定裁判；`wallpaper64.exe` MDAT0001 解析（RE-04） | **elysia 对、我们曾错 → 已移植，两者等价（六包 408 层 A/B maxΔ=0.005px）** | 19 个附件层（全部头发/衣袖/飘带/眼睛）整体偏移数百 px | ✅ P-21-ATTACH；`?att=legacy` 回退 |
| 2 | 网格（puppet）绘制 | `renderMeshLayer`(bundle:3536+)：`wpos=origin+u_Scale·v`，`MCC_ENABLED` 默认 **关**（=官方直算） | `puppet.js` `renderPuppet`(L8)：`leftX=origin+scale·minX`（顶点即模型空间，无中心补偿） | lwe CImage.cpp:536；elysia 实测=官方 | **一致**（我们曾自造 `u_Origin−scale⊙__center` 补偿，会按每网格 bbox 平移） | 网格层各自偏移；眼睛组合曾虚差 568px | ✅ MCC 默认关，`?mcc=1` 回旧 |
| 3 | y 轴/翻转约定 | parseScene 末尾**所有层统一** `PROJ_H−y` 翻转一次（bundle:886-892） | 世界保持 y-up，绘制端 `H−y`（`renderPuppet` L81、`image.js` dy） | 同一几何约定，等价 | **一致**（我们曾有"animL 层不翻转"例外：3554161528 人物层 y=1565 vs 官方 595 → 已删） | 无附件但带 animationlayers 的立绘包人物上下颠倒 | ✅ `legacyAnimY` 仅 legacy |
| 4 | 旋转角手性/单位 | 合并用**弧度**直收（bundle:853-858）；四边形绘制 `mat4RotateZ(m,−θ)`(bundle:4095)；粒子发射器内部 `cos(−angle)`(bundle:1546) | `resolveTransform` 直收弧度（math.js parseVec3 无转换）；`blitRotated` 内部 `cos(−angle)`（canvas.js:90） | lwe CImage.cpp:1097 注释原文 "**already in radians from scene.json**"；wer-ref SceneNode.cpp Eigen AngleAxis（弧度）；语料实测 3.14159=π、1.57080=π/2（63 处非零） | **一致**（我们曾 ×π/180：π/2 被当 90°→90rad；旋转父级下子层位置错 5730 倍） | 带旋转父级/旋转粒子层的场景 | ✅ 弧度修复（parseScene+粒子层角度） |
| 5 | **demo 父链合成路径** | parseScene 单一合并（demo 默认不再预合并） | 不适用（elysia 单一 resolveTransform） | — | **我们曾错**：demo.html hier 预合并把 origin 改成世界值后 parseScene 又当局部值再合并（探针：299 底发 (2284,342)→(3454,230)） | demo 浏览器路径全部子层 | ✅ hier 预合并仅 `?att=legacy` |
| 6 | 相机/取景 | `buildCamera`(bundle:1259+)：ASPECTCROP（cover 四分支）+ `zoom` 除法 | `camera.js` `setupCameraMatrices`：ortho 直投影设计 W×H；`renderPuppet`/`image.js` 用 `ps=[W/orthoW, H/orthoH]` **非等比拉伸** + `_viewShift`（相机 eye/相机对象位移） | wer-ref VulkanRender.cpp:1531-1571（fillmode 四分支，默认 ASPECTCROP）、:1575-1576（zoom） | **我们更准**（elysia 非 16:9 画布会变形，无 fillmode/zoom）；elysia 多了相机 paths/相机对象运镜（我们缺，WER-ALIGN B4 记 P2） | 非 16:9 画布、zoom≠1、相机动画包 | 已是官方；B4 待定（语料 0 命中相机动画包） |
| 7 | 视差 | 官方公式 `((node_pos−cam_pos)+mouse)∘depth×amount`（RE-24，`?parallax=official` 切换，默认旧公式 GREEN） | `image.js:181-186` `(pd+amount)×disp×W`（lwe 近似，无相消项） | wer-ref WPNodeTransformResolver.cpp:147-162 逐字 | **我们更准**（公式已移植）。算例：满幅居中层 depth=−0.17、amount=0.35、鼠标 0.6 → 官方=我们 −0.0051·ortho；elysia=(−0.17+0.35)×disp 与位置无关；非居中层 (node_pos−cam_pos)=(800,−400)、depth=1、amount=1、mouse 中心 → 官方=(800,−400)，elysia=0（缺整项） | 鼠标视差观感（16 层 parallaxDepth 包） | 公式在位，默认开启需与官方预览逐层对照（P1，保持开关） |
| 8 | 纹理/格式 | `parseTex`/`decodeMip0`（RE-40 format 5=半分辨率 BC3，163/163 解码） | **直接 import 我们的** `parseTex/decodeMip0`（`textures.js:6`）——同一份代码 | RE-40（456 .tex 全量解析；上游 elysia 仓库缺 fmt5，本仓副本已复用我们解码器） | **完全一致**（by construction） | — | 无需修 |
| 9 | 效果链/FBO | GLSL 真编译链，C1-C17 对齐 wer-ref（P-15…P-18：previous=链输入、每效果乒乓、每效果 FBO 命名空间、copy/compose、bypass copy、fit、COPYBG） | `effects/*.js` 24 个手写 CPU 近似（低频降采样、"效果 UV 数学不变"的等比近似） | WER-ALIGN C 模块（逐条 wer-ref 行号） | **我们更准**（elysia 是观感近似且 CPU 4K 每帧秒级）；我们仍缺：C10 fullscreen 效果层 FBO=主动相机（语料 0 命中）、E4 alpha 写策略 colorMask（P1） | 全屏后处理类效果 | 保持；C10/E4 语料 0 命中暂缓 |
| 10 | 混合模式 | CPU `blendRgbByMode`（`src/render/effects.js` 节，洁净室重写）+ GPU `COPY_FRAG_SCREENBLEND`(bundle:3069+)，0-32+HSL | `math.js applyBlending`(L140) 0-32 | 公开混合定义（W3C Compositing and Blending Level 1 / PDF 1.7 §11.3；两侧各自独立实现） | **一致**：0-30 逐模式数值比对（每模式 200 组随机 A/B/op）Δ<0.02；**31/32 差异=末端 clamp**（elysia clamp 到 [0,1]，我们不 clamp——写入 UNORM8 时等价） | 无（实测分布 26-30 零使用） | 无需修（可选：CPU 侧加 clamp 对齐） |
| 11 | 文本 | canvas+FontFace 光栅，RE-32 官方度量（行高=字体度量、verticalalign 三落点、size 回填、CSS 序 padding、宽度驱动省略号），21/21 | `text.js` 自写 CFF 光栅（font-render.js）；**跳过动态文本**（时钟 `_isLiveText`）与**作者水印**（`_isWatermarkText`）；CJK 叠字缺陷（RE-39） | wer-ref WPTextLayer.cpp（DirectWrite/Pango 同源度量模型） | **我们更准**（官方度量+真实 shaping；RE-39 定案弃用纯 JS font-render） | 时钟/中文文本层 | 保持 |
| 12 | 粒子 | GPU 批渲染：RE-31 精灵表（帧 UV+blend+randomframe 关混合）、RE-37 透视相机（flags&4）、RE-20 算子（oscillate/attract/turbulence/vortex/colorchange）、RE-42 maxcount≤20000 | `particles.js` CPU 逐粒子模拟 + 确定性 RNG（替换 Math.random）；多图精灵按 imageId 换纹理 | RE-31/RE-37/RE-20（官方 shader 逐字+资产实测） | **互有长短**：我们有 GPU 性能+精灵表+透视（elysia 缺透视）；elysia 的多图精灵（imageId 换图）我们正在补（并行任务 RE-REMAINING-4 P0-2，进行中） | 多图精灵包（每帧一图） | 并行任务处理中 |
| 13 | 脚本运行时 | 复用 elysia `scene-scripts.js` + RE-35 官方容错矩阵（init 失败永久禁用、update 失败跳帧保值、安全 shim、4Hz 节流），10/10 | 同一份代码（我们直接复用） | RE-35（wer-ref 11 类调用点逐点） | **一致**（同一实现+我们的容错外壳） | — | demo 用法经 RE-28/RE-35 核对，无遗留偏差 |

## 2. 关键证据明细（第 1-5 行，本次修复项）

### 2.1 附件锚点变换（#1）——修复前误差按锚点名分组恒定
```
修复前（node layer-rect-check.mjs 3719111841 --noattach --refrender）：
  头部系附件 Δc 恒 (−509,+593)：底发/长发2/长发1/后发2/后发1/左侧发2/左眼皮/左刘海/左侧发1/正刘海/右耳朵/右眼上眼睑
  胸部系 Δc 恒 (−339,−377)：衣袖/衣摆/接管    脖颈系 Δc (−311,+88)：长带子    头发附件 Δc (−1291,+1069)：右侧发
  中位 782px / 最大 1676px
修复后（默认路径）：15 层 Δ=(0,0)，21/22 Δ<5px，最大 79px（115 眼睛组合=眨眼动画相位，标定截图为某一瞬间）
移植保真度（node attach-transform-test.mjs T1）：6 包 408 层，我们 resolveTransform vs elysia maxΔ=0.00482px
```
根因链（修复前我们的三处自造口径）：
1. `demo.html anchorsOf` 用 `_bindRT/_animRT0` 自算骨骼位姿 + `mkOff` 的 `ayFlip/__usePiv` 补丁（demo.html:484-680 旧）；
   elysia 用 `_puppetBoneFinal`（bind 世界位姿 ⊕ animationlayers 增量，additive 参考=层帧0）——与蒙皮同一份代码。
2. MDAT 矩阵只取平移列经骨骼角旋转：`off=[bx+A.tx·cos(ba)−A.ty·sin(ba), by+A.tx·sin(ba)+A.ty·cos(ba)]`
   （core.js:416-418 逐字）；我们旧代码 `anchRot` 算了没用、`ayFlip` 对偏移单独取 y（双重翻转风险）。
3. 动画层选择：仅"多动画+有 animationlayers"做层合成（visible 过滤→名字/数字后缀/索引三级匹配，core.js:386-409）；
   单动画 layers=null → 动画0 帧0。我们旧路径直接取 `animRT0||bindRT`，多动画模型会选错层。

### 2.2 弧度（#4）——三方独立证据
- 语料：63 处非零 z 角度，值域 0.04~3.14（`3.14159`=π、`1.57080`=π/2、`1.31720`=75.45°——若是度则荒谬）。
- lwe-ref `CImage.cpp:1097` 注释原文："Build rotation from angles **(already in radians from scene.json** — see CParticle.cpp:2119)"。
- wer-ref `SceneNode.cpp:10-13`：Eigen `AngleAxisd(m_rotation.z(), …)` 直收（弧度），无转换点
  （`grep 'M_PI\|180' wpscene/*.cpp scene/*.cpp` 零命中）。

### 2.3 双重合并（#5）——探针输出（3719111841，无锚点隔离变量）
```
层         refrender中心    A:parseScene(原始)   B:hier预合并+parseScene(demo旧默认)
299 底发    (2284,342)      (1775,935)           (3454,230)   ← 两套都错，B 还叠加了二次变换
63  右耳朵   (2483,160)      (1974,753)           (3549,143)
```

### 2.4 相机算例（#6）——设计 3840×2160，画布 1440×1080（4:3）
- 我们（=wer-ref）：fboAspect 1.333 < sAspect 1.778 → 窗口 2880×2160 居中（左右各裁 480 设计像素，cover）。
- elysia：`ps=[1440/3840, 1080/2160]=[0.375, 0.5]` → 纵向相对拉伸 1.333 倍（画面变形）。
- zoom=2 时我们在 ASPECTCROP 基础上 `framed/2`（wer-ref VulkanRender.cpp:1575 同式）；elysia 仅 3D fov 分支乘 zoom。

### 2.5 纹理（#8）
`elysia/we-renderer/textures.js:6`：`import { parseTex, decodeMip0, FIF } from '../../we-scene-bundle.js'`
→ format 0/4/5/6/8/9 两边解码结果逐位相同（同一函数）。RE-40 的"elysia 缺 format 5"指上游 elysia 仓库
（`ToTextureFormat` 无 5），本仓副本已绕开。

## 3. 已落地修复（第 2 步，全部可一键回退）

| 修复 | 位置 | 回退开关 |
|---|---|---|
| elysia 四函数移植（`_mdlAnchors`/`_puppetBoneFinal`/`_attachmentOffset`/`resolveTransform` + `_parseMdl`/`_sampleAnimRT`） | 新文件 `core/attach-transform.mjs`（零依赖，浏览器+Node 共用；bundle import + 服务器 `/attach-transform.mjs` 路由） | demo `?att=legacy` |
| parseScene 接入 `opts.attachCtx`（默认计算 19 个附件锚点） | `core/we-scene-bundle.js` parseScene 开头 | 不传 attachCtx 即关 |
| 弧度修复（父链合并 + 粒子层角度） | `core/we-scene-bundle.js`（合并 L853-858、粒子 L4869） | —（官方语义，无回退理由；旧行为可 `?att=legacy` 不可复现，见注释） |
| y 翻转统一（删 animL 例外） | `core/we-scene-bundle.js` L886-892 | `opts.legacyAnimY`（demo legacy 路径自动带） |
| hier 预合并删除（双重变换） | `demo.html`（仅 legacy 分支保留） | `?att=legacy` |
| 网格中心补偿默认关 | `core/we-scene-bundle.js` `MCC_ENABLED` | `?mcc=1` 开旧补偿 |
| 逐帧附件动画（把骨骼位移当层位移，语义错误）仅 legacy | `demo.html` attachAnimActive 门控 | `?att=legacy` |
| 服务器路由 `/attach-transform.mjs` | `server/we-scene-demo-server.mjs` | — |

**验收数字**（`node attach-transform-test.mjs`，全绿）：
T1 移植保真 408 层 maxΔ=0.005px；T2a 标定 21/22 Δ<5px；T2b 中位 0.0px（修复前 782px）；T2c 最大 79px；
T3 无锚点层 24/24 逐位不变；T4 弧度手推 (0,1100) 实测 (0.0000,1100.0000)；T5 MDL/锚点/偏移表健全（19 层）。

全量回归（P-19 清单）：内置 shader 13/13、效果链 GLSL 128/128、mock-GL 12/12、精灵表 17/17、粒子精灵 10/10、
文本几何 21/21、bloom 14/14、脚本容错 10/10、坏帧 8/8、tex-fmt5 4/4、render-audit mesh 5/5、alignment 184/184。

## 4. 待定 / 需要什么证据

| 项 | 现状 | 需要的证据 |
|---|---|---|
| elysia `_puppetBoneFinal` 的 fps=30 硬编码 vs 我们 demo 的每动画 fps | 两边在 t=0 等价（帧0）；t>0 锚点随动画推进时 elysia 用 30fps | 官方骨骼动画是否恒 30fps：wer-ref WPPuppet 采样域由每动画 fps 决定（RE-03），elysia 的 30 是近似；等我们实现"锚点随 t 推进"时按每动画 fps 做，暂不做（静态帧0 已对齐标定） |
| 眼睛组合 79px 残差 | 标定截图是眨眼周期某瞬间，蒙皮 bbox 随帧变化 ±数十 px（bind 中心 −848.7 vs 帧0 −815.2，高 253→399） | 官方预览连续帧序列才能消掉相位差；非变换错误 |
| WER-ALIGN B4 相机节点帧 / C10 fullscreen / E4 colorMask | 我们缺，语料 0 命中 | 扫到一个真实使用的包再修（feature-scan） |
| 视差官方公式默认开启 | 公式已实现（`?parallax=official`），默认仍是旧公式（16 层 parallaxDepth 包按旧公式校准过 GREEN） | 官方预览逐层鼠标对照（本轮任务范围外，保持 P1） |

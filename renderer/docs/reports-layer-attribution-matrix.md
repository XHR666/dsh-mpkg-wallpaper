# 层归因矩阵（B1/B2）——四根语料全库离线扫（C0 工具）

> 生成：2026-10-04（批次 3 B 档）。工具：`tests/layer-attribution-matrix.mjs`（C0 的
> `attributeScene`：真 parseScene + mock GL + 真 renderScene，无 `__lnHidden`；分批纪律照
> renderer-gap-matrix，`--max-mb 250`、`--min-free-mb 900`）。机读：`reports/layer-attribution-matrix.json`
> （187 容器逐包行 + 聚合）。真机一致性已由 `layer-attribution-consistency.mjs` 在 3 包钉死（12/0）。
> 相位：t=20s、campose=legacy（离线不跑场景脚本 ⇒ 脚本驱动取景/可见性的包按 script-state 登记）。

## 1. 机制类聚合（187 容器 / 3872 个解析层）

### 1.1 未上屏（skipReason，共 1990 层；2026-10-04 二扫修正口径）

> **二扫修正**（B1 遗留"not-drawn 逐条查清"）：初版 `degenerate-geometry` 判据（≤0）与 core
> `compositeLayer` drawGuard（实绘 ≤0.5 设计px，P-21）**不同口径** ⇒ 0917/3509243656 的
> scale=0.001 微缩层族（118 层）漏进 not-drawn。判据对齐 drawGuard 后重扫：
> degenerate-geometry 204 → **263**、not-drawn 137 → **78**。

### 1.1 未上屏（skipReason，共 1990 层）

| 机制类 | 层数 | 语义（出处） | 样例包 |
|---|---|---|---|
| invisible | 887 | 作者原文 visible=false | 2887099508（in heart 1-3 / pussy / ey00000） |
| invisible-config | 599 | applyRenderConfig 关的（UI 名单正则 / 类别开关 / 音频美术豁免 / 时段变体）——工具以 parse 前后 visible 差分归因 | 3326873240（Media Info (ROUND)）、2887099508（wind.mp3） |
| degenerate-geometry | 263 | 实绘 ≤0.5 设计px（drawGuard 同口径）：sound 层 `scale=0 0 0` 族 + 3509243656 的 scale=0.001 微缩族 | 2887099508（11 个 sound 层）、3509243656（text/image 微缩 118 层） |
| not-drawn | 78 | **兜底枚举**，已分族：**particle 19**（Trails/Shooting star 族——def/贴图在、无跳过日志、0 draw，= 渲染器粒子相位 vs 离线模拟的分歧族，渲染器侧待查）；**59 集中在 3509243656**（唯一 3D 透视包的 LOAD*/kk/tt* 加载屏族，候选 = 透视后裁剪/起始门控，逐层明细在矩阵 JSON `notDrawn[]`）；零星 | 2887099508（#25 Light shafts）、3509243656（LOAD1/LOAD2/kk） |
| particle-no-def | 112 | 声明了 particle 但 def 未解析（渲染循环 `particle && !particleDef` continue） | 1004/夜莺night 系 |
| container | 25 | composelayer 无 fx（官方逻辑 helper）+ 真容器 | 2887099508（可调整组合层） |
| particle-idle | 9 | 采样时刻存活 0（CPU 模拟复核：未到发射窗/已消亡） | 2981249186、3521337568 |
| logical-helper | 7 | 无 fx 的 projectlayer/fullscreenlayer（P-231，官方 RegisterLogicalImageLayer 不画） | 2887099508（ldfk） |
| particle-budget | 2 | 粒子预算跳过（P-59 公平份额） | 3690417937 |

### 1.2 已上屏（bind，共 1889 层）

| 绑定类 | 层数 | 语义 |
|---|---|---|
| texture | 935 | 内容纹理正常绑定 |
| transparent | 433 | 透明兜底（Node 无文本光栅器的 text 层 / 缺纹理且未开 whitefallback / sound 层无图像内容） |
| particle | 164 | 粒子层绘制（不走 compositeLayer） |
| solidcolor | 41 | solid 纯色卡（whiteTex×color4，G3） |
| rtcopy | 9 | **copybg 换入**（P-230 语义：无自有内容**且有效果链** ⇒ 链输入=背景拷贝） |

## 2. B2：copybackground 全量点验（11 包 / 80 层）

| 路径 | 层数 | 语义（P-230/P-199） |
|---|---|---|
| withTex（有自有贴图） | 31 | 背景只走 COPYBG 槽，层内容仍在槽 0（P-199） |
| noTexNoFx（无贴图无 fx） | 36 | **不换入**，画自己的内容（纯色卡/透明）——P-230 修复的语义面 |
| noTexFx（无贴图有 fx） | 13 | 链输入=背景拷贝（rtcopy=9 上屏 + 4 个不可见层的链已按新语义接） |

真机像素对照（3 个非同族包，`reports/copybg-ab.json`，1280×720、campose=legacy、settle 6s）：
`0923/2887099508` default uniq **66199** vs legacy 30257（fx=0 层出真内容）；`dd/3327063360`
82.98↔85.64、`dd/3326873240` 88.09↔89.34（copybg fx=0 面小、变化微小）——P-230 的默认行为
变更在三个非同族包上无退化、在探针包上大幅改善。

## 3. 边界
① 离线**不跑场景脚本**：脚本驱动的可见性/取景差异（混淆脚本形态）按 `script-state`/`camera-scale`
登记（C6 已把指针事件接进宿主，离线跑脚本仍是 C6 边界）；② `not-drawn:137` 是兜底枚举，
按纪律逐条查清才立新枚举（已抽查：粒子种子相位族为主）；③ >250MB 的 22 个容器未扫（分批纪律），
需要时用 `--max-mb` 放开分批跑。

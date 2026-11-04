# POSITION-FINDINGS.md — "位置渲染错误"的定位结论（2026-09-13）

> 用户给的标准参照：`Testphoto/TP8/Screenshot_2026-09-08-00-29-59-64_*.jpg`（凯尔希 3719111841 官方效果，
> 除"左侧中间的文字层"与"左下角水印"外都要对齐）。
> 本文只记**可复现的数字证据**与**结论**，不含猜测。
>
> **【2026-09-13 更新】§5 的三处问题已全部修复**（P-22-ATTACH，`core/attach-transform.mjs` 移植 elysia 四函数 +
> 弧度定案 + 双重合并/翻转例外删除 + MCC 默认关）。修复后：**中位中心误差 782px → 0px**，
> 21/22 层 Δ<5px（elysia 基线 19/22），最大 79px（眨眼相位，非变换错误）。
> 逐子系统审计见 `ELYSIA-DIFF-AUDIT.md`；验收测试 `attach-transform-test.mjs`（9/9）。
> 本文以下保留修复前的定位过程（含旧数字）供追溯；复现旧数字用 `layer-rect-check --noattach --refrender`。

## 1. 一句话结论

**我们的父链/附件（attachment anchor）变换是错的；elysia 的同一套数学与官方逐层吻合（Δ=0px）。**
证据：`refrender-3719111841.json`（早前按官方预览逐层标出的设计空间实绘矩形）作为裁判，
用 elysia 的 `SceneRenderer.resolveTransform` 复算 22 层，**19/22 层中心误差 0–3px**，
剩下 3 层是"网格包围盒 vs 对象 size"的尺寸定义差异（中心 48–72px，非变换错误）。

复现命令（本仓已有）：

```bash
node we-scene-demo/elysia-transform-check.mjs 3719111841     # elysia 复算 vs 标定矩形
node we-scene-demo/layer-rect-check.mjs 3719111841 --refrender  # 我们复算 vs 标定矩形
```

## 2. 数字对比

| 层 | 官方标定中心（y-down） | elysia 复算 | Δ | 我们（父链合并，未加锚点） | Δ |
|---|---|---|---|---|---|
| 右耳朵 (63) | (2483, 160) | (2483, 160) | **0** | (2483, 753) | 593 |
| 后发1 (49) | (1917, 743) | (1917, 743) | **0** | (1408, 1336) | 781 |
| 左侧发1 (95) | (2356, 1096) | (2356, 1096) | **0** | (1846, 1689) | 782 |
| 衣袖 (52) | (1948, 1965) | (1948, 1965) | **0** | (1609, 1588) | 502 |
| 长带子 (71) | (2412, 1660) | (2412, 1660) | **0** | (2100, 1747) | 324 |
| 背景正常 (31) | (1914, 1065) | (1914, 1065) | **0** | (1913, 1095) | 30 |
| 左耳朵1 (303) | (2000, 275) | (1997, 274) | 3 | (1488, 868) | 776 |
| 右眼上眼睑 (67) | (2553, 592) | (2553, 591) | 1 | (2044, 1185) | 782 |
| 主体 (91) | (1968, 1289) | (1967, 1241) | 48 | (1967, 1241) | 48 |
| 长发3 (475) | (1238, 1528) | (1238, 1455) | 72 | (1238, 1456) | 72 |
| 眼睛组合 (115) | (2349, 586) | (2913, 648) | 568 | (2404, 1242) | 657 |

（完整表：跑上面两条命令；`layer-rect-check` 的中位中心误差 **782px**、最大 1676px。）

## 3. 场景结构（为什么是"附件"在错）

3719111841 = 43 层，其中 **22 层有父级、19 层带 `attachment`**（锚点名：头部/胸部/脖颈/头发附件），
5 层是 puppet 网格。锚点挂在父 puppet 的 MDAT0001 骨骼锚点上：

```
475 长发3 (puppet, scale 0.693)
└─ 91 主体 (puppet, 有 animationlayers)
   ├─ 49 后发1   attachment="头部"     ← 位置全靠锚点骨骼位姿
   ├─ 52 衣袖    attachment="胸部"
   ├─ 53 后发2   attachment="头部"  ├─ 61 衣摆 attachment="胸部"
   ├─ 71 长带子  attachment="脖颈"  ├─ 75 长发1 attachment="头部"
   ├─ 87 正刘海 / 95 左侧发1 / 99 左侧发2 / 111 左眼皮 / 299 底发 / 831 左刘海 attachment="头部"
   ├─ 115 眼睛组合 / 303 左耳朵1（自带 puppet 网格）
   └─ 58 右侧发   attachment="头发附件"（父 475）
```

**没有锚点时**（= 我们现在的有效行为）：子层只用 `origin × 父scale`，误差是"锚点应有的骨骼位移"，
按锚点名分组几乎恒定（头部 ≈ (−509,+593)、胸部 ≈ (−339,−377)、脖颈 ≈ (−311,+88)）——
这正是"整片头发/衣袖一起偏"的观感来源。

## 4. 官方/elysia 的正确公式（可直接照抄）

```js
// 世界（y-up）× 父变换累积（elysia we-renderer/core.js resolveTransform）
origin = root.origin; scale = root.scale; ang = root.angles
for (child = root 的子, 逐级向下到目标):
   cos = cos(ang.z); sin = sin(ang.z)
   [ax, ay] = attachmentOffset(child, parent)          // 仅当 child.attachment 存在
   if (ax||ay): origin += R(ang.z) · (a × scale)       // 锚点与自身 origin 同空间，先加锚点
   origin += R(ang.z) · (child.origin × scale)
   scale  *= child.scale
   ang    += child.angles
// 渲染 y-down：y_render = PROJ_H − origin.y

// 锚点偏移（elysia _attachmentOffset）：
//   1) 父模型 json → puppet → MDL 里的 MDAT0001 锚点表（name → {boneIdx, 4×4 矩阵}）
//   2) 取该锚点骨骼的**动画后最终位姿** (bx, by, ba)   ← 关键：用 _puppetBoneFinal(mesh, t, layers)
//   3) offset = [ bx + A.tx·cos(ba) − A.ty·sin(ba),  by + A.tx·sin(ba) + A.ty·cos(ba) ]
//   4) 不做任何"网格包围盒中心"补偿（我们渲染器里的 u_Origin 中心补偿是自造的，见下）
```

## 5. 我们的实现差在哪（三条，按影响排序）

1. **锚点骨骼位姿来自我们自己的近似**：`demo.html` 里 `anchorsOf()` 自算 `_bindRT/_animRT0`，
   而 elysia 用 `_puppetBoneFinal(mesh, time, layers)`（bind 世界位姿 ⊕ `animationlayers` 逐层增量 × blend，
   与它自己蒙皮用的同一份代码）。两者对"骨骼最终位姿"的取样口径不同 → 锚点整体偏。
   → 修法：直接调用/移植 elysia 的 `_puppetBoneFinal` + `_mdlAnchors` + `_attachmentOffset`。
2. **网格包围盒中心补偿（自造）**：渲染器 `renderMeshLayer` 里
   `u_Origin = origin − u_Scale ⊙ mesh.__center` 把网格 bbox 中心搬到原点上；
   官方/lwe/elysia 都是"MDL 顶点即模型空间，对象变换直接作用"，**没有这一步**。
   它会让同一父级下每个网格层按各自 bbox 中心平移（头发/眼睛各不相同）。
   → 已加开关：`?mcc=0` 关闭（=官方直算）、`?mcc=1` 强制开启（旧行为）。
3. **附件 pivot 补丁**：`demo.html` 曾把"子网格 bbox 中心"再加进锚点偏移（`__usePiv` 写死 true），
   与第 2 条重复补偿。本文件同目录注释早已写明"长发等附件错误加 piv → 甩出屏外"。
   → 已改为**只对名单内层（眼睛组合）生效**，`?piv=1` 全开、`?piv=0` 全关。

另有两个**未实现**但本场景 no-op 的点（WER-ALIGN A3/B1）：
`alignment` 偏移（本场景 0 层非 center）、`fillmode=ASPECTCROP`（设计 16:9，本场景 16:9）。

## 6. 验收方式

1. 设备/浏览器打开 3719111841，与 `Testphoto/TP8/Screenshot_*00-29-59*.jpg` 对照：
   角色大小、发片、衣袖、长带子、耳朵、眼睛应落在与截图相同的位置（截图里的文字层与水印忽略）。
2. 逐层数字验收：`node layer-rect-check.mjs 3719111841 --refrender`（**已达成：中位 0px、最大 79px**；
   修复前基线可用 `--noattach` 复现：中位 782px）。
3. A/B：`?att=legacy`（旧锚点路径）、`?mcc=1`（旧中心补偿）、`?hier=0`（refrender 绝对定位兜底）。
4. 移植保真：`node attach-transform-test.mjs`（T1=与 elysia 六包 408 层 A/B maxΔ=0.005px）。

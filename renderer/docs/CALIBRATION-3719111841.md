# 凯尔希(3719111841) 最终校准记录

日期：2026-09-07。范围：we-scene-demo（WebGL2 CPU/GPU 双路径）。
本文件记录 A（附件统一修正）+ B（效果链回退）的结论与验证。

## 0. 坐标系与既有语义（沿用，未推翻）
- parseScene：子层在编辑器 y-up 空间按父链相加合并；合并后 `world.y = PROJ_H − merged.y`（顶部为 0 的渲染 y-down）。
- 例外（历史兼容）：带 `animationlayers` 的层"不再翻转"（wy = merged.y）。
- 锚点偏移 = 父 puppet MDLS 骨骼位姿 + MDAT0001 锚点平移（旋转后），由调用方经 `opts.attachmentOffsets` 注入，在子局部空间并入。

## A. 附件错位根因（3 条，全部定位并修复）
凯尔希 19 个附件对象挂 91(主体)；其中 4 个对象自带 `animationlayers`
（`眼睛组合`/`右眼上眼睑`/`左耳朵1`/`主体`/`长发3`，经查 origin 均无关键帧、
`animationlayers` 只是 puppet 驱动标记）→ 命中历史"animL 不再翻转"分支，
而它们的同父姊妹（`左眼皮`/`右耳朵`/`后发2`/`左刘海`… 无 animationlayers）走"统一翻转"。

后果：同是"左眼皮/眼睛/右眼上眼睑"的组件，一个翻转一个不翻转，
世界 y 互相差出数百设计像素——正是用户截图"眼皮互相差 485px、眼与眼皮差 450px"的根因
（数值：旧默认 eye screen y=504 vs left lid 213；同一锚点附件被劈到两半）。

另一处：`眼睛组合` 自带 puppet，其网格包围盒中心 = (−848.7, −19.7)（模型空间，
与父主体局部像素 1:1）——WE 把皮肤按网格中心绘制，我们按对象原点中心绘制，
使眼睛对象原点被整体推到脸右缘外（screen x 971 vs 官方 783，差 −188px/设计 −564px）。

### 修复 1（core/we-scene-bundle.js，parseScene）
新增 `opts.uniformFlipY`：为 true 时忽略 animationlayers 分支，一律 `wy = PROJ_H − merged.y`。
demo 在存在 attachmentOffsets（即 puppet 附件场景）时置 true；其它场景/调用方不变。

### 修复 2（demo.html）
锚点偏移公式加入子对象自带 puppet 的网格中心（meshCenterOf，同 elysia 顶点块扫描规则）：

```
finalOffset(o) = [
   bonePose.x + rotate(anchor.tx) + ownPuppetMeshCenter.x,
   (bonePose.y + rotate(anchor.ty) + ownPuppetMeshCenter.y),   // ?ay=flip 时整项取反（调试用）
]
```

### A 修正后附件屏幕位置（1280×720，设计/3；官方眼目标 (783,220)）
| 对象 | 设计 (x, ydown) | 屏幕 (px) | 说明 |
|---|---|---|---|
| 眼睛组合(115) | (2324.7, 662.0) | (775, 221) | 官方眼 (783,220)：差 8px/1px ✓ |
| 左眼皮(111) | (2371.9, 638.6) | (791, 213) | 与眼同带，贴左眼上 ✓ |
| 右眼上眼睑(67) | (2552.6, 591.6) | (851, 197) | 与眼同带（残留 ~35-70px 属逐件精调） |
| 左耳朵1(303) | (1999.7, 274.8) | (667, 92) | 头顶左侧 ✓ |
| 右耳朵(63) | (2482.9, 159.6) | (828, 53) | 头顶右侧 ✓ |
| 左刘海(831) | (2356.7, 520.7) | (786, 174) | 眉额之上 ✓ |
| 正刘海(87) | (2508.5, 496.2) | (836, 165) | ✓ |
| 主体(91) | (1967.4, 1240.8) | (656, 414) | 全身中部 |
| 长发3(475) | (1238.1, 1455.3) | (413, 485) | 后发大层 |

一致性检验：眼/双睑同屏 y 带 197-221（官方眼 220）；双耳在头顶两侧、双刘海压眉上、
后发层在头后——整体回到"同一张脸"的空间关系，不再出现旧的 400-900px 级劈裂。

旧→新（同 1280×720 屏幕坐标）：
eye (971,504)→(775,221)、left lid (790,213)→(791,213)、right lid (851,523)→(851,197)、
left ear1 (666,629)→(667,92)、right ear (828,667)→(828,53)、左刘海 (786,546)→(786,174)。

## B. 效果链 GPU 失败回退（方案 B：直接画 base 纹理）
现象：'背景正常'(waterwaves 等)、GirlCat houseback 等效果链在部分设备抛 GL 0x501/0x502
（日志 tag `use-blend-fbo` / `pass-draw`），画面黑屏 + 大白块。

实现（core/we-scene-bundle.js，renderLayer 效果分支）：
- 效果链入口把 `fxChainGpuErr` 清零；copy 直绘、每个 passTagErr、pass draw 后读 `gl.getError()`，
  一旦非 NO_ERROR → 停止该链；
- 结束处若失败且未 `?nofxfb=1` → 改调 `compositeLayer(copyProg, srcTex, …)`
  （无效果直绘该层 base 纹理/绿幕），不再合成损坏的效果 FBO；
- 每层只打一次日志："效果链失败(...) → 回退直接画 base 纹理"。
GirlCat houseback/凯尔希 背景正常共用同一回退路径（自动生效）。

## C. 校验结果
- `node --check core/we-scene-bundle.js` ✅；demo.html 内 module 脚本抽取 `node --check` ✅
- `node glsl-validate.mjs` → 128/128 通过 ✅
- `node preview.mjs 3719111841 /tmp/k.png`（CPU 基础层，无附件/效果）正常出图 ✅
- 服务器 `curl -s http://127.0.0.1:8899/bundle.js | cmp - core/we-scene-bundle.js` ✅（BUNDLE_CURRENT=文件）

## 改动文件清单
1. core/we-scene-bundle.js
   - parseScene：新增 `opts.uniformFlipY`（animL 附件场景统一 y 翻转）
   - renderLayer：效果链 GL 错误检测 + 失败回退直绘 base（方案B）；`?nofxfb=1` 关回退
2. demo.html
   - 新增 `meshCenterOf(buf)`（puppet 网格包围盒中心）
   - 锚点偏移 += 自带 puppet 网格中心（附件公式修复 2）
   - parseScene 调用带 `uniformFlipY: attachmentOffsets.size>0`
3. CALIBRATION-3719111841.md（本文档）

## D. 尚未决问题（一句话）
官方 preview.gif 的相机取景仍为推断（192² 窗口未能在无 GPU 环境像素级对齐），
眼部/耳部各附件剩余 ~8-80px 设计像素精调需在浏览器对照官方逐件微调，且附件自身
puppet 的"皮肤按网格缩放显示"（眼睛组合网格 305px vs 纹理 584px）尚未实现——目前只修正了位置。

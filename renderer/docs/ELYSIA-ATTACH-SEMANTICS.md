# elysia 逐行对比结论：附件锚点 vs 动画（2026-09-11 深夜）

## 对比对象
`/tmp/elysia-full/lib/we-renderer/core.js:361 _attachmentOffset` + `:383-400`（动画层选择）+ `puppet.js:_puppetBoneFinal/_sampleAnimRT`

## 决定性结论
1. **附件锚点偏移**：`anchors.find(name===child.attachment)` → 骨骼最终世界位姿。
   **关键分支**（core.js:383-386 注释原文）：
   > 仅当 **多动画 + 有 animationlayers** 时做层合成；**单动画时 layers=null → `_puppetBoneFinal` 用默认动画0**
   > = 父网格蒙皮同款，否则锚点跟随错误。
   → **单动画场景（凯尔希主体只有"呼吸"）= 锚点用动画0 的静态位姿**，不随 t 推进。
2. **动画的"动"**由**父网格顶点蒙皮**承载（renderPuppet 用 `_sampleAnimRT` 逐帧采样骨骼 → 变换 mesh 顶点）；
   附件锚点只是"挂在骨骼上的静态挂点"。
3. **多动画 + animationlayers** 时：按 `animationlayers[].name`（支持"动画 N"数字后缀）匹配 `mesh.animations[]`，
   并考虑 `visible/blend/rate` → 这才是"附件随动画变化"的唯一合法场景。

## 对我们渲染器的直接结论
- 我们**没有实现顶点蒙皮** → 任何"逐帧改变附件 origin"的做法都是**语义错误**（把骨骼微动放大成层位移）
  → 真机表现即用户实测："头发上下呼吸、结尾左右颤抖、画面像翻转、飘带/眼睛相对头发错位"。
- **正确状态 = 附件锚点静态（anim0）**；`?anim` 逐帧仅在将来实现 g_Bones 蒙皮后才有意义。
- 数据层（真实 `fps/frameCount/mode` + 两帧插值 + loop/mirror/single）已按官方语义实现在 demo.html，
  可在**实现蒙皮**时直接复用（不必重写解析）。

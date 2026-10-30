# archive/ — 零引用脚本归档（MERGED-2 第 4 项 I，2026-09-12）

> 归档而非删除：以下脚本在归档时刻经 `grep` 全目录（*.mjs/*.sh/*.md/*.html）复核**零外部引用**
> （仅自身用法注释出现自己的名字）。历史价值保留，跑法：`node archive/<脚本>.mjs`（相对 import
> 路径如 `./we-scene-bundle.js` 需先移回上级或用 `--pkg` 绝对路径核对）。

| 脚本 | 当年干什么 | 结论 / 现在由谁替代 |
|---|---|---|
| mul-scan.mjs | 扫 shader 源里所有 `mul(...)` 调用并标注参数形态，定位 mat*vec 错配 | 结论已沉淀进 hlsl2glsl 转译器（we-scene-bundle.js 内置）；现由 `internal-shader-validate.mjs` / `glsl-validate.mjs` 承担 |
| mulswizzle-scan.mjs | 平衡括号版 `mul(...).swizzle` 形态扫描 | 同上，转译器已按其结论处理 swizzle 链 |
| cast-scan.mjs | 全 dd 目录扫 CAST 变体 + mul().swizzle（从 pkg 解 shader 文本） | 同上；类型转换语义已内置转译器 |
| geo-check.mjs | 几何预演：按渲染器数学与"修正数学"分别算每层屏幕 AABB | 被 `layer-rect-check.mjs`（实绘矩形 vs 官方标定）与 `alignment-scan.mjs` 替代 |
| orient-check.mjs | 肤色带位置对比判定贴图朝向（单层目视判据） | 一次性取证，结论进 PATCHES P-1x；朝向语义现由 alignment/attach-transform 测试守护 |
| asset-check.mjs | 三场景资源完备性终检（镜像 demo loadScene） | 被 `package-matrix.mjs` 全量替代（107 包：纹理命中/解码/缺模型） |
| motion-sim.mjs | MDLA 骨骼动画逐帧偏移校验（复刻 demo 采样公式） | 被 `attach-transform.mjs` + `attach-transform-test.mjs`（官方寻址 408 层 maxΔ<0.01px）替代 |
| scene-survey.mjs | dd 全场景摸底（更多可测壁纸候选） | 被 `feature-scan.mjs` / `package-matrix.mjs` 替代 |
| text-render-test.mjs | 用包内字体验证 RE-19 文本光栅化（纯 JS） | 被 `text-layout-test.mjs` + `text-render.mjs` 替代 |
| tex-dump.mjs | 导出场景纹理为 PNG 缩略图 | 一次性取证；纹理问题现由 `tex-format-verify.mjs` / `tex-fmt5-test.mjs` / package-matrix 解码统计承担 |
| tex-smoke.mjs | 纹理解码冒烟（找"解码后透明/全黑"） | 被 `tex-fmt5-test.mjs` + `mock-gl-test.mjs` + package-matrix `TEX_DECODE` 门禁替代 |
| transpile-check.mjs | 复现三场景全部 shader 转译，扫 GLSL ES 编译雷区 | 被 `internal-shader-validate.mjs`（13 内置）+ `glsl-validate.mjs`（128 条）替代 |
| png2ascii.mjs | PNG → ASCII 亮度图（终端可读构图） | 小工具无替代；需要时 `node archive/png2ascii.mjs <file>`（自包含） |

归档规则（给下一班）：**不要**把这里的脚本加进 `run-all-tests.sh`；若某脚本需要复活，先移回上级目录、
修好 import 相对路径、补进 TESTING.md，再删掉本表对应行。

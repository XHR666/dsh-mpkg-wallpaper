# 3463520581「头发位置整体错」取证（P-240 开工轮）

## 已量到的三种口径（离线，HEAD 0.5.19）

场景：74 层（42 可见），93 张贴图全部上传成功，无脚本异常；`KIRITO PUPPET lil`（id 360）与 id 34 两个 puppet 根，
`hair kirito front/back`、`kirito face/body/arm` 等部件都是 `parent=<puppet>` + `attachment:"Attachment"`。

| 口径 | 结果 |
|---|---|
| ① 原始 `origin`（scene.json） | `hair kirito front` (152.70, 815.30)、`hair kirito back` (203.64, 804.47)、`kirito face` (24.35, 723.65)、**`kirito body` 没有 `origin` 字段** |
| ② 父链合成后（`parseScene`） | face (2603, 294)、hair front (2737, 199)、hair back (2790, 210)、body (2578, 1047) —— **相对关系解剖上自洽**（前/后发都压在脸上、身体在下方） |
| ③ 附件锚点偏移（`buildAttachOffsets`，58 条 / 45ms） | **所有部件都是 `[0.04, −6.97]`（同一个 "Attachment" 锚点）** ⇒ 小量、不可能造成"整体错位" |

⇒ ①②③ 三条都**排除**：位置数据本身没错，"头发整体错位"的高度嫌疑落在**puppet/骨骼蒙皮路径**
（部件是被 puppet 的骨骼/`animationlayers` 驱动的，不是静态贴图）。旁证：加载期有
`[P-152] MDLS bone layout rescued @+89454: declared=7 parsed=7 layout=C variant=name-fronted+slot`
（该 puppet 的骨骼布局是靠"骨名前置"兜底扫出来的）。

## 下一步最小实验（一条命令级别）

1. 真机读 puppet 部件状态：`window.__mpwBones`（骨骼表）与各部件 `l.__skin` / `l.__boneBind`；
   对比 `hair kirito front` 与 `kirito face` 拿到的**骨索引/绑定矩阵**是否一致（若头发绑到别的骨 ⇒ 定位完成）。
2. 逐层隔离要用 **`__lnHidden`**（保留父链）而不是 `?ln=`：本包 `?ln=<任意>` 会让整帧变黑（隔离档在这里不可用，
   实测 `?ln=999` 空帧 mean=0 而基线 mean≈137），原因待查（很可能是隔离档下 puppet 根/蒙皮输入缺失）。
3. 真值对照：上游**桌面 WE** 截图（网页产物档对 puppet 的支持也不同源，只能看"大致相对位置"）。

## 真机看到的现象与机制（第 62 轮，HEAD 0.5.19，`/tmp/kirito-live.png`）

**现象**：整场景渲染出来了（云、草原、远景城、女孩 Asuna 有头发），但**男孩 Kirito 是"光头"** ——
他的 `hair kirito front` / `hair kirito back` 两层没有画在头上（画面里能看到的少量错位发丝落在女孩一侧）。
这正是"人物头发的位置完全错了"。

**机制（本轮量到的链路）**：

| 事实 | 读数 |
|---|---|
| 可见 puppet 部件的蒙皮状态 | `kirito face`(层 55) 有 `__skin={mesh,nb,bindInv,bindRT,animIdx,fps}` + `__skinReady:true`；**`hair kirito front`(57) / `hair kirito back`(56) / `kirito body`(58) 完全没有 skin 字段** |
| 部件模型 | `models/hair kirito front.json` 键 = `autosize, cropoffset, material` ⇒ **没有 `puppet` 键**（数据上确实不是蒙皮层）；`models/puppet - Copy.json` 才有 `puppet` |
| puppet 文件解析 | `models/puppet - Copy_puppet.mdl`（MDLV0023，17 503 B）经 `parseMdl` 得到 **bones=1、anchors=0**（`parseMdatAnchors` 也是 0） |
| 附件偏移 | `buildAttachOffsets` 给所有部件都是 `[0.04, −6.97]`（同一 `"Attachment"` 锚点；锚点表为空 ⇒ 实质等于"没有偏移"） |
| 第二条 puppet（层 63–66） | 同样只有 `kirito face` 有 skin；该组 `visible:false`（另一姿态变体） |

⇒ 结论：**这些"挂在 puppet 上的静态部件"应该跟随父级 puppet 的骨骼/锚点变换（官方语义），而我们把它们当纯静态贴图**，
位置停在 rest pose；同一个 puppet 的 `kirito face` 是蒙皮的、跟着动画走 ⇒ 脸动了、头发没动 ⇒ 光头/错位。
根因落在 **puppet `.mdl` 的骨骼/锚点解析**（本文件解析出 bones=1、anchors=0，明显偏少；同包另有
`[P-152] MDLS bone layout rescued … declared=7 parsed=7` 说明骨架解析本身有已知的脆弱点）。

## 下一步（最小实验，按顺序）

1. 把 `models/puppet - Copy_puppet.mdl`（17 503 B）与"解析正常"的 puppet 逐块对比（`MDLV0023` 头 + 各 chunk），
   确认 bones=1/anchors=0 是**解析缺口**还是文件本身如此；若是缺口 ⇒ 修 `parseMdl`（有判据可加：
   该文件应解析出 ≥7 骨骼 / 命名锚点）。
2. 若文件本身没有锚点 ⇒ 按官方语义补"**被 attach 的静态层跟随父级骨骼变换**"这条链路（当前只有
   `kirito face` 走了蒙皮），判据用本包：Kirito 头部区域应出现黑发（与 `hair kirito front` 的贴图内容相符）。
3. 复验时逐层隔离**必须用 `__lnHidden`**（本包 `?ln=` 会让整帧变黑，已记在上面）。

## 第 63 轮：**该包 65/67 个材质 pass 用的是 `genericimage4`，而本仓 bundle 里 0 处引用** ⇒ 主因方向

| 读数 | 值 |
|---|---|
| 全包材质 pass 的 shader 分布 | **`genericimage4`: 65**、`genericimage2`: 2（共 67） |
| 本仓 `core/we-scene-bundle.js` 里 `genericimage4` 出现次数 | **0**（⇒ 没有专门分支，走的是某个兜底图像路径） |
| 两条头发层的材质 | `materials/hair kirito front.json` / `hair kirito back.json`：`shader: "genericimage4"`、`blending: translucent`、`combos: {}`、贴图**在包内**（`materials/hair kirito *.tex` 都存在；不是缺纹理） |
| 官方 shader 源（本机 WE 安装，可直接读） | `<WE 安装目录>/assets/shaders/genericimage4.{vert,frag}`（`genericimage{,2,3,4}` 都在同一目录） |

**现象对照**（截图已存）：全画档 Kirito 头上有黑发（隐藏两条 `hair kirito *` 后变光头 ⇒ 这两层确实在画、位置大体在头上）；
但"只留 Kirito 头发"档里除了顶部那块黑发，还出现一个**孤立的小白方块**（≈ 屏 (715,290)）
——正是"不认识的 shader 走了兜底、某些 pass 画成白片/漏采样"的典型症状。

**下一轮第一步**：读官方 `genericimage4.vert/.frag` 与本仓现有图像路径逐条对照（重点：它比 `genericimage2` 多了什么——
顶点动画/`VERTEXCOLOR`/多 pass/`combos`），把 `genericimage4` 接进材质→shader 选择表；
判据：本包"只留 Kirito 头发"档不再出现孤立白方块，且隐藏/显示两条头发层对头部黑发的影响与全画档一致。

## 第 64 轮：`genericimage4` 组合位对照 + 白方块定位（未收口）

- **组合位对照**：官方 `genericimage3.vert` 与 `genericimage4.vert` 的 `#if` 组合**完全一致**（SKINNING / MORPHING /
  VERTEXCOLOR 等）；差异只在 `.frag`：v4 用 `LIGHTS_SHADOW_MAPPING`/`LIGHTS_COOKIE` 取代 v3 的
  `LIGHTS_POINT/SPOT/TUBE/DIRECTIONAL`，并多一个 `FOG_COMPUTED`。v4 的 `[COMBO]` 默认值：
  `LIGHTING=0`、`REFLECTION=0`、**`FOG=1`**。而两条头发层材质的 `combos` 是**空表** ⇒ 顶点/片元路径等同"普通图像 +
  场景雾"，不是 SKINNING/VERTEXCOLOR 之类会搬动顶点的组合。
  ⇒ **修正上一条的力度**：`genericimage4` 未接这条**不足以**单独解释"头发整体错位"（空 combos 下它与普通图像路径等价）；
  它仍是"该包 65/67 pass 的主 shader 家族没被显式认领"这条事实，但要先排掉更直接的解释。
- **cropoffset**：两条头发模型的 `autosize:true` + `cropoffset:"783.5 841"`（face 是 "863 717"）；本仓 `cropoffset`
  只在 **网格层** 且 `?meshsize=crop`（研究稿提案，RE-02 判定官方运行时不消费该字段）里生效 ⇒ 默认档不消费，
  头发（非网格层）不受它影响 ⇒ **排除**。
- **白方块仍未定位**：把两条 `hair kirito *` 同时显示时，除顶部黑发外还有一块孤立白色方块（≈屏 (715,290)，设计
  ≈(3405,1381)），而两层的解析 origin 分别是 (2790,210)/(2737,199)（屏 ≈(586,44)/(575,42)）⇒ **白方块不是这两层的
  起点位置**，来源待定。下一轮第一步：**分别**只留 `hair kirito back`(下标 56) 与只留 `hair kirito front`(下标 57)
  各截一张（`__lnHidden`，保父链），看白方块属于哪一层、还是来自第三层（如 `hair extra` / `HAIR BACK (BIG)`）。

## 第 65 轮：白方块 = **puppet 根层（`alpha:0`、50×50）被画成了一小块白**（新线索，最具体）

| 读数 | 值 |
|---|---|
| 只留 `hair kirito front`(57) 的截图（`/tmp/ko-57.png`） | 同时出现**两样东西**：顶部那块深色头发（≈ 它的解析 origin 屏幕位置）+ 一块**孤立白方块**（≈屏 (715,290)，约 10×10 屏幕 px ≈ 48 设计 px） |
| 两个 puppet 根层 | `id34 KIRITO PUPPET`：`image: models/puppet - Copy.json`、`size: 50×50`、`scale 1.04`、**`alpha: 0`**、`origin (2577.98, 1112.91)`；`id360 KIRITO PUPPET lil`：同一个模型、`size 50×50`、`scale 0.798`、**`alpha: 0`**、`origin (2577.98, 861.13)` |
| 尺寸吻合 | 白方块 ≈ **48 设计 px** ≈ 根层 `size 50×50` ⇒ **它极可能就是这两个根层被画出来的那一块** |
| 材质/贴图 | 根层材质 `materials/puppet - Copy.json`（`genericimage4`、translucent、贴图 `puppet - Copy`）——**贴图在包内**（不是缺贴图兜底白） |
| 网格 | `models/puppet - Copy_puppet.mdl`（MDLV0023）：163 顶点 / 882 索引 / **bones=1、anchors=0** |

**为什么之前没看出来**：我用 `__lnHidden` 做"只留一层"时，**保留了祖先链**（正确做法，否则 puppet 部件会跟着消失），
而两个 puppet 根层正是祖先 ⇒ 白方块被一起留下；本次逐层隔离才把它与头发分开。

**下一轮第一步（很小、可判定）**：
1. 全画档里**只隐藏两个根层**（`id 34` / `id 360`，按 `l.id` 匹配），前后各截一张 ⇒ 若角色附近那块白色/米色形状消失，
   即确认"根层白块"这条；
2. 查网格绘制路径对 **层 `alpha`** 的处理（`alpha: 0` 的层应当整层不画，或至少乘到片元 alpha 上）；
   判据：`alpha: 0` 的 puppet 根层在整帧里贡献 **0 像素**（可写进 `tests/` 的合成场景断言）。
3. 顺带：`bones=1`/`anchors=0` 的解析缺口仍待查（第 62 轮登记），它与"部件不跟随骨骼"是同一族问题。

## 第 66 轮：**puppet 根层画的是"角色网格"本身**（占整帧 38%），白方块是网格里的残片 —— 上一轮的"白块"结论要收敛

实测（全画档，隐藏 `id34`+`id360` 两个 `KIRITO PUPPET*` 根层前后对比，`/tmp/kr-A-full.png` vs `/tmp/kr-B-noroot.png`）：

| 读数 | 值 |
|---|---|
| 差异像素 | **352 041（38.199% 整帧）**，包围盒 **1280×720 @(0,0)**（全屏），平均差 54.1 |
| 两个根层定义 | `id34 KIRITO PUPPET`（`alpha: 0`、`size 50×50`、`models/puppet - Copy.json`）、`id360 KIRITO PUPPET lil`（同模型、`alpha: 0`、`scale 0.798`） |

⇒ **修正第 65 轮的收敛方向**：这两个根层不是"只画一小块白"，它们画的是**角色网格（puppet mesh）的主体**
（隐藏后整帧 38% 变化）；之前那个 50×50 的白方块是**网格渲染里的残片**（很可能是一个退化/未蒙皮的 quad，
或者是根层自身 `size 50×50` 在网格路径里被当兜底 quad 画了出来）。而 **`alpha: 0` 在网格路径上显然没有被当作
"整层不画"**（否则隐藏前后不会有 38% 差异）——这一条本身需要用官方语义核对（puppet 容器的 `alpha` 是否应当乘到网格上）。

### 由此收敛后的下一步（按性价比排序，都是小实验）

1. **网格动画/骨骼是否真的作用到顶点**：该 puppet 的 MDLV0023 里 `bones=1`、`animations=1`（`parseMdl` 读数）。
   ⇒ 读官方 `we-scene` 的网格路径（或 `references/vendor-ref` 里的 MIT 对照实现）确认：这种"1 骨 + 1 动画"的 puppet
   是靠**顶点动画（MDLA/MDLV animations）**驱动的；若本仓网格路径只做骨骼蒙皮、不消费顶点动画，网格就会停在
   rest pose ⇒ **头发（烘进网格的部分）位置错**，而单独作为静态层画出来的部件（face/hair 等）各自按 authored 走
   ⇒ "位置对不上"的观感。
2. **层 `alpha` 与网格**：判据化 —— `alpha: 0` 的 puppet 层在整帧里应贡献 0 像素还是照画（要按官方语义定）。
3. 白方块残片：在网格路径里找"退化 quad / 未蒙皮顶点"的来源（可与 1 一起修）。
4. 复验口径：本包逐层隔离必须用 `__lnHidden`，且"只留一层"要保留祖先链（否则 puppet 部件整组消失 —— 已记）。

## 第 67 轮：puppet 网格是"**1 骨蒙皮 + 1 段骨骼动画**"，且本仓网格路径确实消费 animations

| 读数（`models/puppet - Copy_puppet.mdl`，MDLV0023，17 503 B） | 值 |
|---|---|
| 网格 | 顶点 **163** / 索引 **882**；每顶点都有 `blendIndices`(163) 与 `blendWeights`(163) ⇒ **是蒙皮网格** |
| 骨骼 | **bones = 1**、anchors = 0 |
| 动画 | `animations = 1`；`animation[0] = {id, name, frameCount, boneCount, segBytes, segs:[15271], fps}` ⇒ 一段骨骼动画（首段起始 15 271 B） |

本仓网格路径的消费点（`core/we-scene-bundle.js`）：`mesh.animations[spec.animIdx]`（`bindWorldChain`/`skinPuppet` 家族，
`analyzeAnimGoodFrames` 建"好帧表"，`animSpec` 带 `blend/rate/additive`）⇒ **不是"完全不消费动画"**；
`kirito face` 层真机读数也确实拿到了 `__skin = {mesh, nb, bindInv, bindRT, animIdx, fps}` + `__skinReady:true`。

⇒ 本轮无法支持"网格只做骨骼蒙皮、不吃顶点动画"这一条（该假设**待定**，不作为结论）；
真正需要的是**真机读 `__skin` 的实际取值**：`nb`（骨数）、`animIdx`、`fps`，以及该网格画出来的**实际落点**
（与相邻静态部件对比）——下一轮按这个做。

> 操作教训：本轮第一次尝试把 `blendIndices` 整个数组打进了日志（14 KB+ 刷屏）⇒ 以后打印只给**长度与首元素**。

## 第 68 轮：真机 `__skin` 读数（puppet = **两个网格 + 若干静态层**）

| 层 | 层 alpha / 可见 | `__skin` | 网格 |
|---|---|---|---|
| `KIRITO PUPPET`（下标 52，id34，**当前生效的那个变体**） | **alpha 0**、vis true、origin (2577.98, 1047.09)、scale 1.04 | `nb=1`、`animIdx=0`、`fps=12`、`bindInv[1]`、`bindRT` 有、`frameCount/good/animGood/animSpec` 齐 | **163 顶点 / 882 索引**、`center=(-0.5,-0.5)` |
| `KIRITO PUPPET lil`（下标 60，id360） | alpha 0、**vis false**（另一变体，用户属性 `characterssize` 条件 '1'） | `nb=1`、fps 12 | 163 / 882（同一模型） |
| `kirito face`（下标 55） | alpha **1** | **`nb=7`**、fps 15、`bindInv[7]` | **487 顶点 / 2541 索引**、`center=(31.3, 82.6)` |
| `hair kirito front`（下标 57） | alpha 1 | **无 `__skin`**（纯静态图像层） | — |

要点：
1. **`[P-152] MDLS bone layout rescued … declared=7 parsed=7` 对应的是 `kirito face`**（`nb=7`）——骨架解析在这条上是对的；
   根层那个 `puppet - Copy_puppet.mdl` 就是**只有 1 根骨**（`nb=1`）的简单网格。
2. **根层 `alpha: 0` 仍然在画**（第 66 轮：隐藏它整帧变 38%）⇒ 需要按官方语义核对"puppet/网格层的 `alpha` 是否生效"；
   两种可能：(a) 官方也把 puppet 容器层的 `alpha` 当无效（网格用材质 alpha）⇒ 我们的行为正确；
   (b) 官方按 alpha 0 不画 ⇒ 我们多画了一个网格（角色身上会多一层深色覆盖）。
3. `hair kirito front/back` 是**静态图像层**（无 skin），所以它们**不会跟随 puppet 的骨骼动画**——如果官方让它们跟着
   父级/锚点动，那"头发位置错"的机制就在这里；若官方也不动，则问题在别处（例如上游产物档对比下看不出差异）。

## 下一轮（两步，都很小）

1. **同相位对照上游产物档**：同一包（本仓档 vs `/wallpaper-engine-webgl/renderer/index.html` + `loadSceneFile`），
   两边各截一张 ⇒ 直接看"官方画出来的角色/头发 vs 我们的"差在哪（body/hair/位置/多余层）。
2. **离线查网格路径是否消费层 `alpha`**（`core/we-scene-bundle.js` 的 `onMeshLayer`/`skinPuppet` 家族），
   并按官方 d.ts/参考实现判定 puppet 容器层 `alpha` 的语义，写成判据（`alpha:0` 的网格层应贡献 0 像素或照画，二者取官方口径）。

## 第 69 轮：用**上游产物档当仲裁**（改包对照）—— puppet 容器的 `alpha` **官方也不消费**

同相位（装载后 20 s，各 3 帧均值），把三份改过的包喂上游产物档：

| 包（改 `scene.json`） | 上游档 mean | 上游档 `≥250` |
|---|---|---|
| `k-orig`（原包，根层 `alpha: 0`） | 163.85 | 16.96% |
| `k-alpha1`（两个 `KIRITO PUPPET*` 根层 `alpha → 1`） | **164.25**（+0.40，噪声内） | 17.05% |
| `k-noroot`（整层删掉两个根层） | **177.34**（+13.49，明显变亮） | 18.03% |

⇒ 两条结论（**以官方渲染器为仲裁**）：
1. **官方不消费 puppet 容器层的 `alpha`**：把它 0→1，画面几乎不动（+0.4）⇒ 本仓"根层 `alpha: 0` 仍然画"**与官方一致，不是缺陷**
   （第 68 轮列出的两种可能里，取 (a)）。
2. **官方确实画这个根层网格**：删掉它**变亮 13.5**（去掉一层深色网格）⇒ 本仓画它也是对的。

另外把两边截图并排看（`/tmp/kirito-live.png` 本仓 vs `/tmp/kup-k-orig.png` 上游）：
上游对**这个包**的渲染本身是坏的（背景出现大片**白色方块**、远景层缺失），所以它**不能当这个包的像素真值**；
两边共同点：Kirito 有黑发（不是光头）、Asuna 的白色披风/发饰都向左侧飘 —— **"头发位置错"没有在我这两张同相位截图上复现**。

### 下一轮：把"用户看到的那一帧"复现出来（不再靠猜）
按时间序列与相机档各截几张，逐张比对"谁在哪、头发在哪"：`t≈5s / 15s / 30s` × `campose=full / legacy`，
外加开场动画期（`?skipintro=0`）；重点看 **Asuna 的长发**与 **Kirito 的前/后发**两条 `hair kirito *`
（它们是静态层、不吃骨骼；若某相位下它们停在 rest pose 而角色其它部分动了，就会看到"头发漂在别处"）。

## 第 70 轮：**机制定案** —— 挂在 puppet 上的**静态部件（含头发）没有跟随"动画后的附件骨骼"**，只吃了静态偏移

同一相位截图（`/tmp/kp-legacy-t26000.png` 等四张）里能直接看到症状：**Asuna 的长发/发饰整体偏到头部右下方**、
Kirito 侧也有一块橙色发饰漂在他背后；而**角色本体的脸/身体是对的**（不是光头、位置正常）。

真机层表（`3463520581`，可见层）：

| 角色 | 根层（puppet） | 蒙皮部件 | **静态部件** |
|---|---|---|---|
| Asuna | `ASUNA PUPPET`(id30) `__skin nb=1`、`models/puppet.json` | `asuna body`(id22) **`nb=15`**（父 = `asuna body bottom`） | `asuna body bottom`(id16)、以及**全部头发**（`main hair back c2`(id134)… 父链 `HAIR BACK (BIG)`(id70)→`ASUNA PUPPET`），`skin: null`、`att:"hair back"` |
| Kirito | `KIRITO PUPPET`(id34) `nb=1` | `kirito face`(id55) **`nb=7`** | `kirito body`(id58)、`hair kirito front/back`(id102/98)，`skin: null`、`att:"Attachment"` |

⇒ **这些部件的模型 JSON 里没有 `puppet` 键**（数据上确实是静态图像层），但它们 `parent` 是 puppet、带 `attachment`
⇒ 官方语义下它们要**跟着附件点所在的那根骨骼动**；本仓只给了它们一个**静态偏移**（第 61 轮实测：所有部件同一个
`"Attachment"` 锚点、偏移仅 `[0.04, −6.97]`，因为锚点表为空 ⇒ 实质等于没有变换）。
**动画一跑起来，角色本体（蒙皮网格）动、头发（静态层）不动 ⇒ "头发位置完全错了"**；
而且这与"某些相位看起来正常、某些相位错得离谱"完全吻合（rest pose 相位对上、动画拉开就错开）。

### 下一轮：实现"附件跟随动画骨骼"（这条是**产品代码修复**，不再是取证）
1. 在 `core/attach-transform.mjs`：把现有 `attachmentOffset(child, parent, ctx)`（静态）扩展/新增一个
   **按时间 t 求附件世界变换**的口径（官方 `_attachmentOffset` + `puppetBoneFinal`：用父级骨骼链在 t 的姿势），
   已有 `bindWorldChain`/`sampleAnimRT`/`puppetBoneFinal` 可复用；`?att=legacy` 保留旧静态偏移做 A/B。
2. 在 `core/we-scene-bundle.js` 的每帧脚本/变换同步处：对 `attachment != null && parent 是 puppet` 的层，
   写回 **origin（必要时 scale）**（沿用 `syncScriptOrigins` 同款"增量叠加"口径，避免抹掉 parseScene 的锚点结果）。
3. 判据：同包同相位（`campose=legacy`，t≈26 s）与"只画部件"的隔离档 —— 头发包围盒应与所在角色的头/背对上；
   并加一条合成场景断言（一个 1 骨 puppet + 一个静态附件层，动画推进后附件层的 origin 必须随时间变化）。

## 第 71 轮：根因**落到代码行** —— 逐帧附件跟随的表根本没建起来（`attachAnchorAnim` 空）

三组读数把链路钉死：

| 读数 | 值 | 含义 |
|---|---|---|
| 离线 `attachOffsetDeltas(objects, readEntry, {time})` | **条目 58**，t=3 s 时 **20 条非零**、最大 `|Δ| = 18.52`；t=8 s 最大 14.76 | 增量机制**本身是好的**（锚点确实随动画动） |
| 真机 `origin`（`hair kirito front/back`、`main hair back c2`、`hair extra`、`kirito face`）t0/t1/t2 各隔 4 s | 位移 **0.00 / 0.00** | **逐帧跟随没有生效** |
| 真机页面日志 | **没有** `①(P-139) 附件锚点逐帧: N 层` 这一行（只有 `附件锚点 = elysia 移植实现…`） | 建表那段（`if (!ATT_LEGACY) { scene.layers.forEach(...) }`）**没有往表里放进任何层** |

⇒ 结论：`demo.html` 里 `attachAnchorAnim` 的**填充发生在模块初始化期**（那段是顶层代码，紧跟在
`applyScriptedFullscreenFallback` 等 init 调用之后），此时 `scene.layers` 还是空的 / 场景尚未装载
（页面不报错、应用照常，说明 `scene` 存在但层表为空）⇒ 表恒空 ⇒ `applyAttachAnchorDelta()` 首行
`if (!attachAnchorAnim.size) return` 直接返回 ⇒ **所有挂 puppet 的静态部件（含头发）停在 parse 时烘进去的
"动画帧 0" 位姿**，角色本体（蒙皮网格）却一直在动 ⇒ 用户看到的"头发位置完全错了"。

### 下一轮修法（很小，且可判定）
1. 把建表那段抽成一个函数（`buildAttachAnchorAnim()`），在**挂载/解析完成后**调用一次（`scene.layers.length > 0` 且
   `objById.size > 0` 时），并**无条件打一行** `①(P-139) 附件锚点逐帧: N 层`（便于以后一眼看出有没有建表）；
   为稳妥起见可在 `applyAttachAnchorDelta()` 里做一次惰性补建（表空 + 场景就绪 ⇒ 建）。
2. 判据：真机同包 `campose=legacy` 下，`hair kirito front/back` 的 `origin` 在 8 s 内**必须变化**（对比两组采样）；
   再叠加视觉验收（t≈26 s 截图里 Asuna/Kirito 的头发应与头部对齐）。
3. `?att=legacy` 保持旧行为（那条路径走 `attachAnim`，与本条无关）。

## 第 77 轮：**量级校正** —— 已修好的"逐帧附件跟随"只能搬动 ≤4 屏幕像素；"头发整体错位"另有原因

`applyAttachAnchorDelta` 现在真的在跑（第 76 轮：`delta={anim:58,deltas:58,applied:58,miss:0,t:0.25}`、
`hair kirito front` 2737→2736），但把**量级**摆出来看：

- 离线同包 `attachOffsetDeltas` 在 **t=3 s** 时最大 `|Δ| = 18.5`、t=8 s 为 14.8（**设计单位**）；
- 1280 宽下 1 设计单位 ≈ **0.21 屏幕像素** ⇒ 这条链路最多搬动 **≈4 屏幕像素**；
- 而"头发整体错位"在截图里是**几十到上百屏幕像素**级别的偏差。

⇒ **结论（对前几轮的收敛）**：逐帧跟随确实是**真缺陷**（对这些包从未生效，已修并验证），
但它**不足以**解释"头发位置完全错了"。真正的大位移必须在**基线位置**里（parse 时烘进去的
`origin` / 父链合成 / 附件锚点静态偏移），而不是"每帧增量"里。

### 下一轮（把基线位置量出来）
1. 逐层隔离（`__lnHidden` + 保留祖先链，`campose=legacy`）量 **`main hair back c2`(下标12) / `HAIR BACK (BIG)`(下标8)
   / `asuna body`(下标23) / `kirito face`(下标55)** 的**实绘包围盒**，与"解析 origin × 画面比例"推出的期望位置逐层对比
   （第 77 轮首次尝试的探针在页面里抛错，下一轮修好再跑：`empty` 帧那句写法有误）。
2. 对偏差大的层，离线复算三种基线口径（raw authored / 父链合成 / 附件锚点静态偏移）里**哪一种**能把该层搬到实绘位置；
   以此判定是 `parseScene` 的父链合成还是 `attachmentOffset` 的静态烘焙口径错。
3. 判据：修好后 t≈26 s 截图里 Asuna 的长发与头部对齐（并与 Kirito 侧同相位对照）。

## 第 78 轮：再排掉两个假设（无重复变体 / 基线几何自洽），并把"同一 t 的对照物"指向 elysia CPU 参考渲染

| 检查 | 读数 | 结论 |
|---|---|---|
| 基线几何（离线逐层） | `HAIR BACK (BIG)` 与父 `ASUNA PUPPET` 距 300、`main hair back c2` 与父距 314、`hair kirito front` 与 `KIRITO PUPPET` 距 863（raw y=815 ⇒ 在上方） | 子层相对父层的**方向与量级都与 raw 值一致** ⇒ 父链合成 + 静态附件偏移**没有肉眼级错误** |
| 变体重复（解析期可见性） | `parseScene` 后 74 层里 72 层"可见"（只有 2 层隐藏） | 解析期很宽松 ⇒ 必须看运行期 |
| 变体重复（**运行期**，真机） | 运行期隐藏 **32 层**，`ASUNA PUPPET lil`/`KIRITO PUPPET lil` 及其**全部**部件（433/437/466/520/537/394/398/405/415）`vis=false` | **没有"两套变体同时上屏"** ⇒ 排掉"重复叠加导致错位" |
| 已修链路 | 第 75–77 轮：逐帧附件跟随三处作用域缺陷修好、真机 58/58 应用、位移 ≤4 屏幕像素 | 排掉"逐帧增量造成大位移" |

⇒ 剩下的**唯一**能解释"几十~上百像素级"偏差的可能，是**相位**：本机 llvmpipe ≈0.5 fps，
`skinAnimTime` 每帧只 +1/30 s ⇒ 动画时钟 ≈ **0.017 s/s**（16 s 墙钟 = t≈0.25 s），
角色几乎停在**初始姿势**。若作者的部件本来就靠动画（附件骨骼走位）才落到正确位置，
那"本机看到的错位"与"真机（时钟按真实时间走）看到的位置"就会不同 —— 这需要用**同一 t 的对照物**来判。

### 下一轮：拿"同一 t 的对照物"
1. 服务器有 `/refrender/` 路由（elysia CPU 参考渲染）；用它渲染同一个包、取**明确的 t**，与本仓 WebGL 在同一 t 的结果逐层比
   （CPU 侧按真实时间推进 ⇒ 能直接给出"t=3 s 时头发该在哪"）。
2. 若 CPU 参考渲染在 t=3 s 时头发也"错位" ⇒ 那就是**作者意图**（或共同的基线口径问题）；若 CPU 侧正确 ⇒ 问题回到 WebGL 侧的时钟/骨骼采样。
3. 判据：同一 t 下，本仓 WebGL 与 elysia CPU 的**头发层包围盒**偏差 < 一个层宽。

## 第 79 轮：**基线口径被官方标定表验证通过**；Asuna 头发那 705 设计单位的位移是"附件锚点算出来的"，不是错误

用仓库自带的层实绘矩形工作台（`tests/layer-rect-check.mjs --pkg <pkg> --t=<秒> [--noattach]`）量：

| 层 | `--t=0`（含附件锚点） | `--t=0 --noattach`（关附件） | 差值 |
|---|---|---|---|
| `hair extra`(id270, Asuna) | center **(1999, 817)** | center **(1975, 1522)** | **Δy = 705 设计单位 ≈ 148 屏幕像素** |
| `hair kirito front`(id102) | (2737, 206) | (2737, 199) | Δy = 7 |
| `hair kirito back`(id98) | (2790, 218) | (2790, 210) | Δy = 8 |

⇒ **Asuna 的头发确实被附件锚点搬了 ~705 设计单位（≈148 屏幕像素）**，这就是"几十~上百像素级"的来源 ——
但它**不是我们算错**：把同一套 `--refrender` 口径拿到**有官方标定矩形**的包 `3719111841` 上跑：

```
附件锚点：58:右侧发→头发附件, 299:底发→头部, 52:衣袖→胸部, 473:长发2→头部, …
与标定矩形中心距离：中位 0px，最大 79px
```

⇒ **中位 0px** —— 附件锚点管线**已被官方标定表验证**（连"哪根骨/哪个锚点"都对得上）。

### 结论（第 4 件）
- 基线位置（父链 + 静态附件锚点）**与官方口径一致**；
- 逐帧跟随的**真缺陷已修**（P-241，58/58 逐层应用）；
- 因此"我看到的头发错位"最可能来自**相位**：本机 llvmpipe ≈0.5 fps ⇒ 动画时钟 ≈0.017 s/s，
  角色停在**初始姿势**（t≈0.25 s），而 Asuna 长发的锚点姿势在动画里是**大幅移动**的
  （静态锚点就已经是 705 单位 ⇒ 动画中还会继续走位）。

### 下一轮（把相位跑起来再判，仍然本机可做）
1. 用 `__lnHidden` **只留 puppet 相关层**（两个角色 + 头发 + 身体，约 20 层）⇒ 帧率应显著上升；
2. 等 ~60 s 让动画时钟走到 **t≈10–20 s**，截图并与"t≈0.25 s"那张对比：若头发随头部落位 ⇒ 相位结论成立；
3. 若仍错位，再把该 t 的 `layer-rect-check --t=<同一个 t>` 结果与实绘包围盒比对，定位到具体层。

## 第 80 轮：相位判定通过 —— 剪层提帧后动画时钟走到 t≈7 s，**头发与脸同步移动**（相对关系保持）

把非 puppet 层剪到只剩 **23/74 层**（`__lnHidden` + 保留祖先链），帧率显著上升、动画时钟真的走起来了：

| 采样 | `__mpwAttachDelta.t` | 帧数 | `hair kirito front` | `hair kirito back` | `kirito face` | `main hair back c2` |
|---|---|---|---|---|---|---|
| t0 | 0.35 s | 8 | (2737,199) | (2790,210) | (2603,294) | (2197,1410) |
| +30 s | 3.7 s | 75 | (2732,199) | (2785,210) | (2599,294) | (2197,1410) |
| +60 s | **6.9 s** | 139 | (2730,199) | (2783,210) | (2597,294) | (2197,1410) |

- Kirito 的头发与脸**同步位移**（各 −6~−7 设计单位，≈1.5 屏幕像素）⇒ **相对关系保持**、逐帧跟随工作正常 ✓
- Asuna 的 `main hair back c2` **完全不动** ⇒ 该锚点骨在这段动画里不动（数据如此，非缺陷）
- 截图：`/tmp/ph-t0.png` / `/tmp/ph-t30.png` / `/tmp/ph-t30.png`（第二次覆写）

### 第 4 件的收口判断
1. 基线（父链 + 静态附件锚点）**经官方标定表验证**（`3719111841` 中位 0px）；
2. 逐帧跟随的**真缺陷已修**（P-241：三处作用域缺陷；真机 58/58 逐层应用、零未命中）；
3. 相位测试通过（头发与脸同步）；
⇒ **可复现、可判定的缺陷已清零**。剩下的"看起来错位"需要**用户那一刻的截图/相位**才能继续定位
（本机 llvmpipe 每帧只推进 1/30 s，跑 60 s 才到 t≈7 s；真机是同一条逻辑、时钟按真实时间走）。
记录成待办（非阻塞）：需要一份"出问题时"的截图（含左下/右下角时间与是否刚进壁纸）+ 是否发生在开场动画期。

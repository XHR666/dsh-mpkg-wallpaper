# ISSUE0924A2 · 渲染器「效果链编译失败」线（G 线）报告 —— **宽度推断族 + `fmod` 重写**

- 开工提交：`a3bb009d2b567dcbd080c67f516432c783e196f3`（`git rev-parse HEAD`，**改前口径一律以此为准**；
  本线**未 commit**，D 线改动与本线改动都在工作区）
- 写权范围（只碰这些）：`core/we-scene-bundle.js`、`tests/hlsl2glsl-width-table-test.mjs`、
  `tests/hlsl2glsl-width-9w-test.mjs`（新增）、本文件。**没碰**：`demo.html` / `demo/**` / `server/**` /
  `package.json` / `README*` / `docs/PATCHES.md` / 插件仓 / `shaders/**`（`common_vertex.h` 未做，见 §6.5）。
- 上游交接：`docs/reports-issue0924a2-line-D.md`（§1/§2/§7/§8）—— D 线把 `/0923` 语料的
  「含 include 的 shader stage 编译失败数」从 **151** 打到 **10**，本线接的就是那剩下的 10 条。

---

## 0. 汇总（一句话）

**根因 7 类已定死（全部真编译器复现）· 修复 2 处（新规则族 9-W 七条子规则 + `fmod` 重写）· 新增判据 2 个文件
（宽度表判据扩到 **77 项断言** + 新判据 **68 项断言**，含 3 组变异必红与真包真编译）· `/0923` 语料编译失败
10 → **1**（剩 1 条属**另一族**：顶点阶段写 `attribute`，本线未修并已定性）· 用户 ④ `2902406982` 的
`三角*` 层 `passes` **0 → 1**（端到端读数见 §5）· 既有门禁全绿、B2「移植前能编译的输出逐位不变」= 0 回归。**

---

## 1. 现象与复现（用户 ④ `2902406982`，本机 llvmpipe + 桌面 Firefox）

用户报的 `三角1..6/12/13` 那批层，效果链是 `clipping_mask` **单 pass**。改前（= D 线末态，本线新规则关掉）
端到端实测：

```
跳过编译失败的 pass=1   着色器编译失败=1   wrongOperand=9
fx 层=43   真的跑了 pass 的层=5
三角* 层数=7   其中 passes=0 的=7
日志: ⚠ [we-scene] 跳过编译失败的 pass "workshop/2800594362/effects/clipping_mask":
      ERROR: 0:472: '-' : wrong operand types — no operation '-' exists that takes a left-hand operand of
      type 'highp 4-component vector of float' and a right operand of type 'highp 2-component vector of float'
```

改后：`跳过编译失败的 pass=0 · 着色器编译失败=0 · wrongOperand=0 · 三角* 7/7 层 passes=1 ·
真的跑了 pass 的层 5 → 12`（逐层读数与命令见 §5）。

离线（不依赖浏览器）同一根因的复现：`tests/hlsl2glsl-width-9w-test.mjs` 的 W2 用**真包真源 + 生产拼装**
`assembleEffectShaderSources()` + `glslangValidator` 逐条编译，改前每条都报 `wrong operand types`（W3 变异必红档）。

---

## 2. 根因（逐条 `file:line`；`file:line` 都是**真包内源文件**的行号）

`/0923` 语料里含 include 的 shader stage 改前有 10 条编译失败，全部落在下面 **7 类**里（①–⑥ 是
「宽度 / 整型隐式转换」族、⑦ 是「GLSL 没这个函数」；真编译器读数见 §4）：

| # | 现象（真编译器报文） | 根因 `file:line` | 现场源（要点） |
|---|---|---|---|
| ① | `'-' : wrong operand types … 4-component … 2-component` | `0923/2902406982 shaders/workshop/2800594362/effects/clipping_mask.frag:53` | `v_TexCoord * 2.0 - 1.0 - texScaleCenter`：`v_TexCoord` 是 `vec4`（同文件 `:29`），`texScaleCenter` 展开成 `vec2` ⇒ **二元运算两侧宽度不同**。HLSL 把宽的一侧截到窄的一侧（fxc 仅告警 X3206），GLSL ES 3.0 直接拒绝 ⇒ 驱动拒绝整条 pass ⇒「跳过编译失败的 pass」⇒ 该层退化成背景拷贝 |
| ② | 同上（`vec3 … vec2`） | `0923/2981249186`+`3690417937 shaders/workshop/2138904733/effects/cutout_vignette.frag:79` | `abs(v_TexCoord - vec2(u_offset))`：`varying vec3 v_TexCoord` 减 `vec2` |
| ③ | 同上（`vec4 … vec2`） | `0923/3448290956 shaders/workshop/2973943998/effects/iris_movement__.vert:167` | `vec2 da = transformedCursorPosition * g_CursorScale * …`：`vec4 * vec2` |
| ④ | 同上（`vec2 … vec4`，**右侧更宽**） | `0923/3653641024 shaders/workshop/3221939295/effects/____________________.frag:159` | `vec2(500) / g_Texture0Resolution`：右侧 `uniform vec4` ⇒ 截**右**为 `.xy` |
| ⑤ | `'+' : … 'const int' … '2-component vector of float'` + `'=' cannot convert from int to float` | `0923/3479521040 shaders/workshop/3088030303/effects/shadow.vert:37` | `float atFactor = (1 + (abs(u_shadowOffset) + abs(…)) * 2) * max(1, abs(u_ShadowScale));` —— 三个子问题叠在一行：**(a)** `1`(int) ⊗ `vec2`（GLSL ES **没有** int→float 隐式转换，glslang 实测 `int / float` 也报 `no operation`）；**(b)** 整式是 `vec2` 却赋给 `float`（HLSL 取 `.x`）；**(c)** `max(1.0, <vec2>)` —— GLSL 只有 `max(genType, genType)` 与 `max(genType, float)`，没有 `max(float, vecN)` 重载 |
| ⑥ | `'const' : non-matching or non-convertible constant type for const initializer` + `'/' int/float` | `0923/3582367840 shaders/effects/godrays_cast.frag:46` 与 `:53` | `const float sampleDrop = sampleCount - 1;`（`sampleCount` 是 `const int`）—— GLSL ES 的 const 初始化式**类型必须精确匹配**；修掉它之后同一文件 `:53` 暴露下一处：`albedo += smp * (i / sampleDrop);`（`int / float` ⇒ 需要显式 `float(i)`） |
| ⑦ | GLSL ES 无 `fmod` 这个名字 | `0923/2902406982 shaders/workshop/2423877731/effects/chromatic_aberration.frag:42` | `fmod(g_Time, M_PI_F / 10) * u_shiftSpeed`（`AUDIOPROCESSING=0` 那一支）。**必须**落成 `x - y*trunc(x/y)`：`fmod` 向**零**取整、GLSL `mod` 向**负无穷**取整（`fmod(-1.5,1) = -0.5` vs `mod(-1.5,1.0) = 0.5`）⇒ 直接换 `mod` 是**改语义**（数值实证见 §4 W4） |

**共同点**：①–⑥ 都是「HLSL 宽松、GLSL ES 严格」的**隐式转换**（截断 / int→float / 标量广播 / const 初始化式），
⑦ 是「GLSL ES 侧根本没有这个名字」；**共同后果是静默失败**——驱动拒绝整条 pass，渲染器只 `console.warn`
后跳过，画面上只是「这一层的效果没了」，控制台没有红。

---

## 3. 改法（2 处，逐条给理由）

### 3.1 新规则族 **9-W「表达式级宽度推断」**（`core/we-scene-bundle.js` 的 `hlsl2glsl()`，宽度表块**最后**）

位置紧跟既有 9 / 9-3 / 9a-2 / 9-S 之后、同一 `if (w9Width.size > 0)` 闸门内 —— **既有四条规则的输入与行为
逐字节不变**（守门人 = 宽度表判据的 B2，实测 0 回归）。口径与既有规则同源，一条不放宽：

1. **只认可确证的宽度**：本文件（`#include` 已展开 ⇒ 公共头里的函数声明也在册）的 `vecN <名>` / `float <名>` /
   `int <名>` 声明、`vecN(...)` 构造、`texture|textureLod`（GLSL 规范 4 分量）、分量式内建、**本文件声明的
   函数返回类型**，以及它们的算术组合。**永远不给"名字在册但本文件没声明"的内建猜宽度**（与 9a-2 的 F8/F10 同口径）。
2. **标量（宽 1）永不参与截断**：`标量 ⊗ 向量` 在 GLSL 与 HLSL 两侧都合法，动它就是改语义。
3. **推不出来 ⇒ 原样保留**，并计进本规则**自己的**桶（`rule9Wunresolved` + `rule9WunresolvedReasons`）；
   既有三条规则的 `unresolved` 口径**一个数都不动**（B7 断言两个桶分开且都可读）。
4. 只在**声明/赋值语句的右值**上动手；词法/语法碰到未建模的 token（数组下标、比较、三元、位运算、`%`、
   未知函数…）⇒ **整条语句放弃**（原样保留 + 计数），不做任何猜测。
5. **同名 float 与 vecN 并存 ⇒ 不猜**（与 9-3 的 `9-3-rhs-type-ambiguous` 同口径）。

六条子规则与**独立分桶计数**（`h2gWidthStats`，`h2gWidthStatsReset()` 一并归零）：

| 子规则 | 治什么 | 桶 | 落点（真包现场） |
|---|---|---|---|
| ① 二元两侧宽度不同 | 两个方向都截：`lw > rw` 截左、`rw > lw` 截右（同宽不动） | `rule9Wbin` | `clipping_mask.frag:53` / `cutout_vignette.frag:79` / `iris_movement__.vert:167` / `____________________.frag:159` |
| ② 声明/赋值两侧宽度不同 | `float x = <宽度≥2 的表达式>` ⇒ `(expr).x`；`vecN x = <更宽>` ⇒ `(expr).xy/xyz` | `rule9Wdecl` | `shadow.vert:37`（旧的 9a-2 只看"单标识符/构造/采样调用"三种简单形态，够不到整式） |
| ③ int 字面量 ⊗ 浮点向量 | 字面量补 `.0`（两侧都是 int ⇒ **不动**，整数语义保住） | `rule9Wint` | `shadow.vert:37` 的 `1 + <vec2>` |
| ④ `const float = <int 表达式>` | 整式外包 `float(...)`（GLSL ES 的 const 初始化式不容 int） | `rule9Wconst` | `godrays_cast.frag:46` |
| ⑤ 分量式内建的**标量广播** | 只在 GLSL **确实没有对应重载**的位置补 `vecN(标量)`（按 GLSL 重载表逐位置标注 `v/s/S/b`） | `rule9Wbcast` | `shadow.vert:37` 的 `max(1.0, <vec2>)` ⇒ `max(vec2(1.0), <vec2>)` |
| ⑥ int 表达式 ⊗ 浮点标量 | 给 int 那一侧套 `float(...)`（字面量已由既有 2a-2e 规则覆盖） | 也计 `rule9Wint` | `godrays_cast.frag:53` 的 `i / sampleDrop` |
| ⑦ 分量式内建的**向量实参**宽度不同 | 取**最小宽度**为目标、截更宽的实参（与二元运算同一条 HLSL 规则） | `rule9Warg` | `0917/3233141951 shift_hue.frag:132`+`dd/3327063360 hue_shift.frag`: `mix(albedo`(vec4)`, newAlbedo`(vec3)`, mask)` ⇒ `mix(albedo.xyz, …)`（GLSL 只有 `mix(genType,genType,genType)` 与 `mix(genType,genType,float)`） |

**实现上踩到并已定死的四个坑**（都可复核，都写进了判据）：

- **孩子修正在父层被原文覆盖**：每个 AST 节点必须**从孩子的 txt 重拼**，不能"本层没动就回退到原文切片"
  —— 否则 `1 + <vec2>` 的 `.0` 会在上一层的 `*` 处被吃掉（自测当场发现，夹具 A30 钉住）。
- **文本代入必须自带括号**：`fmod(g_Time, M_PI_F/10)` 若写成 `trunc(x / <实参>)` 就变成左结合的
  `trunc(x / A / B)` = **语义错**（`fmod` 那处，判据 W4b 钉住）。
- **公共头的形参污染**：`float c`（include 里的形参/局部）会污染本文件真声明为 `vec3 c` 的局部 ⇒ 本规则的
  **假阳性**把本来**编得过**的 `lens_flare_sun.frag:98` `c += vec3(0,0,0) + f0/1.0;` 截成了 `.x`。
  这条是宽度表判据的 **B2「移植前能编译的输出逐位不变」当场抓住的**（本线唯一的回归），修法是"同名 float 与
  vecN 并存 ⇒ 宽度记 0、不猜、计 `9W-width-ambiguous-float-and-vec`"，并加了夹具 A36 当回归守门人。
- **同名 `int` 与 `float`/`vecN` 并存也不猜**（同一纪律的第二个入口）：`Simple_Audio_Bars.frag` 里
  `float bar`（`:207`/`:223`）与 `int bar`（`:226`）分属不同作用域；`wIsIntExpr` 若只看"名字在 int 声明册里"
  就会去套 `float(...)`。现在要求"**只**在 int 册里（不在 float/向量册里）"才算 int 表达式。
  注意**分支裁剪**：`#if` 裁掉 `float bar` 那一支后，现用分支里 `bar` **确实**是 `int`
  ⇒ `float(bar) * u_BarOpacity`（真包两处）是**真修复**（`int * float` 在 GLSL ES 里同样编不过），不是假阳性。

### 3.2 `fmod(x, y)` 重写（`core/we-scene-bundle.js`，`atan2` 之后）

`fmod` → `((x) - (y) * trunc((x) / (y)))`，实参**文本代入且每个代入点自带括号**；多趟处理嵌套（最多 5 趟）。
计数：`ruleFmod`（改写条数）/ `ruleFmodDupArgs`（实参含函数调用 ⇒ 文本代入使求值次数由 1 变 2 的条数，
本机语料 **0** 条）。**不允许**直接换 `mod`（理由与数值实证见 §2 ⑦ 与 §4 W4）。

---

## 4. 判据

### 4.1 扩既有：`tests/hlsl2glsl-width-table-test.mjs`（**77 项断言，变异自证 3/3 组**）

| 组 | 内容 | 读数 |
|---|---|---|
| A27–A33 | 9-W 前六条子规则的**真阳性**：产物文本精确 + **独立分桶计数**精确 + `glslangValidator` 真编译 0 error（7 条） | 全绿 |
| A34 | 边界：等宽 / 标量⊗向量 / 矩阵 / 整数算术（`int k = i + 1;`）**逐字不变**且五个计数器全 0 | 全绿（产物真编译 0 error） |
| A35 | 宽度推不出（未声明的名字）⇒ 逐字保留 + 只计**本规则自己的**桶（既有 `unresolved` = 0） | 全绿 |
| A36 | ★ 同名 float 与 vecN 并存 ⇒ 不猜（`lens_flare_sun.frag:98` 假阳性回归守门人） | 全绿 |
| B | 真语料对拍：变化集精确相等（**5 → 16 条**）+ B2 0 回归 + 每条真编译口径 + 9-W 自己的 unresolved 桶（B7） | B2 **0 回归**、B3 逐条一致 |
| C | 变异自证：`no-table` 26 条红集、`flip-9-3` 6 条、`silent` 3 条，**期望红集 == 实际红集** | 3/3 组 |

- 契约变更（**显式更新、未放宽语义**）：`EXPECT_CHANGED` **5 → 16 条**（新增 11 条全部出自"改前编不过"那批，
  B2 逐条验过）；`compiles` 标志翻转 3 条为 `true`（`clipping_mask.frag` / `cutout_vignette.frag` /
  `chromatic_aberration.frag`），另有 2 条**显式标成 `false` 并写明理由**（`shadow.vert` 卡顶点写 attribute；
  `Simple_Audio_Bars.frag` 卡既有的 `%`→`mod` 不看 uint 目标 —— 两者都是**另一族**、都不是本线引入）；
  `EXPECT_RED_FLIP_93` **移出 A5**：9-W 是 9-3 的超集，9-3 方向写反后 9-W 仍兜住同一形态（产物写法不同、
  仍然合法）⇒ A5（真编译）不再变红；同形态的**文本精确**断言 A4 仍红 ⇒ 分辨力仍在（理由已写进测试注释）。

### 4.2 新增：`tests/hlsl2glsl-width-9w-test.mjs`（`node tests/hlsl2glsl-width-9w-test.mjs`）

**真编译器档：`/usr/bin/glslangValidator`**（本机可用）。分层：W1 夹具（文本+计数+真编译）/
W2 **真包真源 + 生产拼装 + 真编译 0 error** / W3 **变异必红** / W4 `fmod` 文本+数值语义+真编译 /
W5 不回归边界 / W6 全语料台账（`MPW_W9W_CORPUS=1` 时跑）。

W2/W3 覆盖的 6 个**真包真 shader**（含真实 combo，从 `scene.json` 的层/pass 里取，不是手抄）：

| 真包 | shader | 改前（真编译） | 改后（真编译） |
|---|---|---|---|
| `0923/2902406982` | `workshop/2800594362/effects/clipping_mask.frag` | `:472 '-' vec4…vec2` | **0 error** |
| `0923/2981249186` | `workshop/2138904733/effects/cutout_vignette.frag` | `:79 '-' vec3…vec2` | **0 error** |
| `0923/3448290956` | `workshop/2973943998/effects/iris_movement__.vert` | `:167 '*' vec4…vec2` | **0 error** |
| `0923/3653641024` | `workshop/3221939295/effects/____________________.frag` | `:159 '/' vec2…vec4` | **0 error** |
| `0923/3582367840` | `effects/godrays_cast.frag` | `:146 const` + `:153 int/float` | **0 error** |
| `0923/3479521040` | `workshop/3088030303/effects/shadow.vert` | `:151 '+' int…vec2` | 宽度族/整型族两条错**已消失**，**仍剩** `:152 'assign' l-value required "a_TexCoord"`（**另一族**，见 §6.1） |

变异档（W3）：把 9-W 驱动循环与 `fmod` 重写定点关掉（**只落 `os.tmpdir()` 副本，真树 sha256 跑前跑后相同**），
上表前 5 条**必须**重新报出 `wrong operand types` / `const … non-convertible` / `no matching overloaded` —— 实测重现。

### 4.3 全语料对拍（`/0923`，口径 = D 线：**含 `#include` 的 shader stage**，生产拼装 + 真编译）

| 档 | 包数 | 编译失败的 include-依赖 stage | 说明 |
|---|---|---|---|
| 改动前（include 展开成空 = 真机实况） | 23 / 30 | **151** | D 线读数 |
| 只修 URL + 内置头 | 9 / 30 | **11** | D 线读数 |
| 再加规则 9-S | 9 / 30 | **10** | D 线读数（本线开工基线，实测复核 = 10） |
| **再加本线 9-W + fmod** | **1 / 30** | **1** | 本线读数 |

剩下这 **1** 条：`0923/3479521040 shaders/workshop/3088030303/effects/shadow.vert`
⇒ `ERROR: 0:152: 'assign' : l-value required "a_TexCoord" (can't modify shader input)`。
**归类**：与宽度/整型无关的**另一族** —— 顶点阶段把 `attribute`（GLSL 侧是只读的 `in`）当可写变量用；
既有 h2g 的"影子局部变量"规则（`2i`）**只对 `stage === 'frag'` 的 varying 生效**，顶点 attribute 没有这一层。
**本线未修**（超出本线范围，且会改动所有"在顶点里写 attribute"的 shader 的产物，需要它自己的 0 回归证据）；
改法已定性：把 `2i` 的影子化条件从 `stage === 'frag'` 扩到"frag 的 varying + vert 的 attribute"，实现落点
`core/we-scene-bundle.js` 的 `if (stage === 'frag') { … inRe … written … }` 那一块（判据：同一套 B2/B3 对拍 + 真编译）。

全语料 9-W 台账（宽度表判据 B 段打印，199 包 / 276 去重 shader）：`rule9Wbin=8 · rule9Wdecl=1 ·
rule9Wint=9 · rule9Wconst=3 · rule9Wbcast=1 · rule9Warg=2 · ruleSample2D=5 · ruleFmod=1`；
本规则自己的 unresolved = **30**（`9W-rhs-parse-bail` 23 + `9W-width-ambiguous-float-and-vec` 4 +
`9W-operand-width-unprovable` 2 + `9W-stmt-shape-bail` 1），既有 `unresolved` 桶 = 1
（`9a2-vec-head-wider-but-width-unprovable`，D 线既有口径，未被本线搅动）。
**"推不出 ⇒ 原样保留"的条数是读得到的**（不静默）；那 23 条右值解析放弃主要来自 `edgedetection.frag`
（循环/比较/数组下标等未建模上下文）。

### 4.4 既有门禁（本线碰到的相关项，**全部在最终产物上重跑过**）

产物指纹：`core/we-scene-bundle.js` sha256 = `8e5b204d7371bb876afe8fc09dd36e4fd1fd73011ad8f8ef7996c7135d4f5cc4`
（本线最终态；D 线末态的指纹是 `119d420ff2230841…`，可用来对齐"改前/改后"）。

```
tests/hlsl2glsl-width-table-test.mjs      ALL PASS（77 项断言，变异自证 3/3 组）· B2 0 回归 · B3 变化集=16 逐条一致
tests/hlsl2glsl-width-9w-test.mjs          ALL PASS（68 项断言）［真编译器档］· W6 全语料：改前 10 → 改后 1
tests/hlsl2glsl-wiring-test.mjs            ALL PASS（13 项）
tests/hlsl2glsl-coverage-test.mjs          ✓ 覆盖率回归通过（46/46 = 100.0%）
tests/glsl-validate.mjs                    结果: 128/128 通过（dd 语料真编译）
tests/demo-syntax-check.mjs                demo 内联脚本语法：11/11 通过
tests/effect-prelude-common-test.mjs       ALL PASS（92 项断言）［真编译器档］（D 线判据，未被本线破）
```

（其余门禁按纪律留给编排者统一全量跑；本线**没有**跑全量套件。）

---

## 5. 端到端（浏览器，`flock /tmp/.mpw-firefox.lock`，库根切换后**已 reset**）

`POST /api/library-dir {"dir":"…/allwallpaper/0923"}` → `webloader/?id=2902406982&audit=1` → 读 `#log` +
`window.__mpwFxStats()`；改前/改后各一次浏览器会话，中间把 9-W 驱动与 fmod 重写定点关掉
（**改后已恢复并 sha256 校验逐字节一致**）。

| 读数 | 改前（= D 线末态） | 改后 |
|---|---|---|
| 首帧 / canvas | true / 1920×1080 | true / 1920×1080 |
| 跳过编译失败的 pass | **1** | **0** |
| 着色器编译失败 | 1 | 0 |
| 日志里 `wrong operand types` | 9 | 0 |
| fx 层 / **真的跑了 pass 的层** | 43 / **5** | 43 / **12** |
| `三角*` 层（`fxStats` 台账里名字含「三角」） | 7 层，**其中 passes=0 的 7** | 7 层，**passes=1 的 7** |
| `三角*` 逐层样例 | `三角13#70 eff=1 passes=0`、`三角12#791 eff=1 passes=0` … | `三角13#70 eff=1 passes=1`、`三角12#791 eff=1 passes=1` … |
| `前景#167` / `前景效果#410` | `passes=4` / `passes=0`(`inputKind=transparent`) | 同左（**未变**，不属本线） |

> 用户原话里的那 10 个层，在本机这次场景里 `fxStats.perLayer` 名字含「三角」的是 **7** 层（`#` 后缀是层 id）；
> **7/7 全部从 `passes=0` 变成 `passes=1`**，且 `三角*` 里"只画背景拷贝"的读数 = 0（改前它们同样没有
> 背景拷贝标记，问题只是 pass 被跳过 ⇒ 该层效果缺失）；`前景效果#410` 仍是 `passes=0`（D 线 §6.1 已定性为
> "没查到确证"的另一个问题，本线不动它）。

---

## 6. 未做 / 未验证边界（如实列出，逐条给"怎么做"）

1. **`shadow.vert` 的最后一处**：顶点阶段写 attribute（`l-value required`）。**未做**，归因与改法见 §4.3 末段。
   ——它是 `/0923` 现在**唯一**的 include-shader-stage 编译失败，`tests/hlsl2glsl-width-9w-test.mjs` 的 W2
   把"改后只剩这一族"钉成了断言（不许假装全绿）。
2. **本线修完后"下一处错"暴露出来的两个既有缺陷**（**都不是本线引入**：两者的"改前产物"本来就编不过，
   已被 B2 逐条验过；它们是"修好前一族之后才轮到它们"的另一族，本线**未修**）：
   - `0923/3653641024 shaders/workshop/3021673417/effects/Simple_Audio_Bars.frag:492`
     `uint barFreq1 = mod(frequency, 32.0);` ⇒ `'=' cannot convert from float to uint`。
     **根因**：既有规则 `2d`（`float % 整数字面量 → mod(x, n.0)`）**不看目标类型** —— 源里是
     `uint barFreq1 = frequency % RESOLUTION;`（整数取模、目标 uint），被改写成返回 float 的 `mod(...)`。
     **改法（已定性）**：`2d` 在改写前查一下左值声明（`w9IntDecl` 同源的 `int/uint` 名单）——目标是
     `int/uint` 时**保持 `%` 不动**；判据落点 `tests/hlsl2glsl-width-9w-test.mjs` 或宽度表判据的夹具组。
   - `0923/3479521040 shaders/workshop/3088030303/effects/shadow.vert:152` 顶点写 attribute（见上一条 1）。
3. **9-W 的覆盖面边界**（都不静默，可读）：
   - **宽度表闸门**：9-W 与既有 9/9-3/9a-2/9-S 同一个 `if (w9Width.size > 0)` —— 某个 shader 若**一个
     `vecN` 声明都没有**，本族不跑（连"`const float = <int 表达式>`"这种跟向量无关的子规则也不跑）。
     实测全语料 276 个去重 shader 的**源文件全部含 `vecN` 声明（0 条「一个都没有」）** ⇒ 对现网无影响；
     但这是**已知的形态边界**（换语料/换宿主就可能踩到），
     要消掉它得单独给"纯标量 shader"开一条闸门（会动到既有四规则的闸门语义，本线**故意不做**）。
   - **解析放弃 23 条**（`9W-rhs-parse-bail`）：右值里出现未建模 token（`for` 头、数组下标、比较、三元…）⇒
     整条语句原样保留 + 计数。要提覆盖率就得把词法/语法扩到"下标与比较"，那属于"通用 HLSL 表达式类型系统"
     的大工程（编排者明确本轮不做）。
   - **矩阵操作数**（`c * m`）、**未声明名字**（`g_SomeUndeclaredBuiltin`）：一律记 0 ⇒ 原样保留 +
     `9W-operand-width-unprovable` 计数（语料实测该原因 0 条，因为语料里"名字在册但没声明"的内建本来就 0 条）。
   - `%`（整数取模）不碰；`float % int` 仍交给既有 `2d` 的 `mod(x, n.0)` 重写。
4. **`fmod` 的实参重复求值**：文本代入 ⇒ 实参含函数调用时求值次数 1 → 2。本机语料 **0 条**
   （`ruleFmodDupArgs=0`），且该条数**单独可见**（不假装没有）。要彻底消掉，得往 shader 里注入一个
   helper 函数（命名冲突/注入位置/链接口径都要另证）——本轮不做。
5. **`common_vertex.h` 自研等价头：未做**（编排者列为优先级 2，本线时间盒用尽）。怎么做（已定性）：
   `docs/COMMON-HEADERS-REPLACEMENT.md` 的既有口径是"**自有实现、无第三方代码、数值/API 与官方一致**，
   逐头一份自研文件 + `WE_BUILTIN_SHADER_HEADERS` 内置兜底 + `tests/effect-prelude-common-test.mjs` 的
   token 级防漂移比对"。落点：① 从 WE 安装目录的 `assets/shaders/common_vertex.h`（526B）读出**API 清单与数值**
   （只做行为对照，不复制代码/注释/组织）；② 在 `shaders/common_vertex.h` 写自研等价实现（风格照
   `shaders/common.h`）；③ 把正文同步进 `WE_BUILTIN_SHADER_HEADERS`；④ 在
   `tests/effect-prelude-common-test.mjs` 里把它加进 `SYMBOLS`/官方逐值比对与 token 级比对；
   ⑤ 真编译档：`/0923` 那 5 个引用它的包（`fetchHeader` 三候选 + 内置兜底两条路）各拼一次跑 0 error。
   ——注意本线**没有**改 `shaders/**`，所以这一条完全是"未做"。
6. **真机未验**：本机是 llvmpipe + 桌面 Firefox；用户真机是 Android Chromium + Adreno 830。编译期错误与驱动
   无关（已用 `glslangValidator` 复现同一行号、同一报文），但**贴图/合成观感**本线不覆盖。
7. **未跑全量套件**（纪律：编排者统一跑）；本线只跑了 §7 列出的门禁 + 语料对拍 + 端到端。

---

## 7. 跑过的命令与汇总行

```bash
cd <工作区>/we-scene-demo
# 开工基线（钉死提交）
git rev-parse HEAD            # a3bb009d2b567dcbd080c67f516432c783e196f3

# 离线判据（本线范围内全部跑过）
node tests/hlsl2glsl-width-table-test.mjs          # ALL PASS（77 项断言，变异自证 3/3 组）· B2 0 回归 · B3 变化集=16（逐条一致）
node tests/hlsl2glsl-width-9w-test.mjs --no-corpus # ALL PASS（68 项断言，真编译器档：真包真源 生产拼装 真编译 0 error + 变异必红）
MPW_W9W_CORPUS=1 node tests/hlsl2glsl-width-9w-test.mjs --no-corpus  # W6 全语料台账（改前 10 → 改后 1）
node tests/hlsl2glsl-wiring-test.mjs
node tests/hlsl2glsl-coverage-test.mjs
node tests/glsl-validate.mjs
node tests/demo-syntax-check.mjs
node tests/effect-prelude-common-test.mjs          # D 线判据，必须仍然全绿

# 全语料对拍（D 线口径：含 include 的 shader stage，真编译）
node /tmp/mpw-0923-after-scan.mjs                  # 改前 10 → 改后 1

# 端到端（全部在 flock 内；跑完 reset 库根）
flock /tmp/.mpw-firefox.lock -c 'node /tmp/g-e2e.mjs'   # 改前/改后各一次浏览器会话 + 变异/恢复 sha256 校验
curl -s -X POST http://127.0.0.1:8902/api/library-dir -H 'content-type: application/json' -d '{"reset":true}'
```

**汇总行**：根因 6 类已定死（真编译器逐条复现）· 修复 2 处（规则 9-W 六条子规则 + `fmod` 重写）·
新增/扩展判据 2 个文件（77 项 + 68 项断言，含 3 组变异必红、真包真编译 0 error、假阳性回归守门人）
· 既有门禁全绿且 B2 = 0 回归（唯一的假阳性 `lens_flare_sun.frag` 被 B2 抓住并已修）·
`/0923` 语料编译失败 **10 → 1**（剩 1 条属另一族：顶点写 attribute，已定性未修）·
用户 ④ `2902406982` 的 `三角*` 层 `passes` **0 → 1**、跳过编译失败的 pass **1 → 0**。

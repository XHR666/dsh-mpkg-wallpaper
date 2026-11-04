# EFFECTS-COMPUTE-SPEC —— CPU 效果链求值（混合 / HSL / 位移 / 水波流）行为规格

> **参照来源许可声明**：本文档引用的 `wer-ref/` 是**第三方参考实现**
> （`Aromatic05/wallpaper-engine-renderer`，为 `catsout/wallpaper-scene-renderer` 的 fork，
> **GPL-2.0-only**），**不是 Wallpaper Engine 官方代码，也不是"真值源"**。
> 与本项目渲染器（GPL-3.0-or-later）**许可不兼容**：仅用于**行为对照**，
> **不得复制、改写、逐行翻译其代码、注释、常量组织或错误文案**。
> `we-layerd-ref/`（`Aromatic05/we-layerd`）**无任何许可**（保留所有权利），同样只可读行为结论。
> 血缘自查结论见 `docs/WER-REF-LICENSE-AUDIT.md`。

> **性质**：**行为规格**（behavior spec）。本文件只描述"这几个纯函数对外必须做什么"，
> 供**洁净室重写**使用：实现者只读本文件，不读任何第三方或专有着色器源码。
> **背景**：`docs/WER-REF-LICENSE-AUDIT.md`（DSHarea 根）§3.5 记的 R1 ——
> `core/we-scene-bundle.js` 的 `src/render/effects.js` 节曾自述「逐行翻译自 WE shader 原文」，
> 且该节内另有 3 处自认（「逐字实现」「逐字」「全量字面翻译」）与 12 处上游 `文件:行号` 引注。
> 该节在审计里被归到「WE 专有 shader」轴（`wallpaper_engine/assets/shaders|effects/**`），
> **上一轮（P-95）明确未动**（P-95 处置的是 `wer-ref` 轴的两处点状同源）。
> **日期**：2026-09-16。**落点**：`core/we-scene-bundle.js` 的 `src/render/effects.js` 节。
>
> **规格来源（允许的四类，逐条标注）**
> 1. **调用方需求与既有对外契约** —— 该节导出的纯函数是渲染器的 **CPU 侧参考实现**
>    （`docs/RENDERER-ARCHITECTURE.md` §「CPU 侧效果参数求值」），被 `mock-GL`/对拍脚本当数值基准；
>    函数签名、参数对象字段名、返回值形状、**是否原地改写入参**都是既有契约。
> 2. **公开标准的数学定义** —— 分离式混合模式取自 **W3C Compositing and Blending Level 1**
>    与 **PDF 1.7 §11.3（Blend Mode）** 的公开公式；HSL 取自公开的 hexcone（六棱锥）模型；
>    `smoothstep`/`fract`/双线性采样取自 OpenGL/GLSL 规范里对这些函数的标准定义；
>    三角级数常量是公开的 sin/cos 泰勒系数。**这些是数学事实，不是任何实现方的表达**。
> 3. **WE 场景包格式的公开事实** —— `effects/<name>/effect.json` + `materials/effects/*.json`
>    的 pass/constant 字段与取值范围（`? 效果参数`），以及纹理槽位、RGBA/RG88 两种流图通道口径。
> 4. **本项目自己的历史口径** —— 一维效果参数（`direction`、`bounds`、`flow`）的既有解释；
>    这些解释在本项目文档与测试里已冻结为对外行为。
>
> **禁止**：本文件不得出现任何着色器源码的函数名、行号、宏表或分支写法；
> 实现者也不得为了让代码"看起来像"某个外部实现而调整结构。
> **数值口径**：本节的实现是**逐位（bit-for-bit）兼容契约**：重写只允许改**表达**
> （命名、控制流组织、常量表达、注释），不允许改**求值形状**（每个算式里各步的运算顺序、
> 每个字面量的数值）。理由：CPU 侧结果是 mock-GL/对拍的数值基准，任何 1 ulp 漂移都会
> 让调用方的对比结论变化；"视觉等价"在这里是**逐位等价**的下界，不是替代品。

---

## 0. 模块边界

| 函数（重写后的名字） | 一句话职责 | 纯函数？ | 改写入参？ |
|---|---|---|---|
| `blendRgbByMode(mode, A, B, opacity)` | 按混合模式把效果色 B 叠到底色 A 上 | 是 | 否 |
| `composeColorEffectStack(items, t, textures, time, u0, v0)` | 顺序作用 tint / pulse / colorkey 三类像素级效果 | 否（见 §3.4） | **可能**（见 §3.4） |
| `resolveDisplacedUv(items, u0, v0, tex, textures, time)` | 由位移类效果算出最终采样坐标 | 是 | 否 |
| `applyShakeMaskMix(items, u0, v0, su, sv, tex, textures, time, t)` | 对"带蒙版的 shake"把位移结果按蒙版混回原图 | 否 | **是** |
| `applyWaterFlowOverlay(items, u0, v0, su, sv, tex, textures, time, t)` | waterflow 四相采样叠加 | 否 | 否（返回新数组） |
| `sampleTex` / `sampleTexLod` / `mipLevelForScale` / `flowChannels` / `maskChannel` / `rotate2` / `frac` / `mix4` / `smoothstep` / `M_2PI` | 采样与标量工具 | 是 | 否 |

**通用输入形状**

- `tex`：`{ width, height, rgba: Uint8Array(w*h*4), mips?: [{width,height,rgba}...], rg88?: boolean }`。
- `textures`：`Map<string, tex>`；**取不到即视为"没有该贴图"**，调用点用 1×1 纯白兜底（见 §5）。
- `items`：参数对象数组，字段见 §3/§4；`type` 之外的字段缺省时按"0/空"处理（JS 的 `undefined` 传播）。
- 时间 `time`：秒，可为负数/小数/非有限值（不特殊处理，按 IEEE-754 传播）。
- 坐标 `u0,v0`：图层画面空间的原始采样坐标（v=0 = 画面顶部），不预先 wrap。
- 像素 `t`：**`[r,g,b,a]`，各分量 0..255 的浮点**（不是 0..1），允许越界。

---

## 1. `blendRgbByMode(mode, A, B, opacity)` —— 分离式混合

### 1.1 要解决的问题

效果链里"把效果色按某种混合模式叠上去"是一个**参数化**操作：场景包里的
`ui_editor_properties_blend_mode` 是一个整数 id，含义固定（见 1.3 表）。CPU 侧必须
对每个 id 给出与 GPU 侧同口径的结果，供数值对拍。

### 1.2 输入域与返回

- `mode`：整数 id（0..32 有定义；**任何其它值**——负数、≥33、小数、`undefined`、`null`——一律走"缺省"行）。
- `A`、`B`：长度 3 的数组（`[r,g,b]`）。**不 clamp**：调用方可能传 0..1 之外的中间量（如 tint 的乘积）。
- `opacity`：透明度权重，正常 0..1，不 clamp。
- 返回：**新的**长度 3 数组。返回**不 clamp**（越界值原样返回）。
- 逐通道独立：1.3 表里的"核"`K(a,b)` 对三个通道各算一次，再按权重类别合成为整色。

### 1.3 模式表（**行为需求**，不是实现结构）

权重类别：
- **W（加权）**：`out = lerp(A, K, opacity)`，其中 `lerp(x,y,t) := x*(1-t) + y*t`。
- **R（原样）**：`out = K`，`opacity` 不参与（有的核里已自带 `opacity`）。
- 缺省行：`K = B`，类别 W。

| id | 名称（公开混合模式名） | 核 `K(a,b)` | 类别 |
|---|---|---|---|
| 1 | Darken | `min(b,a)` | W |
| 2 | Multiply | `a*b` | W |
| 3 | Color Burn | `b == 0 ? 0 : max(1-(1-a)/b, 0)` | W |
| 4 | Subtract（线性减淡的补） | `max(a+b-1, 0)` | W |
| 5 | Darken（无权重变体） | `min(a,b)` | **R** |
| 6 | Lighten | `max(b,a)` | W |
| 7 | Screen | `1-(1-a)*(1-b)` | W |
| 8 | Color Dodge | `b == 1 ? 1 : min(a/(1-b), 1)` | W |
| 9 | Add（线性减淡） | `min(a+b, 1)` | W |
| 10 | Lighten（无权重变体） | `max(a,b)` | **R** |
| 11 | Overlay | `a < 0.5 ? 2*a*b : 1-2*(1-a)*(1-b)` | W |
| 12 | Soft Light | `b < 0.5 ? 2*a*b + a*a*(1-2*b) : sqrt(a)*(2*b-1) + 2*a*(1-b)` | W |
| 13 | Hard Light | `overlay(b,a)`（即 11 的核交换两操作数） | W |
| 14 | Vivid Light | `vivid(a,b)`（见 1.4） | W |
| 15 | Linear Light | `b < 0.5 ? max(a+2*b-1, 0) : min(a+2*(b-0.5), 1)` | W |
| 16 | Pin Light | `b < 0.5 ? min(a, 2*b) : max(a, 2*(b-0.5))` | W |
| 17 | Hard Mix | `vivid(a,b) < 0.5 ? 0 : 1` | W |
| 18 | Difference | `abs(a-b)` | W |
| 19 | Exclusion | `a+b-2*a*b` | W |
| 20 | Subtract（= id 4） | 同 4 | W |
| 21 | Reflect | `b == 1 ? 1 : min(a*a/(1-b), 1)` | W |
| 22 | Glow | `reflect(b,a)`（即 21 的核交换两操作数） | W |
| 23 | Phoenix | `min(a,b)-max(a,b)+1` | W |
| 24 | Average | `(a+b)/2` | W |
| 25 | Negation | `1-abs(1-a-b)` | W |
| 26 | Hue | `hsl2rgb([hsl(B).h, hsl(A).s, hsl(A).l])` | W |
| 27 | Saturation | `hsl2rgb([hsl(A).h, hsl(B).s, hsl(A).l])` | W |
| 28 | Color | `hsl2rgb([hsl(B).h, hsl(B).s, hsl(A).l])` | W |
| 29 | Luminosity | `hsl2rgb([hsl(A).h, hsl(A).s, hsl(B).l])` | W |
| 30 | Tint | `max(A.r, max(A.g, A.b)) * b`（**同一乘数作用于三通道**，取 A 三分量的最大值） | W |
| 31 | Add（权重内置变体） | `a + b*opacity` | **R** |
| 32 | 线性减淡的自乘变体 | `a + a*b` | W |
| 其它 | 缺省（Normal） | `b` | W |

> 表里 `W` 行的整色合成必须逐通道做 `x*(1-k) + y*k` 形状的求值（先乘后加），
> **不得**改写成 `x + (y-x)*k`：两者数学等价但浮点结果可差 1 ulp。
>
> **"交换操作数"族的准确表述**：13 = 11 交换操作数、22 = 21 交换操作数只在**核**的层面成立
> （即 `opacity = 1` 时两条式子逐位相等）。`opacity < 1` 时两条式子**不同** —— 加权族的插值起点
> 永远是第一个实参（`lerp(A, K, opacity)`），交换实参也交换了起点。验收断言必须按此写。

### 1.4 `vivid(a,b)` 的定义（14/17 共用）

```
b < 0.5 : bb = 2*b        ; b == 0 时结果 0，否则 max(1-(1-a)/bb, 0)
b >= 0.5: bb = 2*(b-0.5)  ; bb == 1 时结果 1，否则 min(a/(1-bb), 1)
```

### 1.5 HSL 三件套（26–29 的内部依赖）

`hsl(rgb) -> [h,s,l]`（hexcone 模型，s/l ∈ [0,1]，h 环绕到 [0,1]）：

1. `fmin = min(r,g,b)`，`fmax = max(r,g,b)`，`delta = fmax-fmin`，`l = (fmax+fmin)/2`。
2. `delta == 0` ⇒ `h = 0, s = 0`（**精确相等判定，不是 epsilon**）。
3. 否则 `s = l < 0.5 ? delta/(fmax+fmin) : delta/(2-fmax-fmin)`；
   `dR = ((fmax-r)/6 + delta/2)/delta`，`dG`、`dB` 同理；
   `h` 由**第一个**等于 `fmax` 的分量决定（判定顺序 r → g → b；**并列时按此顺序取首个**，不许改成"取三者之一"）：
   `r` ⇒ `dB-dG`；`g` ⇒ `1/3 + dR-dB`；`b` ⇒ `2/3 + dG-dR`。
4. `h < 0` ⇒ `+1`；否则 `h > 1` ⇒ `-1`（**只做一次**，不 loop）。

`hue2rgb(f1,f2,hue)`：`hue < 0 ⇒ +1`；否则 `hue > 1 ⇒ -1`；然后
`6*hue < 1 ⇒ f1+(f2-f1)*6*hue`；`2*hue < 1 ⇒ f2`；`3*hue < 2 ⇒ f1+(f2-f1)*((2/3-hue)*6)`；否则 `f1`。

`hsl2rgb([h,s,l])`：`s == 0` ⇒ 三通道同 `l`；否则
`f2 = l < 0.5 ? l*(1+s) : l+s-s*l`，`f1 = 2*l-f2`，
返回 `[hue2rgb(f1,f2,h+1/3), hue2rgb(f1,f2,h), hue2rgb(f1,f2,h-1/3)]`。

### 1.6 边界与默认（必须逐条覆盖）

| 输入 | 必须的行为 |
|---|---|
| `mode` 缺省/负数/33+/小数 | 走缺省行（W，`K=B`） |
| `mode = 0` | 同上（`= mix(A,B,opacity)`，**不得**再被外层二次加权） |
| `opacity = 0` | W 行返回 `A` 的逐位值；R 行返回核值 |
| `opacity = 1` | W 行返回核值（可能 ≠ A） |
| `b = 0`（id 3）/ `b = 1`（id 8/21） | 走短路分支，**不得**直接做除法（会产生 ±Infinity/NaN） |
| `a < 0`（sqrt 前的负值，id 12 的 `b>=0.5` 分支） | `Math.sqrt(负)` = `NaN`，按 IEEE-754 传播（不特判） |
| `A`/`B` 越界（如 1.5、-0.25） | 核内 `min/max/clamp` 按其自身语义生效；最终值**不**再 clamp |
| `NaN`/`±Infinity` 参与 | 按 IEEE-754 传播；除 1.6 的短路分支外不做兜底 |
| `-0` | 必须保留 `-0`（比较一律用 `Object.is`） |

---

## 2. `sampleTex` / `sampleTexLod` / `mipLevelForScale` / 通道工具

1. **双线性采样**（`sampleTex`）：`x = u*w-0.5`、`y = v*h-0.5`；四角索引**夹取**到 `[0,w-1]`/`[0,h-1]`；
   先沿 x 做 `p0*(1-fx)+p1*fx`，再沿 y 做 `a*(1-fy)+b*fy`；返回 `[r,g,b,a]`（0..255）。
   **运算顺序即契约**（先 x 后 y）。越界 uv 不 wrap，靠夹取。
2. **带 mip 采样**（`sampleTexLod`）：有 `mips.length > 1` 时把 `level` **夹取**到 `[0, mips.length-1]`
   并**取整级别**采样该级（不做级间插值），否则退回 `sampleTex`。
3. **级别估算**（`mipLevelForScale`）：`texWidth <= 1 || scale >= 1 ⇒ 0`；
   否则 `max(0, round(-log2(scale)))`（`Math.round` 的 .5 进位语义即契约）。
4. **流图通道**（`flowChannels`）：`rg88` 贴图 ⇒ `[b/255, r/255]`（**分量顺序是 B、R**）；
   普通贴图 ⇒ `[r/255, g/255]`。
5. **蒙版通道**（`maskChannel`）：`rg88` ⇒ `b/255`；普通 ⇒ `r/255`。
6. `rotate2(v,a)` = `[x*cos-y*sin, x*sin+y*cos]`（先算 `cos`、`sin` 各一次，两次三角调用复用）。
7. `frac(x) = x - floor(x)`（负值也落在 [0,1)，**不是** `x % 1`）。
8. `mix4(a,b,k)`：逐分量 `x*(1-k)+y*k`。
9. `smoothstep(e0,e1,x)`：`k = clamp((x-e0)/(e1-e0), 0, 1)`（先减后除，再夹取），返回 `k*k*(3-2*k)`。
10. `M_2PI = 6.28318530718`（这是本项目的取值，**不是** `2*Math.PI` 的最精确近似，不许"顺手改正"）。

---

## 3. `composeColorEffectStack(items, t, textures, time, u0, v0)` —— 像素级颜色效果

### 3.1 顺序与缺省

按 `items` 的**列表顺序**依次作用；未知 `type` 一律**跳过**（不是报错）。返回最终的 `[r,g,b,a]`。

### 3.2 `tint`

字段：`alpha`（0..1 权重）、`masked`+`mask`（可选透明度蒙版贴图名）、`blendMode`、`color`（0..1 三元组）。

1. `w = alpha`；若 `masked && mask` 且该贴图存在，则 `w *= maskChannel(tex, sampleTex(tex,u0,v0))`。
2. `rgb = blendRgbByMode(blendMode, [t.r/255, t.g/255, t.b/255], color, w)`。
3. 新像素 = `[rgb*255 …]`，alpha = `blendMode === 0 ? 255 : 原 alpha`（**mode 0 会把图层写不透明**）。

### 3.3 `pulse`

字段：`masked`+`mask`、`bounds`（`[lo,hi]`）、`speed`、`phase`、`amount`、`noiseAmount`、`noise`（贴图名）、
`noiseSpeed`、`power`、`pulseColor`、`tintLow`、`tintHigh`、`blendMode`、`pulseAlpha`。

1. 若 `masked`：先 `sample = t` 的**副本**（后面要混回）。
2. `pulse = smoothstep(bounds[0], bounds[1], sin(time*speed + phase)*0.5 + 0.5) * amount`。
   **相位不加常数偏移**（本项目口径：`sin(t*speed+phase)`）。
3. `noiseAmount > 0` 时：噪声贴图取不到 ⇒ 1×1 纯白；采样坐标
   `(time*noiseSpeed, time*0.333*noiseSpeed)`；`pulse += (n.r/255) * noiseAmount`。
4. `pulse = pulse^power`（`Math.pow`，负底数会产生 NaN，不特判）。
5. `pulseColor` 为真时：`A = t.rgb/255 * tintLow`，`B = t.rgb/255 * tintHigh`（**逐分量乘**），
   `rgb = blendRgbByMode(blendMode, A, B, pulse)`，像素新 rgb = `rgb*255`。
6. `pulseAlpha` 为真时 `t.a *= pulse`。
7. rgb 三分量各取 `max(0, x)`（**下限 0，无上限**）。
8. 若第 1 步存了副本且 `mask` 贴图存在：`t = mix4(sample, t, maskChannel(tex, sampleTex(tex,u0,v0)))`
   （蒙版在**原始 uv** 上采样一次）。

### 3.4 `key`（colorkey）与"改写入参"契约

字段：`key`（0..1 三元组）、`tol`、`fuzz`、`invert`、`keyAlpha`、`flatten`。

1. `delta = |key.r - r/255| + |key.g - g/255| + |key.b - b/255|`（**三分量绝对值之和**，不是欧氏距离）。
2. `blend = smoothstep(0.001, 0.002 + fuzz, delta - tol)`。
3. `invert` ⇒ `blend = 1 - blend`。
4. `t.a *= keyAlpha*(1-blend) + 1*blend`。
5. `flatten` ⇒ rgb 三分量各乘 `t.a/255`（**premultiply，用改写后的 alpha**）。

> **改写契约（必须保留）**：`key` 与 `pulse` 的某些分支**原地改写调用方传入的数组**
> （`t.a *=`、`t[i] =`）；`tint` 分支是"新建数组再重新绑定局部变量"，**不**改写调用方数组。
> 由于列表顺序决定"哪一步先碰到调用方数组"，这个细节是可观测行为，重写时不得统一成
> "全部新建"或"全部原地"。

### 3.5 边界

| 输入 | 必须的行为 |
|---|---|
| `items` 为空 / 非数组 | 原样返回 `t` |
| 蒙版/噪声贴图缺失 | tint/waves/sway 的蒙版**视为不存在**（tint 不加权）；pulse 的噪声退化为 1×1 纯白；key 不用贴图 |
| `mask` 字段为假值 | 不做蒙版分支（即使 `masked` 为真） |
| `bounds[0] == bounds[1]` | `smoothstep` 的 `(x-e0)/0` 按 IEEE-754（`±Infinity`/`NaN`）传播，不特判 |
| `t.a` 越界或 NaN | 按 IEEE-754 传播 |

---

## 4. 位移类与水波流

### 4.1 `resolveDisplacedUv(items, u0, v0, tex, textures, time) -> {su, sv}`

初始 `su=u0, sv=v0`，按列表顺序处理（未知 `type` 跳过）。**所有效果内部的蒙版/噪声/相位贴图
一律在原始 `(u0,v0)` 上采样**；只有最后的图像采样用 `(su,sv)`。

**(a) `scroll`**：字段 `sx`、`sy`、`rx`、`ry`。
`ox = sign(sx)*sx*sx*time`（保号平方），`oy` 同理；
**`su = frac((u0+ox)*rx)`、`sv = frac((v0+oy)*ry)`**（用原始 uv 重算，不是累加），
后续效果在此结果上继续累加。

**(b) `shake`**：字段 `phase`（相位贴图名）、`flow`（流图名）、`speed`、`fx`、`fy`、`bounds`、`direction`、`amp`、`masked`+`mask`。

计算"位移量 `off`"（**这一段被 §4.2 复用，必须共用一个纯函数**）：
1. 相位：`phaseTex = textures.get(phase) ?? 纯白`；`flowPhase = (sampleTex(phaseTex,u0,v0).r/255) * 2π`。
2. 流向量：`flowTex = textures.get(flow) ?? 纯白`；`f = flowChannels(flowTex, sampleTex(flowTex,u0,v0))`；
   `flowMask = [(f0-0.498)*2, (f1-0.498)*2]`（0.498 是"中性值"的中心化常量）。
3. `t2 = speed*time + flowPhase`；
   `off = sin(frac(t2/2π)*2π)`（等价于 `sin(t2 mod 2π)`，但**必须按此形状求值**）；
   `off = off*0.498 + 0.5`（映射到 0.002..0.998）。
4. `base = cos(t2) >= 0 ? 1 : 0`；
   `off = base ? off^fy : 1 - (1-off)^fx`（**幂次随 `cos` 的符号二选一**）。
5. `off = clamp((off - bounds[0]) * (1/(bounds[1]-bounds[0])), 0, 1)`（先乘倒数再夹取）。
6. `direction`：`0 ⇒ off*2-1`；`2 ⇒ off-1`；其它（含 1）保持 0..1。
7. 位移：`su += off * amp*amp * flowMask[0]`，`sv += off * amp*amp * flowMask[1]`。

**(c) `waves`（水波）**：字段 `mask`（蒙版名）、`direction`（弧度）、`speed`、`scale`、`perspective`、`strength`。
1. `mask = maskChannel(tex, sampleTex(tex,u0,v0))`（缺贴图 ⇒ 纯白 ⇒ 1）。
2. `dir = rotate2([0,1], direction)`（= `(-sin, cos)`）。
3. `pos = |(u0-0.5)*dir.x + (v0-0.5)*dir.y|`。
4. `dist = time*speed + (u0*dir.x + v0*dir.y) * (scale + perspective*pos)`。
5. `s = sin(dist) * (strength*strength + perspective*pos) * mask`。
6. `su += dir.y * s`，`sv += -dir.x * s`（**垂直方向即 `(dir.y, -dir.x)`**）。

**(d) `sway`（植被摇摆）**：字段 `noise`（贴图名）、`noiseScale`、`ratio`、`direction`、`strength`、
`masked`+`mask`、`phase`、`speed`、`power`。
1. 噪声**带 mip**：`sampleTexLod(noise, u0*noiseScale, v0*noiseScale, mipLevelForScale(noiseScale, noise.width))`
   ——"缩小采样时取低级别"是口径的一部分。
2. `aspect = (tex.width/tex.height) * ratio`；`zw = rotate2([1/aspect, aspect], direction)`；
   `params = rotate2([u0,v0], direction)`。
3. `amp = strength*strength*0.005`；若 `masked && mask` 且贴图存在 ⇒ `amp *= maskChannel(...)`。
4. `phaseArg = (n.g/255 * 2π + params[0]*10 + params[1]*5) * phase`。
5. 两组各 4 项的三角级数（**系数即契约，不许"化简"**）：
   `ks = [1, -0.16161616, 0.0083333, -0.00019841]`（sin 侧，相位 `phaseArg + speed*time*k`）；
   `kc = [-0.5, 0.041666666, -0.0013888889, 0.000024801587]`（cos 侧，相位 `0.4 + phaseArg + speed*time*k`）。
   每项累加 `|sin(x)|^power * sign(sin(x))`（保号幂）。
6. `su += zw.x * sumSin * amp`，`sv += zw.y * sumCos * amp`。

### 4.2 `applyShakeMaskMix(items, u0, v0, su, sv, tex, textures, time, t)`

只处理 `type==='shake' && masked` 的项（**仅在这些项存在时才需要调用**）：

1. 用 §4.1(b) 的同一个位移量函数取 `off` 与 `flowMask`（**不得复制一份公式**）。
2. 位移后坐标 `mx = u0 + off*amp*amp*flowMask[0]`，`my = v0 + off*amp*amp*flowMask[1]`。
3. `maskVal = maskChannel(maskTex, sampleTex(maskTex, mx, my))`（蒙版贴在**位移后**的 uv 上采样；
   缺贴图 ⇒ 纯白 ⇒ 1）。
4. `orig = sampleTex(tex, u0, v0)`；四通道**原地**改写：`t[c] = orig[c]*(1-maskVal) + t[c]*maskVal`。
5. 返回 `t`。
   注：只有"该层唯一位移效果就是这个 shake"时该步才与"整体位移后采样"严格等价；
   多个位移效果并存时本函数仍按上式独立求值（既有行为，不得"顺手改成更合理的顺序"）。

### 4.3 `applyWaterFlowOverlay(items, u0, v0, su, sv, tex, textures, time, t)`

只处理 `type==='flow'` 的项：

1. 相位：`phaseTex = textures.get(phase) ?? 纯白`；
   `flowPhase = sampleTex(phaseTex, u0*phaseScale, v0*phaseScale).r / 255`（**在缩放后的原始 uv 上采样**）。
2. 流向量：`flowTex = textures.get(flow) ?? 纯白`；`f = flowChannels(...)`；
   `flowMask = [(f0-0.498)*2, (f1-0.498)*2]`；`amount = hypot(flowMask.x, flowMask.y)`
   （**取模长，不截断到 1**：后面的 `mix4` 允许外插）。
3. `amp = strength*0.1`。
4. 四个相位与两个混合权重（**`frac` 的参数形状即契约**）：
   `p0 = frac(time*speed)`、`p1 = frac(time*speed+0.5)`、`p2 = frac(0.25+time*speed)`、`p3 = frac(0.25+time*speed+0.5)`；
   `cyc[i] = p[i] - 0.5`；`blendA = 2*|p0-0.5|`，`blendB = 2*|p2-0.5|`。
5. 四张偏移采样：`o[i] = (flowMask.x*amp*cyc[i], flowMask.y*amp*cyc[i])`，
   在 `(su+ox, sv+oy)` 上采 `tex`；`albedo = sampleTex(tex, su, sv)`。
6. `flowA = mix4(f0, f1, blendA)`、`flowB = mix4(f2, f3, blendB)`、
   `flowOut = mix4(flowA, flowB, smoothstep(0.2, 0.8, flowPhase))`；
   返回 `mix4(albedo, flowOut, amount)`（**返回新数组，不改写入参**）。

---

## 5. 与调用点/贴图层的契约（重写时不可破坏）

1. **导出名**：重写后导出的函数名是本项目自定的（见 §0 表）；`M_2PI` 等常量保持导出。
   本项目内部**当前没有**调用点（该节是 CPU 参考实现），但它是包 `exports["./bundle"]` 的
   公开面 ⇒ 重命名必须一次性改净并在 `PATCHES.md` 留新旧对照表。
2. **参数对象字段名**：§3/§4 列出的字段名是效果参数词汇表的一部分，**不得改名或新增必填项**。
3. **贴图兜底**：任何"取不到就纯白"的位置都用同一个 1×1 纯白常量（`rgba=[255,255,255,255]`、
   `rg88=false`、`width=height=1`）；不要各自新建。
4. **不碰 GL/DOM/全局状态**：本节的函数只吃参数（`location.search` 之类只在同文件的开关解析里用）。
5. **不改写实现的调用方**：函数不注册钩子、不写日志、不缓存。

---

## 6. 验收判据（"重写完成"的定义）

1. **逐位等价**：以重写**前**的实现在固定语料上的输出为冻结真值（digest + 逐值），
   重写后实现必须**逐位相同**（比较一律 `Object.is`，含 `-0`/`NaN`）。
   语料覆盖：全部 0..32 模式 × 随机与边界 A/B/opacity、§3 三类效果的组合栈、
   §4 四类位移 + shake 蒙版 + waterflow（含 RG88 与 mip 贴图、贴图缺失路径）。
2. **性质断言**：与规格表直接对应的独立断言（例如 id 20≡4、id 13 = 11 交换操作数、
   id 31/5/10 不受 opacity 影响、id 22 = 21 交换操作数、`Darken ≤ min(A,B)` 分量界等）。
3. **源码守卫**：旧标识符（上游同名回响）、上游 `文件:行号` 引注、"逐行翻译/逐字/字面翻译"
   一类自认措辞在 bundle 该节中**归零**；新标识符在位。
4. **血缘复测**：最长公共 token 串、最长公共字符子串、标识符重合率三项在重写前后各测一次，
   差值记入 `PATCHES.md`（跨语言（JS↔GLSL）文本相似度天然低 ⇒ **判据以"命名回响 + 自认措辞 +
   引注 + 分支表逐模式同构"四项为准**，文本指标只作辅助证据，这一点必须如实写进留痕）。
5. **真语料**（可选，缺语料 SKIP）：从真场景包解析出的效果参数逐条跑一遍，与冻结真值比对。

## 7. 未定 / 明确不改的部分

1. **模式表本身（id → 公开混合模式名的映射）不可改**：它是场景包格式的一部分（接口/格式事实），
   属于"思想与接口"，不是表达。重写只改表达。
2. **数学上唯一写法的表达式**：`l = (fmax+fmin)/2`、`s = delta/(fmax+fmin)`、BT.601 权重、
   `smoothstep` 的标准定义等——这些是公开标准的唯一表达，重写后一律在注释里
   标注"公开标准公式（W3C/PDF/GLSL 规范）"，**不标注任何实现方**。
3. **三角级数常量**（§4.1(d)）：sin/cos 的麦克劳林系数是公开数学常量（保留原精度写法）。
4. **§4.2 的"多位移并存时不严格等价"**：这是既有行为，本轮只重写表达，不改语义；
   若将来要修，属功能变更，另立编号。
5. **文本相似度指标在本模块的适用范围**：JS ↔ GLSL 跨语言对照的文本指标天然低，
   且位移/水波流段的**最长公共子串就是公开的 sin/cos 级数系数串**（数学常量，值不可改）
   ⇒ 该段的原始字符指标在重写前后**不会下降**，这是预期结果而不是残留。
   因此判据取：① 自认措辞归零 ② 上游 `文件:行号` 引注归零 ③ 上游同名回响归零
   ④ 结构去重（同一公式不再两处各写一份）⑤ "剔除数字 token"后的 LCS 与标识符重合率。
   五项都在测试 `tests/clean-room-effects-blend-test.mjs` 里可复现。

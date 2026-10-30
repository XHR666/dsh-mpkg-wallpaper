# 粒子算子语义冲突定案：C4（control point force 门限）+ C3（vortex 切向手性）

*线：粒子算子语义（C3/C4）· 2026-09-24 · 只做两件有界的事：给定案、修可证伪的那条*

**改前钉死的提交**：`a3bb009d2b567dcbd080c67f516432c783e196f3`（`main`）。
⚠ 本工作树在该提交之上**已有别的线未提交的改动**（`①(ISSUE0924A2)` 等）⇒ 本报告一律以
**文件内容哈希**钉住"改前/改后"，不用 `HEAD:`：

| 对象 | sha256 |
|---|---|
| `we-scene-demo/core/we-scene-bundle.js` **改后**（本次交付） | `df453fcba877cf50ae75471740071a294749f9a5a64c5f6dd94884dbd51faa44` |
| 同上 **改前**（把本次那条语义行文本还原：`sys.pforceLegacy ? __thrRaw * 0.5 : __thrRaw` → `pGetVal(pr, 'threshold', 512) * 0.5`） | `f580131a6fa52dadd891c1cc214d39e8770969e26561b972dffc467ff10940dc` |

---

## 0 摘要（两句话）

| 冲突 | 结论 | 我方现行实现 | 本次动作 |
|---|---|---|---|
| **C4** control point force 门限 | ✅ **定案**（官方文本 + 官方资产 + 官方编辑器键表三方一致） | ❌ **错**：无条件 `threshold × 0.5` | **已修**：官方路径改回 `threshold` 原值；新增 `?pforce=legacy` 回退（与改前**逐位相同**） |
| **C3** vortex 切向手性 | ⚠ **未定案**（官方文档与官方资产**对手性沉默**） | 现状：默认 `(dy,−dx)`、`?pvortex=legacy` = `(−dy,+dx)` | **不猜着改**（按纪律）；新增"开关有实际效果"判据，回退口确认可用 |

判定 C4 的那句官方原文（`docs.wallpaperengine.io` §"Control point force"）：

> **Distance: The maximum distance of the force.**

---

## 1 取证（S0 → S1 → S2，逐条留证）

### 1.1 S0 官方文档（`web_fetch`，HTTP 200）

**① <https://docs.wallpaperengine.io/en/scene/particles/component/operator.html>**（2026-09-24 取）

§"Control point force" 节逐字（**这是 C4 的定案依据**）：

> Either pulls or pushes particles when **near** a control point with the provided distances and strength.
>
> - **Offset:** Lets you adjust the position of the force relative to the selected control point.
> - **Scale:** The strength of the force. Positive values pull particles to the control point. Negative values push particles away.
> - **Distance: The maximum distance of the force.**
> - **Control point:** The control point index that this operator works with. Valid numbers: `0` - `7`.
> - **Reduce velocity near center:** Reduces the attraction rate towards the control point.
> - **Delete particles in center:** Adds additional **Deletion threshold** option that lets you define how close particles can come to the center of the control point before they get deleted. Triggers the **death** event on deletion.

三条要点：
1. **"Distance: The maximum distance of the force."** —— 该字段**就是**最大作用距离。
   全文**没有任何**"直径/半径"换算的措辞（无 diameter / radius / half 字样）⇒ **除 2 无文本依据**。
2. 同节开头 **"when near a control point"** ⇒ 近距才施力 = 区间判据 `d < 门限`（**方向**）
   —— 与本仓 `d < thr` 一致（那条是 P-126 已修的）。
3. §"Delete particles in center" 的 **"Deletion threshold"** 是**另一个**选项（见 §1.3 的键名证据）。

§"Vortex" 节逐字（**这是 C3 "官方沉默"的依据**）：只给字段集，**没有任何方向/手性/旋转正负的定义**：

> Spins particles around in a vortex. Has two modes: Standard vortex and ring-shaped.
> - **Axis:** Lets you define the axis of the vortex movement. …
> - **Speed inner:** The speed of particles within the inner distance.
> - **Speed outer:** The speed of particles within the outer distance.
> … （Ring radius / Ring width / Ring pull distance / Ring pull force / Infinite axis / Control point /
> Maintain distance to center / Center force / Audio response）

**② <https://docs.wallpaperengine.io/en/scene/particles/component/control_point.html>**（同日取，独立佐证）

> **Control point force:** Acts upon articles with a force, allowing you to push or pull particles
> **when they come near the control point**. When the control point is bound to the mouse cursor,
> allows you to push particles away.
>
> **Vortex:** Creates a vortex movement which you can lock to a control point to position the vortex
> independently from the rest of the particle system.

⇒ 第二页同样只讲"近距施力"，**不讲**门限减半；对 vortex 同样**只讲"绕轴转"，不讲绕哪一边**。

### 1.2 S1 官方资产（本机 WE 安装目录的 `wallpaper_engine/assets/**`，**不随仓分发**）

**① C4：该字段的序列化键名 = `threshold`，且它就是文档的 "Distance"**

全 `assets/**` 普查（逐 `effect/scene/particle` json 解析）**35 个** `controlpointattract` 实例，
字段出现次数：

```
controlpoint 25 | id 35 | name 35 | scale 35 | threshold 33 | origin 28 | blendinstart 1 | flags 1
```

⇒ **`threshold` 33 次、`distance` 0 次**。而 Control point force 文档列出的距离型选项只有一个
（"Distance"），故 `threshold` ⇔ "Distance"。（`distance` 这个键名在**别的**算子上确实存在 ——
`collisionplane` 用 `distance`、`reducemovementnearcontrolpoint` 用 `distanceinner/outer`、
`vortex` 用 `distanceinner/outer` ⇒ 官方命名不统一，所以这一条必须靠"键集 + 文档选项一一对应"来钉。）

**② C4：官方为该算子做的元素预览场景，门限相对发射行程留了整 2× 余量**

`assets/scenes/particleelementpreviews/controlpointattract/particles/new_particle_system.json`（官方**元素预览**，
即官方教"这个算子长什么样"的样板）：

```json
emitter[0]  = { "name": "sphererandom", "distancemin": 300, "distancemax": 500, "rate": 15 }
operator[0] = { "name": "movement" }
operator[1] = { "name": "controlpointattract", "origin": "0 0 0", "scale": 2000, "threshold": 1000 }
```

粒子全部出生在半径 300–500 的球壳内，力门限 **1000 = 2 × 500**。

⚠ **如实标注这条证据的强度**：这是**设计意图/数据关系**证据，**不是运行期判别器**。
若门限除 2 变成 500，则 `d < 500` 这个**开区间**恰好把"正好落在 500 外壳上"的粒子排除 ——
连续分布下这只影响测度 0 的集合，**画面差别 ≈ 0**。所以它只能支持"官方作者按 2× 余量布置"，
**不能**单独证伪除 2。C4 的定案主力是 §1.1 的官方原文 + §1.3 的键名区分。

**③ C3：官方 vortex 资产只暴露"字段 + 有符号速度"，对手性沉默**

官方资产里全部 `vortex` / `vortex_v2` 字段取值（去重后的完整清单）：

```
vortex     axis        = "0 1 0" ×3          ；其余 8 个实例**不写 axis**（走缺省）
vortex     speedinner  = -250 ×2 / 0 ×5 / 100 ×1 / 128 ×2      ← **有负值**
vortex     speedouter  = -250 ×2 / 5 ×1 / 2500 ×2 / 3000 ×2
vortex     flags       = 1 ×3
vortex_v2  flags       = 2 ×2 / 3 ×1 ; ringradius 256 ; ringwidth 5 ; ringpulldistance 250 ; speedouter 2500
官方元素预览：vortex = { "name":"vortex", "speedinner":100 } ; vortex_v2 = { "name":"vortex_v2", "flags":3 }
```

可读出的两件事，以及**读不出**的那一件：

- 官方**用 `speedinner/speedouter` 的符号**表达转向（`presets/abstract/dna.json` 用 `axis:"0 1 0"` +
  `speedinner:-250` 做双螺旋）⇒ 转向是**作者用标量符号**选的；
- 缺省 `axis` **不被序列化** ⇒ 官方资产里查不到"缺省轴是 +z 还是 −z"；
- **读不出**：引擎把"正速度 + 正轴"解释成屏幕上的顺时针还是逆时针
  （即 `tangent = axis × radial` 还是 `radial × axis`）。**docs 与 assets 都没有这个信息。**

**④ C3 旁证（负面）：官方 shader 资产自己在 cross 次序上就不自洽**

同族的两份官方绳子粒子着色器用了**相反的 cross 次序**：

```
assets/shaders/genericropeparticle.geom:58   vec3 trailRightStart = cross(CPStart, eyeDirection);
assets/shaders/genericropeparticle.vert:151  vec3 trailRightStart = cross(eyeDirection, trailDelta + CPStart);
```

⇒ 即使只看官方自家的屏幕空间 cross 用法，也**不能**据此推出"官方 vortex 用哪种手性"。
（这条只作为"官方资产不足以定手性"的旁证，**不作为**任何方向判据。）

### 1.3 S2 官方编辑器字符串表（只做 `strings` 级键名取证，**未反汇编**）

**① 粒子属性键表**：`wallpaper_engine/bin/wallpaperui.exe` 偏移 **11348344** 处是粒子属性键表，
逐字包含（节选）：

```
… start | drag | gravity | fadeintime | force | startvalue | fadeouttime | starttime | endvalue |
  mask | endtime | scalemin | frequencymin | threshold | scalemax | variablestrength |
  deletethreshold | distanceouter | distanceinner | reductionouter | reductioninner | …
```

**关键**：`threshold` 与 `deletethreshold` 是**两个不同的键**。
⇒ `threshold` **不是**文档 §"Delete particles in center" 的子项 "Deletion threshold"（那一个叫
`deletethreshold`）⇒ 在 Control point force 的键集里，`threshold` 只能对应 §"**Distance**"。
**这一条把 §1.2① 的"键名 ⇔ 文档选项"从推断变成排他。**

（复核：全 `assets/**` 里 `deletethreshold` / `deletion` **0 命中** ⇒ 官方资产从不使用删除门限，
与"`threshold` 是主距离选项"自洽。）

**② 该算子的条件属性形状**：同文件偏移 11382192 附近，`controlpointattract` 的字符串邻域逐字：

```
ui_editor_properties_reduce_velocity_near_center | controlpointattract |
checkBit(findProperty('flags').value, 1) | ui_editor_properties_delete_particles_in_center |
maintaindistancetocontrolpoint | ui_editor_properties_deletion_threshold | …
```

⇒ "Reduce velocity near center" 与 "Delete particles in center" 都挂在 `flags` 位/条件上
（本仓读 `flags` bit0 与此一致），而距离值是**独立数值键** `threshold`。

**③ 本地化标签**（`locale/ui_en-us.json`）：

```
ui_editor_particle_element_operator_controlpointattract = "Control point force"
ui_editor_properties_distance     = "Distance"
ui_editor_properties_offset       = "Offset"
ui_editor_properties_scale        = "Scale"
ui_editor_properties_threshold    = "Threshold"      ← 存在，但**不在** wallpaperui.exe 里出现；
                                                        且与 Control point force 的键集无绑定
ui_editor_properties_deletion_threshold = (en-us 缺失；该 id 出现在别的语言文件里)
```

⚠ **如实标注**：`ui_editor_properties_distance` = "Distance" 是**通用标签**，本机**没有**取到
"键 `threshold` → 标签 `ui_editor_properties_distance`"的**直接指针绑定**（那需要反汇编描述符表，
本机无 ghidra/r2/jadx，且本轮明确不做反编译）。C4 的结论**不依赖**这条直接绑定 ——
它依赖的是 §1.1 的官方原文（"Distance = 最大距离"）+ §1.2① 的键集普查（唯一的距离型键）
+ §1.3① 的 `threshold ≠ deletethreshold`（排除"删除门限"这一解释）。这三条已经**排他**。

---

## 2 C4 结论：定案 —— 无条件 `× 0.5` 是错的，已改

### 2.1 照官方哪个文本/资产

| 级别 | 依据 | 说了什么 |
|---|---|---|
| S0 | `docs.wallpaperengine.io/…/operator.html` §"Control point force" | **"Distance: The maximum distance of the force."** ⇒ 门限原值就是作用半径 |
| S0 | 同页同节开头 | **"when near a control point"** ⇒ 近距才施力（判据方向，本仓已对） |
| S1 | `assets/**` 35 个实例的字段普查 | 距离型键名 = `threshold`（`distance` 0 次） |
| S1 | `scenes/particleelementpreviews/controlpointattract/…` | `threshold:1000` 对 `distancemax:500` ⇒ 官方按 **2×** 余量布置 |
| S2 | `bin/wallpaperui.exe` @11348344 键表 | `threshold` ≠ `deletethreshold` ⇒ 排除"删除门限"解释 |
| — | 旧结论的两条依据（**已废**） | lwe-ref 无条件 `/2.0f` 硬编码；wer-ref 自述是 `Cherry_Blossoms_2.json` 的**逐壁纸经验补偿**（均非引擎语义主张，见 `docs/OPENSOURCE-BORROW-PLAN.md` §④-C4） |

### 2.2 我方现行实现：**错**（改前读数）

```js
// 改前：`core/we-scene-bundle.js:5176`（**本会话开始时的行号**；文本还原后落在 `:5201`）
const thr = pGetVal(pr, 'threshold', 512) * 0.5     // ← 无条件除 2
```

- 判据方向**是对的**（`we-scene-demo/core/we-scene-bundle.js:5227`，`d < thr` 走官方路径，
  `d > thr` 是 `?pops=legacy`）—— 这一条不属本次改动。
- **门限数值是错的**：作用半径被砍半 ⇒ 官方 `threshold` 记为 400 时只有 200px 内受力。

### 2.3 改法（已落地）

```js
// 改后：we-scene-demo/core/we-scene-bundle.js:5201-5202
const __thrRaw = pGetVal(pr, 'threshold', 512)
const thr = sys.pforceLegacy ? __thrRaw * 0.5 : __thrRaw
```

回退开关 **`?pforce=legacy`**（沿用本仓 `?pops=legacy` / `?pvortex=legacy` 的命名与解析惯用法）：

- 缺省 = `official` = 门限原值（**与官方文本一致**）；
- `?pforce=legacy` = **逐位**回到改动前（乘数与求值次序一字未动，见 §4 的 F3）；
- 与 `?pops=legacy` **正交**：`pops` 管判据**方向**，`pforce` 管门限**数值**（互不覆盖）。

接线共 6 处（与既有 8 个档位同构）：sys 标志 `:4145`、档位常量 `PFORCE_MODE` `:9438`、
模式上报 `:9582`、缓存签名 `:13836`、props 接线 `:13882`、语义点 `:5201-5202`。

### 2.4 语料读数（真包；改前 vs 改后）

语料 = `$MPW_ROOT/allwallpaper/{dd,0917,0923,wallpaperE,wallpapertest1}` 全量扫 `scene.pkg`，
命中含 `controlpointattract` 的粒子资产 **29 条**（逐包只读目录表 + seek 单条 json，不整包读入）。
每层 60 步 @30fps、固定种子 `"<root>/<id>|<entry>"`、指针固定 (500,400)：

**汇总行**：改后默认档**读数有变化的层 = 17/29**（其余 12 层逐位不变 —— **如实记账**）。

有变化的层里最值得看的 4 条（完整 29 行见 `tests/particle-force-distance-test.mjs` 运行输出的 S 段）：

| 真包 :: 粒子资产 | 算子参数 | 存活（改前→改后） | 受力粒子数（改前→改后） | 平均距离 |
|---|---|---|---|---|
| `dd/3544152633 :: birds.json` | `threshold:2048` + `threshold:1024`（两个吸引） | 30 → 30 | **56 → 60** | 1101.5 |
| `0923/3151551777 :: birds.json` | 同上 | 30 → 30 | **55 → 60** | 1104.6 |
| `0923/3479521040 :: Bird.json` | `threshold:100` + 一个**缺 `threshold`**（⇒ 缺省 512） | 10 → 10 | **0 → 2** | 1457.5 |
| `0923/3696234311 :: Bird.json` | 4 个 attract（`100` + 三个缺省 512） | 49 → 49 | **0 → 6** | 4446.2 |
| `dd/3554161528 :: Cherry_Blossoms_2.json` | `threshold:50`（排斥）+ `threshold:5000`（吸引） | 158 → 158 | 158 → 158 | 1216.9 |

**怎么读这些数**：
- "受力粒子数"按**每个算子**的 `d < 门限` 计数（一颗粒子可被多个算子计到，故可 > 存活数）；
  两档恒满足 `official ≥ legacy`（门限更宽 ⇒ 受力集合是超集），这条已被判据 **S2** 钉住。
- **存活数在 29 层里全部不变** ⇒ 这次改动**不改变粒子生死**，只改变"哪些粒子受力"。
- 可见影响**集中在门限大/缺省的层**（`birds` 的 1024/2048、`Bird` 的缺省 512）；
  门限小（32/50/64/70/100）的层里粒子平均距离远大于门限 ⇒ 两档都"不受力" ⇒ 逐位不变。
- ⚠ **平均距离那列的语义**：它是"存活粒子到力中心的平均距离"，**只作记账**，不是"改动效果"。
  少数层里改后平均距离反而更大，原因是本算子**非指针**路径的 y 口径
  （`dy = -(target[1] - p.pos[1])`）是**既有的未决问题**（`DSHarea/docs/PARTICLE-FIREFLY-INVESTIGATION.md`
  §215 第 4 条："正确换算应为层 origin + 旋转/缩放后的 offset；目标绝不能是世界 (0,0) 这条是可证伪的；
  但 flags=1 且无鼠标时官方控制点到底停在哪，需要一次真机/官方对照"）。
  **那条不在 C4 范围内**，本次一个字都没改它；此处登记以免把它的症状误读成本次改动的效果。

---

## 3 C3 结论：**未定案**（不猜着改）

### 3.1 为什么定不下来

研究线已经推翻了旧的"2 票 vs 1 票"推理（`docs/OPENSOURCE-BORROW-PLAN.md` §④-C3）：
`wer-ref` 的翻转**理由不是"引擎数学不同"，而是屏幕手性**（其自述 `…screen-space handedness makes
axis-cross-radial bend each emitted arm to the viewer's left; reverse the tangent…`）⇒ 它与 `lwe` 在
**算子数学上可能本就一致**，差异只在 y 轴朝向约定。于是真正要定的是"**官方用哪种屏幕手性**"，而：

- **S0 官方文档**：§"Vortex" 只给字段集（Axis / Distance inner-outer / Speed inner-outer / flags…），
  **没有一个字**定义旋转正负或屏幕手性；`control_point.html` 也只说"Creates a vortex movement"。**沉默。**
- **S1 官方资产**：缺省 `axis` 不序列化（查不到缺省轴符号）；`speedinner/speedouter` 有正有负
  ⇒ 转向由**标量符号**表达；官方元素预览 def 只有 `{speedinner:100}` / `{flags:3}`。**沉默。**
- **S1 旁证**：官方两根绳子着色器的 cross 次序自相矛盾（§1.2④）⇒ 官方资产不能当手性判据。
- **S3/S4（官方二进制/安卓 `.so`）本机没有反编译产物**（无 ghidra/r2/jadx），本轮明确定为**不做**。

⇒ 按纪律（`docs/OPENSOURCE-BORROW-PLAN.md` §"不为了对齐上游翻任何默认值"），**不猜着改**。

### 3.2 需要什么证据（才能把 C3 从"证据更强"升级为"已证实"）

1. **首选（最便宜）**：官方**出帧对拍** —— 用官方元素预览场景
   `assets/scenes/particleelementpreviews/vortex/`（官方资产、涡旋在该层是**主导力**）在真机 WE 里录一段
   （哪怕是短视频/逐帧），读它的**有符号环量符号**；本仓同一 def 的读数**已经现成**
   （判据 F5 每次都打印：official `L=−0.1795` / legacy `L=+0.1795`，两档**只差符号**）。
   ⇒ 只要官方那一帧的符号定了，C3 立即定案，**零额外实现成本**。
2. **次选**：官方**编辑器 UI 的 gizmo/动画**（Axis 字段旁的旋转示意）或被官方文档引用的 vortex 视频。
3. **兜底**：反汇编官方 vortex 算子的切向符号（安卓 `.so` 优先 / 桌面 `llvm-objdump`，方法学见
   `DSHarea/docs/OFFICIAL-PARALLAX-RE-20260924.md` §B-3/B-4）—— 需要一台能装工具的机器或人工。

### 3.3 回退开关状态：**在，且确认有实际效果**

- `?pvortex=legacy` **仍在**：`we-scene-bundle.js:9515`（`VORTEX_MODE`，缺省 `official`）、
  props 接线 `:13890`（`vortexLegacy: VORTEX_MODE === 'legacy'`）、切向调用点 `:5410` / `:5444`（`sys.vortexLegacy ? -1 : 1`）。
- 新增判据 **F5** 专门钉"不是死开关"（用官方 vortex 元素预览 def，40 步）：
  `official L=−0.1795（n=66）` / `legacy L=+0.1795（n=66）`，**严格反号**且 `|L_official + L_legacy| = 0`
  ⇒ 开关**只改方向、不改强度**。
- 既有的 `tests/particle-vortex-chirality-test.mjs` **18 通过 / 0 失败**（含它自己的变异自证），
  本次**未改动**它。

### 3.4 ⚠ 提请注意（不由本线决定）

现行的 vortex **默认**（`(dy,−dx)`）是**上一轮**按"第三方多实现共识 + 上游带理由翻转"翻过来的，
而那条理由（"2 票"）**已被研究线推翻**。本轮按纪律**不翻默认**（未与官方出帧对拍前不翻默认），
只登记该风险：**这个默认现在处于"依据已被削弱、但方向仍未被证伪"的状态**。
是否回到 `legacy` 作默认，属编排者/用户的决定（回退口随时可用，一键切换）。

---

## 4 判据、读数与"变异必红"

新增判据文件：**`we-scene-demo/tests/particle-force-distance-test.mjs`**（用法
`node tests/particle-force-distance-test.mjs [--no-mutation] [--verbose]`；退出码 0/1/2）。

### 4.1 判据清单与本次读数（**33 通过 / 0 失败**，exit 0）

| 判据 | 内容 | 读数 |
|---|---|---|
| F1a | official 路径**不含** `* 0.5`（源码切片） | ✓ |
| F1b | legacy 路径保留**改动前那条表达式** | ✓ |
| F1c | `?pforce=legacy` 已登记且缺省 official（3 个接线点） | ✓ |
| F1d | 门限口径进**缓存签名**（切档重建） | ✓ |
| F1e | 与 `?pops=legacy` **正交**（判据方向仍由 pops 决定） | ✓ |
| F1f | `?pforce` 解析惯用法与 `?pops`/`?pvortex` **逐字同形** | ✓ |
| F1g | 该算子段内 `* 0.5` **恰好 1 处**且只在 legacy 分支 | ✓ `段内 *0.5 出现 1 次` |
| F1h | 官方资产键名 = `threshold`（`distance` 0 次） | ✓ `35 实例：threshold 33 / distance 0` |
| F1i | 官方元素预览 `threshold === 2 × distancemax` | ✓ `threshold=1000 / distancemax=500` |
| **F2a** | **official 作用半径 == `threshold`**（二分实测） | ✓ `threshold=400 ⇒ 400.000000`；`1000 ⇒ 1000.000000` |
| **F2b** | **legacy 作用半径 == `threshold/2`** | ✓ `⇒ 200.000000`；`⇒ 500.000000` |
| **F2c** | **两档半径比 == 2** | ✓ `比=2.000000000`（两个 threshold 各一次） |
| F2d/F2e | 门外一步不施力、门内一步施力 | ✓ `399 施力 / 401 不施力`；`199 / 201` |
| F3a/F3b | 能还原"改动前"源码切片并 import | ✓ |
| **F3c** | 敏感性前置：改后默认 **!=** 改前（夹具不空） | ✓ |
| **F3d** | **合成档：改前默认 == 改后 + `?pforce=legacy`（逐位）** | ✓ |
| **F3e** | **真包语料 29 条：改前默认 == 改后 + `?pforce=legacy`（逐位）** | ✓ **29/29** |
| F4a–F4f | 两个变异各自的"必红"自证（见 4.2） | ✓ 6/6 |
| F5a | `?pvortex=legacy` 仍在且缺省 official | ✓ |
| **F5b** | **该开关有实际效果**（两档有符号环量严格反号） | ✓ `off=−0.1795 / leg=+0.1795` |
| F5c | 两档只差方向（`|Δ|=0`、粒子数相同） | ✓ `|Δ|=0.00e+0` |
| S1/S2 | 语料读数留档 + `official ≥ legacy` 单调 | ✓ `29 条` |

**"逐位相同"是怎么证的**：把 `core/we-scene-bundle.js` 的**文本还原**成改动前那条表达式，
在**临时目录**（`mkdtemp` + 把 `core/` 兄弟模块符号链接进去，仓库内不落文件）import 出"改前构建"，
与"改后 + `?pforce=legacy`"逐位比对**全粒子状态**（`pos/vel/age/life/size/alpha/rot` 的
IEEE754 位串 + `alive` + 粒子数），在**合成档**和**全部 29 条真包语料层**上分别比。
⇒ 不是"数值近似"，是**位串相等**。

### 4.2 变异必红（**加回 0.5 ⇒ 套件红**）

**套件级演示**（真的把 `0.5` 加回真源码，跑测试，再按 sha256 逐位还原）：

```
变异：const thr = sys.pforceLegacy ? __thrRaw * 0.5 : __thrRaw
   →  const thr = sys.pforceLegacy ? __thrRaw * 0.5 : __thrRaw * 0.5
```

| 变体 | 变异读数 | 结果 |
|---|---|---|
| ① **把 `0.5` 加回 official 路径** | F2a：official 半径 `400 → 200.000000`（`threshold=1000` 时 `→ 500`）；F2c 半径比 `2.000000000 → 1.000000000`；F2d 红；F3c 红（official 与改前逐位相同 = 改动被完全回退）；**F3e `10/29`**（改前 ≠ legacy）；F1g 红（段内 `*0.5` 出现 **2** 次） | ❌ **8 失败 / 19 通过，exit 1** |
| ② 把 legacy 的 `0.5` 也去掉（回退口失效） | F2b/F2e 红；F4f 红（回退档与改动前不再逐位相同） | ❌ 红（测试内建自证） |

还原后：`sha256 = df453fcb…`（与变异前**逐位相同**），套件回到 **33 通过 / 0 失败**。

### 4.3 顺带扩的既有判据（原来钉着**已被推翻**的旧结论）

`tests/particle-render-correctness-test.mjs` 的 ⑦F #6 段原来断言"显式 threshold 仍按 `threshold/2` 生效"
（这是 C4 旧结论的化石）。本次按新结论改写为 3 条，并**保留**旧口径在 legacy 档的断言：

- 缺 `threshold` ⇒ 缺省 512 是**半径**：`d=100` 与 `d=300` 都施力、`d=600` 不施力；
- 显式 `threshold=70` ⇒ 半径就是 **70**（`d=10`、`d=50` 施力，`d=100` 不施力）；
- `?pforce=legacy` ⇒ 回到 `threshold/2`（半径 35：`d=10` 施力、`d=50` 不施力）。

---

## 5 跑过的命令与汇总行

```bash
# ── 取证（S0/S1/S2）──────────────────────────────────────────────────────────
#  S0：web_fetch 两页官方文档（HTTP 200，2026-09-24）
#      https://docs.wallpaperengine.io/en/scene/particles/component/operator.html
#      https://docs.wallpaperengine.io/en/scene/particles/component/control_point.html
#  S1：官方资产普查（35 个 controlpointattract 实例；vortex 全字段取值；元素预览 def）
python3 - <<'PY'   # 逐 json 解析 $WE/**，统计算子名 × 字段名直方图
PY
#    ⇒ controlpointattract: threshold 33 / distance 0（共 35 实例）
#    ⇒ 元素预览 controlpointattract: scale=2000 threshold=1000，emitter distancemax=500
#  S2：官方编辑器字符串表（**只 strings 级，未反汇编**）
python3 - <<'PY'   # bin/wallpaperui.exe 字节偏移扫描
PY
#    ⇒ @11348344 键表同时含 `threshold` 与 `deletethreshold`（两个不同键）
#    ⇒ @11382192 controlpointattract 条件属性区（flags bit1 → delete_particles_in_center）
python3 -c "json.load(open('wallpaper_engine/locale/ui_en-us.json'))"   # 标签：Distance/Offset/Scale 等

# ── 改动后（新增判据）────────────────────────────────────────────────────────
node tests/particle-force-distance-test.mjs
#    ⇒ 结果: 33 通过, 0 失败
#    ⇒ ✓ C4 判据通过：门限 = 官方 `threshold` 原值 / `?pforce=legacy` 与改动前逐位相同 / 变异必红 / C3 回退开关可用

# ── 变异必红（改真源码 → 跑 → 逐位还原）──────────────────────────────────────
#    把 official 路径改回 `* 0.5`
node tests/particle-force-distance-test.mjs --no-mutation
#    ⇒ 结果: 19 通过, 8 失败        EXIT=1
#    ⇒ F2a official 半径 200.000000 ｜ F2c 比=1.000000000 ｜ F3e 10/29 ｜ F1g 段内 *0.5 出现 2 次
#    还原后 sha256 = df453fcb…（逐位相同）

# ── 受影响的既有粒子判据（**未跑全量套件**，由编排者统一跑）──────────────────
node tests/particle-render-correctness-test.mjs   # ⇒ 121 通过 / 0 失败（含本次改写的 ⑦F #6）
node tests/particle-op-census-test.mjs            # ⇒  30 通过 / 0 失败
node tests/trail-leave-test.mjs                   # ⇒  70 通过 / 0 失败
node tests/particle-vortex-chirality-test.mjs     # ⇒  18 通过 / 0 失败（C3 既有判据，未改动）
node tests/particle-frame-uv-and-pointer-test.mjs # ⇒  37 通过 / 0 失败
node tests/particle-children-test.mjs             # ⇒  67 通过 / 0 失败
node tests/particle-sphere-dim-test.mjs           # ⇒  20 通过, 0 失败
node tests/particle-turbulence-field-test.mjs     # ⇒  34/34 断言通过
node tests/particle-preset-fallback-test.mjs      # ⇒  57/57 通过
node tests/p74-ysign-scan.mjs                     # ⇒ exit 0（扫描器）
```

---

## 6 未验证边界（宁可说做不到）

1. **C3 未定案** —— 官方文档 + 官方资产 + 本机可得的一切都对"屏幕手性"沉默；本机无官方反编译产物
   （无 ghidra/r2/jadx），本轮**不做**反编译。所需证据与最便宜路径见 §3.2。
2. **`?pforce=legacy` 的"浏览器 URL → 档位"一跳未做端到端实测** —— 判据 F1c/F1f 钉的是
   **源码切片 + 与既有 8 个档位逐字同形的接线形状**；真正的 URL 端到端需要 `createRenderer`
   （要真 WebGL2 上下文）或起浏览器，按纪律**本轮未起浏览器**。`?pforce` 与 `?pops`/`?pvortex`
   走的是同一段惯用法 ⇒ 风险低，但**如实登记为未验证**。
3. **门限缺省 512 未获官方级证据** —— `threshold` 缺省值 512 仍来自第三方参考实现
   （`assets/**` 里 bubbles1 两个实例不写 `threshold`）。官方文档不写缺省值，本机也没取到官方数值缺省
   ⇒ **未动**（不属"能证伪"的一类）。
4. **`threshold` ⇔ UI 标签 "Distance" 的直接指针绑定未取到**（需反汇编描述符表）⇒ 结论靠
   "官方原文 + 键集排他 + `threshold≠deletethreshold`"三条（见 §1.3 的如实标注）。
5. **非指针路径的力中心/y 口径仍是未决问题**（`PARTICLE-FIREFLY-INVESTIGATION.md` §215 第 4 条）
   —— 本次**一个字未改**，但语料读数里"平均距离"那列会受它影响，故在 §2.4 显式标注。
6. **未跑全量套件**（按纪律由编排者统一跑）；只跑了上列 11 个直接相关的粒子判据。
7. **未做真机/官方出帧对拍**（本机拿不到 WE 运行环境）⇒ 数字全部是**离线读数**，不是画面证据。

---

## 7 许可与写权（自证）

- **未借用任何 GPL 代码**：本线的 C4 依据全部是**官方文档 + 官方资产 + 官方编辑器字符串表**
  （读取 `assets/**` 的 json 字段与 `bin/wallpaperui.exe` 的字符串）；
  对第三方参考实现（`lwe-ref` GPL-3.0-only / `wer-ref` GPL-2.0-only）**只读语义与结论**，
  **未复制、未改写、未逐行翻译**任何代码/注释/常量组织/错误文案；
  新增测试文件里 `import` 的只有本仓模块（`core/we-scene-bundle.js`、`core/we-particle-pointer.mjs`、`tests/_root.mjs`）。
- **未随仓分发任何官方 WE 资产**：本报告只引用**字段名与数值**（如 `threshold:1000`）作为证据，
  **未内嵌**官方 shader / effect / preset / 字体内容。
- **写权范围**（本次只碰这 4 个路径；`demo.html`、`demo/**`、`server/**`、`shaders/**`、`package.json`、
  `README*`、`docs/PATCHES.md`、`docs/OPENSOURCE-BORROW-PLAN.md`、插件仓**一个都没碰**）：
  1. `we-scene-demo/core/we-scene-bundle.js`（6 处接线 + 1 处语义，净 +61 行）
  2. `we-scene-demo/tests/particle-force-distance-test.mjs`（**新建**）
  3. `we-scene-demo/tests/particle-render-correctness-test.mjs`（⑦F #6 段按新结论改写）
  4. `we-scene-demo/docs/reports/particle-force-c3c4-verdict.md`（**新建**，本文件）
- **单写者**：**未** `git add` / **未** `commit` / **未** `git add -A`；未起浏览器；未跑全量套件。
  变异自证的临时产物全部落在 `/tmp`（`core/` 兄弟模块用符号链接补齐，仓库内不落文件），
  唯一进过工作树的临时写入是"变异—还原"那一轮，已按 sha256 验证**逐位还原**（§4.2）。

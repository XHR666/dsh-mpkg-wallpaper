# 粒子渲染正确性研究（P-103 · 用户第 12 条"你有一些粒子效果的渲染是有问题的，开源仓库里有方案，去参考一下"）

> 本文是**判据式**取证记录：每一条现象都给出「判据 → 命中层数 → 我们的数字（改前）→ 官方应有 → 依据（官方资产/开源实现的那段逻辑）」，
> 以及本轮修掉什么、量化前后、还剩什么没定。补丁台账见 `docs/PATCHES.md` 的 **P-103** 节；
> 开关登记见 `docs/README-DIAGNOSTICS.md`（主表 4 行：`prot`/`pquad`/`pexp`/`pspeed`）。
>
> **取证工具都在仓库里、都不进 `tests/run-all-tests.sh`**（人工取证用，与 P-65 的 `particle-shape-audit` 同族）；
> 门禁项只有一项：`particle-render-correctness`（`tests/particle-render-correctness-test.mjs`，33 断言）。
>
> 许可：`oneincase/webwallgl`（**MIT**）只作**口径对照**（未复制代码）；`wer-ref/`（**GPL-2.0-only**）
> 与 `lwe-ref/`（linux-wallpaperengine，**GPL-3.0-only**）**只作行为对照、洁净室实现**，
> 本轮另把源码里残留的 wer-ref **逐字代码引注**清零（见 P-103.6）。

---

## 1. 判据与复跑命令

| 判据 | 判据定义（可复算） | 复跑 |
|---|---|---|
| **R 自转** | 粒子层的 `initializer` 含 `rotationrandom`/`angularvelocityrandom`，或 `operator` 含 `angular*`/`rotation*` | 语料扫描（§2.1） |
| **Q 图层变换** | 图层 `scale[0]`/`scale[1]` ≠ 1，或 `angles[2]` ≠ 0 | 同上 |
| **E exponent** | 任一 `initializer.exponent` 存在且 ≠ 1 | 同上 |
| **S 初速** | 任一 `emitter.speedmin`/`speedmax` 非 0 | 同上 |
| **几何（可见判据）** | 合成顶点流里 quad 的**长轴角散布**、**竖直占比**、**长/短边中位**（"竖线/僵死贴片"的直接判据） | `node tests/particle-shape-audit.mjs <ids…>` |
| **像素（不回归判据）** | 用真实顶点流 UV 采样 GPU 侧贴图字节：四角 alpha、覆盖均值 alpha、不透明占比 | 同上 |
| **代价（不回归判据）** | 逐帧 `performance.now()` 中位 ms + `particleStats`（`simSteps`/`simUpdates`/`alive`/`drawn`） | `node tests/particle-cost-probe.mjs --frames 30` |
| **改前档位（A/B）** | 环境变量 `PQUAD_MODE=legacy PROT_MODE=legacy PEXP_MODE=legacy PSPEED_MODE=legacy`（= 真机 `?pquad=legacy&prot=legacy&pexp=legacy&pspeed=legacy`） | 两个工具都认这四个变量 |

复跑（本机语料 = `$MPW_ROOT/allwallpaper/dd` 的 11 个 scene 型真包）：

```bash
node tests/particle-shape-audit.mjs 3326873240 3327063360 3544152633 3554161528 3660962877 3719111841
PQUAD_MODE=legacy PROT_MODE=legacy PEXP_MODE=legacy PSPEED_MODE=legacy \
  node tests/particle-shape-audit.mjs 3326873240 3327063360 3544152633 3554161528 3660962877 3719111841
node tests/particle-cost-probe.mjs --frames 30 --json /tmp/cost-official.json
PQUAD_MODE=legacy PROT_MODE=legacy PEXP_MODE=legacy PSPEED_MODE=legacy \
  node tests/particle-cost-probe.mjs --frames 30 --json /tmp/cost-legacy.json
node tests/particle-render-correctness-test.mjs        # 门禁项本体（33 断言）
```

---

## 2. 问题清单（现象 + 两侧数字）

### 2.1 语料级判据统计（11 个 scene 型真包 / **49 个粒子层**）

| 判据 | 命中 | 分布 |
|---|---|---|
| R 自转 | **14 / 49 层** | 3544152633×5、3554161528×5、3719111841×4 |
| Q 图层变换 | **35 / 49 层** | 全语料最多的判据；最大 `scale=7.059/7.147`（3327063360「萤火虫」） |
| E exponent | **2 / 49 层** | 3554161528「落花」×2，`sizerandom … exponent=2` |
| S 初速 | **2 / 49 层** | 3554161528 / 3660962877 的 `cherry blossoms on cursor`，`speedmin=0 speedmax=20` |

> ⚠ 口径更正：`docs/README-DIAGNOSTICS.md` 原先写「14/40 个测试包」「30/40 层」——
> 分母是本机全部**粒子层数 49**（不是包数、也不是 40）；两条判据的分子复算为 **14** 与 **35**。
> 本轮把这 4 行的编号（原误标 P-101）与分母一并改正。

### 2.2 逐层现象表（几何 A/B 实测，25 个有粒子批的层）

| 包 id | 层名 | 现象（用户能看见的） | 我们的数字（改前 = legacy） | 官方应有 | 依据（官方资产 / 开源实现的那段逻辑） |
|---|---|---|---|---|---|
| 3719111841 | Glass Shards | 玻璃碎片全部轴对齐，像"贴图网格"而不是飞散的碎片 | 长轴角散布 **0°**、竖直占比 **100%**、长/短边中位 1.78 | 碎片朝向随机：official 散布 **44°**、竖直 **27%**、长/短边 1.54 | 语料 `rotationrandom`（默认 0..2π）+ 官方 `common_particles.h:20-38 ComputeParticleTangents`（z 轴 roll 的两条局部轴） |
| 3719111841 | Bokeh Hex | hex 光斑不转，且尺寸不吃图层 `scale=1.18913` | 散布 **0°**、竖直 **100%**、长/短边 1.78 | 散布 **46°**、竖直 **55%**；quad 边长比 = 图层 scale **1.18913** | 官方 `genericparticle.vert:86-87`：quad 位置**整体**乘 `g_ModelViewProjectionMatrix` ⇒ size 偏移也吃图层 T·R·S |
| 3544152633 | Fog (calm) | 雾团被拉成竖直长条（图层 `scale=1.8/0.85` 不生效） | 散布 **0°**、竖直 **100%**、长/短边 1.78 | 散布 **166°**、竖直 **0%**、长/短边 **1.16** | 同上（图层变换）+ 语料 `rotationrandom` |
| 3544152633 | Moving Glowing Stars_01 | 星点长宽比恒等于贴图比例，看起来"全都是同一颗星" | 长/短边中位 **1.78**、竖直 **100%** | 长/短边 **1.14**、竖直 **0%** | 图层 `scale=0.876/0.430` 应进 quad 边长 |
| 3327063360 | 萤火虫 | 粒子**整体偏小 7×**（图层 scale 完全不生效） | 边长 = `size`（跨度口径），比官方大 **2×** 再乘错图层比例 | 边长 = `size/2 × scale(7.059, 7.147)` | 官方 `common_particles.h:52-56` 展开式 + `wer-ref WPParticleRawGener.cpp:85`（写属性前 /2，行为对照）+ 语料 scale |
| 3554161528 | 落花 ×2 层 | 花瓣尺寸"都一样大"，缺小花瓣（`exponent=2` 被忽略） | 尺寸均值 **60.0**（= 均匀分布 `(40+80)/2`），P(尺寸<50)≈**0.25** | 均值 **53.33**（`pow(u,2)` 的期望）、P(<50)≈**0.50** | 语料 `sizerandom min=40 max=80 exponent=2`；行为对照 `lwe-ref …/CParticle.cpp:738`（`pow(t,exp)` 后再 /2） |
| 3554161528、3660962877 | cherry blossoms on cursor | 花簇**原地不动**（发射器只写了 `speedmin/speedmax`） | 出生速度 **恒 0**（只可能来自 `velocityrandom`） | 出生 `\|v\| ≤ 20`（`speedmax`），方向 = 基准点→出生点 | 语料 `sphererandom … speedmin=0 speedmax=20`；MIT `webwallgl particles.js:804-806`（沿发射方向给初速，口径对照） |

### 2.3 官方预览动图对照（`$MPW_ROOT/Steam/steamapps/workshop/content/431960/<id>/preview.gif`）

| 包 | 动图可见 | 与我们的差 |
|---|---|---|
| 3719111841（凯尔希） | 左侧绿色波形 rope 轨迹 + 人物周围的碎片/光斑**朝向互不相同**（非网格状） | 改前全部轴对齐 ⇒ 与动图不符；本轮 official 档 44–51° 散布 |
| 3544152633（Girl and cat） | 雨丝/雾团/星点各自成条成团，长宽比明显不等 | 改前恒 1.78（贴图比例） |
| 3554161528 / 3660962877 | 花瓣与光标处花簇**成簇出现并随光标移动** | 改前花簇出生无初速 |
| 3327063360 | 萤火虫为**大颗**光点（占屏比例明显） | 改前小约 7×（图层 scale 丢失） |

> 判据强度说明：动图是**入场后低分辨率帧**（1920×1080 级、GIF 256 色），只能判"朝向是否随机/成簇是否移动/尺寸量级"，
> **不能**做逐像素或角度统计；角度/长宽比的量化结论一律来自 §2.2 的顶点流实测，动图只作**方向性佐证**。

---

## 3. 对照开源实现的差距表（任务点名的 10 个核对项）

| 核对项 | 官方 / 参考口径 | 我们改前 | 我们改后（本轮） | 许可处理 |
|---|---|---|---|---|
| 发射器默认值 | `speedmin/speedmax` 缺省 0（MIT `webwallgl particles.js:324-325`）；缺字段 ⇒ 不产生初速、**不抽随机数** | 一致（恒 0） | 仅当字段非 0 才抽一次随机数 ⇒ "无字段层两档逐位相同" | MIT 口径对照，未复制代码 |
| 生命周期与随机种子 | 出生期决定 `life/size/rot`；同一 `seedStr` 必须可复现 | 种子化 `rng()`（自有实现） | exponent 档位**复用同一次抽样**、speed 档位不额外抽 ⇒ legacy 逐位可复现 | 自有实现 |
| 重力/速度坐标系 | y 向下（与官方场景坐标同为 y-down）；发射器偏移与 quad 形状**必须同一套空间** | quad 形状用另一套（不吃图层 scale/角） | 统一走 `toWorldOff`（先按 z 角 R(−θ)、再逐轴 ×scale），与 `spawnParticle` 发射器偏移**同序** | 自有实现 |
| `size` 与 quad 边长 | sprite：**边长 = size/2**（`common_particles.h:52-56` 以 `(uv−0.5)` 展开 ⇒ 跨度 w）；rope：**总宽 = size**（`genericropeparticle.vert:133/138/160`） | 早于 P-74 时把 `size` 当跨度（2× 偏大），P-74② 已修（`?psize=legacy` 留档） | 维持 P-74 口径不变，本轮只让**图层变换**参与 | 官方资产 + 行为对照 |
| rope/trail 段数与长度口径 | ribbon 两端各按"该端 size/2"混合（`genericropeparticle.vert:148-167`）；`length/maxlength/segments` 见 P-65 | P-65 已落地 | 未改（本轮只纠引注行号） | 官方资产 |
| `spritetrail` 采样数 | `up = V̂·min(\|V\|·length, maxlength)`、`right = normalize(cross(V, eye))`（`common_particles.h:41-49`） | P-65 已落地 | 未改 | 官方资产 |
| 帧动画与 blend 模式 | `ComputeSpriteFrame`（`common_particles.h:59+`）：`randomframe`=出生抽一次，其余=序列；帧间按 `frameBlend` 插值 | 已实现 | 未改（本轮回归断言覆盖） | 官方资产 |
| `lockToPointer` | 控制点 `flags=1` 时**必须有指针**，否则该发射器不发射（MIT `webwallgl particles.js:815-822` 同行为） | 一致 | 未改（本轮测试用 `s.pointer` 显式覆盖该路径） | MIT 口径对照 |
| 排序与深度 | 单批 `drawArrays`、按存活序；z 走透视 `ds` 缩放 | 一致（P-59/P-65 成果） | 未改 | 自有实现 |
| 增量仿真确定性 | 同一 `seedStr` + 同一档位 ⇒ 逐位可复现；两档的 `simSteps/simUpdates` 相等 | — | **两档逐值相等**（门禁断言 + 探针 245/245、224/224） | 自有实现 |

---

## 4. 本轮结论

1. **四项修复已在 `core/we-scene-bundle.js` 落地**（提交 `e08e898`）：quad 图层变换（`?pquad`）、粒子自转（`?prot`）、
   exponent 非线性分布（`?pexp`）、发射器 `speedmin/speedmax` 初速（`?pspeed`）；四项都做 **official ↔ legacy 双向**断言，
   并且**无该字段/无该初值时两档逐位相同**（防"顺手多抽一次随机数"这类隐性回归）。
2. **门禁与台账本轮补齐**：`tests/particle-render-correctness-test.mjs`（33 断言）注册进门禁（`add` 列表**末尾追加**，
   既有 74 项的行号未动）；`docs/README-DIAGNOSTICS.md` 4 行编号 P-101→**P-103** 并改正分母；
   `docs/PATCHES.md` 新增 **P-103** 节（插在 P-100 与 P-105 之间，满足"P 编号非降"）。
3. **量化（25 个有粒子批的层，official vs legacy）**：
   - 几何：长轴角散布变化 **6/25 层**（0°→11–166°，其中 5 层 ≥42°：166/51/46/44/42），长轴角中位变化 **10/25**，
     竖直占比变化 **8/25**，任一几何指标变化 **13/25**；长/短边中位由
     贴图比例（1.78）回到真实形状（1.05–1.70）；
     > ⚠ 口径更正（P-108 复算，2026-09-17）：本节曾写"**11/25** 层角度散布由 0° 变为 44–166°"。
     > 用 §1 的两条命令重跑（产物 `/tmp/particle-shape-audit-on-official.json` 与
     > `…-on-pquad=legacy_prot=legacy_pexp=legacy_pspeed=legacy.json`），并与昨晚同两套产物逐层对拍（无一行不同）：
     > **散布**变化是 **6/25**，11 既不等于 6，也不等于角中位变化 10 / 任一指标变化 13 ⇒ 已改为上面三个可复算的数。
     > 三个计数都可用同一对 JSON 复算：逐层比 `geom.angleSpread` / `geom.angleMed` / 六项 `geom` 任一。
   - 不变量：**25/25 层** quad 数、存活粒子数、四角 alpha、覆盖均值 alpha、不透明占比**两档逐值相同** ⇒ 改动只动几何、不动像素语义与仿真；
   - 代价：hina（13 粒子层）中位 **1.77 ms/帧、245 updates/帧**（legacy 1.69 ms、245）；凯尔希（8 层）**1.53 ms、224**
     （legacy 1.91 ms、224）—— 与历史基线（P-69 的 62.8 ms/96000 → 1.7 ms/245）同量级，**无回退**。
4. **许可收口**：MIT（`webwallgl`）仅口径对照；GPL-3.0-only（`lwe-ref`）只做行为对照后自写；
   **GPL-2.0-only（`wer-ref`）的 6 处逐字代码引注已清零**（改成行为描述，见 P-103.6），官方着色器引注行号按官方资产实测纠正。
5. **未定**：
   - 本机无 headless WebGL（chromium GPU 进程被沙箱杀）⇒ 只有**顶点流级**判据，没有真机逐像素对照；
   - 官方预览动图分辨率与色深不足以做角度/尺寸的统计判据（§2.3 已注明只作方向性佐证）；
   - 帧动画 blend、rope 段数、`spritetrail` 采样数三项本轮**只看未改**，如需继续对齐要另开取证；
   - `core/audio-band-array.mjs`（同属 P-103 编号的另一半）**已接线**（2026-09-17 / P-112-BANDGEOM：`?bandfeed=`，真实源 = 渲染器自己的 AnalyserNode、无源则确定性模拟源；见 `docs/AUDIO-BAND-WIRING.md`，规格 §6 已同步）；
   - `P-101`（目录再整理）与 `P-104`（发布纪律）两号仍归各自那条线补写小节。

# 官方鼠标视差对齐（RE-24 静态逆向 → 本仓落地）— 2026-09-24

工作目录 `/root/Desktop/DSHarea/we-scene-demo`（渲染器仓库根）。本轮**只写**四个文件：

| 文件 | 动作 |
|---|---|
| `core/we-scene-bundle.js` | 6 处对齐（其中 2 处经复算判定为**不必改**，见 §2） |
| `tests/official-parallax-formula-test.mjs` | **新增**（23 断言 + 6 组变异自证） |
| `tests/parallax-live-test.mjs` | 扩展（2 条变异锚点随重构迁移，语义不变） |
| `tests/run-all-tests.sh` | **一行**注册（`add "official-parallax-formula" …`） |

没有 commit / push；没开浏览器；`docs/**`、`demo.html`、`demo/bench-patch.js`、`server/**`、`elysia/**`、
`tests/bench-*`、`tests/gyro-*`、插件仓一律未动。改前 `core/we-scene-bundle.js` 是干净的
（`git status` 里只有别的线在动的 `demo/bench-patch.js`、`docs/README-DIAGNOSTICS.md`、
`tests/bench-*.mjs`、`tests/run-all-tests.sh`），改前 blob = `67bfb2954948849edc5cac082b7c4fd533eee29d`。

> ⚠ 一处**副作用需要交回主线判断**：跑 `node tests/docs-check.mjs`（任务要求）时，它按设计重写了生成物
> `web/diag-flags.json` —— 内容差异只有 `generatedAt` 时间戳 + 若干 `line` 号（因为我给
> `core/we-scene-bundle.js` 加了 ~94 行，诊断开关的行号整体下移）。**没有回滚它**：回滚反而会让行号
> 与 bundle 不一致（第二次跑 docs-check 已报 `diag-flags.json 未变`，即该重写是**一次性**的）。
> 若主线希望该文件保持未改，`git checkout -- web/diag-flags.json` 即可。

---

## 0. 结论（先说结果）

| # | 项目 | 结论 |
|---|---|---|
| 1 | 每层权重**乘法** `depth × amount` | **本仓缺省档早已是乘法**（`?parallax=legacy` 档才是旧的加法 A/B）⇒ **无需改**；加法形式只作为 `legacy` 档逐位保留 |
| 2 | 归一化映射 `0.5 − p·min(influence,1)` | **已改**：补上 `min(influence,1)` 截断（`influence ≤ 1` 时逐位不变） |
| 3 | `depth` 取**顶层祖先** | **已改**：父链解析 + 顶层取值（顶层没有时回落本层，见 §5 残余） |
| 4 | "鼠标被重复计入" | **判定为逆向报告的一版误读**：缺省档那两项是**同一个官方差式的分解**，删任一项都会改坏 ⇒ **未改**，并用变异 M6 把"机械删项"钉成必红 |
| 5 | 平滑闭式 `k = min(1,(1−delay/3)·10·dt)` | **已改**：含 `delay ≤ dt ⇒ 吸附`、只封顶不夹下界（旧指数式移入 `legacy` 档） |
| 6 | 场景级 `cameraparallax=false` ⇒ **冻结**（非归零） | **已改**：与 `opts.parallaxOff`（本仓产品开关，仍归零）分成两个分支 |
| — | `?parallax=legacy` 逐位回旧行为 | **已证**：与 `git show HEAD:` 的**改前构建**在 3 个夹具上**逐位相同**（含 `influence=2` 一档） |

---

## 1. 逐项对照表：官方（读出来的） vs 本仓改前 vs 改后

证据列里的 `A3/A4/C1/C2/A18/A20` = `docs/_official-extract/parallax/…` 的转储；
`§` = `docs/<工作区>/docs/OFFICIAL-PARALLAX-RE-20260924.md`（工作区 `docs/`）。**强度**是我按"能指到几条指令/是否有第二构建独立复现"给的。

| # | 项 | 官方（逐指令） | 本仓**改前** | 本仓**改后** | 强度 |
|---|---|---|---|---|---|
| 1 | `g_ParallaxPosition` 语义 | 归一化**位置** vec2∈[0,1]，中心 0.5（`depthparallax.vert`: `prlxInput = g_ParallaxPosition*2-1`；A18） | 原样送 `parallaxState`（L10004） | **不动** | FACT（官方资产原文） |
| 2 | 归一化 → 位置 | `S = 0.5 − p·min(influence,1)`；`p` **中心相对**（居中⇒p=0⇒S=0.5）<br>A3 `0x2556140 fadd`(2·infl) → `0x2556154 fminnm`(,2.0) → `0x2556164 fmul`(乘 p) → `0x255616c fmul`(−0.5) → `0x2556174 fadd`(+0.5) | `(0.5 − parallaxState.x)·influence`（`parallaxState.x` 是 [0,1] **原始指针** ⇒ `0.5 − parallaxState.x = −p`） | `(0.5 − parallaxState.x)·min(influence,1)`<br>（≡ `(S−0.5)`，见 §2.2） | FACT |
| 3 | 每层权重组合 | `depth × amount`（A4 `0x2557c34 fmul`→`0x2557c38 fmul`；x86-64 独立复现 C2 `14014c9cb`/`14014c9d5`；对这两槽的 `addss` 全量扫描 **0 命中**） | 缺省档**已是** `dpx·parAmount`；`legacy` 档 `(dpx+parAmount)` | **缺省档不动**；`legacy` 档**照旧**（逐位要求） | FACT ×2 构建 |
| 4 | `depth` 来源 | **顶层祖先**：A4 `0x2557bf4-0x2557c14`（`GetParent()` 循环到根，`x22`）→ `0x2557c30 ldr d2,[x22,#320]`；桌面 C2 同构（`14014c990-9d` → `14014c9d5 mulss 0x180(%rcx)`）。旁证 A20：官方 37 工程 `parallaxDepth` **40/40 都在顶层** | 本层 `layer.parallaxDepth`（L10338-10339） | **顶层祖先**（L10367-10368，父链 id→层 解析）；顶层没有则回落本层 | FACT + 旁证 |
| 5 | 参考点位置 | 顶层祖先位置：A4 `0x2557c28 ldr d2,[x22,#248]`（**同一个 `x22`**） | 本层 `ox,oy`（L10346） | **未改**（残余，见 §5.2） | FACT（官方用顶层）；本仓保持本层 |
| 6 | 位移式子 | `offset = (rootPos − S) ∘ depth × amount` | `((ox−camCx) + parDisp)·dpx·parAmount` | **未改**（复算证明它 ≡ 官方镜像式，见 §2.3） | FACT |
| 7 | 平滑 | `k = min(1.0, (1 − delay/3)·10·dt)`；`delay ≤ dt` ⇒ 吸附；**只封顶不夹下界**<br>C1 `0x14014b6c2/6ce/6f8/6fa/705/709/711/716/71b/758` | `clamp01(1 − exp(−dt·ln100/delay))` | **官方闭式**（L11445-11448）；非有限 `delay` 走本仓失败安全 `k=1` | FACT（唯一 bit 级可比闭式） |
| 8 | 平滑默认值 | `delay=0.1`（A18 44/44）⇒ 60fps `k≈0.161111` | 同 delay 下 `k≈0.535841`（**快 3.3 倍**） | `k≈0.161111` | FACT |
| 9 | 场景级开关 | `cameraparallax===false` ⇒ **整段跳过、保持上次位置**（C1 `0x14014b626 je 0x14014b7e4`；帧计时在 `je` **之前**推进，`0x14014b61c`） | `else { parDisp=0 }`（归零） | **冻结**（L11471-11472），帧计时照旧推进 | FACT（桌面） |
| 10 | 产品开关 | 无对应（`?parallax=` 是本仓产品决定） | `opts.parallaxOff` ⇒ 归零 | **仍归零**（L11473-11474），与 #9 分开 | 本仓决定 |
| 11 | 鼠标归一化 | 桌面 `GetCursorPos → ScreenToClient → x/宽, y/高 → [0,1]²`，中心 0.5，**采样时不夹**（C1 `0x1400e807b-aa`；夹取在输出 `0x14014b794-7a4`） | `[0,1]` 且**立即** `clamp`（L9926-9927） | **未改**（残余，见 §5.3） | FACT |
| 12 | `1 − x` 镜像 | arm64 `0x2556180 fsub`/`0x2556184 fcsel`（只翻 x，条件 `impl[248]&0x800`）；桌面 `0x14014b7da subss`（只翻 x） | 无显式镜像，但 `(0.5−·)` 口径等价于**已翻** | **未改**（逆向侧明示"别修正"；两构建对"镜像是否进每层项"本身不一致，见 §5.1） | FACT（指令）/ 推断（语义） |
| 13 | 作用对象 | 写 `layer+328`，进视图矩阵（A4 `0x2557c78`） | 与 `origin` 合并进一次平移（L10353） | **不动** | FACT，结构相当 |
| 14 | 重力/陀螺仪 | `Scene::Update3DParallax`（旋转），与鼠标是两条通道（A2/A7） | 本仓另有 `?gyro` 通路 | **未动**（不在本轮范围） | FACT |

---

## 2. 复算：我对逆向结论做的两处**更正**

### 2.1 #1「每层权重是加法」——行号快照过期，缺省档早已是乘法

任务表把 `~L10342-10343` 的 `(dpx + parAmount) * parDispX` 标为"现状"。按内容定位后：
**那一行现在只存在于 `opts.parallaxLegacy` 分支**（`?parallax=legacy` 的 A/B 档），缺省分支（L10388）早就是
`((ox−camCx) + parDispX) * dpx * parAmount`。⇒ 按任务表字面改它，会**直接违反**"`?parallax=legacy` 逐位回旧行为"
这条硬约束。**判定：#1 无需改**（缺省已合规；`legacy` 档必须保留加法），并用判据
`OFF-PRODUCT-NOT-SUM`（读数取乘法 −53.76、不取加法 −875.52）+ 变异 `M3` + §4 的逐位对拍三面钉住。

### 2.2 #2 的"0.5 位置"：两种写法在**本仓语义下是同一个式子**

本仓 `parDispX` 不是"位置"而是**中心相对位移**：`parDispX ≡ (S − 0.5) × 画布`。
因为 `(S−0.5) = −p·min(influence,1) = (0.5 − cursor)·min(influence,1)`，所以把 `influence` 换成
`min(influence,1)` 之后，本仓的式子与官方**逐位等价**（对 `(S−0.5)` 做 EMA 与对 `S` 做 EMA 是平移等价的）。
⇒ 缺省档**唯一**真正缺的是 `min(·,1)` 截断；我**没有**把 `parDisp` 改成"位置"（那要同时改每层式、
初值（官方复位写 `(0.5,0.5)`）与 `parallaxOff` 归零口径，且会翻转方向，见 §2.3）。

`influence ≤ 1`（含官方默认 `mouseinfluence = 0.0`）时 `min` 是**恒等** ⇒ 本仓存量读数一位不变 ——
这就是为什么 `p76-parallax-eye`（111 断言，钉死逐层像素）**改前改后完全一致**。

### 2.3 #4「鼠标被重复计入」——**判为误读**，并给出正确读法

官方：`offset = (rootPos − S) ∘ depth × amount`。把本仓缺省档展开（`orthoW = projW = 2·camCx`，
`rootPos = ox/projW`，`p = cursor − 0.5`）：

```
((ox − camCx) + parDispX) · dpx · parAmount
  = projW · [ rootPos − 0.5 + (0.5 − cursor)·min(infl,1) ] · dpx · amount
  = projW · [ rootPos − (1 − S) ] · dpx · amount          ← 官方差式，S 取 arm64 的 `1−x` 镜像那一支
```

即：**`(ox − camCx)` 与 `parDispX` 是同一个官方差式的两项**（`camCx = 0.5·画布` 与 `parDispX` 里的
`0.5·画布` 恰好对消），鼠标**只进了一次**（进在 `parDispX`）。
- 删 `(ox−camCx)` ⇒ 丢官方 `root` 参考点：实测 600px 偏心层差 **21.000px**（判据 `OFF-TWO-TERMS-KEPT`，变异 `M6` 必红）。
- 删 `parDispX` ⇒ 丢鼠标项：`Δmouse` 变 0（判据 `OFF-MOUSE-ONCE` 会红，实测 `Δm1=Δm2=−53.760px`，与官方系数**一份** `−53.76` 吻合；重复计入才会是 `−107.52`）。
- 逆向报告 §对照表 #9 建议的 `(ox_root − parDispX)` **成立的前提**是把 `parDisp` 换成"位置型"
  （`S·画布`）；那是一条与本文等价的**代数重排**，但按本仓现有"位移型"语义直接删项就是错的。

⇒ **#4 未改**。这也是本批唯一一条"逆向结论本身有问题"的地方（另一条是 §2.1 的行号快照）。

---

## 3. 代码改动清单（`core/we-scene-bundle.js`）

| 行 | 改动 | 注释里写清的依据 |
|---|---|---|
| L9782-9806 | 新增 `parLayerById` / `parLayerByIdScene` / `parTopAncestorOf()`（父链 id→层，防环 64 跳，按场景缓存） | A4 `0x2557bf4-0x2557c14` 的 `GetParent()` 循环 |
| L10363-10392 | 每层：`parRoot = parTopAncestorOf(layer)`；`parDepthSrc = parRoot.parallaxDepth ? parRoot : layer`；门从"本层有 depth"改成"取值源有 depth" | A4 `[x22,#320]`、桌面 C2 `14014c9d5`、A20 40/40 顶层 |
| L10388-10389 | 缺省档每层式**保持**，但注释重写成"两项 = 一个官方差式"，并注明"不是鼠标重复计入" | A4 `0x2557c28 fsub → c34 fmul → c38 fmul`；C2 独立复现 |
| L11382-11399 | 场景级段头注释换成官方算式四项；新增 id→层表缓存（换场景重建） | §A.2/§A.3/§B-4 |
| L11409-11415 | 门拆成两层：外层 `opts.parallax !== false && opts.parallaxOff !== true`（产品开关），内层 `parEnabled`（场景级）；`parDt`/`lastParallaxTime` 提到内层之外 | C1 `0x14014b61c` 在 `je` 之前 |
| L11441-11448 | `k`：`legacy` 走旧指数式；否则 `delay ≤ parDt ⇒ k=1`（吸附），否则 `min(1,(1−delay/3)·10·parDt)`（**不夹下界**）；非有限 `delay` ⇒ `k=1`（本仓失败安全，注释标明不是官方语义） | C1 `0x14014b6fa/705/709/711/716/71b/758` |
| L11461-11462 | `inflClamped = legacy ? influence : Math.min(influence,1)`；`tx/ty` 用它 | A3 `0x2556154 fminnm` + `0x2556164 fmul` |
| L11467-11470 | 更新条件从 `k > 0` 改成 `isFinite(k) && k !== 0`（官方对被乘的 k **无**守卫，允许 `k<0` 反向外插；`legacy` 档下与旧口径逐位等价） | C1 `0x14014b726-732` 无条件 lerp |
| L11471-11474 | 冻结分支（注释）+ `parallaxOff` 归零分支 | C1 `0x14014b626 je`；产品开关是本仓决定 |

**没动的**：`g_ParallaxPosition` 接线、`layer+328` ↔ `mat4Translate` 的空间口径、`1−x` 镜像、
`?parspace=`/`?paroff=` 两个回退开关、粒子/翻译器/文本/效果链一切。

---

## 4. mock-GL 改前 / 改后读数

夹具统一为 `projW=3840, projH=2160`，层居中 ⇒ 读数（设计像素）= 视差位移本身。

### 4.1 与**改前构建**对拍（`git show HEAD:core/we-scene-bundle.js`，落 `/tmp` 后 import）

| 档 | 夹具 | 改前 | 改后 | 关系 |
|---|---|---|---|---|
| `?parallax=legacy`（`parallaxLegacy:true`） | L1 `influence=1, amount=0.5, delay=0.1, dt=1/60, cursor=0.9, 3 帧, depth=0.07` | `−48.38393568992615` | `−48.38393568992615` | **逐位相同** |
| `?parallax=legacy` | L2 `influence=0.07, amount=0.5, delay=0.1, dt=1/60, cursor=(0.9,0.25), 40 帧, depth=(3.8,4.2)` | `[−204.28786754608154, −79.3799838423729]` | 同左 | **逐位相同** |
| `?parallax=legacy` | L3 `influence=2, amount=1.75, delay=0.5, dt=1/30, cursor=(0.3,0.5), 5 帧` | `[2410.158005…, …]`（px） | 同左 | **逐位相同**（说明 legacy 档连"influence 不截断"也照旧） |
| 缺省档 | `influence=1, amount=0.5, delay=0.1, dt=1/60, cursor=0.7, **1 帧**` | `−14.403343` px | `−4.330589` px | **必须不同**（旧 k=0.535841 / 官方 k=0.161111） |

> 这一组是**真 bit-exact**（同一条 float32 通路、同一个数），也是任务要的"回归护栏"。
> 缺省档"必须不同"那一行是**反假绿**：否则"逐位相同"可能只是"两档都没动"。

### 4.2 `tests/parallax-live-test.mjs` B 段（既有夹具，用户样本 0917/3233141951）

| 读数 | 改前 | 改后 |
|---|---|---|
| `Δx`（鼠标 0.5→0.9，`influence=0.07, depth=3.8, amount=0.5, 40 帧`） | `−204.288` px（已收敛） | `−204.107` px |
| 差值来源 | — | 官方 k 更慢（0.1611）：40 帧后残差 `204.288·(1−0.1611)^40 = 0.181px`；判据容差 0.5px ⇒ 仍 PASS |

### 4.3 `tests/p76-parallax-eye-test.mjs`（对象级/门控，111 断言）

改前 111/0、**改后 111/0**；该测试把逐层读数**钉成常量**（含 D3 的 `?props` 偏差 ≤1e-6 档），
改后所有钉子仍在原判据内 ⇒ 对象级那一项没有被本轮改动带偏。（该夹具 `cameraparallax` 未开 ⇒ `parDisp=0`
⇒ 只走"与鼠标无关的 `(ox−camCx)·depth·amount`"那一项，而那一项本轮没改。）

---

## 5. 档位（variants）读数与**残余/未验证**

### 5.1 镜像方向（**未验证**，故意没改）

- FACT：arm64 `0x2556180/0x2556184` 与桌面 `0x14014b7da` 都**只翻 x**。
- FACT：两构建对"镜像是否进**每层**项"**不一致** —— arm64 里翻过的 `v3`
  （`0x2556184 fcsel` 之后）按 A3 的数据流进入写 `Scene[704]` 的那段计算（`0x25561d0-0x2556248`；
  ⚠ 那段积分器本身的**语义**被逆向报告列为未定论，这里只用"数据流到了哪"这个较弱的事实），
  而 A4 减的就是 `Scene[704..708]`；桌面则把 `1−x` 做在**另一个槽** `[Scene+0xd0]+0x6c`
  （供 `g_ParallaxPosition`），每层项减的是 `Scene+0x320`（C2 `14014c9b9 subss 0x320(%rdi)`）。
  **强推断**（两个转储各读一处、地址算式不同；两槽是否别名未进一步验证，但 `[Scene+0xd0]` 是解引用得到的
  独立对象，按 B-4 的 `movq 0xd0(%rbx),%rcx` 读法不像是 `Scene+0x2b4` 的内部指针）。
- ⇒ "官方每层项到底翻不翻"**证据不足**；本仓现有 `(0.5−·)` 口径等价于 arm64 的**已翻**那一支。
  按逆向侧"别去修正它"的要求**保持原样**。因此本档只在 **x** 上判读数，且判据都构造成**镜像不变**的
  （绝对值量级 + 变化率 + 与改前对拍），不声称"与官方 x 方向逐位一致"。
- y 轴：本仓对 y 用**同一式**（镜像也落到 y），官方只翻 x ⇒ 已知残余；本档 y 轴**不做**断言。

### 5.2 `root[248..252]` 取顶层位置 —— **官方用顶层，本仓仍用本层**（未改）

A4 里 `[x22,#248]`（位置）与 `[x22,#320]`（depth）来自**同一个**根指针 ⇒ 严格说本仓的
`(ox − camCx)` 也该取顶层祖先的 origin。**未改**，理由：
1. 不在本轮授权改动清单（清单只到 depth）；
2. 顶层祖先的**有效** origin 在本仓会被 `?charfit` 兜底改写（L10307-10316），要复刻得把那段逻辑
   在 `compositeLayer` 里重算一遍，属于"改坏"风险；
3. A20 证：官方 37 个工程里 `parallaxDepth` **40/40 都在顶层** ⇒ `root === layer`，两者在官方语料上
   **不可分辨**。本档的 `OFF-ROOT-ANCESTOR-DEPTH` 夹具特意让父子 origin 相同，就是为了不让这条残余
   污染 depth 的判据（已在测试注释里写明）。

### 5.3 指针归一化夹取时机（未改）

官方桌面**采样时不夹**（越出客户区可 >1），夹取发生在视差输出（C1 `0x14014b794-7a4`）；
本仓 L9926-9927 立即 `clamp(0,1)`。影响只在"鼠标移出画布"的边界（本仓更保守），本轮未动。

### 5.4 场景级开关关掉时，本仓**仍不消费**冻结值（未改；官方 Draw 侧无此门）

官方每层式（A4 `0x2557c18-0x2557c40`）**没有** `cameraparallax`（bit 0x100）门，只有 bit 0x200（JNI 模式）门
⇒ 官方在 `cameraparallax=false` 时仍会用"冻结住的 S"支起一个静态深度位移。本仓 `compositeLayer` 的门是
`parEnabled && …` ⇒ 关掉时位移为 **0**。测试读数（`OFF-FREEZE-NOT-ZERO`）如实打印了这一点：
"冻结窗口内 x=0.000100px"（消费被门挡住）而**恢复帧** `x=−53.759912px`（证明状态确实被冻结、没归零）。
未改的理由：官方的初值 `Scene[704..708]` 未被证实（只知复位写 `0.5,0.5`，触发条件 C1 列在"未定论"），
若照抄 Draw 侧口径，`?parallax=1` + `cameraparallax=false` 的场景会突然多出一个静态位移 —— 超出授权面。

### 5.5 其它没验证的

- **真机观感**：本轮全部是离线 mock-GL + 静态逆向，**没有开浏览器、没有真机录屏对拍**。方向/量级的
  "官方一致"只到"与反汇编式子一致"，不等于"与 WE 客户端出帧逐位一致"。
- `influence` 的**官方取值范围**：只知默认 `0.0`（A18 43/44）、arm64 在 `min(2·infl,2)` 处截断；
  作者侧合法区间（是否允许 >1、UI 上限）未查。
- 桌面 B-4 的目标值算式里还有一段 `(1 − influence)` 的混合项（C1 `0x14014b6b2-6ca`），
  两个操作数我没能完全辨认 ⇒ **`influence ≠ 1` 的桌面精确形态未定论**；本轮的 `min(influence,1)`
  只用 arm64 A3 的证据（FACT）。
- `cameraparallaxdelay > 3` 时官方 `k < 0`（反向外插）：指令如此（`0x14014b716` 只 `comiss 1.0`），
  但我没有官方工程把 `delay` 设 >3 的样本，实际是否会发生未验证。
- 官方默认值里本仓**没跟**的：`cameraparallaxamount` 缺省（官方 0.5 / 本仓 0）、
  `cameraparallaxmouseinfluence` 缺省（官方 0.0 / 本仓 1）、`cameraparallaxdelay` 缺省（官方 0.1 / 本仓 1）。
  这三条是"缺属性时的兜底"，改动会影响所有没显式写这些属性的存量场景，**不在授权清单内 ⇒ 未改**。

---

## 6. 变异自证（6 组，`MUTANT-RED-OK`：期望红集 == 实际红集）

每组只改**一处**源码（副本落 `/tmp`，真树只读），跑**同一套**判据，比较"基档通过 → 变异后为假"的红集：

| 变异 | 内容 | 期望红集 == 实际红集 |
|---|---|---|
| M1 | `inflClamped` 回旧（不再 `min(·,1)`） | `{OFF-INFLUENCE-CLAMP}` |
| M2 | 平滑回旧指数式 `1−exp(−dt·ln100/delay)` | `{OFF-K-CLOSED-FORM, OFF-K-CAP-ONLY, OFF-K-NO-LOWER-CLAMP, DEFAULT-DIFFERS-FROM-PREV}`（末项正确：改回旧 k 后缺省档与改前构建读数重合） |
| M3 | 每层回旧加法式 `(depth+amount)×disp` | `{OFF-PRODUCT-NOT-SUM, OFF-HALF-NOT-SCALED, OFF-INFLUENCE-CLAMP, OFF-K-CLOSED-FORM, OFF-K-SNAP-DELAY0, OFF-K-CAP-ONLY, OFF-K-NO-LOWER-CLAMP, OFF-ROOT-ANCESTOR-DEPTH, OFF-MOUSE-ONCE, OFF-TWO-TERMS-KEPT, OFF-FREEZE-NOT-ZERO}` |
| M4 | `parDepthSrc = layer`（不回顶层祖先） | `{OFF-ROOT-ANCESTOR-DEPTH}` |
| M5 | #6 回旧的"关就归零" | `{OFF-FREEZE-NOT-ZERO}` |
| M6 | **#4 机械"只保留 `Scene[704..708]` 那一项"**（删 `(ox−camCx)`） | `{OFF-TWO-TERMS-KEPT}` |

6/6 全部 `MUTANT-RED-OK`；跑完真树 `sha256` 不变、`/tmp` 无残留。

判据清单（23 条，全部 PASS，读数见 §4）：
`OFF-DEFAULTS-INFL0`、`OFF-PRODUCT-NOT-SUM`、`OFF-HALF-NOT-SCALED`、`OFF-INFLUENCE-CLAMP`、
`OFF-K-CLOSED-FORM`、`OFF-K-SNAP-DELAY0`、`OFF-K-CAP-ONLY`、`OFF-K-NO-LOWER-CLAMP`、
`OFF-ROOT-ANCESTOR-DEPTH`、`OFF-MOUSE-ONCE`、`OFF-TWO-TERMS-KEPT`、`LEGACY-BITEXACT-VS-PREV`、
`LEGACY-KEEPS-OLD-INFLUENCE`、`DEFAULT-DIFFERS-FROM-PREV`、`OFF-FREEZE-NOT-ZERO` + 6 组变异 + 真树未改。

**判据里写的官方算式**（不是抄实现）：`S = 0.5 − p·min(influence,1)`；
`offset = (rootPos − (1−S))·画布·depth·amount`（镜像支，注释标明）；
`k = (1 − 0.1/3)·10·(1/60)`；`0.4 vs 0.15`、`−53.76 vs −875.52`、`−53.76 vs −107.52` 等反例都是**手算常数**。

---

## 7. 门禁尾部（原样贴回）

```
$ node tests/official-parallax-formula-test.mjs
  ✓ OFF-DEFAULTS-INFL0  [influence=0（官方默认）⇒ 鼠标右移到底读数 x=0.000100px（期望 0）]
  ✓ OFF-PRODUCT-NOT-SUM  [x=-53.759912px 官方(乘)=-53.760000000000005 旧(加)=-875.5200000000001]
  ✓ OFF-HALF-NOT-SCALED  [x=-13.439842px 官方(0.5−p·0.5→S=0.4)=-13.439999999999998 旧((0.5−p)·0.5→S=0.15)=-47.040000000000006]
  ✓ OFF-INFLUENCE-CLAMP  [x=-53.759912px 官方(min(2,1)=1)=-53.760000000000005 未截断=-107.52000000000001]
  ✓ OFF-K-CLOSED-FORM  [x=-4.330589px 官方 k=0.1611111111111111 ⇒ -4.330666666666665；旧指数式 k=0.5358411166387221 ⇒ -14.403409215248848]
  ✓ OFF-K-SNAP-DELAY0  [delay=0 ⇒ k=1 ⇒ x=-53.759912px（= tx·depth·amount 精确值）]
  ✓ OFF-K-CAP-ONLY  [x=-26.879906px 封顶后 k=1 ⇒ -26.879999999999995；未封顶 k=1.3333333333333337 ⇒ -35.84]
  ✓ OFF-K-NO-LOWER-CLAMP  [x=4.480081px 官方 k=-0.16666666666666666 ⇒ 4.479999999999999（旧式夹成 0 ⇒ 0）]
  ✓ OFF-ROOT-ANCESTOR-DEPTH  [child x=-1075.200005px root x=-1075.200005px 顶层 depth 1.4 ⇒ -1075.1999999999998；本层 depth 0.07 ⇒ -53.760000000000005（子层完全继承顶层）]
  ✓ OFF-MOUSE-ONCE  [只改鼠标（0.5→0.9）⇒ Δm1=-53.760012px Δm2=-53.759995px 官方一份=-53.760000000000005（重复计入会是 -107.52000000000001）]
  ✓ OFF-TWO-TERMS-KEPT  [m2@鼠标0.9 x=567.240143px 官方两项=567.24；只留鼠标项会得到=546.24（差 21.000px）]
  ✓ LEGACY-BITEXACT-VS-PREV  [三个夹具（influence/amount/delay 各不同，含 influence=2 一档）**逐位相同** [L1:true L2:true L3:true]]
  ✓ LEGACY-KEEPS-OLD-INFLUENCE  [legacy 档 influence=2 **不截断**（旧口径）：prev=2410.158005px now=2410.158005px]
  ✓ DEFAULT-DIFFERS-FROM-PREV  [缺省档 1 帧：改前 x=-14.403343px ⇒ 改后 x=-4.330589px（旧 k=0.5358 / 官方 k=0.1611）]
  ✓ OFF-FREEZE-NOT-ZERO  [关前 x=-53.759912px；冻结窗口内 x=0.000100px（本仓消费门仍在 ⇒ 0，见报告"残余"）；恢复帧 x=-53.759912px；冻结期望=-53.76；归零会得到=-8.661333333333333]
  ✓ G 变异自证组数 ≥3 且全部 MUTANT-RED-OK（6/6）
  ✓ H 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同，且 /tmp 无残留副本  [sha=5a8aa41edce0 leftovers=0]

===== official-parallax-formula: 23 通过 / 0 失败 / 0 SKIP =====

$ bash tests/run-all-tests.sh --only bundle-syntax demo-syntax mock-gl ptrfx-uniform official-parallax-formula parallax-live p76-parallax-eye scene-layer-baseline
⏳ 另一个重活在跑（flock /tmp/.mpw-gate.lock）—— 等待它结束（最多 20 分钟；MPW_GATE_NOLOCK=1 可跳过）
✓ 拿到锁，开始跑门禁
PASS bundle-syntax (110ms)
PASS demo-syntax (752ms)
PASS mock-gl (273ms)
PASS ptrfx-uniform (345ms)
PASS official-parallax-formula (1022ms)
PASS parallax-live (272ms)
PASS p76-parallax-eye (4763ms)
PASS scene-layer-baseline (2487ms)
══ 汇总：PASS=8 FAIL=0 SKIP=0 / 总 8 项
（本次运行产物：/tmp/mpw-gate-32352-1790192867 ；日志副本：/tmp/mpw-gate-32352-1790192867/last.log）

$ node tests/docs-check.mjs
检查 17 个文档 · 778 个文件引用 · P-编号健康 ✓ · diag-flags ✓   diag-flags.json 未变（保持旧时间戳，不落盘）（common=11 个常用）
✓ 文档一致性全部通过
```

（`core/we-scene-bundle.js` 最终 blob = `324a2e0b806ddebd…`，与上面 H 断言的 `sha=324a2e0b806d` 同源。
`docs-check` 第二次跑已显示 `diag-flags.json 未变` ⇒ §0 里那个生成物副作用是**一次性**的。）

---

## 7b. 跨线影响（**必须交给主线处理**）：`tests/gyro-parallax` 有一条读数是按旧 `k` 标定的

跑 `bash tests/run-all-tests.sh --fast`（全量 164 项）得 **PASS=152 / FAIL=7 / SKIP=5**。逐条核对后
**只有 1 项与本轮改动有因果关系**：

**`gyro-parallax` → C2 失败**（`29 通过 / 4 失败`；另 3 条 M2/M3/M4 是"红集不符"，因为 C2 本来就红、
被算进了它们的实际红集）：

- 断言：`|Δx − (−204.288)| < 0.5`，实测 **−201.274**（差 3.014px）。
- 根因（`tests/gyro-parallax-test.mjs` **L322-324**，注释自己写着标定口径）：
  ```js
  pose(o.beta || 0, o.gamma === undefined ? 24 : o.gamma)
  await step(24)                   // 视差平滑 k≈0.536/帧 ⇒ 24 帧后残余 <1e-6
  ```
  `k≈0.536/帧` 正是**旧的指数式**。换成官方 `k = (1 − delay/3)·10·dt`（默认 `delay=0.1`、60fps）后
  `k≈0.1611` ⇒ 24 帧残余 `(1−0.1611)^24 = 1.45%` ⇒ `204.288 × 1.45% = 2.96px` ≈ 实测 3.014px（**吻合**）。
- 最小修法（**我没有改这个文件** —— `tests/gyro-*` 不在我的授权面）：把那一行 `await step(24)` 换成
  `await step(60)`（残余 `2.6e-5` ⇒ `0.005px`，断言 0.5px 容差下绰绰有余），顺带把那句
  `k≈0.536/帧` 的注释改成官方闭式。
  **已在 `/tmp` 的副本上验证过**（只改这一处 + 两处 import 绝对化）：
  `===== gyro-parallax: 33 通过 / 0 失败 =====`，C2 读数 `−204.283`。
- 影响面：这是**唯一**一条按旧 `k` 标定绝对值的存量断言；`parallax-live` 的行为断言都是定性的
  （`|k|>0.5`、方向、线性、MAE）⇒ 不受影响；`p76-parallax-eye` 不走场景级视差 ⇒ 不受影响。

其余 6 项与本轮**无关**（都在别的线正在改的面上，跑这一轮时 `git status` 也显示它们正被改动）：

| 失败项 | 失败点 | 归属判断 |
|---|---|---|
| `pack-closure` | C2：`server/we-scene-demo-server-8902.mjs → /diag-flags.json` 映射不到包内文件 | `server/**` 正在改（`git status` 里已 M） |
| `pkg-entry-index` | D6：未知场景期望 500 实得 404 | 同上（`sc.pkgPath` 语义） |
| `cross-platform` | A/B：`tests/bench-dsh-libroot-test.mjs`、`tests/portability-audit-fix-test.mjs` 里的本机路径/`/tmp` 字面量 | `tests/bench-*` 正在改 |
| `portability-fix` | 13 条：`scene-project-json.mjs` / `publish-check.mjs` / `known-issues.json` 的 HEAD 对拍 | portability 线的 WIP |
| `bench-ui-headless` | 子帧 `Error creating WebGL context`（本机无 GL 给该档） | bench 线；环境 |
| `bench-shell-fixes` | bench 页壳 | bench 线 |

---

## 8. 复算命令（可原样重跑）

```bash
cd /root/Desktop/DSHarea/we-scene-demo
node tests/official-parallax-formula-test.mjs                 # 官方算式 + 逐位回归 + 6 组变异（~1s）
node tests/parallax-live-test.mjs --offline                   # 20 通过（含 3 组旧变异锚点）
node tests/p76-parallax-eye-test.mjs                          # 111 通过（对象级视差零回归）
bash tests/run-all-tests.sh --only official-parallax-formula parallax-live p76-parallax-eye
node tests/docs-check.mjs

# 逆向依据（只读；工作区根）
sed -n '200,340p' /root/Desktop/DSHarea/docs/<工作区>/docs/OFFICIAL-PARALLAX-RE-20260924.md   # §A.2/§A.3
sed -n '673,730p' /root/Desktop/DSHarea/docs/<工作区>/docs/OFFICIAL-PARALLAX-RE-20260924.md   # §B-4 桌面
sed -n '817,852p' /root/Desktop/DSHarea/docs/<工作区>/docs/OFFICIAL-PARALLAX-RE-20260924.md   # 对照表
sed -n '1,80p'    /root/Desktop/DSHarea/docs/_official-extract/parallax/desktop/C2_disasm_perlayer_weight_wallpaper64.txt
```

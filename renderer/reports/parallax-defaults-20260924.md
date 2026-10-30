# 官方**视差默认值**对齐 + 测试台开关进诊断表 —— 2026-09-24

工作目录 `~/DSHarea/we-scene-demo`（渲染器仓库根）。本轮**只写**这五个文件（`git status` 原样）：

| 文件 | 动作 | 任务 |
|---|---|---|
| `core/we-scene-bundle.js` | 三处"缺属性兜底值"改官方默认（+21 行注释/常量，**公式一行未动**；新注释块 11397-11413、常量 11414-11416） | A |
| `tests/official-parallax-formula-test.mjs` | 扩展：§F 官方默认值 6 条 + §D/§G legacy 缺属性 3 条 + 变异 6→**10 组** | A |
| `tests/diag-flag-check.mjs` | 抓取源 **+1 个文件**（`demo/bench-patch.js`），抓取规则 a/b/c/d 未动 | B |
| `docs/README-DIAGNOSTICS.md` | 主表新增第 ⑧ 节 4 行 + 表头计数回填 + 「补丁层开关」节改写 | B |
| `web/diag-flags.json` | 重生成（183 flags / common 仍是 **11**） | B |
| `reports/parallax-defaults-20260924.md` | 本报告 | — |

没有 commit / push；没开浏览器；`demo.html`、`demo/bench-patch.js`、`server/**`、`elysia/**`、插件仓、`tests/run-all-tests.sh`
一律未动（**没有**新增测试文件 ⇒ 门禁注册表不需要 +1 行，`run-all-tests.sh` 保持零改动）。语料扫描逐包读、读完释放（`pkg = null`），
206 个包 32.2s 跑完，无 OOM。

改前锚点（`git show HEAD:` = `f405939886985dbecd8f02ce82873b7798870cd5`，工作树当时干净、与 HEAD 逐字节相同）：

| 位置（HEAD 行号） | 改前 |
|---|---|
| `core/we-scene-bundle.js:11397` | `parAmount = typeof general.cameraparallaxamount === 'number' ? general.cameraparallaxamount : 0` |
| `core/we-scene-bundle.js:11416` | `const influence = typeof general.cameraparallaxmouseinfluence === 'number' ? … : 1` |
| `core/we-scene-bundle.js:11417` | `const delay = typeof general.cameraparallaxdelay === 'number' ? … : 1` |

---

## 0. 结论（先说结果）

| # | 项目 | 结论 |
|---|---|---|
| 1 | 官方默认值出处 | **44/44 官方 `wallpaper_engine/assets/effects/*/preview/scene.json`**：amount `0.5`(44/44)、delay `0.1`(44/44，文本是 float32 的 `0.10000000149011612`)、influence `0`(43/44，另 1 个 `1.0`)。§1 有**独立复算**与逐字节 file:offset；官方二进制里**没有**这三个值的硬编码（只有属性槽位描述符） |
| 2 | 本仓旧默认 | amount `0` / delay `1` / influence `1`（HEAD 的 `11397/11416/11417`，见上表） |
| 3 | 语料读数：**开了视差但没写这三个属性的包** | `allwallpaper/**`：206 个包候选 / 121 个含 `scene.json` / **31 个开了 `cameraparallax`** ⇒ 其中 **0 个**缺这三个属性（缺任一 = 0，三个全缺 = 0）。官方 `wallpaper_engine/projects/**/scene.json`：14 个场景、**0 个**开视差。**没有包名可列 —— 读数是空集**（§2） |
| 4 | 改动 | 缺属性兜底改成官方 `0.5 / 0.1 / 0.0`；`?parallax=legacy` 逐位回旧三默认；显式给的值（**含 0**）一律优先；`?parallax` 缺省关的产品语义**未动**；官方算式**一行未动** |
| 5 | 判据 | `official-parallax-formula`：**37 通过 / 0 失败 / 0 SKIP**；变异 **10/10 `MUTANT-RED-OK`**（含新增 M7~M10） |
| 6 | 门禁 | `PASS=6 FAIL=0 SKIP=0`；`docs-check` 全绿；`diag-flag-check` **双向 0 差异（183 == 183）**，`common=11`（§7） |
| 7 | 对存量语料的**可见**影响 | **0 个包**（31 个开视差的包里三个属性全写全了；且 `dd/3544152633` 是**显式 `amount=0`**、`0923/3582367840` 是**显式 `delay=0`** ⇒ 都必须保持原值，本轮判据 `DEF-EXPLICIT-ZERO-IS-EXPLICIT` 钉住）。本轮修的是**语料之外的作者场景**与官方的口径分歧（§2.3） |

---

## 1. 官方默认值的确切出处（file:offset）+ 本仓独立复算

### 1.1 语料（"官方默认值"的实体）

官方随安装包发布的 **44 个效果预览场景** `wallpaper_engine/assets/effects/*/preview/scene.json`。
例（逐字节偏移，`python3` 读原始字节）：

| 文件 | 字节偏移 | 原文 |
|---|---|---|
| `wallpaper_engine/assets/effects/blend/preview/scene.json` | **307** | `"cameraparallaxamount" : 0.5,` |
| 同上 | **340** | `"cameraparallaxdelay" : 0.100000001490116…` |
| 同上 | **388** | `"cameraparallaxmouseinfluence" : 0,` |

**本仓独立复算**（`json.load` 全部 44 个文件，`<dict>.value` 解包）：

```
scenes 44
  cameraparallax                 {'False': 43, 'True': 1}
  cameraparallaxamount           {'0.5': 44}
  cameraparallaxdelay            {'0.10000000149011612': 31, '0.1': 13}
  cameraparallaxmouseinfluence   {'0': 29, '0.0': 14, '1.0': 1}
```

⇒ delay 那两种写法是**同一个 float32** 的两种文本形态（`0.10000000149011612 == Math.fround(0.1)`）；
influence 43/44 是 `0`、1 个是 `1.0`。工作区文档里的同一读数：
`docs/_official-extract/parallax/A18_official_assets_depthparallax_and_defaults.txt:35-41`；
结论行 `docs/<工作区>/docs/OFFICIAL-PARALLAX-RE-20260924.md:52-55`。

### 1.2 为什么说这是"默认值"（而不是我挑的样本）

* 官方**二进制里没有**这三个值的编译进常量：arm64 `Scene::InitProps` 只注册属性槽位描述符
  `cameraparallaxamount = {4, 692}` / `cameraparallaxdelay = {4, 696}` / `cameraparallaxmouseinfluence = {4, 700}`
  （`docs/_official-extract/parallax/A13_rodata_property_descriptors.txt`，常量地址 `0xc73a08/0xc73d78/0xc734c0`、
  代码点 `0x255e524/0x255e5f8/0x255e6cc`）；桌面同一套描述符格式
  `cameraparallaxamount = {4, 0x314}` / `delay = {4, 0x318}` / `mouseinfluence = {4, 0x31c}`
  （`desktop/C1_disasm_scene_parallax_property_binding_table.txt` `0x14015608d-0x14015615d`）。
  我在 `wallpaper64.exe` 里对"立即数写这三个槽位"做过有界字节扫描（`c7 8? <disp32> <imm32>` 三组）**没有**得到
  0.5/0.1/0.0 的写入 ⇒ **值只能来自 scene.json**。
* 另一条旁证：官方 UI 的共享默认属性表只给 `cameraparallax: true`
  （`wallpaper_engine/ui/dist/scripts/scripts.js` 偏移 **337776**，`this.getSharedDefaultProperties=function(e){var t={alignment:0,alignmentposition:50,rate:100,volume:50,cameraparallax:!0};…}`）
  —— 三个数值量在 UI 侧**没有**默认，进一步说明它们来自场景 JSON。
* 44/44 全写、无一例外 ⇒ 这就是官方编辑器/官方资产在"作者没动这三项"时落盘的值，也就是我们要跟的"官方默认"。

> ⚠ 别把本仓旧文档 `docs/<工作区>/docs/FIELD-ANALYSIS.md:58` 的 `0.35/1.04/0.25` 当成官方默认 —— 那是**某一个用户包**
> （`dd/3544152633` 一类）的作者值，不是官方默认。本轮改成的是"**缺属性**时用什么值"，与作者值无关。

---

## 2. 语料扫描（有界）：开了 `cameraparallax` 但没写这三个属性的包

### 2.1 方法（可复跑）

脚本 `/tmp/parallax-defaults-scan.mjs`（临时件，不入库；逻辑：逐包 `lib.parsePkg` → 取 `scene.json` → 判
`cameraparallax` 真值（含 `{value:true}` 形态）→ 对 `cameraparallaxamount/delay/mouseinfluence` 做
`hasOwnProperty && !== undefined && !== null` 的"写了没"判定 → 逐包释放）。扫描面：

* `allwallpaper/**` 的 `scene.pkg` / `*.mpkg`（**scene.json 的实体在 pkg 内**，这是本仓语料的形态；
  `docs-check` 与 `tests/*-scan.mjs` 同口径）
* 官方 `wallpaper_engine/projects/**/scene.json`（直读 JSON）

### 2.2 读数（**不编**：下面每个数字都是脚本输出）

```
allwallpaper:  pkgTotal=206  parsed=121  noScene=85  err=0
               开 cameraparallax 的包 = 31
                 其中"缺任一所列属性" = 0     "三个全缺" = 0     missingDetail = {}   （空集）
official projects: projTotal=14   开 cameraparallax = 0
```

* `noScene=85`：这 85 个包里没有 `scene.json` 条目（抽查 4 个：`preview.gif/jpg` + `project.json` + `*.mp4`
  ⇒ **视频壁纸**，天然无场景）—— 这是本次扫描的**已知覆盖面边界**，写在这里而不是当作"扫过全量"。
* **包名列表：空**（`pkgParallaxOnMissingAny` 里 31 条的 `missing` 全是 `[]`；`pkgParallaxOnMissingAll = []`）。
* 31 个开视差包的作者值分布（旁证这些包真的在做视差，不是"开关开着但没参数"）：
  amount `{0.5:11, 0.15:4, 0.1:2, 0.2:2, 0.31:2, 0.01:2, 0:1, …}`；
  delay `{0.1:13, 2:8, 0.2:2, …}`；influence `{0.5:8, 0.07:3, -0.3:3, 0.7:2, …}`。
* 顺带查出的**两个"显式 0"**（本轮最危险的回归面，必须保持原值）：
  | 包 | amount | delay | influence |
  |---|---|---|---|
  | `allwallpaper/dd/3544152633/scene.pkg` | **0** | 0.1 | 0.5 |
  | `allwallpaper/0923/3582367840/scene.pkg` | 0.64999998 | **0** | -0.079999998 |
  即：语料里**真的有**"作者显式写 0"的包。把"显式 0"当缺省（变异 M8）会让这两个包突然多出位移 —— 判据
  `DEF-EXPLICIT-ZERO-IS-EXPLICIT` 与 `DEF-EXPLICIT-VALUES-WIN` 钉住这条。

### 2.3 结论（诚实版）

* 任务书担心的场景（"开了 `cameraparallax` 但没写 amount ⇒ 官方有视差、我们一点都没有"）在**本机两个语料里
  一个都没有**。所以本轮改动的**用户可见影响在语料上 = 0 个包**（31 个包全部写全三个属性 ⇒ 本轮兜底逻辑对它们**不可达**：29 个是常规作者值、2 个是显式 0）。
* 但它仍是**真实的口径分歧**：官方语义是"这三个是场景 general 属性、缺了就按官方值"（1.2 证明引擎侧无独立默认），
  而本仓的 `0/1/1` 会让这种作者场景**静默无位移**；`amount=0` 尤其致命（整项乘 0）。本轮把这条补齐，
  并用 F1 夹具（层心 +600px、depth 0.07、三属性全缺 ⇒ 官方默认必须有 **+21px** 非零位移）把"改完真的动起来"钉住。
* 现状（改后）：`parDefaultAmount = opts.parallaxLegacy ? 0 : 0.5`（`core/we-scene-bundle.js:11414`）、
  `parDefaultDelay = … ? 1 : 0.1`（`:11415`）、`parDefaultInfluence = … ? 1 : 0`（`:11416`）；
  消费点 `parAmount`（`:11417`）、`influence`/`delay`（`:11440`/`:11441`）。

---

## 3. 改了哪些锚点（逐条 + 回退）

| 文件:行（改后） | 内容 |
|---|---|
| `core/we-scene-bundle.js:11397-11413` | 新增注释块：官方默认值出处（file:offset + A18）、本仓旧默认、为什么改、**回退口**；三个常量 `parDefaultAmount/parDefaultDelay/parDefaultInfluence`（`opts.parallaxLegacy` 时取旧值 0/1/1） |
| `core/we-scene-bundle.js:11417` | `parAmount = typeof general.cameraparallaxamount === 'number' ? general.cameraparallaxamount : parDefaultAmount` |
| `core/we-scene-bundle.js:11436-11441` | `influence`/`delay` 的缺省改用 `parDefaultInfluence`/`parDefaultDelay`，并注明"官方算式/`parallaxOff` 门/冻结分支一律未动" |

**回退矩阵**（逐条对应任务书要求）：

| 口径 | 行为 |
|---|---|
| 缺属性 + 缺省档（非 legacy） | 官方默认 `amount=0.5 / delay=0.1 / influence=0` |
| 缺属性 + `?parallax=legacy` | **逐位**回旧：`0 / 1 / 1` + 旧算式（判据 `DEF-LEGACY-MISSING-BITEXACT`，与 `git show HEAD:` 构建对拍） |
| 显式给值（任何档） | 作者值优先；`0` 是"显式 0"（`DEF-EXPLICIT-ZERO-IS-EXPLICIT`、`DEF-EXPLICIT-VALUES-WIN`） |
| `?parallax` 缺省关（`opts.parallaxOff`） | **未动**：仍是"视差整体停用 ⇒ `parDisp` 归零"（本仓产品决定），与"缺属性兜底"是两个正交维度 |
| 公式（`k` 闭式、`min(influence,1)`、顶层祖先 depth、冻结分支、每层乘法式） | **一行未动**（`DEFAULT-EXPLICIT-BITEXACT-VS-PREV` 钉住"显式给值时与 HEAD 逐位相同"） |

---

## 4. 判据（`tests/official-parallax-formula-test.mjs`，37 通过 / 0 失败 / 0 SKIP）

新增 **11 个判据 id**（下表 9 行；另**退役** 1 个 `DEFAULT-DIFFERS-FROM-PREV`，见本节末注）。其余 26 条是上一轮的官方算式/冻结/legacy 判据，全部照旧 PASS。

| 判据 | 夹具与断言（**官方公式写在断言里**） | 改后读数 |
|---|---|---|
| `DEF-OFFICIAL-DEFAULTS-HAND-MATH` | 手算自检：`600×0.07×0.5 = 21px` ⇒ 读数 `600+21 = 621px`；`k = (1−0.1/3)×10×(1/60) == 29/180` | `21.000000000000004` / `k=0.1611111111111111`（29/180 = 0.16111111111111112，差 1 ulp） |
| `DEF-MISSING-AMOUNT-OFFICIAL` | `general` **只有** `cameraparallax:true`；层心 `camCx+600`、depth 0.07、鼠标居中（p=0 ⇒ 官方 `S=0.5`）⇒ `offset=(rootPos−S)∘depth×amount` = **非零** | `x=621.000137px`（与手算 621 差 1.4e-4px = float32 末位；旧默认 amount=0 ⇒ 正好 600px） |
| `DEF-MISSING-INFLUENCE-ZERO` | 缺 `mouseinfluence`（显式给 amount 以隔离）⇒ 官方默认 0.0 ⇒ 鼠标 0.5→0.95 读数**逐位不变**；正对照（显式 influence=1）必须动 | `621.000137px` 两次**完全相同**（listener=true）；正对照 `Δ=-35.353260px` |
| `DEF-MISSING-DELAY-OFFICIAL` | 缺 `delay`（显式 amount/influence）⇒ 官方默认 0.1 ⇒ 1 帧后 `k=29/180` | `x=-4.330589px`（手算 `-4.330666666666665`）；旧默认 delay=1 ⇒ `-2.986666666666667` |
| `DEF-EXPLICIT-VALUES-WIN` | 作者值 `amount=0.25 / delay=0(吸附) / influence=1` | `x=-26.879906px`（手算 −26.88；若 delay 被当缺省会是 −4.33） |
| `DEF-EXPLICIT-ZERO-IS-EXPLICIT` | 显式 `amount=0` ⇒ **零位移**（不是缺省 0.5） | `x=600.000114px`（= 层位；当缺省会是 621px，差 21px） |
| `DEFAULT-EXPLICIT-BITEXACT-VS-PREV` | **口径更新**：HEAD 已是"公式对齐后"的构建 ⇒ 缺省档 + 显式给值的三个夹具必须与 HEAD **逐位相同**（本轮只许动缺属性兜底） | L1/L2/L3 全部 bit-exact |
| `DEF-MISSING-DIFFERS-FROM-PREV` | 反假绿：缺属性夹具在 HEAD 与新构建之间**必须不同** | HEAD `600.000114px`（旧默认 amount=0）⇒ 新 `621.000137px` |
| `DEF-LEGACY-MISSING-BITEXACT` / `DEF-LEGACY-MISSING-NONZERO` / `LEGACY-DEFAULTS-DIFFER-FROM-OFFICIAL` | legacy 档的**缺属性**夹具 LM1（三缺）/LM2（缺 delay+influence）/LM3（缺 delay）与 HEAD **逐位相同**；LM2 必须非零（否则"逐位相同"可能只是两边都 0）；且缺省档 ≠ legacy 档 | `LM1:true LM2:true LM3:true`；LM2 改前构建 `x=-279.035082px`（y=`3.4e-5px` = 量化噪声）；同场景缺省档 `0.000100px` |

> 上一轮那条 `DEFAULT-DIFFERS-FROM-PREV`（"缺省档必须与改前不同"）**按设计退役**：它的"改前"指上一轮的公式对齐，
> HEAD 换了之后它必然为假（实测就是它与新构建读数相同）。本轮的"改前"是 HEAD，所以方向反过来：
> **显式给值逐位不变** + **缺属性必须变**，两条一起构成这一轮的反假绿。

## 5. 变异自证（10 组，全部 `MUTANT-RED-OK`：期望红集 == 实际红集）

副本落 `/tmp`、真树只读（H 判据：跑前跑后 `core/we-scene-bundle.js` sha256 相同、`/tmp` 无残留）。
`M7~M10` 是本轮新增（老 6 组沿用上一轮，但 M1/M2/M3/M6 的**期望红集随新判据更新**，理由写在每条 `why` 里）：

| 变异 | 内容 | 期望红集 == 实际红集 |
|---|---|---|
| M1 | `influence` 不再 `min(·,1)` | `{OFF-INFLUENCE-CLAMP, DEFAULT-EXPLICIT-BITEXACT-VS-PREV}` |
| M2 | 平滑回旧指数式 | `{OFF-K-CLOSED-FORM, OFF-K-CAP-ONLY, OFF-K-NO-LOWER-CLAMP, DEFAULT-EXPLICIT-BITEXACT-VS-PREV, DEF-MISSING-DELAY-OFFICIAL}` |
| M3 | 每层回旧加法式 | 16 条（原 11 + `DEFAULT-EXPLICIT-BITEXACT-VS-PREV`、`DEF-MISSING-AMOUNT-OFFICIAL`、`DEF-MISSING-DELAY-OFFICIAL`、`DEF-MISSING-DIFFERS-FROM-PREV`、`DEF-EXPLICIT-VALUES-WIN`） |
| M4 | `depth` 取本层 | `{OFF-ROOT-ANCESTOR-DEPTH}` |
| M5 | 关视差就归零 | `{OFF-FREEZE-NOT-ZERO}` |
| M6 | 删掉 `(ox−camCx)` 那一项 | `{OFF-TWO-TERMS-KEPT, DEF-MISSING-AMOUNT-OFFICIAL, DEF-MISSING-DIFFERS-FROM-PREV}` |
| **M7** | **三个默认值全改回旧的** `0/1/1` | `{DEF-MISSING-AMOUNT-OFFICIAL, DEF-MISSING-INFLUENCE-ZERO, DEF-MISSING-DELAY-OFFICIAL, DEF-MISSING-DIFFERS-FROM-PREV}` |
| **M8** | **把"显式 0"当缺省**（三处 `typeof` → 真值判定，含 amount） | 10 条：`{OFF-PRODUCT-NOT-SUM, OFF-HALF-NOT-SCALED, OFF-INFLUENCE-CLAMP, OFF-K-SNAP-DELAY0, OFF-ROOT-ANCESTOR-DEPTH, OFF-MOUSE-ONCE, OFF-TWO-TERMS-KEPT, OFF-FREEZE-NOT-ZERO, DEF-EXPLICIT-ZERO-IS-EXPLICIT, DEF-EXPLICIT-VALUES-WIN}` |
| **M9** | **legacy 档也换新默认**（`parDefault*` 去掉 `parallaxLegacy` 判断） | `{DEF-LEGACY-MISSING-BITEXACT, LEGACY-DEFAULTS-DIFFER-FROM-OFFICIAL}` |
| **M10** | 只把 `amount` 默认改回 0 | `{DEF-MISSING-AMOUNT-OFFICIAL, DEF-MISSING-DIFFERS-FROM-PREV}` |

**三处"我一开始猜错、按实测修正"的记录**（写在这里防下次踩）：

1. **M6 预期**：我以为删 `(ox−camCx)` 后 `DEF-MISSING-DIFFERS-FROM-PREV` 仍绿；实测**红** —— 删项后新构建的
   读数回到层位 600px，正好等于 HEAD（旧默认 amount=0）的读数 ⇒ "本轮改动生效"这条判据为假。红是对的。
2. **M7 预期**：我以为 `LEGACY-DEFAULTS-DIFFER-FROM-OFFICIAL` 会红；实测**绿** —— LM2 有**显式** amount，
   两档的 `k` 算式本来就不同（缺省档官方闭式 0.1111 / legacy 旧指数式 0.0739）⇒ 默认值全一样也仍然不同。
   该判据要 **M9** 才红（那条把两档默认改成同一套 ⇒ 真的一样了）。
3. **M10 预期**：`DEF-MISSING-INFLUENCE-ZERO` / `DEF-MISSING-DELAY-OFFICIAL` 一开始会跟着红，原因是这两个夹具
   当时**也缺 amount** ⇒ 被 amount 默认值污染（"鼠标项被 0 乘掉，动不了"）。改成"各夹具只让一个属性缺失、
   其余显式给值"后，两个判据变成各自只考一个默认值，M10 的红集收窄到 {amount, differs} —— 这样诊断力更强。

---

## 6. 任务 B：测试台（bench）开关进诊断主表

| 步骤 | 读数 |
|---|---|
| ① 抓取源 +1 | `tests/diag-flag-check.mjs` 的 `collect()` 里新增 `absorb('demo/bench-patch.js', …)`（紧跟 `demo.html` 之后），并把文件头的"来源四类"注释改成五类 + 说明。**抓取规则 a/b/c/d 一条没改** |
| ② 差异 | 加源后第一跑：`✗ 代码有·文档无（漏写 4 个）: online, propimg, sample, shell`（退出码 1）—— 与任务书点名的四个一致 |
| ③ 补表 | `docs/README-DIAGNOSTICS.md` 主表新增 **第 ⑧ 节「测试台补丁层」4 行**（列格式与既有行一致：开关/取值/默认/作用/什么时候用/回退风险/解析位置），落点逐条给到 `demo/bench-patch.js` 行号：`shell` → `6977`、`8395`；`online` → `6101`（+ `onlineDemoEnv` @ `610`）；`sample` → `9471`、`9515`（+ `defaultSamplePlan` @ `720`）；`propimg` → `4511`、`4517` |
| ④ 归零 | `✓ diag-flag-check：代码 183 个开关 == README 主表 183 行，0 差异` |
| ⑤ `common` | 重生成 `web/diag-flags.json`：`flags=183`、**`common=11`（未变）**、`codeBasis` 新增 `demo/bench-patch.js`；四个 bench 开关都**不在** `COMMON_FLAGS` 里（它们不是常用档） |
| ⑥ 表头/附录回填 | 表头把陈旧的"当前 **173** 个"回填成脚本实测 **183**（并留 ③ 号注记说明是"加抓取源"导致）；「补丁层开关」节**改写**：明确它现在只放**抓取规则看不见**的开关（`openrewrite` 等走 `readPatchFlags` 的 `on('name', true)`，a~d 四条规则抓不到），并把 `propimg` 从该附录移入主表（避免两处权威） |
| ⑦ 判据 | `node tests/diag-flag-check.mjs` → 0 差异 / exit 0；`node tests/docs-check.mjs` → `检查 17 个文档 · 782 个文件引用 · P-编号健康 ✓ · diag-flags ✓ … ✓ 文档一致性全部通过` |

> 行号漂移提醒：`demo/bench-patch.js` 是**别的线**正在改的文件（本轮**未碰**），它的行号变了主表落点就会陈旧；
> `diag-flag-check` 只按**开关名**双向比对（不校验行号），`docs-check` 也不校验 `文件:行号` 形态的引用
> ⇒ 行号靠人工保持新鲜。这是本轮已知的**弱项**，写在这里。

---

## 7. 门禁尾部（原样贴回）

```
$ bash tests/run-all-tests.sh --only official-parallax-formula parallax-live p76-parallax-eye ptrfx-uniform diag-flags docs-check
[gate] MPW_PERF_PKG = /root/.dsh-mpkg-wallpaper/5a85a54b12b64bc882d1e7bab0f8e837.mpkg（扫描 /root/.dsh-mpkg-wallpaper/*.mpkg 取最大者：331194792 B；可用 MPW_PERF_PKG= 显式覆盖）
PASS official-parallax-formula (1830ms)
PASS parallax-live (270ms)
PASS p76-parallax-eye (4482ms)
PASS ptrfx-uniform (340ms)
PASS diag-flags (489ms)
PASS docs-check (902ms)
══ 汇总：PASS=6 FAIL=0 SKIP=0 / 总 6 项
（本次运行产物：/tmp/mpw-gate-4679-1790201762 ；日志副本：/tmp/mpw-gate-4679-1790201762/last.log）

$ node tests/docs-check.mjs
检查 17 个文档 · 782 个文件引用 · P-编号健康 ✓ · diag-flags ✓   diag-flags.json 未变（保持旧时间戳，不落盘）（common=11 个常用）
✓ 文档一致性全部通过

（上面这段是**最后一跑**（`/tmp/mpw-gate-4679-1790201762`）的原样输出；报告写作前的两次同样 `PASS=6 FAIL=0`，
产物目录分别是 `/tmp/mpw-gate-3407-1790201570`、`/tmp/mpw-gate-3911-1790201671`。）
```

`--list` 查名（门禁项都存在）：`official-parallax-formula` / `parallax-live` / `p76-parallax-eye` / `ptrfx-uniform` / `diag-flags` / `docs-check`。

单独跑的三项（同一轮、同一棵树）：

```
$ node tests/official-parallax-formula-test.mjs
  ✓ G 变异自证组数 ≥3 且全部 MUTANT-RED-OK（10/10）
  ✓ H 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同，且 /tmp 无残留副本  [sha=5ea567fd131f leftovers=0]
===== official-parallax-formula: 37 通过 / 0 失败 / 0 SKIP =====

$ node tests/parallax-live-test.mjs --offline      → ===== parallax-live: 20 通过 / 0 失败 =====
$ node tests/p76-parallax-eye-test.mjs             → 全部通过 ✓  111 断言通过 / 0 失败
$ node tests/ptrfx-uniform-test.mjs                → ===== ptrfx-uniform: 41 通过 / 0 失败 =====
$ node tests/gyro-parallax-test.mjs                → ===== gyro-parallax: 33 通过 / 0 失败 =====   （见 §8①）
```

`git status --porcelain`（本轮全部改动，逐条都在授权面内）：

```
 M core/we-scene-bundle.js
 M docs/README-DIAGNOSTICS.md
 M tests/diag-flag-check.mjs
 M tests/official-parallax-formula-test.mjs
 M web/diag-flags.json
```

改后 sha256：`core/we-scene-bundle.js` = `5ea567fd131f…`（测试内 H 判据 `sha=5ea567fd131f` 同源）、
`tests/official-parallax-formula-test.mjs` = `bab7124ca68e…`、`tests/diag-flag-check.mjs` = `a4c0fa9e85a1…`、
`docs/README-DIAGNOSTICS.md` = `d2d7e8eb1f21…`、`web/diag-flags.json` = `631e2a6dcfe5…`（以磁盘为准；
`docs/README-DIAGNOSTICS.md` 的哈希在我把 `shell` 行里那个裸 `|` 换成文字之后又变了一次 —— 表格列数已回到 7 列）。

---

## 8. 没能验证的 / 残余（如实）

1. **真机与浏览器**：全部是离线 mock-GL + 静态逆向 + 语料读数，**没开浏览器、没真机录屏对拍**。
   `gyro-parallax` 本轮跑出 33/0（上一轮报告里它按旧 `k` 标定的 C2 是红的 —— 说明**别的线已经改过那个夹具**，
   不是本轮改好的；本轮对它是零影响，因为它的场景三个属性都显式写了）。
2. **"官方缺属性时到底用什么值"的可观测性**：官方二进制里没有这三个值的硬编码（§1.2 的字节扫描是**有界**扫描：
   只查了 `c7 8? disp32 imm32` 这种"立即数写内存"形态与属性注册路径，不排除寄存器/常量池间接初始化路径），
   所以"官方默认 = 44/44 场景 JSON 的一致取值"是**强推断**（44/44 + UI 无默认 + 引擎无硬编码），不是我能在真机上
   断点验证的事实。
3. **语料扫描的边界**：`allwallpaper/**` 里 **85 个包没有 `scene.json` 条目**（抽查是视频壁纸），它们**没被判定**；
   插件下载缓存 `/root/.dsh-mpkg-wallpaper/*.mpkg` 与 SD 卡语料**没扫**（任务书只点名 `allwallpaper` + 官方 `projects`）。
   因此"缺属性的包 = 0"这句的适用范围严格限于上面扫过的面。
4. **本轮改动的可见效果在语料上是 0**（§2.3）：F1 的 +21px 非零位移是**合成夹具**读数；没有任何真包能证明
   "改后与官方出帧一致"（因为语料里没有触发场景）。
5. **上一轮遗留的残余一条没动**（本轮授权面之外）：顶层祖先的 **origin**（官方 `[x22,#248]`）本仓仍用本层、
   `1−x` 镜像只做在 x 上而本仓 y 同式、指针归一化的夹取时机、官方 Draw 侧没有 `cameraparallax` 门而本仓
   `parEnabled` 会挡住冻结值的消费。详见 `reports/parallax-official-align-20260924.md` §5。
6. **文档行号会漂**：`demo/bench-patch.js` 落点行号（`§6`）在别的线改动该文件后会陈旧，而门禁**不校验行号**。
7. **`influence` 官方取值范围**（是否允许 >1、UI 上限）与 `delay > 3` 的反向外插仍无官方样本可证，与上一轮同。

---

## 9. 复算命令（可原样重跑）

```bash
cd ~/DSHarea/we-scene-demo
node tests/official-parallax-formula-test.mjs        # 37 判据 + 10 组变异（~2s）
node tests/diag-flag-check.mjs                       # 双向 0 差异（183 == 183）/ common=11
bash tests/run-all-tests.sh --only official-parallax-formula parallax-live p76-parallax-eye ptrfx-uniform diag-flags docs-check
node tests/docs-check.mjs

# 语料读数（临时脚本；逐包读、读完释放）
node /tmp/parallax-defaults-scan.mjs | head -40      # 本报告 §2 的原始 JSON
python3 - <<'PY'                                     # 官方 44 个 preview scene.json 的默认值复算
import json,glob,collections
c=collections.defaultdict(collections.Counter)
for f in sorted(glob.glob('wallpaper_engine/assets/effects/*/preview/scene.json')):
    g=(json.load(open(f,encoding='utf-8-sig')).get('general') or {})
    for k in ('cameraparallax','cameraparallaxamount','cameraparallaxdelay','cameraparallaxmouseinfluence'):
        v=g.get(k,'<MISSING>'); v=v['value'] if isinstance(v,dict) and 'value' in v else v
        c[k][repr(v)]+=1
print(dict(c))
PY
```

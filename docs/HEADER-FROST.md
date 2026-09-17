# 标题栏磨砂（header frost）—— 注入链、开关、诊断字段

> 适用版本：`dsh-mpkg-wallpaper` 当前工作区（2026-09-16 第三轮定案：**层叠 + 描边**）。
> 相关代码：`lib/client.js` → `ensureHeaderFrost()` / `syncHeaderFrost()` / `buildCss()` 的 headerFrosted 块 /
> `buildUiCss()` 的 `[data-mpw-hdr-translucent]` 与 `.mpw-hdrFrost` 规则；
> 回归：`node tools/frost-rail-test.mjs`（假 DOM 断言）+ `node tools/header-rail-replica.mjs --both`（真机复刻 A/B）。

## 0. 第三轮定案：磨砂"层存在但看不见"的真根因（2026-09-16）

上一轮修掉了 `normalizeSection` 的 `ReferenceError`（见 §1），真机 diag 随即显示
`headerFrost.injected=true / px=30 / bdf=blur(30px) saturate(1.4) / translucent=true`，
**但用户仍然看不到磨砂**。本轮把链路推到"层在层叠中的位置"，定案如下：

**真根因：注入层用了 `z-index:-1`，而宿主顶栏不是层叠上下文 ⇒ 负层画在顶栏
`background-color` 之下，被那层半透明底色（`rgba(255,255,255,.38)` / 暗色 `rgba(18,22,30,.45)`，
以及主题色 wash）整片盖住，`backdrop-filter` 一点都透不出来。**

证据（全部可复算，非推断）：

| 手段 | 事实 |
| --- | --- |
| 合成实验 `tools/probe-out`（父底 `#1122ff` 不透明 + 子层 `#ff0000`） | `z-index:-1` 采到**父底蓝**（子层被完全盖住）；`z-index:0` / `auto` 采到**子层红** |
| 真机复刻 A/B `tools/header-rail-replica.mjs --both` | 改前 `frostEl.zIndex=-1` 且顶栏底 alpha=0.38；改后 `z-index=0`、`coversHeader=true`、宿主内容层 `z-index=1` |
| 真机 headless 采集 `tools/header-rail-collect.mjs` | 顶栏 `position:relative`、`z-index:auto`、`isolation:auto`、`transform:none` ⇒ **确实不是层叠上下文** |

修法（三件，缺一不可）：

1. `ensureHeaderFrost()` 的内联样式由 `z-index:-1` 改为 **`z-index:0`**
   ⇒ 层画在顶栏背景**之上**、内容**之下**（经典磨砂位置）。
2. `buildUiCss()` **无条件**输出三条层叠规则（不放在任何 `if (headerBg)` 分支里，
   否则"另一档配置下规则消失"会让修复静默失效）：
   ```css
   .mpw-hdrFrost { z-index: 0 !important; background: transparent !important; }
   .wSkVaW_header:has(> .mpw-hdrFrost) > :not(.mpw-hdrFrost) { position: relative; z-index: 1; }
   .mpw-hdrFrost:first-child ~ * { position: relative; z-index: 1; }
   ```
   第二条把宿主顶栏的**直接子节点**抬到 `z-index:1`：它们原本都是 `static/auto`，
   抬升**只改绘制序、不改布局**，保证 `z-index:0` 的磨砂层永远不盖住标题/logo/按钮
   （`?hdrblur=pseudo|element` 等对照路径也照样安全）。
3. 层的背景恒为 `transparent`：半透明底色仍由顶栏承担（`--mpw-hdr-frost-bg` 那条规则），
   避免"底色叠两次"变成两层白纱。

**代价（已知且可接受）**：给注入层 `z-index:0` 会让顶栏成为**层叠上下文**
（`position:relative` + 非 auto 的 z-index 子节点已经足够；`isolation`/`backdrop-filter` 才是
**backdrop root / containing block** 那种有害情形）。层叠上下文只影响"内部谁盖谁"，
**不产生 fixed 后代的 containing block**，所以"设置弹窗被困/浮层模糊失效"那两个历史 bug 不受影响
（`tools/css-matrix.mjs` 的断言仍然全绿）。

## 0b. 回归：顶栏下描边被我们抹掉（同一轮用户实测）

用户原话：「你现在给顶部标题栏，它下面一部分，它的描边你给它去掉了」。归因（**两条规则**）：

| 位置（修复后行号会漂） | 规则 | 后果 |
| --- | --- | --- |
| `buildCss()` headerFrosted 块的 `.wSkVaW_header { background-color: …; }` | 原本带 `border-bottom: 1px solid transparent !important;` | 基础档（任何配置）都把宿主下描边抹成透明 |
| 同函数 `if (headerBg && !headerBlur)` 分支（"透出壁纸且不磨砂"，**用户真机命中的就是这条**） | 原本也带同一条 | 同上，且优先级更高 |

两条**已全部删除**：本插件只改 `background-color`，描边一律交还宿主
（亮色 `1px solid rgba(19,45,83,.26)` / 暗色 `rgba(148,180,220,.32)`；悬浮态圆角外框的下边也随之恢复）。
防复发断言（`tools/frost-rail-test.mjs` PART 1b + PART 3）：
扫**全部设置组合**的产物，禁止出现"选择器命中 `wSkVaW_header/_header_` + `!important` +
`transparent`/alpha=0"的 border 声明；源码级再断言一次。

复刻实测（`tools/header-rail-replica.mjs --both`）：

```
顶栏 border-bottom         改前 1px solid rgba(0, 0, 0, 0)      →  改后 1px solid rgba(19, 45, 83, 0.26)
顶栏 border-bottom alpha   改前 0                              →  改后 0.26
```

## 1. 为什么以前"一直没有效果"（上一轮的真根因，保留记录）

真根因：**`syncHeaderFrost()` 每次调用都在第一行抛 `ReferenceError`，而异常被函数自己的 `catch {}` 吞掉。**

- `syncHeaderFrost()` 是**模块作用域**函数（`lib/client.js:2658` 附近）。
- 它第一行调用 `normalizeSection(readSection())`，而 `normalizeSection` / `__asStr` 当时定义在
  **`applyFromStorageInner()` 的函数体内**（旧行号 ~2696）⇒ 模块作用域里不存在该标识符。
- 该函数整体包在 `try { … } catch {}` 里（刻意吞异常以免影响样式），所以：
  - 磨砂层**从未注入**（真机 diag：`headerFrost.injected = false`）；
  - `lastFrostReason` **从未写入**（真机 diag：`headerFrost.reason = ""`，因为赋值语句在抛错点之后）；
  - `?hdrfrost=off` / `?hdrblur=pseudo|element` 等分支**永不执行** ⇒ 用户"参数没效果"。

复现（对照实验，已固化进回归测试的 `broken-scope` 场景）：

```
# 修复前（HEAD 版本 + 打开 syncHeaderFrost 自身的 catch）
syncHeaderFrost 进入次数 = 1 | 被函数自身 catch 吞掉的异常 = "normalizeSection is not defined"
# 修复后（当前工作区，假 DOM）
【修复后】state = {"injected":true,"px":30,"reason":"…｜半透明底已设｜跟随整屏虚化 30px","translucent":true,…}
```

修法：把 `__asStr` / `normalizeSection` **提升到模块作用域**（`lib/client.js` 中 `applyFromStorage` 之前），
并让 `syncHeaderFrost` 的 catch **把异常写进 `hdrFrostState.reason`**（不再静默）。

## 2. 注入链（"必然可见"方案）

| 环节 | 做法 | 为什么 |
| --- | --- | --- |
| 磨砂层 | header 的第一个子节点 `<div class="mpw-hdrFrost" data-mpw-hdr-frost="1" aria-hidden="true">`，**内联** `position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit` + `backdrop-filter: blur(Npx) saturate(140%)` | 内联样式不受宿主特异性/类名 hash 漂移影响；`z-index:0` 让层绘制在 header **背景之上、内容之下**（`-1` 会被顶栏底色整片盖住 —— 见 §0） |
| 宿主标记 | `header[data-mpw-hdr-frost="el"]` + `body[data-mpw-hdr-frost-el="1"]` | 可被 devtools / 断言直接看到；CSS 用它抑制 `::before` 伪元素方案，**避免两层模糊叠加** |
| 半透明底 | `header[data-mpw-hdr-translucent]` + 我们自己的 token `--mpw-hdr-frost-bg`（亮 `rgba(255,255,255,.38)` / 暗 `rgba(18,22,30,.45)`，JS 按主题写入） | **模糊只有在背后能透出内容时才看得见**；不透明底会把磨砂挡死（历史上"来回修"的真正原因）。底色不再引用宿主静态色 token |
| 伪元素兜底 | `html body:not([data-mpw-hdr-blur-element]):not([data-mpw-hdr-frost-el]) .wSkVaW_header::before` | JS 注入失败（极端环境/找不到 header）时仍有模糊；两层不会同时存在 |
| 层叠上下文防护 | **不给 header 加** `isolation` / `backdrop-filter` / `filter`；顶栏浮层的定位/模糊不受影响 | 这些都会让 header 成为 **backdrop root** 或 **fixed 后代的 containing block** → 顶栏浮层模糊失效 / 设置面板被困（历史 bug，`tools/css-matrix.mjs` 有断言）。磨砂由旁系子节点承担；该子节点 `z-index:0` 只会让 header 成为**层叠上下文**（不改 containing block） |

## 2b. 开销纪律（用户要求"可实现但内存/浏览器开销不要太大"）

| 项 | 做法 | 理由 |
| --- | --- | --- |
| 同步时机 | 只在**状态变化时**同步一次：`applyFromStorageInner()`（任何设置提交/壁纸切换/主题翻转都会重入）里调 `syncHeaderFrost()`；另有主题翻转钩子（`data-ds-dark-theme` 变化）各调一次 | 磨砂是"配置 + 主题"的函数，不需要跟滚动/动画/每帧走 |
| 低频保险 | `setInterval(syncHeaderFrost, 3000)`（单实例，`__mpwHdrFrostGuard` 守卫） | 宿主热重载/React 重建顶栏时可能把注入层挤掉；3s 一次的空转成本 ≈ 1 次 `querySelector` + 1 次 `getComputedStyle`，远低于一帧渲染。**①(2026-09-17) 它仍是兜底，但不再是唯一补救**：结构变化由下面的窄观察器即时触发（见 §7） |
| 结构自愈（①2026-09-17 新增） | 在**稳定会话容器**（`[data-slot="main.conversation"]`/`[data-slot="main"]`）与当前顶栏的父节点/自身上挂 **childList-only** 的 `MutationObserver`（**不开 `subtree`**），命中后去抖 50ms 同步一次 | 切会话时宿主把顶栏三个节点整块重建（真机实测），只靠 3s 保险会让磨砂"消失 0～3 秒"（用户实测 ≈3s）。窄观察器真机空闲 3s **0 次回调**，且 `?hdrfrostwatch=off` 可一键回退 |
| 不做的事 | **不装全树 `MutationObserver`**（只在上面那几个稳定锚点上观察"直接子节点"）、不监听 `scroll`/`resize`/`pointermove`、不做 requestAnimationFrame 轮询、不在高频路径里反复 `getComputedStyle` | 全树观察在 DSH 这种长列表页面上开销与风险都高（每次 DOM 变更都要回调） |
| rail 侧 | 只在 `applyFromStorageInner()` / web 壁纸路径 / 主题翻转时各调一次 `refreshRailInk()`（写 3 个 CSS 变量 + 1 个 body 属性） | 与磨砂同一节拍；变量只写 `documentElement`，浏览器只在下一帧重算一次样式 |

## 3. 门控语义（可预期、可回退）

| 场景 | 行为 |
| --- | --- |
| 默认（无参数） | **有壁纸 → 磨砂 + 半透明底**（不必先猜对 `headerBlur`/`headerBg`/`unifyTint`）；用户显式动过磨砂/顶栏开关（`headerFrostUserSet`）→ 完全按他的选择 |
| `?hdrfrost=legacy` | 回到旧门控 `(headerBlur || unifyTint) && headerBg`（一键回退旧行为） |
| `?hdrfrost=off` | **彻底关闭**磨砂链（清注入层 + 清半透明属性 + 清 body 标记，不留残留） |
| `?hdrblur=pseudo` | 对照模式：撤掉注入元素，走宿主 `::before` 伪元素 |
| `?hdrblur=element` | 对照模式：走"header 本体 backdrop-filter"旧路径 |
| `wanted=false` / `px<=0` | **清理**（绝不留下一个 `backdrop-filter:none` 的空层——空层会抑制伪元素兜底，反而彻底没磨砂） |
| `headerBg=false` | **不注入磨砂层**（该档语义是"顶栏不透明、不透出壁纸"，此时模糊层要么透不出、要么与用户选择相反；描边与底色全部交还宿主） |

半径下限：`headerFrostOwn` 开 → `headerFrostAmount`（≥8px）；`unifyTint` 开 → `unifyAmount`（≥12px）；
否则 `headerBlurAmount`（≥12px，缺省 24px）。

## 4. 诊断字段（`POST /diag` → `.dsh-mpkg-wallpaper/diag-*.json`）

`headerFrost` 对象（缺字段=该环节没跑到）：

| 字段 | 含义 |
| --- | --- |
| `hostHasHeader` | 是否找到宿主 header（`.wSkVaW_header` → `header[class*="_header_"]` → `header`） |
| `injected` | `.mpw-hdrFrost` 是否真的在 DOM 里 |
| `px` | 注入的模糊半径（元素上的 `__mpwBlurPx`） |
| `bdf` / `wk` | 注入层 computed `backdrop-filter` / `-webkit-backdrop-filter` |
| `rect` | 注入层位置尺寸（判"是否有尺寸/被裁"） |
| `z` / `pos` | 注入层 computed `z-index` / `position` |
| `headerRect` | 宿主 header 位置尺寸 |
| `pseudoBdf` | header `::before` 的 computed backdrop（伪元素兜底是否在） |
| `mode` | `child`（默认/元素方案）、`pseudo`、`element` |
| `reason` | **为什么开/为什么关**（人来读的一句话；异常也会写在这里） |
| `translucent` / `headerTranslucent` | header 是否带 `data-mpw-hdr-translucent`（半透明底是否生效） |
| `computed.headerBg` | header computed 底色（**不透明 = 磨砂必然看不见**） |
| `computed.headerBackdrop` | header 本体 backdrop（应为 `none`） |
| `computed.frostElBackdrop` / `frostElZ` | 磨砂层 backdrop / z-index |
| `state` | JS 侧快照 `hdrFrostState`（`injected/px/reason/translucent/mode/hostHasHeader/headerBg/headerBackdrop/frostElBackdrop`） |

**一次上报即可定案**：`hostHasHeader=false` → 找不到顶栏；`injected=false` + `reason` 有文案 → 门控/清理；
`injected=true` + `bdf=none` → 半径算成 0；`bdf=blur(..)` + `translucent=false` → 半透明底没挂上（模糊被底挡）；
`computed.headerBg` 不透明 → 底没生效。

## 5. 验收

- 无浏览器（自动化）：`node tools/frost-rail-test.mjs` —— 8 个假 DOM 场景 + **PART 1b 三段新增防复发断言**
  （每个设置组合都查：下描边未被我们抹透明 / rail 覆盖带反色晕且无 `!important` 且不碰宿主 token /
  磨砂层 `z-index:0` + 宿主内容被抬到 `z-index:1`），全绿。
- **真机复刻 A/B（本机可跑，且是判定"磨砂到底可不可见"的主证据）**：
  `node tools/header-rail-replica.mjs --both` —— 真宿主顶栏 CSS + **真插件 `buildCss()` 产物** +
  无头 Firefox 取 computed；`before` 变体把本轮修复逐条还原，双向断言（before 必须测到旧 bug、
  after 必须测到已修复）⇒ 探针自身有分辨力。证据：`tools/probe-out/replica-ab.txt`。
- 真机页面采集：`node tools/header-rail-collect.mjs --label after [--wall <png>]`
  —— 直接开 `http://127.0.0.1:3080/` 取顶栏/磨砂层/rail 的 computed 与几何，
  落盘 `tools/probe-out/<label>.collect.{json,txt}`。
- **仍需真机确认（未验证项）**：自动化能证明"层在父背景之上、有尺寸、覆盖整个顶栏、
  `backdrop-filter` 计算值正确、宿主内容在层之上"，**不能**证明在当前壁纸/主题/缩放下
  `backdrop-filter` 的**观感强度**（30px 是否够/是否过糊）。请在真机确认并把 `?diag` 的
  `headerFrost` 段贴回（含 `computed.frostElBackdrop` 与 `computed.headerBg`）。

## 6. 像素判据的边界（为什么本机不拿截图当判据）

本机（无 GPU 容器）的无头 Firefox 里 `CSS.supports('backdrop-filter','blur(1px)') === true`，
但**不合成** backdrop-filter。对照实验（`/tmp/mpw-exp/exp5.html`，5 个完全相同的半透明面板，
分别 `backdrop-filter: none / blur(10px) / blur(30px) / blur(30px)+isolation / blur(30px)+will-change`）：

```
R1 none                mean=(234.7,197.3,197.3) span=124 jumps=79
R2 blur30              mean=(234.7,197.3,197.3) span=124 jumps=79   ← 与 R1 逐像素相同
R3 blur10              mean=(234.7,197.3,197.3) span=124 jumps=79
```

⇒ 在本机"模糊有没有画出来"**无法**用像素判定（`tools/hdr-probe.mjs` 的 F 断言因此是假阴性：
真机实测 `meanAbsDiff=0.014`，与"完全没变"同级）。真机（用户设备，Firefox/Via 有 GPU）不受此限。
所以本仓库的判据分两层：**结构/层叠事实**用本机探针（本文件 §5 的两条），
**观感强度**留给真机确认。

## 7. 切会话时磨砂"先消失、约 3 秒才回来"（2026-09-17 真机定案 + 修复）

用户原话（翻译）：「在标题栏里切换主会话和子代理会话时，**顶栏磨砂先消失，大约三秒后才回来**，
两个方向都这样（主→子代理、子代理→主）。」

### 7.1 真机取证（无头 Firefox + 真实页面，探针在 /tmp 侧、不进本仓库）

方法（可复跑，Cookie 由 `tools/hdr-probe-mint-cookie.mjs` 生成）：

```bash
mkdir -p /tmp/ffprobe
node tools/hdr-probe-mint-cookie.mjs --authority 127.0.0.1:3080 --out /tmp/ffprobe/cookie.json
# ① 相位对齐最坏情况：等 3s 定时器刚把层补回 → 立刻删掉它 → 测恢复（确定性，不受相位运气影响）
# ② 真实路径：点左侧会话列表切会话；③ 模拟宿主重挂载：把 header 节点换成克隆
node /tmp/hdrwatch/measure2.mjs --mode align|click|cloneheader --trials 3 --label before|after
```

| 事实 | 证据 |
| --- | --- |
| 补挂磨砂层的**唯一**路径是 3s 低频保险 | 拦截 `Node.prototype.insertBefore` 抓到调用栈：`setInterval handler → applyFromStorageInner → syncHeaderFrost → ensureHeaderFrost`（`lib/client.js:3698` 的 `setInterval(…, 3000)`），**没有任何结构变化路径参与** |
| 相位对齐最坏情况 | 改前 **2996 / 3000 / 3000 ms**；改后 **66 / 67 / 67 ms** |
| 直接删掉注入层（模拟 React 重渲染挤掉子节点） | 改前 339 ms（相位运气好）～3000 ms；改后 **60 / 61 / 61 ms** |
| 模拟宿主重挂载（`header.replaceWith(clone)`） | 改后 **34 / 59 / 60 ms** |
| 真实点侧栏切会话 | 改前 **347 / 1696 / 1741 ms**（= 3s 保险的相位分布）；改后「新顶栏挂上文档 → 磨砂回到新顶栏」Δ = **85 / 266 / 290 ms**（其余时间是宿主自己重建顶栏，见下） |
| 回退开关自证 | 同一份修复后构建 + `?hdrfrostwatch=off`：**3004 / 3013 ms**（完全复现旧行为） |

结构取证（哪一步把我们的层弄丢）：一次会话切换会让 `header.wSkVaW_header`、
`[data-slot="conversation.session.header"]`、`.wSkVaW_root` **三个节点同时换成新节点**；
`[data-slot="main.conversation"]`（及其上溯 `[data-slot="main"]`）**跨会话保持同一节点**。
节点级时间线（探针拦截 appendChild/insertBefore）：新顶栏在 +38ms 就被"造"出来，
但要到 +402ms 才挂进文档，我们的层在 +452ms 补上 ⇒ **磨砂的可见空窗主要是宿主重建顶栏的时间**，
我们这一侧只占 50ms 去抖 + 一次同步。

### 7.2 根因（机制 + 行号）

1. `.mpw-hdrFrost` 是**我们注入到宿主顶栏里的子节点**（`lib/client.js:3520` 附近的
   `ensureHeaderFrost()`：`hdr.insertBefore(el, hdr.firstChild)`）。
2. 宿主在切会话时**整块重建顶栏节点**（三个节点全换，见上）⇒ 注入层随旧顶栏一起被丢弃。
3. 补挂时机当时只有两处：设置/主题变化时同步一次（`lib/client.js:3687`）和
   **3s 低频保险**（`lib/client.js:3698`）。切会话这两个都不触发 ⇒ 只能等下一次滴答，
   表现为"消失 0～3 秒"（用户看到的是最坏情况 ≈3 秒）。

### 7.3 修法（最小改动，**不新增轮询/网络/依赖**）

`lib/client.js` 新增 `armHeaderFrostWatch()` 一族（`lib/client.js:3403-3480` 附近），挂
**childList-only** 的 `MutationObserver`（不开 `subtree`）：

| 观察目标 | 覆盖的失效方式 |
| --- | --- |
| `[data-slot="main.conversation"]`、`[data-slot="main"]`（稳定容器） | 顶栏整块重建（`.wSkVaW_root` 被换成新节点） |
| 当前顶栏的父节点 | 顶栏节点本身被换 |
| 当前顶栏自身 | 宿主原地重渲染，把我们的层从子节点列表里挤掉 |

命中后：忽略"仅仅新增了我们自己的磨砂层"的自触发 ⇒ **去抖 50ms**（用 `setTimeout` 而不是
`requestAnimationFrame`：后台标签页的 rAF 会被暂停，而"切会话"完全可能发生在后台标签页）⇒
`syncHeaderFrost()` 一次。3s 低频保险**保留**作兜底。

* **幂等**：观察器实例 + 目标表放在 window 级单例 `window.__mpwHdrFrostWatch`（与
  `__mpwHdrFrostGuard` / `__mpwStyleWatch` 同风格）；目标没变就复用，绝不堆第二个；
  构造器被换（宿主 HMR / 测试桩）才重建。
* **开销**：真机实测 3s 空闲窗口 **0 次回调**；3 次会话切换期间该子树
  `childList+subtree` 也只有 280 条，而我们只观察"直接子节点"（不跟消息流）。
* **关掉就消失**：总开关关闭 / `?hdrfrost=off` / `headerBg=false` / `px<=0` / `?hdrblur=pseudo|element`
  一律 `disarmHeaderFrostWatch()`（`disconnect()` + 状态清零），不留观察器、不留回调。
* **回退开关**：`?hdrfrostwatch=off` ⇒ 完全退回"只有设置/主题变化 + 3s 保险"的旧行为
  （真机实测 3004/3013ms，见 §7.1 表）。
* **诊断**：`POST /diag` 的 `headerFrost.watch`（`armed` / `targets` / `hits` / `queued` / `off`）
  + `hdrFrostState.watch/watchTargets/watchHits`。**`hits` 增长即证明"这次是观察器补的，不是 3s 定时"**
  （真机上点一次会话 `hits` +1）。

### 7.4 回归（红/绿有分辨力）

`node tools/frost-rail-test.mjs` 新增两个场景（PART 2）：

| 场景 | 装置 | 断言 |
| --- | --- | --- |
| `remount` | 假 DOM 复刻真机结构 `div[data-slot="main.conversation"] > header.wSkVaW_header`；把 `MutationObserver` 换成**可手动触发**的桩；手动派发"顶栏被换成新节点"的 childList 变更 | 观察器已挂载 / 目标 ≥2 / 连调 5 次 `sync` 不新建实例（不堆叠）/ **顶栏重建后磨砂自己回来**（< 300ms）/ 由观察器触发（`hits ≥ 1`）/ 新顶栏被重新标记 + 半透明底补上 |
| `remount-before` | 把源码里 `armHeaderFrostWatch()` 那一行删掉的**变异副本**（`mkdtemp` + 退出即删） | 反向对照：观察器未挂载、层**没有**回来、`hits = 0` |

关键点：**测试进程里 `setInterval` 是空桩**（`tools/_stub.mjs`）⇒ 3s 保险根本不存在，
层丢掉后能补回来的唯一通路就是自愈观察器 ⇒ 断言天然有分辨力。
判别力实测：临时删掉源码里的 `armHeaderFrostWatch()` 调用行后，同一测试
**14 项断言变红**（`[default]`/`[remount]`/`[remount-before]`），恢复后 0 项失败。

### 7.5 未证实 / 边界

* 本机无 GPU + 无头 Firefox 不合成 `backdrop-filter`（见 §6）⇒ 本节所有数字都是**结构与时间**证据，
  "用户眼里这三秒有多明显"仍需真机观感确认。
* 真实点击路径的 Δ = 85～290ms（不是恒定的 50～70ms）：素材来自"宿主把新顶栏分多次提交进文档"，
  我们只能在**最后一次结构变更**后再补（每次补挂仍 ≤ 一帧 + 50ms 去抖）；换更激进的 0 去抖会变成
  "每个 mutation 批次都做 DOM 查询"，与 §2b 的开销纪律冲突，故不做。
* 若宿主未来把顶栏搬到 `[data-slot="main.conversation"]`/`[data-slot="main"]` 之外的位置
  （即上面两个稳定锚点也失效），自愈会退回 3s 保险的频率 —— 届时诊断字段
  `headerFrost.watch.targets` 会先变小（1）可作为预警。

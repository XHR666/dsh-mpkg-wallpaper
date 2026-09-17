# 表面 token 命名空间（`--mpw-*`）—— 顶栏 / 侧栏 / 面板 / 时间线条 的统一来源

> 需求来源：`docs/MASTER-TODO.md` §5 第 1 项（P0-3）
> 「磨砂/主题一致性彻底解决：顶栏、侧栏、面板、时间线四处视觉一致性用**同一套 token 命名空间**
> （`--mpw-*`），永不覆盖宿主 token ⇒ 从结构上消灭"我们弄坏宿主新功能"这类 bug」
>
> 机器判据：`tools/style-scope-guard.mjs`（作用域 + 宿主 token 覆盖登记表 + 四表面接线）
> 与 `tools/token-namespace-test.mjs`（before↔after 取值等价 + SSOT 定义点 + 分辨力自证）。

## 0. 一句话结论

插件**唯一**会写出 `--mpw-surface-*` 值的地方是 `lib/client.js` 的 `emitSurfaceTokens()`
（登记靠 `tok()`，输出成产物里唯一那一块 `body { … }`）；**四个表面只写 `var(--mpw-surface-*)`**，
规则里不再出现 `var(--dsw-*)` 用在底色/磨砂/模糊上。全插件**唯一**一处宿主 token 覆盖是
`buildSidebarFillCss()`（见 §3）。

## 1. 为什么 SSOT 打在 `body` 而不是 `:root`（**踩过就会再踩**）

DSH 把设计 token 定义在 **`body`** 上，不是 `:root`：

* `@deepseek-ai/dsh-client-ui-theme/lib/client.js` 的 `design_platform_css_default`：
  `body{--dsw-static-neutral-bluish-00:#fff; … --dsw-static-neutral-bluish-950:#151517; …}`
  与 `body[data-ds-dark-theme]{…}`；
* 别名层同样是 `body{--dsw-alias-bg-base:…;--dsw-alias-label-primary:…}`。
  实测 `html` 上没有这些定义（`node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-*.css`
  里只有**使用**没有定义）。

自定义属性里的 `var()` 是在**声明所在的那个元素**上求值的（本条登记的 id 是 `root:surface-token-ssot`）。所以如果写成
`:root { --mpw-surface-panel: var(--dsw-static-neutral-bluish-00); }`：

1. 在 `html` 上 `--dsw-static-neutral-bluish-00` 不存在 ⇒ 该自定义属性成为
   **guaranteed-invalid**；
2. 它作为**继承值**传给 `body` 及所有后代（后代上再定义也没用，除非重新声明该变量）；
3. 于是所有 `background-color: var(--mpw-surface-panel)` 在 computed-value time 失效
   ⇒ `unset` ⇒ 透明。

这正是本仓历史上「右侧轮次导航条变透明」的同一机制（`docs/TIMELINE-RAIL-TOKEN.md` §2/§5）。
**结论：SSOT 必须打 `body`。** `tools/token-namespace-test.mjs` 断言 B 与
`style-scope-guard.mjs` 的 `ROOT_POLICY.registeredRootTokenRules` 一起把这件事钉住
（把 SSOT 挪回 `:root` 的变异必须变红）。

## 2. 表面 token 清单（token → 谁定义 → 谁消费）

「定义」= `lib/client.js` 的 `tok()` 调用点，最终由 `emitSurfaceTokens()` 汇总输出为
产物里唯一那一块 `body{…}`。四个表面的**取值**因此只有一个来源。

| token | 归属表面 | 值怎么来的（宿主 token 消费点） | 谁来消费 |
| --- | --- | --- | --- |
| `--mpw-surface-frost-top` | 顶栏 | `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) <hdrAlpha>%, transparent)` | `.wSkVaW_header { background-color }` |
| `--mpw-surface-frost-top-light` | 顶栏 | 同上，`…-bluish-00`（亮色档） | `body:not([data-ds-dark-theme]) .wSkVaW_header` |
| `--mpw-surface-opaque-top` / `-dark` | 顶栏 | `var(--dsw-static-neutral-bluish-00 / -950)` | 「标题栏透出」关档的两条规则 |
| `--mpw-hdr-blur` | 顶栏 | 磨砂半径（`headerFrostOwn` / `unifyAmount` / `headerBlurAmount` 三档推导） | `.wSkVaW_header::before { backdrop-filter }` |
| `--mpw-surface-side` / `-dark` | 侧栏 | `color-mix(… bluish-950 / bluish-00 …)`（统一虚化档与默认档不同，逐字保留） | `html body .pI_x6G_sidebarCol, html body [class*="sidebarCol"]…` |
| `--mpw-surface-side-unify-light` | 侧栏 | `color-mix(… bluish-00 …)`（统一虚化的亮色覆盖） | `body:not([data-ds-dark-theme]) .pI_x6G_sidebarCol, …` |
| `--mpw-surface-side-frost` | 侧栏 | `rgba(var(--mpw-chrome-bg), var(--mpw-chrome-alpha))` | H 块左栏磨砂规则 |
| `--mpw-surface-side-plugin` | 侧栏 | `color-mix(… var(--dsw-alias-bg-base) 45% …)` | `[data-slot="sidebar"] [data-plugin]` |
| `--mpw-surface-opaque-side` / `-dark` | 侧栏 | `var(--dsw-static-neutral-bluish-00 / -950)` | 「侧栏透出」关档；也是 `--dsw-specific-sidebar-fill` 覆盖的值 |
| `--mpw-surface-host-side` | 侧栏 | `var(--dsw-specific-sidebar-fill)`（**无壁纸档把底色交还宿主**） | 无壁纸分支的 `.pI_x6G_sidebarCol, .hHd-Xa_root` |
| `--mpw-chrome-blur` / `-alpha` / `-bg` | 侧栏 | 侧栏磨砂半径 / 白雾透明度 / 底色 RGB | H 块、弹层底色 |
| `--mpw-rs-blur` / `-alpha` | 侧栏（右栏） | 「右侧边栏/dock 虚化」条 | `[data-sidebar-right-panel] [data-dockkit-*]` |
| `--mpw-surface-rs-dock` / `-dock-dark` | 侧栏（右栏） | `rgba(<chromeBg>, calc(var(--mpw-rs-alpha) * 0.55))` / `rgba(18,22,30, calc(… * 0.75))` | 右栏/dockkit 面板 |
| `--mpw-surface-rs-full` | 侧栏（右栏） | `rgba(var(--mpw-chrome-bg, …), calc(var(--mpw-rs-alpha, .45) * .55))` | 右栏全屏 `[data-rightbar-fullscreen]` |
| `--mpw-surface-panel` / `-dark` | 面板 | `var(--dsw-static-neutral-bluish-00 / -950)` | `[role="dialog"], [role="alertdialog"]`；`settingsArea` 兜底 |
| `--mpw-surface-panel-frost` / `-dark` | 面板 | `color-mix(… bluish-00 / -950 80% …)` | overlay 内对话框、设置面板磨砂 |
| `--mpw-surface-dialog-dark` / `-light` | 面板（本插件弹窗） | `var(--dsw-static-neutral-bluish-950 / -00)` | `.mpw_dialog` |
| `--mpw-surface-dialog-frost-dark` / `-light` | 面板（本插件弹窗） | `color-mix(… 80% …)` | `.mpw_dialog`（虚化档） |
| `--mpw-surface-pop` / `-dark` | 面板（弹层） | `rgba(var(--mpw-chrome-bg,…), var(--mpw-pop-alpha, <滑条>))` / `rgba(18,22,30, …)` | 菜单/下拉/提示/`[data-dsh-surface]` |
| `--mpw-surface-composer` / `-light` | 面板（输入框） | 字面量 `#1b2233 42%` / `#dde3ee 55%` | `[data-composer-card]` |
| `--mpw-surface-glass` / `-dark` | 面板（设置右区） | `color-mix(… bluish-00 / -950 62% …)` | `.mpw_glassHost` |
| `--mpw-surface-content` / `-unify-light` | 面板（内容区） | `color-mix(… bluish-950 / --dsw-alias-bg-base …)` | `.ydkMvW_root` |
| `--mpw-surface-plugin-panel` / `-unify-light` | 面板（宿主插件面板） | `color-mix(… bluish-950 / bg-base 62% …)` | `[data-cordis-panel]` |
| `--mpw-surface-plugin-row` / `-unify-light` | 面板（同上，行） | `color-mix(… 55% …)` | `[data-cordis-panel] [class*="row"]` |
| `--mpw-rail-ink` / `-ink-strong` / `-halo` | 时间线条 | **由 JS 写在 `documentElement` 内联样式上**（`refreshRailInk()`，按亮/暗取反色） | `body[data-mpw-rail-ink]` 门控下的 `.eGxaPq_*` 对比补偿 |

关于时间线条为什么由 JS 而不是 CSS 定义：条的颜色要跟着**当前壁纸的明暗**走，而壁纸换图时
不重建样式表（重建会带来闪烁与 React 重渲染风险）⇒ 只有这一处例外，值仍然只写一次
（`refreshRailInk()` 一个函数），并且**只在 `body[data-mpw-rail-ink]` 门控下生效**
（`docs/TIMELINE-RAIL-TOKEN.md`）。

## 3. 宿主 token 覆盖登记表（**唯一允许的越界**）

全插件只有 `lib/client.js` 的 `buildSidebarFillCss()` 会写宿主 token。判据在
`tools/style-scope-guard.mjs` 的 `HOST_OVERRIDE_REGISTRY`：产物里**每一处**把 `--dsw-*`
当属性名写的声明都必须命中一条登记项（token + 选择器 + 值形态 + **生效条件**），未命中判红；
而且**生效条件为假的组合里必须一次都不出现**（机器证明"覆盖不会漏进默认档"）。
当前实测：产物里宿主 token 覆盖声明 **39 处，39 处登记命中（6 条登记项）**。

| # | 登记 id | token | 生效条件（feature） | 为什么必须保留 / 允许 |
| --- | --- | --- | --- | --- |
| 1 | `ovr:sidebar-fill-translucent` | `--dsw-specific-sidebar-fill` = `transparent` | 「侧栏透出壁纸」开（`sidebar`，默认开） | DSH 侧栏**内层**（工作区/会话列表/侧栏根）自己用这个 token 上底色。只改显式规则时内层会再叠一层半透明块（用户实测"出现一个深灰色半透明块"）⇒ 要让开关真的生效只能改这一个 token。选择器已收窄到侧栏白名单（`?sbfill=wide` 才回退旧的全局写法） |
| 2 | `ovr:sidebar-fill-opaque` | `--dsw-specific-sidebar-fill` = `var(--mpw-surface-opaque-side[-dark])` | 同上功能**关**（`sidebar === false`，含 lgTest 档） | 关掉透出时若不把 token 还原成不透明，内层仍会透一点 ⇒ 用户观感"开关没用"（2026-09-13 真机实测）。值来自我们自己的表面 token，不再引第二处宿主 token |
| 3 | `ovr:font-color-gray` | 17 枚 `--dsw-alias-label-*` / `--dsw-alias-line-secondary` / `--dsw-alias-border-{secondary,l2,l3}` / `--dsw-alias-state-warn-label` | `fontColorGray` 开 **且** 选了合法 `#RRGGBB` | 「自定义灰字颜色」功能本体：要把整套灰字换成用户选的色。**只在用户显式选色时**生效（未开/未选色保持主题灰 = 关闭态，与用户"关=默认"的要求一致） |
| 4 | `ovr:aqua-ink-brand` | 8 枚 `--dsw-alias-label-*` / `brand-*` / `state-business-primary` | Aqua 实验模式（`aquaMask‖aquaTint‖aquaInk`） | Aqua 的自适应文字/品牌色。门控选择器 `body[data-mpw-aqua][data-mpw-aqua-ink]`——**只有 JS 真把 ink 写进 `--mpw-aqua-ink` 时才打**（曾经的 `var(--mpw-aqua-ink, inherit)` 兜底会把宿主 token 设成 `inherit` ⇒ guaranteed-invalid ⇒ rail 变透明，见 `docs/TIMELINE-RAIL-TOKEN.md`） |
| 5 | `ovr:accent-brand` | 5 枚 `--dsw-alias-brand-*` / `button-info-*` / `state-business-primary` | 同 Aqua 段（见「已知偏差 ①」） | 「配色」(accent) 功能：品牌交互色/发送键用所选色。门控 = `body[data-mpw-accent]`（运行时属性） |
| 6 | `ovr:text-ink-adaptive` | 6 枚 `--dsw-alias-text-*` / `label-*` | 同 Aqua 段 | 亮度自适应文字色：按壁纸感知亮度把文字 token 换成 `--mpw-text-ink*`。门控 = `body[data-mpw-aqua-text][data-mpw-text-ink]`；**没有自引用 fallback**（自引用会构成循环 ⇒ guaranteed-invalid ⇒ 整片失色） |

共同约束（都已经被机器验证到）：值**永不是** `inherit` / `unset` / 空；
**永不碰** rail 家族（`--dsw-alias-border-l4` / `--dsw-alias-label-primary` 在
`TOKEN_POLICY.railTokens`）；未登记的 `--dsw-*` 覆盖一律判红。

### 已知偏差

1. ~~`ovr:accent-brand` / `ovr:text-ink-adaptive` 与 Aqua 段同一处输出 ⇒ 只开「配色」/「深底文字
   可读增强」时规则不生成（功能静默无效）。~~ ✅ **已修（2026-09-18）**：两段各按自己的开关生成
   （`accentConfigured` / `textEnhanceOn`，分段顺序逐字节保留，因为发送键在 accent 与 aqua 下有
   两条同特异度 `!important` 规则）；登记表的生效条件同步改成真实条件。判据是**双向**的：
   `token:override-leaked`（不许漏进关闭档）+ `token:override-missing[-cases]`（条件为真的组合里
   必须真的出现 —— 就是这条抓住了"整段被别的开关包住"）；变异自证见下方。
2. 原始需求里提到的 `color-mix(in srgb, var(--dsw-alias-bg-layer-1) 62%, transparent)` 只是**写法示例**：
   本插件实际用的是 `--dsw-static-neutral-bluish-*` 静态色（理由写在 `lib/client.js` 的
   表面 token 注释里：静态色不受 aquaTint 的 token 覆盖影响）。

### 3b. 同一轮审计**新发现**、登记为「未修」的失效开关

`tools/switch-wiring-test.mjs`（门禁第 2 步）会枚举每个开关并要求它真的改变产物，因此顺手查出
同类的"开关没接线"。这三条**没有修**（改动会启用从未运行过的整块视觉特性，需要单独一轮 + 真机验证），
审计每次运行都会显式列出，且**双向断言**（修好了就必须从 `KNOWN_DEAD` 删掉）：

| 开关 | 现象 | 证据 |
| --- | --- | --- |
| `lgCss`（纯 CSS/SVG 液态玻璃） | **整块从未执行**：块内第 6079 行引用 `bdSupported`，而该 const 在 6304 行才声明 ⇒ 同一函数作用域 TDZ `ReferenceError`，被外层 `catch { /* 液态玻璃失败不得影响其它样式 */ }` 吞掉。默认关+有壁纸+支持 backdrop-filter 也不产出任何规则 | 产物里永远没有 `url(#mpw-lg-warp)`；`lgCss:true` 与 `lgCss:false` 逐字节相同（`tools/switch-wiring-test.mjs` A2 段每次打印） |
| `sessionFollow`（新会话按钮跟随） | 设置页有开关（`lib/client.js:11227 toggleRow`）与文案，但**全仓没有任何地方读 `section.sessionFollow`** ⇒ 点了没效果（6989 行注释声称"随 sessionFollow"，实际无条件用 `U(panel)`） | `grep -n "section\.sessionFollow" lib/client.js` ⇒ 无匹配 |
| `glassWindow`（设置窗口液态玻璃） | 只有 i18n 文案 + 导入净化名单，**既无开关也无读取点** ⇒ 功能未接线 | `grep -n "glassWindow" lib/client.js` ⇒ 仅 i18n 与 `boolFields` 名单 |

修 `accent` / `aquaTextEnhance` 那两条时的**变异自证**（`node tools/switch-wiring-test.mjs`）：

```
== C. 分辨力自证：把门控改回"被 aquaOn 包住"必须变红 ==
  ✓ 变异 accent-gate-reverted：期望变红，实际 RED   [exit=1]
  ✓ 变异 text-enhance-gate-reverted：期望变红，实际 RED   [exit=1]
```
护栏侧另有对称判据的变异证据（`node tools/style-scope-guard.mjs --client /tmp/mut-accent-revert.js`）：
```
↳ token:override-missing-cases：登记项 ovr:accent-brand 的生效条件在这些组合里为真，
  但产物里没有对应的 --dsw-alias-brand-primary 声明：单开:accent / accent+文字增强
```

## 4. 判据与自证（怎么跑、看到什么算过）

```bash
# ① 作用域 + 宿主 token 覆盖登记表 + 四表面接线（门禁第 12 步）
node tools/style-scope-guard.mjs
node tools/style-scope-guard.mjs --selftest      # 13 条变异（含 3 条 token 命名空间变异）
# ② before↔after 取值等价 + SSOT 定义点 + 分辨力自证
node tools/token-namespace-test.mjs
```

`tools/token-namespace-test.mjs` 的口径（**未证实什么，一并写清**）：

* 用 `git show HEAD:lib/client.js` 当 before、工作树当 after，各跑 **606 组设置**；
* 对"表面容器本身的底色/磨砂/模糊"声明做**极小层叠模型**
  （亮/暗上下文 × 默认/门控两态 × 选择器特异度 × 源码顺序）取生效值，
  再用产物里自己的 token 定义**递归代换 `var()`**（宿主自定义 token 保持符号名），
  **13 324 个 (状态, 亮/暗, 表面, 属性) 键逐键相等** ⇒ 这次是重构、不是重设计；
* 本机**无 GPU**，无头 Firefox 不合成 `backdrop-filter` ⇒ 本判据**不声称任何像素结论**；
  真机像素/观感仍需用户确认（见 §5）。

## 5. 本判据**没有**覆盖的部分（需要真机）

* 真实 DevicePixelRatio / GPU 下的磨砂观感（本机 `backdrop-filter` 不合成）；
* 宿主版本升级后新增的、使用这些 token 的组件（我们只保证不再**全局**改宿主 token）；
* `--mpw-rail-*` 三枚由 JS 按壁纸亮度写入，其"取反色是否够对比"只能真机看。

## 6. 怎么加一枚新 token（给下一个人）

1. 值在**推导点**算好后调 `tok("--mpw-surface-xxx", value)`（不要复制公式）；
2. 表面规则里只写 `var(--mpw-surface-xxx)`；
3. 若这枚 token 属于某个表面，把它加进 `tools/style-scope-guard.mjs` 的 `SURFACES[].tokens`
   与 `tools/token-namespace-test.mjs` 的同名清单，并在 §2 表格补一行；
4. 需要新的**宿主 token 覆盖**时：先在 `HOST_OVERRIDE_REGISTRY` 登记（token + 选择器 +
   值形态 + `feature()` + reason + 本文档行号），再写代码；并把本文档 §3 表格补一行。

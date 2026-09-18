# `glassWindow` 的处置：**退役删除**（不留"看得见却点不动"的死文案）

> 2026-09-19。来源：`../docs/ANSWER-REMAINING-AND-API-20260918.md` §3 **S-4**（`:354`，原文"二选一"，
> 标**需用户拍板**）＋ 用户本轮给的政策与授权：**「不留"看得见却点不动"的死文案」**、
> **「一些你能做决定的就自己做决定」**（但**要留证据**）。
> 编号：**P-128**（P-123…P-126 已被并行线占号，P-127 是本轮 ① 发布面；见
> `docs/PUBLISH-SURFACE-LIQUID-GLASS.md` 的编号说明）。

---

## 1. 决定：删除（S-4 的 (B)），**不接线**（(A)）

### 1.1 先纠正 S-4 的一句话前提

S-4 把 `glassWindow` 描述成"看得见、点不动的死文案"，实测**不成立**：它**没人看得见**。
`lib/client.js` 里 `glassWindow` 只有 **6 处**，**没有一处渲染**：

| 处 | 位置（改动前） | 是什么 |
|---|---|---|
| 1 | `:5964` | `lgTest` **测试模式预设**的一个键（`clockSec: …, glassWindow: false`） |
| 2 | `:10017` | **重置所有默认设置**的对象里的一个键 |
| 3 | `:10035` | `BACKUP_FIELDS`（导出/导入字段表）里的一个名字 |
| 4 | `:10077` | 导入时的**布尔净化名单** `boolFields` |
| 5 | `:12367-12368` | zh 字典 `glassWindow` / `glassWindow.desc` |
| 6 | `:13035-13036` | en 字典同上 |

**没有 `toggleRow(...)`、没有 `section.glassWindow` 读取点、没有 `t("glassWindow")` 调用点**
⇒ 那两行文案**从不进 DOM**，用户既看不到也点不到。所以"删掉"对用户**零可见影响**。

### 1.2 为什么选"删"而不是"接线"（四条理由，按权重）

1. **功能已被别的开关覆盖**：它文案承诺的是"整个设置卡片/弹窗玻璃化（半透明 + 模糊 + 底色 tint）"，
   而设置面板已有 `settingsBlur`（虚化设置面板，`lib/client.js:11623` 有 toggleRow + 滑块），
   对话框/弹层另有 `dialogBlur`/`popoverBlur`/`confirmBlur` ⇒ 接线 = **第二个管同一元素的开关**
   （正是 S-9 想解决的"开关列表太长、找不到"）。
2. **接线会引入一类已知回归**：`lgCss` 的玻璃化靠给目标元素打 `[data-mpw-lg-css]` 标记
   （`lib/client.js:5014` 的 `LG_EL_KEYS`）。把它加到**设置面板**上会让面板成为 **backdrop root**
   ⇒ 面板**内部**的浮层（插件自己的取色盘浮窗 `.mpw_pickerWrap`，`lib/client.js:9232`）的 backdrop 采样被隔离。
   这**正是**仓库反复踩过的回归类（顶栏版实测被 `css-matrix` 断言 3 抓到 **40 个问题**，
   见 `docs/TOKEN-NAMESPACE.md` §3b）。而本轮**硬约束禁止启动任何浏览器** ⇒ 我**无法验证**这个视觉后果
   ⇒ 不该落地一个无法验证的视觉改动。
3. **它是整族"WebGL 时代残骸"里的一员**：`glass.*` 分区的实现（elysia395 WebGL 方案）已被 `lgCss`（纯 CSS）取代，
   同族的 `glassColor`/`glassAlpha` 两个设置字段**也没有任何读取点**，`glass.title`/`glass.desc`/
   `glass.color`/`glass.color.hint`/`glass.alpha` **5 个 i18n 键也没有 `t()` 调用点**（本轮实测）。
   只把 `glassWindow` 一个孤儿接上线，会让"半死的功能族"变成"半活的功能族"——**更难审计**。
4. **政策原文就是"删"**：用户给的政策是"**不留**看得见却点不动的死文案"，不是"把死文案都实现出来"。

> 若将来有人要做"设置窗口玻璃化"，正确路径是**新建一个设计过的特性**（明确目标元素、明确与
> `settingsBlur` 的分工、真机验证浮层采样），而不是复活这个只活在字段表里的旧键。

---

## 2. 删了什么（6 处，**导出/净化同步删**）

```
lib/client.js:5964    lgTest 预设            glassWindow: false,                     → 删
lib/client.js:10017   重置默认值对象          glassWindow: false,                     → 删
lib/client.js:10035   BACKUP_FIELDS          "glassWindow",                          → 删（导出/导入字段表）
lib/client.js:10077   导入 boolFields        "glassWindow",                          → 删（布尔净化名单）
lib/client.js:12367-8 zh 字典                "glassWindow" / "glassWindow.desc"     → 删 2 行
lib/client.js:13035-6 en 字典                同上                                    → 删 2 行
```

**为什么必须"同步删"（S-4 特别点名的那条语义）**：`boolFields` 是**导入时的类型白名单**，
不是"忽略名单"。导入循环长这样（`:10079` 起）：

```js
for (const k of BACKUP_FIELDS) {
  const v = settings[k]; if (v === void 0) continue;
  if (numFields.includes(k)) { …有限数校验… continue }
  if (boolFields.includes(k)) { …boolean 校验… continue }
  if (strFields.includes(k)) { …string 校验… continue }
  patch[k] = v;   // ← 兜底：未登记类型**原样透传（不净化）**
}
```

⇒ 只删 i18n、**留着** `BACKUP_FIELDS` 里的名字，会让导入一份含 `glassWindow` 的旧备份时走**兜底直通**
（未净化写进设置）——即"**悬空字段复活**"。两边一起删之后，`glassWindow` 不在 `BACKUP_FIELDS` 里，
导入循环**根本不会遍历到它** ⇒ 旧备份里的该键被**安全忽略**（存量用户 `localStorage` 里的残留键也读不到、
不影响任何行为，重置设置时随之消失）。

**未动**（超出 ② 的授权范围，已在 `docs/TOKEN-NAMESPACE.md` §3b 登记）：`glassColor`/`glassAlpha`
（无读取点）与 5 个孤儿 i18n 键（`glass.title`/`glass.desc`/`glass.color`/`glass.color.hint`/`glass.alpha`）。
顺带核实：`glass.accent`/`glass.accent.hint`/`glass.reset` **不是**孤儿（外观 tab 的 accent 取色盘在用）。

---

## 3. 判据

### 3.1 双向断言（`tools/switch-wiring-test.mjs` 新增 **A0 段**，门禁第 2 步 = 秒级）

| # | 断言 | 抓什么 |
|---|---|---|
| A0-1 | `★ 已退役开关 glassWindow：源码里 0 命中` | 只删 i18n 漏删 `BACKUP_FIELDS`/`boolFields`（悬空字段复活）；也抓"文案引用残留" |
| A0-2 | `★ 已退役开关 glassWindow：i18n 键 glassWindow / glassWindow.desc 两套字典都没有` | 只删 zh（破坏 `panel-fixes-test` 的 zh/en 键集合一致）或只删源码（孤儿文案） |

**实测原文**（`node tools/switch-wiring-test.mjs`）：

```
== A0. 已退役开关（删掉的死文案/死字段）：0 悬空引用、0 孤儿文案 ==
  （政策：不留"看得见却点不动"的死文案；每条退役理由见源码 RETIRED 表）
  ✓ ★ 已退役开关 glassWindow：源码里 0 命中（无悬空字段 / 无净化名单残留 / 无孤儿文案引用）  命中 0 处
  ✓ ★ 已退役开关 glassWindow：i18n 键 glassWindow / glassWindow.desc 两套字典都没有（无孤儿文案）  字典键数 zh=457 / en=457
…
== A. 布尔开关：on/off 产物必须不同（或在 NON_CSS 登记）==
  ✓ ★ 42 个布尔开关全部接线（或已登记为"不影响 CSS"）  25 个有 CSS 影响 / 17 个已登记为"仅运行时" / 0 个已知失效（下表）
…
结果: 28 通过, 0 失败
```

`KNOWN_DEAD` 计数：**1 → 0**（表已清空；审计的 A2 段现在打印"（无）"）。
通过条数：**26 → 28**（−1 条 KNOWN_DEAD 断言，+2 条 A0 断言，+1 条常驻变异断言）。
布尔开关数：**43 → 42**（`46 − 3`；3 = 被审计排除的 `lgTest`/`enabled`/`forceEnabled`）。

### 3.2 变异自证（RED-if-reverted；**常驻**，每次跑门禁都验一次）

`tools/switch-wiring-test.mjs` 的变异表新增一条（在 `mkdtemp` 副本里注入，**不动仓库文件**）：

```
  ✓ 变异 retired-glasswindow-copy-restored：期望 A0 变红，实际 A0
     把已退役开关 glassWindow 的 i18n 文案加回 zh 字典（= 复现"孤儿文案/悬空键"，A0 段必须抓到）  [exit=1]
```

### 3.3 「默认行为不变」：删前删后产物 **sha256 逐字节相同**

任务书硬约束"不要动 `lib/client.js` 的既有默认行为"。判据 = 拿**改动前那份 client.js**
（`git show bf342cb:lib/client.js` → `/tmp/old-client.js`）与改动后的工作树，用同一个桩各自 build 一遍，
对 8 个上下文取 sha256：

| 上下文 | 改动前 | 改动后 |
|---|---|---|
| 默认档 | `f8ddc943ffa9b228` len=56008 | `f8ddc943ffa9b228` len=56008 |
| `lgCss` 开 | `c4637008741271ed` len=57026 | `c4637008741271ed` len=57026 |
| 统一虚化 / `sessionFollow` / 顶栏磨砂 | `f8ddc943ffa9b228` len=56008 | 同左 |
| 无壁纸 / 插件关 | `206a9197f2333293` len=21402 | 同左 |
| `lgTest` 测试模式 | `637e398efdb6f9c3` len=49410 | 同左 |

⇒ **8/8 逐字节相同**（`diff` 空）。理由：`glassWindow` 从来没有任何读取点，删它只是删死数据。

### 3.4 其余秒级门禁（串行单跑，逐个 rc）

| # | 命令 | rc | 输出摘要 |
|---|---|---|---|
| 1 | `node tools/panel-smoke.mjs` | **0** | 面板冒烟 **5/5 通过** |
| 2 | `node tools/switch-wiring-test.mjs` | **0** | **28 通过 / 0 失败**（含 A0 段 + 7 条变异） |
| 3 | `node tools/css-matrix.mjs` | **0** | **1115 组设置**：512 全组合 + 600 随机 + 3 边界；8 类历史回归未复现 |
| 4 | `node tools/style-scope-guard.mjs` | **0** | **615 组设置** / 162160 条规则；233 OK / 134 ALLOWLISTED / **0 RED** / 0 REVIEW |

顺带更正的**过时数字**（本轮实测，非本次改动造成）：`style-scope-guard` 的组数
**改动前 616 → 改动后 615**（用 `--client /tmp/old-client.js` 实测），而 `check.sh`/README×2/
`docs/STYLE-SCOPE-GUARD.md`/`token-namespace-test.mjs` 里写的 **613 早已过期** ⇒ 这 5 处一并改成"实跑打印条数（本轮 615）"。

---

## 4. 未证实项 / 残留

1. **未跑**：`bash tools/check.sh` 全量 12 步（第 9 步起要无头 Firefox）、`tools/token-namespace-test.mjs`
   （第 12 步，本轮不在允许的秒级清单内；它的 `--before`/`--after` 对拍取的是 `HEAD` 与工作树，
   本轮改动只删死数据 ⇒ 静态判断应保持绿，但**没有实跑**）、`tools/panel-fixes-test.mjs`（同位）。
2. **真机观感未验**（禁浏览器）：本条改动**没有**任何视觉改动可验——删的是从不进 DOM 的文案与从不读取的字段。
3. `glass.*` 家族的 5 个孤儿键 + 2 个无读取点字段**仍在**（§2 末），下一轮一次性裁定。

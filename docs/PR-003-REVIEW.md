# PR #3（Bil812）逐项审阅：哪些已实现 / 哪些没实现 / 处置建议

> 审阅基线：本仓 **3.13.9**（提交 `5e7407e`）· 审阅日期 2026-09-25 · 审阅人：仓库维护代理
> PR：`XHR666/dsh-mpkg-wallpaper#3` —— `feat: gray-text customization + full gray token coverage + glass composer (fork merge of v3.1.3)`
> 作者 **Bil812** · 2026-08-20 开 · 最后更新 2026-08-22 · **9 commits / 5 files / +1771 −152** · `mergeable_state: dirty`（与 `main` 有冲突）· 5 条评论

---

## 0. 结论（先给处置建议）

**建议：关闭（close as superseded），并在评论里明确邀请"按当前 main 重开一个小 PR"。** 理由：

1. **基线差 10 个版本**：PR 基于 **v3.1.3**，本仓现在 **3.13.9**（`3.2 … 3.13` 共 ~10 个 minor，含 12 条 P-批次与今日 3.13.8/3.13.9）。`mergeable_state: dirty` 说明按现状**无法直接合并**，硬合会把 v3.1.3 之后的官方修复与判据一起回退。
2. **PR 的绝大部分能力已经以别的方式进仓，并且**本仓在代码注释里**明确署名了来源**：`lib/client.js:367` / `:9978` 写着「⑲(新) Aqua 实验模式（**借鉴 Bil812 fork**，默认全关，不影响原功能）」，面板里还有指向本 PR 的致谢链接（`lib/client.js:21204` 的 `aqua.credit` → `/pull/2`）。
3. **剩下的差异是"实现口径"而不是"功能缺失"**（详见 §2 的 🟡 行）：例如 PR 把灰色 token 直接写进 `buildCss`，本仓走的是"token 覆盖 + 登记表 + 门禁断言"的另一条路；两种都能生效，但后者的默认档与门禁是今天全绿的基础。
4. 对方在 PR 正文里**主动提过**："如果上游愿意把这些能力合入，我们可以把灰色字相关改动**提取成独立的小 PR**，方便逐项 review" ⇒ 关闭时正好顺着这个台阶走。

---

## 1. PR 自称的 7 项能力 vs 本仓 3.13.9 现状

| # | PR 声称的能力 | 本仓现状 | 证据（本仓 `lib/client.js`，3.13.9） |
|---|---|---|---|
| 1 | **自定义灰色字颜色 `fontColorGray`**（官方只有品牌色 `aquaInkColor`） | ✅ **已实现** | `fontColorGray` 22 处；`aquaInkColor` 10 处（两者并存，灰色字可独立跟随） |
| 2 | **灰色 token 全覆盖（17 个）**：`label-primary-bluish/-dimmed/-foreground`、`label-quaternary`、`label-inverse/-primary-inverted/-error`、`line-secondary`、`separator-primary`、`border-secondary`、`state-warn-label` … | ✅ **已实现（同一批 token 名）** | `label-primary-bluish` / `label-quaternary` / `line-secondary` / `state-warn-label` 均在；`data-mpw-aqua` 相关 63 处 |
| 3 | **灰色覆盖不依赖 `overrideTokens`**（改为 `buildCss` 里直写 CSS 变量、mask 缺失用主题中性色兜底） | 🟡 **功能等价、实现口径不同** | 本仓保留 `overrideTokens` 路径（7 处）**并**有 `buildCss` 生成面 + token 命名空间门禁（`tools/token-namespace-test.mjs`，606 组设置 × 亮/暗两态逐键等价 + SSOT 唯一定义点）。⇒ 结论：**能力在，机制不换**（换成直写会动到今日全绿的门禁与默认档） |
| 4 | **输入框真玻璃**（55% 半透明 + `backdrop-filter: blur`，虚化关时也是玻璃） | ✅ **已实现** | `backdrop blur` / `backdrop-filter` 16 处；面板/对话框/顶栏/侧栏四表面共享 `--mpw-surface-*`（见 `docs/TOKEN-NAMESPACE.md`） |
| 5 | **复制/悬浮卡片灰色字修复**（`_card_1b2ny_13`、`#cfd3d6`/`#adb2b8` 硬编码 → 跟随灰色字设置） | 🚫 **不适用（选择器已失效）** | 本仓 `_card_1b2ny` **0 命中**：那是 **v3.1.3 时期 DSH 的构建产物类名**，之后 DSH 侧已改版（本仓现按"语义命中 + 逐项登记"的方式处理宿主节点，见 `docs/STYLE-SCOPE-GUARD.md`）。⇒ 若对方能给出**当前 DSH 版本**下仍硬编码的节点选择器与截图，可作为新 PR 的第一项 |
| 6 | **设置页 Tab 书签导航 + 折叠分组 + HSV 自绘取色器（含预置色板）** | ✅ **已实现** | `tab` 138 处（设置页分栏）；`hsv` 2 处（HSV 自绘取色）；预置色板与 Office 衍生色板在面板内（`aquaColor` 一族） |
| 7 | 其余 fork 定制：全屏统一雾 `#mpw-mask`、面板取色、面板加重、更新源指向 fork | 🟡 **部分** | `#mpw-mask` 2 处 ✅（统一雾已进仓）；「更新源指向 `Bil812/dsh-mpkg-wallpaper`」**明确不采纳**（本仓的更新源就是本仓，指向 fork 会让本仓用户被覆盖 —— 这一条与 PR 的出发点相反） |

### 兼容性声明（PR 正文 §兼容性说明）逐条
| PR 声明 | 本仓现状 |
|---|---|
| Aqua 默认关、不影响原有行为 | ✅ 同口径（本仓亦默认关，注释里写明"借鉴 Bil812 fork"） |
| 旧字段 `panelColor` / `fontColor` / `fontColorGray` 仍兼容读取 | 🟡 `panelColor` 在本仓 **0 命中**（已由新的面板/对话框命名取代）；`fontColorGray` ✅ 在；`fontColor` 由品牌色一族接管 |
| loader id 无 `@local` 前缀（tgz 安装环境） | ✅ 不相关/已满足（本仓走官方 CLI 安装，`cordis.patch.yml` 里 id 就是 `dsh-mpkg-wallpaper`） |

**小计**：✅ 已实现 4 项 · 🟡 等价/部分 3 项 · 🚫 不适用 1 项（第 5 项）· *明确不采纳* 1 条（更新源指向 fork）。

---

## 2. 回复草稿（**未发送**，等仓库主人决定后再贴到 PR #3）

1. 感谢 + 明确**署名**：Aqua/灰色字这条线本仓已借鉴并保留署名（代码注释 + 面板致谢）。
2. 说明**为何不能直接合**：基线 v3.1.3 ↔ 现 3.13.9，dirty；硬合会回退 10 个 minor 的修复与门禁。
3. **逐项交代**：4 项已实现（并列 token/字段名）· 3 项等价或部分（讲清口径差异，尤其"灰色直写 buildCss"vs"token 覆盖 + 门禁"）· 1 项不适用（旧 DSH 类名）· 1 条不采纳（更新源指向 fork）。
4. **顺着对方的提议**邀请**独立小 PR**（灰色字相关），并给出**可被合入的最小形态**：
   - 从当前 `main`（3.13.9）切分支；
   - 只带 1 个主题（例如"当前 DSH 版本下仍硬编码的中性灰节点清单 + 选择器 + 截图"），别带 fork 合并；
   - 不许改更新源/仓库身份类字段；
   - 附一条**能变红的判据**（本仓惯例：`tools/` 下加断言 + 变异自证）。
5. 关闭理由写清"**superseded，不是否决**"，并说明随时可以重开。

---

## 3. 本次**未采纳**的具体条目（留给未来的小 PR）

| 条目 | 为什么这次不采纳 | 需要什么前置才能合 |
|---|---|---|
| 灰色 token 改为 `buildCss` 直写、弃用 `overrideTokens` | 会动到今日全绿的 token 命名空间门禁与默认档（SSOT 唯一定义点 + 取值等价 606 组比对） | 给出"直写"与"覆盖"在同一组设置下的**逐键等价**证据，并同步 `docs/TOKEN-NAMESPACE.md` 与门禁 |
| 复制/悬浮卡片（`_card_1b2ny_13` 等）灰色字 | 那些类名在**当前 DSH 版本**已不存在，属于对旧宿主的补丁 | 当前 DSH 版本下仍硬编码的**选择器 + 截图 + 复现步骤** |
| `panelColor` 旧字段兼容读取 | 本仓该字段已 0 命中（命名已换代） | 若确有用户档在用该字段，给一份真实存档（脱敏）作为迁移用例 |
| 更新源指向 `Bil812/dsh-mpkg-wallpaper` | 与"本仓用户不被 fork 覆盖"直接冲突 | 不做（若需要可分叉自建仓库） |

---

## 4. 本次审阅**未做**的事（如实登记）

- 没有逐行读 PR 的 1771 行 diff（只按 PR 正文的 7 项主张 + 兼容性声明逐条对照本仓实现；`mergeable_state: dirty` ⇒ 逐行 review 的收益低于"重开小 PR"）。
- 没有实际渲染对比（对方截图/Firefox+llvmpipe 本机像素差；如需，可按 `docs/PORTABILITY.md` 的方式在 `:8902` 测试台上做 A/B）。
- 第 6 项（Tab 书签导航/折叠分组/HSV 取色器）只做了**符号级**确认（`tab`/`hsv` 命中 + 面板实现），**未逐项点验**与 PR 截图的视觉一致。


---

## 5. 可直接粘贴的回复草稿（**尚未发送**）

> 用法：仓库主人确认后，把下面 `---` 之间的内容整段贴到 PR #3 的评论框（或 `gh pr comment 3 --body-file <本文件>`）。
> 口径：**感谢 + 署名 + 说明为何不直接合 + 逐项交代 + 邀请重开小 PR**；不含任何"否决"语气。

---

感谢这份合并版，也谢谢把署名留在 PR 里 —— 说明一下我们这边的处理，免得它继续挂着：

**1）这条线我们已经吸收并署名了。** 灰色字（`fontColorGray`）+ Aqua 一族现在的实现里就直接写着来源：`lib/client.js:367` / `:9978` 的注释是「⑲(新) Aqua 实验模式（**借鉴 Bil812 fork**，默认全关，不影响原功能）」，面板关于页也挂着指向这个 PR 的致谢。你列的灰色 token（`label-primary-bluish` / `label-quaternary` / `line-secondary` / `state-warn-label` …）、真玻璃输入框（55% + `backdrop-filter`）、设置页 Tab 导航/折叠分组/HSV 自绘取色器、`#mpw-mask` 统一雾，**在当前 `main`（3.13.9）里都已经在了**。

**2）为什么不直接合。** 这个 PR 的基线是 **v3.1.3**，而 `main` 现在到 **3.13.9**（中间 ~10 个 minor，含十几批修复与门禁）。GitHub 也标了 `mergeable_state: dirty` —— 直接合会把 v3.1.3 之后的修复和判据一起回退，风险大于收益。

**3）剩下的差异是"口径"而不是"缺功能"**，逐条交代：
- 灰色覆盖：你们是**在 `buildCss` 里直写 CSS 变量**（不依赖 `overrideTokens`）；我们保留覆盖路径，但加了"token 命名空间门禁"（606 组设置 × 亮/暗两态逐键等价 + SSOT 唯一定义点，`tools/token-namespace-test.mjs`）。两种都能生效，换机制会动到今天全绿的默认档与门禁。
- 复制/悬浮卡片（`_card_1b2ny_13`、`#cfd3d6`/`#adb2b8`）：这些是 **v3.1.3 时期 DSH 构建产物的类名**，当前 DSH 版本里已经不存在了 ⇒ 在 3.13.9 上属于"补丁打空"。如果你手上有**当前 DSH 版本**下仍在硬编码的中性灰节点，非常欢迎 —— 那是我们最想要的一类报告。
- `panelColor` 旧字段：我们这边已换代（该字段 0 命中），如果你有真实存档（脱敏）在用，我们可以加迁移。
- 更新源改指向 `Bil812/dsh-mpkg-wallpaper`：这一条**不能采纳**（会让本仓用户被 fork 覆盖）。分叉自建仓库没问题，`main` 这边保持不变。

**4）所以建议：这个 PR 我们**按 superseded 关闭**（不是否决，随时可以重开）。你正文里提过"可以把灰色字相关改动提取成独立的小 PR" —— 那正是我们希望的形态，具体一点：
- 从当前 `main`（3.13.9）切分支，**只带一个主题**（例如"当前 DSH 版本下仍硬编码的中性灰节点清单 + 选择器 + 截图/复现步骤"），不要带 fork 合并；
- 别改更新源 / 仓库身份 / loader id 这类字段；
- 附一条**能变红的判据**（我们这边的惯例：`tools/` 下加断言 + 变异自证，例如 `node tools/xxx-test.mjs` 有 `MUTANT-RED-OK`）。

再次感谢这份工作 —— 灰色字这条线的起点是你们那边，这个事实我们会在文档里一直留着（`docs/PR-003-REVIEW.md` 有逐项对照）。

---

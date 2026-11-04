# REMOVALS —— 删除 / 移除记录（公开累积页）

> **这是什么**：本项目的**移除台账** —— 记录**因合规原因或权利人要求**而移出分发面的文件/资产，
> 以及每一步的处置、复核人与关联提交。它是 `docs/TAKEDOWN-RESPONSE.md` §4 第 2 项指定的**公开留痕页面**
> （72h 流程第 9 步的落点），也是 `docs/COPYING-RULES.md` **§9.11"不偷偷删除"** 硬承诺的兑现件。
> **分工**：`docs/PATCHES.md` 记**工程变更**（做了什么、怎么做到的）；**本页只记"移除了什么、为什么、谁要求的、谁复核、关联哪个提交"**。
> **性质**：**流程 + 指针**，**不是法律意见**；本页不作新的法律定性，法律定性一律指向已论证处（[§4](#4-与-third-partymd--docsCOPYING-RULESmd-的关系)）。
> **维护规则**：**每发生一次移除，本页必须同期加一行**；无移除时不改（台账保持空）。
> **日期**：2026-09-18 · **落点**：`docs/REMOVALS.md`（本仓库）· **口径**：仓库内为唯一正式落点。

> **落盘说明（2026-09-18）**：本页与工作区副本**同源**；落盘时**去掉了只对工作区有意义的内容** ——
> `references/**` 参考树、工作区级审计文档（`docs/**` 里不随仓库分发的那批）、仓库外证据目录
> `../Delete/**` 的路径引用，已改写为"**工作区级（不随仓库分发）**"的描述或删除；本仓库内可点的
> 文档/脚本仍按仓库相对路径书写。
> **本页不删任何代码/文件** —— 它是台账；真正的删除动作按附录 A 的 13 步清单另行执行。

---

## 1. 已删除

### 1.1 合规口径（权利人要求 / 上游许可变更 / 我方主动收口）：**当前为空**

| 日期 | 文件/资产 | 为什么删 | 提交哈希 | 复核人 |
|---|---|---|---|---|
| — | —（**暂无移除记录**） | — | — | — |

> **"空"的含义**：截至 **2026-09-18**，**没有任何文件/资产**因权利人要求、上游许可变更或我方合规收口
> 而移出分发面。**复核命令与输出**（本轮实跑）：

```bash
# 渲染器仓：全历史里"删除类"提交只有 1 个，且是**移动**不是删除
$ git -C we-scene-demo log --all --diff-filter=D --name-only --format= | sed '/^$/d' | sort -u | wc -l
1
$ git -C we-scene-demo log --all --diff-filter=D --name-only --format= | sed '/^$/d' | sort -u
run-all-tests.sh          # 0d29bdd 目录收拢时移入 tests/，属重命名
```

### 1.2 工程侧已删除登记（**不是**合规口径，登记以免将来误读）

> 这些是**工程/仓库卫生**层面的删除，出处是 `docs/COPYING-RULES.md` §6 与
> `docs/REIMPLEMENTATION-STATEMENTS.md`；列在这里只为回答"**曾经存在过什么、去哪了**"。
> 除最后一行为渲染器仓外，其余哈希都属于插件仓 `dsh-mpkg-wallpaper`。

| 日期 | 什么 | 为什么 | 提交哈希 |
|---|---|---|---|
| 2026-08-17 | 插件仓根上的中文 README 旧文件（README.zh-CN.md） | 文档收口 | `1785eae` |
| 2026-08-24 | `dsh-mpkg-wallpaper-3.5.0.tgz`（插件仓） | npm pack 产物不入库 | `eac67f4` |
| 2026-09-11 | `lib/client.js.bak-20260907`（插件仓） | 备份文件不入库 | `0f0649f` |
| 2026-09-16 | `tools/mdl_explorer.py`、`tools/tex2png.py`、`tools/unmpkg.py`、`tools/xref.py`（4 个）+ 插件仓 screenshots 目录下的 dhsw1.jpg、dshw2.jpg、dshw3.jpg（3 张旧截图） | 按 MIT 口径移出**许可血缘存疑**的 py 工具；旧截图同期清理 | `73b860f` |
| 2026-09-18 | `tools/liquid-demo/vendor/*.js`（9 文件）（插件仓） | 与 `lib/liquid-glass/` **逐字节重复** ⇒ 去重，保留唯一一份 | `47d2bad` |
| 2026-09-23 | demo/icons/pwa-maskable-512.png（上游 WebWallGL 图标，**已删**） | 品牌/残留清理：全树 0 引用（`grep -rn pwa-maskable` 覆盖 `docs/ tests/ archive/ build-pages.mjs package.json` 与两个 minified 产物均 0 命中）；同时 /favicon.ico 路由从上游 pwa-192.png 改指向自家 assets/brand/ 图 | 待提交（本轮） |
| 2026-09-23 | 插件仓 docs/ 共 5 篇（4 篇调研：elysia395-scene-renderer-分析 / scene-渲染方案评估-v3-elysia实证 / scene-渲染方案重新评估-WebGPU浏览器端可行 / virgl-ANGLE-GPU加速操作指南-Adreno830；+ 1 篇孤儿 scene-渲染加速方案分析，其唯一引用源正是被删的 WebGPU 篇） | 文档卫生：五类引用源（README/README.en/THIRD-PARTY/LICENSE、package.json 的 files 白名单、代码与门禁、插件仓 docs 交叉引用、check.sh 与 integrity-check 点名）全部 0 命中；删后 `integrity-check` 72/0 逐字不变 | 待提交（本轮） |
| 2026-09-23 | 渲染器仓 docs/CLEANUP.md → **移出仓库**至工作区 docs/CLEANUP.md（sha256 逐字节一致，git rm 后历史保留） | 文档卫生：非 README 引用面，但属带证据的历史修复记录 ⇒ 非破坏性移出而非删除 | 待提交（本轮） |
| 2026-09-16 | `common_vertex.h` | 有效行 100% 重合（187/187）⇒ **原件移出分发面**，归档在**仓库外** | **无（从未入库）**：`git log --all -- '*common_vertex*'` → **0 命中** |
| 2026-10-16 | 渲染器仓 `demo/assets/renderer-*.js`（上游 oneincase/webwallgl **2.1.0** 的渲染器构建产物；本次那份 = renderer-n-Rw_ZVc.js（构建名），**1,067,707 B** / sha256 `167d87f8a2239d5d82db2aae7d9ebe9952a947cc2e88f8aa4ac3a4654a1308e1`） | **用户口径**：「把渲染器仓库中的上游渲染器移除，然后留一个可扩展的接口，可以接入其他渲染器（包括上游的）」⇒ 上游产物移出仓库，改由通用**渲染器适配器**契约（`core/renderer-adapter.mjs`）按**外部来源**接入。⚠ **不是合规口径**（权利人未主张）；⚠ **不撤署名**：`demo/LICENSE-webwallgl` / `demo/LICENSE-webwallgl-MIT.txt` 与 `THIRD-PARTY.md` §6 原文一字未动 | 待提交（本轮 P-350） |

**复核命令与输出**（本轮实跑）：

```bash
$ git -C dsh-mpkg-wallpaper show --name-status --format= 73b860f | grep -E "^D"
D	screenshots/dhsw1.jpg
D	screenshots/dshw2.jpg
D	screenshots/dshw3.jpg
D	tools/mdl_explorer.py
D	tools/tex2png.py
D	tools/unmpkg.py
D	tools/xref.py
$ git -C dsh-mpkg-wallpaper show --name-status --format= 47d2bad | grep -E "^D" | wc -l
9
$ git -C we-scene-demo log --all --oneline -- '*common_vertex*' | wc -l
0
```

**P-350 移除项的复核命令与输出**（本轮实跑；备份与恢复途径见 `docs/PATCHES.md` P-350 与工作区报告 `docs/reports/REMOVE-UPSTREAM-RENDERER.md`）：

```bash
# ① 移除后：全树 renderer-*.js 计数 = 0（除 .git/node_modules）
$ find . -type f -name 'renderer-*.js' -not -path './.git/*' -not -path '*/node_modules/*' | wc -l
0
# ② 删除前的字节数与 sha256（备份件逐字节一致）—— 备份落在仓库**外**（/tmp，机器重启即失，故另有一份工作区级 staging 副本）
$ sha256sum /tmp/mpw-remove-upstream-renderer-backup/demo/assets/renderer-n-Rw_ZVc.js
167d87f8a2239d5d82db2aae7d9ebe9952a947cc2e88f8aa4ac3a4654a1308e1  （1,067,707 B）
# ③ 服务端：旧路径真的 404（不是"页面上没引用而已"）
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8902/wallpaper-engine-webgl/assets/renderer-n-Rw_ZVc.js
404
```

> **判据**：`tests/renderer-adapter-test.mjs`（D1/D2 = 全树 0 份；D3/D4 = 缺产物时**明确 SKIP** 而不是静默通过；E6 = 旧路径 404）、
> `tests/demo-check.mjs` D12 ③（A 全树 0 份 + B 渲染器页由适配器驱动 + C 契约在位 + D 缺产物明确 SKIP + **反向自证**：隔离副本塞回假产物 ⇒ 必红）。

---

## 2. 待删（等裁定的对象：**不是**已决定的删除清单）

> 本节回答"**如果明天要删，先看哪里、卡在谁身上、什么条件下才动**"。每一条都必须先过
> [§4](#4-与-third-partymd--docsCOPYING-RULESmd-的关系) 的**许可台账门槛**，再按附录 A 执行。

| # | 对象 | 为什么在清单里 | 阻塞在谁身上 | 判据（何时可执行 / 何时结案） |
|---|---|---|---|---|
| 1 | **随仓分发的 7 个字体**（含 `spincycle_3d_ot.otf` 等） | 其中 `spincycle_3d_ot.otf` 用的是**本地定义的** `LicenseRef-BVFonts-Freeware-2006`（作者 freeware 条款 + 保存的 README/TOU 快照）；发布闸门另有 **11 条"字体二进制与 WE 副本逐字节相同"的误报**，按用户口径保持 **informational、不改判据** | **用户（决策）+ 律师（若被主张）** | ① 用户裁定"移除 / 保留"；② 若移除 ⇒ 按附录 A 走 13 步 + 处理已发布面（§5 表）；③ 在裁定前**不改**闸门判据、**不删**本地文件 |
| 2 | **工作区级参考树**（无许可的 `we-layerd-ref`；GPL-2.0-only 的 `wer-ref` 等同族） | 无许可 / 与 GPL-3.0-or-later **双向不兼容** ⇒ 不得进任何产物（连逐行翻译、抄注释都不行） | **律师（U-1 / U-5 法律定性）** | 定性出来前：保持 **L1/L2 零引入**（`import/readFile` 0 命中、产物零包含）。**不是**"删掉参考树"（见 [§3](#3-明确不删复核后保留)） |
| 3 | **`common_vertex.h` 的衍生性定性** | 文件**已移出、不发布**，但"合并原则是否足以排除衍生性"仍未定 ⇒ 状态码 `PENDING-COUNSEL` | **律师** | 律师意见落地前：维持现状（移出 + 逐字登记事实）；若意见要求进一步处置，按附录 A 第 4/8 步加行 |
| 4 | **三个已发布分发面**（渲染器 npm 包、插件 npm 包、GitHub Pages 在线 demo） | 已发布副本**无法真正撤回**；任何移除都必须同步"补发版本 / 重新部署 / 记录缓存" | **发布流程（需用户批准发版）** | 真发生移除时：按附录 A §5 表逐面处置并记录；未发生移除时本行只是预案 |
| 5 | **T-1…T-8 措辞面**（历史用语 →「**独立实现**」） | 审计口径记 **31 个文件**；本轮只读实测**未复现该数**：渲染器仓 **23 个文件 / 104 处**（命令见附录 A 末）。逐处清单已出（工作区级只读清单，不随仓库分发）：分类为历史记录 / 当前自述 / 测试断言 / 文件名标识符四类 | **用户（是否扫、扫哪些）** | ① 用户批准后按批次执行：先改**不带门禁依赖**的当前自述，再改**需要同步门禁**的测试/断言；② **历史记录与文件名/标识符不动**；③ 未批准则本页不记任何改动 |

> **本轮未发生任何删除**：上面 5 行全部是"待裁定 / 待律师 / 待用户批准"，本页落盘本身不移动任何文件。

---

## 3. 明确不删（复核后保留）

> **为什么单列一节**：本项目刚有过一次"**把运行期活路径误判成死文件**"的教训（`liquid-glass`：
> 客户端确实无调用方，看着像死代码，但宿主路由与构建脚本仍在消费它）。凡是"**看起来没人用**"
> 的对象，**必须复核后写成结论**，而不是留一个"可能是垃圾"的悬念。

| # | 对象 | 曾被认为可删的理由 | 复核结论（**不删**） | 证据 |
|---|---|---|---|---|
| 1 | 插件仓 `lib/liquid-glass/**`（9 文件 / 5830 行，外部 MIT）+ 其派生产物 `lib/liquid-glass-bundle.js` | "客户端无调用方 ⇒ 无引用死文件 ⇒ 许可证表面积可缩小" | **仍是运行期活路径**：宿主路由在命中时 `readFileSync` 读取它；构建/内联脚本消费它生成 bundle。删掉会同时打断 LG 演示与构建链 ⇒ **保留唯一一份**（重复副本已在 `47d2bad` 删除，那才是正确的收口方式） | `dsh-mpkg-wallpaper/lib/index.js:3294-3314`（路由）、`tools/build-lg-bundle.mjs`、`tools/inline-lg-bundle.mjs`、`tools/inline-lg-b64.mjs`、`tools/liquid-demo/server.mjs:23-26`；台账登记见插件仓 `THIRD-PARTY.md` §1.3（含 9 文件 sha256 + `files` 负向模式"不随包发布"） |
| 2 | `elysia/we-renderer/puppet.js:481-500` 的 **MDLE0002 解析**（写入 `bones[].extend`） | "解析了但全仓**没有任何读取方** ⇒ 死代码" | **保留**：它是"上游是否使用该段"的**唯一本地探针**，且是格式覆盖的一部分；删除会丢掉将来翻案/复核的基础，而它对运行期**没有任何影响**（bundle/demo 0 命中）。判决见 `docs/MDLE-VERDICT.md` | `grep -rIn MDLE0002`（排除 `docs/`、`demo/assets/`）→ 只有 `elysia/we-renderer/puppet.js:481,482`；`.extend` 全仓只有写、没有读（`:496`）；`core/we-scene-bundle.js` 与 `demo.html` 各 **0** 命中 |
| 3 | **工作区级参考树**（`lwe-ref` / `wer-ref` / `vendor-ref` / `we-layerd-ref` / `dsbw-ref` / `reference`） | "无许可 / GPL-2.0-only 不兼容 ⇒ 删掉最安全" | **不删本地副本**：它们是行为对照与取证的唯一来源（本轮的 `docs/MDLE-VERDICT.md` 就靠 `vendor-ref` / `wer-ref` 的行为结论定案）；正确处置是**零引入**（护栏断言强制 `import/readFile` 0 命中、产物零包含），而不是删除。删除只在**权利人要求**时按附录 A 执行 | `tests/reference-isolation-check.mjs`（护栏）；`docs/COPYING-RULES.md` §9.8（无许可树：L2 查证后保持零引入）、§9.9（GPL 树）；工作区级隔离说明（不随仓库分发） |
| 4 | `.gitignore` 忽略的本机归档 `archive/local/**`（probe 脚本 / 私有基线 / 标定 json） | "本机残留垃圾" | **不删**：它是历史证据出处，且 `docs-check` 的引用候选把该目录算作**当时的落点**（删了会让历史文档引用变红），同时它**不入库、不发布**、不构成分发面 | `tests/docs-check.mjs`（候选路径含 `archive/local`）；`.gitignore` |
| 5 | `docs/PATCHES.md`、`docs/COMPLIANCE-REVIEW.md`、`THIRD-PARTY.md` 等文档里的**历史表述**（含旧措辞、旧口径、已被取代的登记） | 措辞 sweep 会把它们一并算成"残留" | **不改**：删除动作**不删历史叙事**，只加"已移除（日期 + 原因 + 公开通知链接）"标注。历史记录改写会破坏可追溯性与当时的证据口径 | `docs/TAKEDOWN-RESPONSE.md` §3 类 4；措辞清单（工作区级，不随仓库分发）分类① |

---

## 4. 与 `THIRD-PARTY.md` / `docs/COPYING-RULES.md` 的关系

> **硬门槛：删除任何第三方材料之前，必须先过许可台账。** 删代码 ≠ 删许可义务：
> 归属声明、许可文本、派生产物（bundle / 内联 base64 / 截图）都要一起算。

| 文档 | 分工 | 删除前必须回答的问题 |
|---|---|---|
| `THIRD-PARTY.md` | **许可台账**：每份第三方材料的来源、许可、落点、发布面、sha256（插件仓同名的 `THIRD-PARTY.md` 管插件侧） | ① 该材料**有没有登记行**（没有 ⇒ **先补登记再动**）？② 它的**派生物**有哪些（构建产物、内联常量、截图）？③ 许可是否要求**保留版权/许可文本**（MIT/BSD 等）⇒ 删掉最后一个使用点后，归属行应改成"已移除"标注，**不是**抹掉 |
| `docs/COPYING-RULES.md` | **处置规则**：L1–L5 阶梯（§9.1–§9.10）、L5 隔离块与留痕字段（§9.6/§9.7）、**§9.11"不偷偷删除"**硬承诺 | ① 该对象属于哪一档（无许可 / 不兼容 / 兼容但可缩小表面积）？② 是否**已有结论**（有结论就照结论执行，不重新定性）？③ 本次删除要不要同期改口径表述（"已授权 / 已结案"类句子**当场改**）？ |
| `docs/TAKEDOWN-RESPONSE.md` | **执行手册**：72h 响应模板、§3 删除范围 8 类、§7 13 步清单、§8 复验证据包 | 见附录 A（本页 §2/§4/§6 的源头） |
| `docs/COMPLIANCE-REVIEW.md` | 合规台账 | 被删对象在该表改成 `HOLD` / `已移除` 并写依据 |
| `docs/REIMPLEMENTATION-STATEMENTS.md` | 独立实现事实登记 | 若被主张对象是我方独立实现，**同一批**更新接触/重写事实 |
| **本页 `docs/REMOVALS.md`** | **移除台账（公开留痕）** | 每次移除**同期加一行**；本页**不新增法律定性** |

**顺序固定（删前 6 关）**：① `THIRD-PARTY.md` 查登记 → ② `docs/COPYING-RULES.md` §9 查处置档与既有结论 →
③ 查**发布面**（插件仓 `files` 负向模式、Pages 白名单、`tests/publish-check.mjs` 清单）→ ④ 按附录 A 走 13 步 →
⑤ 复跑门禁（附录 A §6）→ ⑥ 本页加行 + GitHub Issue（两处留痕，缺一不可）。

---

## 附录 A：移除流程（可照抄执行）

> 来源：`docs/TAKEDOWN-RESPONSE.md` §3（删除范围）+ §7（13 步清单）。**任何一步都先记 sha256，再动手。**

### A.1 触发条件（收到即开始计时）

| 触发形式 | 起算 | 首响时限 | 完成移除时限 |
|---|---|---|---|
| 邮件 / GitHub Issue / Discussions 里的**权利人主张** | 收到时刻（记时间戳） | **24 小时内**回执 | **72 小时内**完成移除（含衍生内容） |
| 平台转达（GitHub / npm 的 DMCA 或政策通知） | 通知到达时刻 | 按平台时限（通常 24h，**取更短者**） | 同上 |
| 律师函 | 收到时刻 | **4 小时内**告知用户 + **暂停相关发布** | 72 小时内移除，**答复文本由律师出** |
| 作者/上游**变更许可或收紧条款** | 发现时刻 | 评估 24h 内 | 视结论：整改或移除，**同样留痕** |
| **我方主动收口**（自查发现不应分发的材料） | 发现时刻 | 无需对外回执 | 当轮移除 + 留痕（`docs/COPYING-RULES.md` §9.11-1） |

> **不确定时按最严处理**：分不清"主张"还是"询问" ⇒ 先按主张走（先下架、再澄清）。**宁可多删，不可迟删。**

### A.2 谁决定 / 谁执行 / 谁复核

| 角色 | 谁 | 第一动作 |
|---|---|---|
| **响应负责人（决定者）** | **项目所有者（用户）** | 建立**单一**对外沟通渠道；不在公开场合争论法律定性；拍板"删什么、是否恢复" |
| **执行** | 本仓库维护会话/代理 | 按 13 步执行删除与留痕，**每一步留下命令与 sha256** |
| **复核** | **第二人**（另一会话/代理） | 复验"删干净 + 门禁绿 + 留痕在位" |
| **法律** | **律师** | 只有律师能对外作出法律承诺；答复文本先过律师；**恢复必须先得律师意见** |

**收到主张后的 5 个动作（顺序固定）**：① 冻结（暂停 npm publish / Pages 部署 / tag / Release）→ ② 回执（24h）→
③ 定位（映射到 8 类范围，**含衍生内容**）→ ④ 移除 + 留痕 → ⑤ 复验（出证据包）。

### A.3 13 步清单（8 类范围逐类过一遍）

| # | 类别 | 典型落点 | 处置 |
|---|---|---|---|
| 1 | **原件本体** | `assets/fonts/<file>`、`vendor/<x>/**`、`demo/**`、`shaders/*.h` | **移出仓库**（不是 `rm`：移入**仓库外**证据目录，保留可恢复副本） |
| 2 | **二进制/构建产物** | `demo.html`、`core/we-scene-bundle.js`（bundle 可能内联 shader/资源）、打包清单 | **重新生成**，**不手工编辑**；重生成后核对不含被删材料 |
| 3 | **测试用例与夹具** | `tests/**` 内联语料/期望值、`tests/publish-check.mjs` 清单 | 删除或**改写为不依赖该材料** |
| 4 | **文档引用** | `THIRD-PARTY.md`、`docs/COMPLIANCE-REVIEW.md`、`docs/REIMPLEMENTATION-STATEMENTS.md`、`docs/COPYING-RULES.md` §4 台账、README 署名段 | **不删历史**：加"**已移除（日期 + 原因 + 公开通知链接）**"标注 |
| 5 | **诊断/上报字样** | `web/diag-flags.json`、`docs/README-DIAGNOSTICS.md` | 同步清理，保持 `diag-flag-check` 双向一致 |
| 6 | **npm / Pages / 其它分发面** | npm 包、Pages 站点、`demo/**` 静态产物、CDN/镜像/搜索引擎缓存 | 逐面处理并记录（见 A.4） |
| 7 | **对外表述** | 任何"已获授权 / 已结案"的句子 | **当场改口径**（未得律师意见前**不得**声称结案） |
| 8 | **分发副本** | 工作区 `.bak-*`、`archive/`、`reports/` 旧快照 | 一并清出分发面（`.gitignore.public` / `publish-check` 规则要覆盖） |

**执行顺序**：① 冻结发布 → ② 记录（`received_at` / `channel` / 主张**逐字**原文 + 附件 hash；证据目录放**仓库外**，
**不公开**主张方隐私信息）→ ③ 发出回执（≤24h）→ ④ 映射 8 类范围 → ⑤ 每个对象**删前记 sha256**、移入仓库外证据目录（**不是直接 `rm`**）→
⑥ 重新生成构建产物 → ⑦ 清理测试与夹具 → ⑧ 文档加"已移除"标注 + 改掉"已授权/已结案"类表述 → ⑨ 外部面（补发版本 / 重新部署 / 记录缓存）→
⑩ **公开留痕两处**（GitHub Issue + 本页台账新增一行）→ ⑪ 完成通知（≤72h）→ ⑫ 复验证据包 → ⑬ 归档（**不放仓库**）。

### A.4 历史与"已经发布出去的东西"怎么处理

> 本项目**两个分发面**都可能已经发出：`we-scene-demo`（npm `wallpaper-engine-web-loader` + GitHub Pages 在线 demo）
> 与 `dsh-mpkg-wallpaper`（npm `dsh-mpkg-wallpaper`）。**移除本地文件 ≠ 移除已发布副本。**

| 面 | 处置规则 |
|---|---|
| **git 历史** | **默认不改写历史**（不做 `filter-repo` / force-push）：删除 = **新提交 + 移出工作树**。权利人**明确要求清除历史** ⇒ 单独裁定 + 先过律师，并在本页记明"按主张执行历史重写"。`git rm` 前先 `sha256sum`，原件移入仓库外证据目录 |
| **npm（已发布版本）** | 已发布版本**无法真正撤回** ⇒ **优先补发新版本**（移除 + 版本号 +1）；**不** `unpublish` 已成依赖的版本。权利人/法律明确要求下架时按 npm 政策执行并记录（注意 npm 删除 72h 后受限） |
| **GitHub Pages** | 重新构建产物并部署（`.github/workflows/pages.yml` 随 `push main` 自动重发，也可手动触发）；随后**实测**关键路径 200 且内容哈希 != 被删材料 |
| **镜像 / CDN / 搜索引擎缓存** | 按平台流程逐个处理并在本页"处置"列写明（能做的是"请求清除 + 记录"） |
| **仓库内文档/台账** | **不删历史叙事**：加"已移除（日期 + 原因 + 公开通知链接）"；`docs/COMPLIANCE-REVIEW.md` 对应行改成 `HOLD` / `已移除` 并写依据 |
| **恢复** | **先**取得**律师意见 + 上游许可确认**，再书面告知主张方，并在两处留痕记"已恢复（依据）" |
| **我方独立实现** | 若被主张对象是**我方自写**的等价实现 ⇒ **不独自拒绝**：说明已按主张移除原文材料，其余部分交律师评估并给明确回复期限 |

### A.5 必须重跑的门禁（移除后 = 发布前复验）

> 门禁有互斥锁 `/tmp/.mpw-gate.lock`：看到「⏳ 另一个 run-all-tests 正在运行」是**在等**不是失败。
> ⚠ **不要在门禁运行期间编辑 `tests/run-all-tests.sh` 或工作树**（bash 按字节偏移增量读脚本）。

**渲染器（本仓库）**

| 目的 | 命令 |
|---|---|
| **全量门禁（权威）** | `bash tests/run-all-tests.sh` |
| 文档/引用一致性 | `node tests/docs-check.mjs`（期望 rc=0） |
| 发布闸门（含 `reference-leak` + `reverse-flow` 两条阻塞级断言） | `node tests/publish-check.mjs`（期望 rc=0 / 0 阻塞） |
| 闸门判别力自检 | `node tests/publish-check-selftest.mjs`（期望 16/16） |
| 参考区隔离（被删对象是否仍被引用/夹带） | `node tests/reference-isolation-check.mjs` |
| 站点产物（含 `docs/` 白名单与隐私闸门） | `node build-pages.mjs --out _site --json`；`node tests/demo-check.mjs` |
| 开关 ↔ 文档双向 | `diag-flag-check`（在 `tests/run-all-tests.sh` 内；`web/diag-flags.json` 改动时必跑） |

**"删干净"的机器判据**：每个被删对象在**代码、测试、文档、产物**四处 **0 命中**
（文档里只允许存在"已移除"历史标注，且标注**不含**被删材料内容）：

```bash
cd "$MPW_ROOT/we-scene-demo"
grep -rIn --binary-files=without-match "<pattern>" . | grep -v '^./\.git/' || echo "0 残留 ✓"
node tests/docs-check.mjs
node tests/publish-check.mjs
```

---

## 附录 B：本页维护记录

| 日期 | 动作 | 执行 | 复核 | 证据 |
|---|---|---|---|---|
| 2026-09-18 | **本页落盘入仓**（工作区副本 → `docs/REMOVALS.md`）：§1 已删除（合规口径为空 + 工程侧登记）+ §2 待删 + §3 明确不删 + §4 许可台账门槛 + 附录 A 流程/门禁 | 本次 docs-only 任务 | 待用户/第二人复核 | `docs/TAKEDOWN-RESPONSE.md:95-96`（要求新建本页）；`docs/TAKEDOWN-RESPONSE.md:248` 的"待建"括注同期改为"已建"；§1.1/§1.2 的命令输出见本文 |
| — | （下一次移除发生时在此加行） | — | — | — |

> **台账当前为空**（§1.1）= 本项目**没有**任何"因合规/权利人要求而移除"的记录。
> 已发生过的**工程侧删除**已在 §1.2 逐条登记哈希，口径不属于合规移除。

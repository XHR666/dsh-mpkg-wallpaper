# 提交前门禁（秒级 pre-commit）—— S-8 的落地

> 2026-09-19。来源：`../docs/ANSWER-REMAINING-AND-API-20260918.md` §3 **S-8**（`:373`，原标"下一轮插件线（代码）"），
> 其中第 ② 条："把**秒级**的那几步抽成 `check.sh --fast` 进 pre-commit / CI"。
> 编号 **P-129**（P-127 = 发布面、P-128 = `glassWindow` 退役，见各自文档；P-123…P-126 已被并行线占号）。

---

## 1. 交付了什么

| 文件 | 作用 |
|---|---|
| `tools/pre-commit.sh` | **全部逻辑**：串行跑 2 个秒级测试、路径过滤、跳过口、红行摘要、退出码 |
| `.githooks/pre-commit` | 3 行 shim（版本化、**装了才生效**）：`exec bash tools/pre-commit.sh "$@"` |
| `README.md` / `README.en.md` | 「提交前门禁（秒级 pre-commit）」一节：怎么装 / 怎么绕 / 它**不**包含什么 |

**跑什么**（只有这两个，串行）：

| # | 脚本 | 实测 | 抓什么 |
|---|---|---|---|
| 1 | `tools/panel-smoke.mjs` | ~0.25–0.35 s | 面板能渲染（CSS 模板闭合 / `h` 声明 / 花括号配平）+ 语言字典 + 选择器回归；**5/5 通过** |
| 2 | `tools/switch-wiring-test.mjs` | ~2.3–3.6 s | 每个开关必须真的改变产物（含 A0 段：退役开关 0 悬空引用 / 0 孤儿文案）+ **7 条分辨力变异自证**；**28 通过 / 0 失败** |
| | **合计** | **2.8–3.9 s**（多次实测） | |

> 数字口径：任务书给的是"两者合计约 2.1 s"（那是 P-128 **之前**、变异只有 6 条时的实测）。
> 本轮实测 **3930 ms**（panel-smoke 309 + switch-wiring 3551）与 **2804 ms**（另一次）——变多的是
> `switch-wiring` 内部 **7 条变异各自 fork 一个子进程**重跑整段审计（这正是"断言真的能变红"的代价，值得留着）。
> 顺带更正：`ANSWER-REMAINING-AND-API` 的 S-8 里"第 2+6 步合计 ≈5.4 s"与本文件口径不同源
> （它算的是 panel-smoke+diag-subsystem+switch-wiring+integrity 的组合），以本文件实测为准。

**不跑什么（重要）**：`tools/check.sh` 的 12 步**不**进 pre-commit。第 3 步是 1115 组 CSS 组合矩阵、
第 9 步起要无头 Firefox、第 11 步 bundle 等价性约 20 s ⇒ 分钟级；把它塞进 pre-commit 会变成
"改一行不敢提交"，反而降低门禁使用率。**完整门禁仍是 `bash tools/check.sh`（或 CI）**。

---

## 2. 怎么装（显式、可逆、不阻塞）

```sh
cd dsh-mpkg-wallpaper
git config core.hooksPath .githooks   # 装载：只影响本机这个 clone
git config --unset core.hooksPath     # 卸载
git commit --no-verify                # 单次绕过
MPW_SKIP_PRECOMMIT=1 git commit -m …  # 单次绕过（走脚本内的显式口，恒 exit 0）
```

**为什么是 `.githooks` + `core.hooksPath` 而不是拷进 `.git/hooks/`**：
后者每个 clone 都要手工拷（没人会拷 ⇒ 等于没有），前者**随仓库版本化**、一行命令装载/卸载，
且**不装的人完全不受影响**（这正是"不阻塞开发"的关键：门禁是**选择加入**的）。

**"不阻塞"的四个口子**（都在 `tools/pre-commit.sh` 里，逐条实测见 §4）：

| # | 机制 | 效果 |
|---|---|---|
| ① | 装载显式（`core.hooksPath`） | 不装 = 零影响；装了也能 `--unset` |
| ② | **路径过滤**：暂存区里没有 `lib/` · `tools/` · `package.json` 的改动 ⇒ 直接跳过 | 纯文档/README 提交**零成本**（不再等 4 秒） |
| ③ | `git commit --no-verify` / `MPW_SKIP_PRECOMMIT=1` | 随时可绕，且脚本自己会打印这两条 |
| ④ | 缺 `node` / 缺脚本文件 ⇒ 打印一句就 **exit 0** | 门禁本身绝不成为阻塞（不做"环境不对就红"） |

---

## 3. 判据

### 3.1 单独跑：**rc=0**

```
══ pre-commit 秒级门禁（panel-smoke + switch-wiring；完整 12 步：bash tools/check.sh）══

── panel-smoke（面板渲染 + 语言字典）  秒级
   ✓ panel-smoke（面板渲染 + 语言字典） 通过（309 ms）
     · 面板冒烟：5/5 通过 ✓

── switch-wiring（开关必须真接线 / 退役开关 0 悬空）  秒级
   ✓ switch-wiring（开关必须真接线 / 退役开关 0 悬空） 通过（3551 ms）
     ·   ✓ ★ 42 个布尔开关全部接线（或已登记为"不影响 CSS"）  25 个有 CSS 影响 / 17 个已登记为"仅运行时" / 0 个已知失效（下表）
     · 结果: 28 通过, 0 失败

✓ pre-commit 秒级门禁通过（3930 ms）：面板能渲染 + 每个开关都真的接线（含退役开关 0 悬空引用）
  完整门禁（1115 组 CSS 矩阵 / 作用域护栏 / bundle 等价性 / 样式命名空间，含无头 Firefox 步骤）：bash tools/check.sh
RC=0
```

### 3.2 变异自证：把接线改坏 ⇒ **rc=1**（真树一个字节都没动）

变异 = 把 `sessionFollow` 的读取删掉（复现 2026-09-18 那次真事故："开关存在但全仓无人读"）：

```sh
node -e "…把 'const sessionFollowOn = section.sessionFollow !== void 0 ? … : DEFAULT_SESSION_FOLLOW;'
          换成 'const sessionFollowOn = true;' ⇒ /tmp/mut-client.js"
bash tools/pre-commit.sh --client /tmp/mut-client.js      # 期望 rc=1
```

```
── panel-smoke（面板渲染 + 语言字典）  秒级
   ✓ panel-smoke（面板渲染 + 语言字典） 通过（230 ms）        ← 面板本身没坏，它抓不到这类问题（两者互补）
── switch-wiring（开关必须真接线 / 退役开关 0 悬空）  秒级
   ✗ switch-wiring（开关必须真接线 / 退役开关 0 悬空） **失败**（rc=1，2307 ms）—— 变红的行：
       ✗ ★ 42 个布尔开关全部接线（或已登记为"不影响 CSS"）  — 在 3 个上下文里都没有任何 CSS 影响且未登记：sessionFollow
       ✗ ★ sessionFollow:关档 [默认档] 新会话按钮回**宿主原色**且不再有 color-mix 混透明  — 命中 2 条：[…]
       ✗ ★ sessionFollow:开/关两档产物必须不同 [默认档]  — 56008 B vs 56008 B
✗ pre-commit 未通过（2592 ms）。上面每一条红行都是**真事故**的形状：开关点了没效果 / 面板渲染坏了。
RC=1
```

**真树未改动**：跑完 `sha256sum -c`（跑前快照）⇒ `lib/client.js: 成功`。
（变异只在 `/tmp/mut-client.js` 副本里做 —— 与仓库既有的"变异注入 mkdtemp 副本、绝不动真树"惯例一致。）

### 3.3 hook 链路的端到端验证

`sh .githooks/pre-commit --client /tmp/mut-client.js` ⇒ **HOOK_RC=1**
（证明 shim 能找到仓库根、用 bash 转发、并把子进程退出码原样传回 —— 即 `git commit` 会真的被拦住）。

### 3.4 路径过滤（②）的端到端验证 —— 用**隔离索引**做，不动真索引

```sh
GIT_INDEX_FILE=/tmp/pc-idx git read-tree HEAD
GIT_INDEX_FILE=/tmp/pc-idx git update-index --add --cacheinfo 100644,<blob>,docs/zz-scratch.md
GIT_INDEX_FILE=/tmp/pc-idx bash tools/pre-commit.sh        # ⇒ "…暂存区只动了非产物路径…⇒ 跳过"  RC=0
GIT_INDEX_FILE=/tmp/pc-idx git update-index --add --cacheinfo 100644,<blob>,lib/zz-scratch.js
GIT_INDEX_FILE=/tmp/pc-idx bash tools/pre-commit.sh        # ⇒ 真跑两个测试（✓ panel-smoke …）RC=0
```

过滤器正则 `^(lib/|tools/|package\.json$)` 的单测（7 个样本）：

```
docs/FOO.md   ⇒ 跳过        lib/client.js ⇒ 跑        tools/x.mjs   ⇒ 跑        package.json ⇒ 跑
libx/foo      ⇒ 跳过        mytools/a     ⇒ 跳过      tools         ⇒ 跳过（不是 tools/ 下的文件）
```

跑完 `git diff --cached --name-only | wc -l` ⇒ **0**（真索引全程没被碰过）；
`lib/zz-scratch.js`、`docs/zz-scratch.md` 是**只存在于 /tmp 索引里的 cacheinfo 条目**，磁盘上没有这两个文件。

### 3.5 其它口子

| 命令 | 实测 |
|---|---|
| `MPW_SKIP_PRECOMMIT=1 bash tools/pre-commit.sh` | `… MPW_SKIP_PRECOMMIT=1 ⇒ 跳过…` **RC=0** |
| `bash tools/pre-commit.sh --help` | 打印脚本头部用法 |
| `bash tools/pre-commit.sh --bogus` | `✗ 未知参数：--bogus` **RC=2**（用错参数不装死） |

---

## 4. 未证实项 / 残留风险

1. **没有在真 `git commit` 上跑过 hook**（本仓工作树是**多线共享**的，改 `core.hooksPath` 会影响所有并行线，
   本轮**故意不装载**：装载决定留给主对话/用户）。已用 `sh .githooks/pre-commit --client /tmp/mut-client.js`
   验证转发与退出码（§3.3）。
2. **`switch-wiring` 的耗时随变异条数增长**（当前 7 条 ≈3.5 s）：若哪天真嫌慢，正确的减法是把
   变异段挪到 `check.sh`（`--no-mutations` 已经支持），**不是**把断言删掉。
3. **`panel-smoke` 与 `switch-wiring` 都在 `check.sh` 第 2 步**（同两个脚本）⇒ 装了 hook 的机器上，
   一次 `git commit` + 一次 `check.sh` 会跑两遍（各 ~4 s / 各 ~4 s）。这是**有意的重复**：
   pre-commit 拦"马上要提交的"，check.sh 是"发布前整体"。不去重，避免任何一边被绕过。
4. **未跑**：`bash tools/check.sh`（12 步）本身 —— 本轮硬约束，见交付报告。

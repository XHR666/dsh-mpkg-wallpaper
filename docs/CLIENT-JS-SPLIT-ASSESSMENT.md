# S-6 可行性评估：把 i18n 抽成 `lib/i18n.js`（**本轮只评估，不动手**）

> 2026-09-19。来源：`../docs/ANSWER-REMAINING-AND-API-20260918.md` §3 **S-6**（`:366`，原文"下一轮插件线（代码）"），
> 用户本轮限定："**本轮只做可行性评估** …… **不要真拆**"。
> 编号 **P-130**（P-127 发布面 / P-128 `glassWindow` 退役 / P-129 pre-commit）。

---

## 0. 一句话结论

**"把 i18n 移到 `lib/i18n.js`，`client.js` 里 `import` 它"这条路在本宿主上不成立** ——
宿主的客户端半边是**一个文件 = 一个 bundle**，浏览器侧是 **lazy CJS 表**，相对说明符**没有 graph row**
⇒ `client.js` 里任何 `import './i18n.js'` / `require('./i18n.js')` 都会在 materialize 时**抛错**（宿主自己的话：
"anything else → throw (loud — the runtime mirror of the build-time bundle purity gate)"）。
唯一可行形态是 **"源 + 生成内联"**（像历史上 `inline-lg-bundle.mjs` 那样），而它**必须**配一条
"生成物与源一致"的漂移门禁，否则就是重演那个已经变成死工具的坑。
**体积收益有限**：i18n 只占 `lib/client.js` 的 **7.0 % 行 / 8.5 % 字节**（937 行 / 73 762 B）。
⇒ **本轮不拆**（符合任务书）；要做就选形态 (A)，判据见 §4。

---

## 1. 硬约束取证（宿主侧，逐行读过）

宿主 `/opt/node/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js`：

| # | 事实 | 位置 |
|---|---|---|
| 1 | 客户端半边 = `package.json` 的 `exports["./client"]` **一个文件**（`clientPath: join(dirname(pkgPath), clientRel)`；没有 `./client` 导出就直接 throw） | `:655`、`:659` |
| 2 | 该文件被**整个读出**当作一个 bundle 下发（`readFileSync(record.meta.clientPath)` / `readFileSync(clientPath)`） | `:545`、`:753` |
| 3 | 浏览器侧是 **lazy CJS 表**：脚本执行只 `window.__ModuleLoader__.load({id, factory})` **注册**，模块体在 materialize 时才跑 | `:16-30`、`:390` |
| 4 | 解析分支顺序：seed word → shell 实例；memoized → exports；**graph row** → 注册依赖并 materialize；**其它一律 throw** | `:26-28`（lazy CJS 模型总述 `:16-30`） |
| 5 | `dsh.client.external` 只能列**别的包**，而且"a row must not declare its own package" | `:362`、`:146` |

推论（**本评估的关键**）：

* **同包的第二个文件不是可装载单元**（没有 graph row 认领它）⇒ 形态 (B)(C) 之外无法"真拆文件"；
* 现状自证：`lib/client.js` 里**相对 `import`/`require` 0 处**（`grep -nE "^\s*(import|export)\s|require\(['\"]\./|import\(['\"]\."` 空），
  只有 1 处 `require("react")`（宿主种子词）—— 这正是"半边必须自包含"的现场证据；
* `tools/build-bundle.mjs` **不含** `client.js`（方式四只内联**宿主端** `lib/index.js` + 相对依赖）
  ⇒ 本仓**没有**客户端打包器，"抽出去再打进 client.js"这种事目前没有任何工具承担。

---

## 2. 体积账（实测，本轮）

| 项 | 数字 | 怎么量的 |
|---|---|---|
| `lib/client.js` | **13 430 行 / 863 211 B** | `wc -lc`（行数口径；`grep -c ""` 同值） |
| i18n 块（`const zh = {` … en 字典收尾 `};`） | **`lib/client.js:12114–13050` = 937 行 / 73 762 B** | node 逐行切片求和 |
| 占全文件 | **7.0 % 行 / 8.5 % 字节** | 同上 |
| 字典键 | **914**（zh **457** / en **457**，键集合一致） | `tools/_stub.mjs` 的 `loadPlugin().localeDicts`（② 新加的口子）实测，**不是**正则猜的 |
| 抽走后 | 12 493 行 / 789 449 B | 同上 |

对照 S-6 原文里另外两个数字（本轮复核）：URL 开关唯一数 **51** ✓；`t("…")` **静态**键 **392** ✓。
（原文那句"`grep -oE 'function (build|apply)[A-Za-z0-9_]*'` 共 **107** 个函数"**对不上**：同一条命令本轮实测
**出现 17 次 = 唯一 17 个**（`sort -u` 同为 17）。同族命令里最接近 107 的是"任意 `build*/apply*(` 调用
（含调用点）唯一 **31** / 出现 **132**"，也不是 107 ⇒ 该数字**来源不明，登记为不可引用**。）

---

## 3. 三种形态与裁决

### (A) 源 + 生成内联 —— **唯一可行形态（若要做，选它）**

* 形态：`lib/i18n/zh.js` / `lib/i18n/en.js`（唯一源）+ `tools/inline-i18n.mjs` 把两份字典写进
  `lib/client.js` 的**占位区**；`lib/client.js` **仍入库**（避免"clone 后必须先 build 才能跑任何测试"）。
* 收益：① i18n 改动不再与代码改动争同一个 hunk ⇒ **并行线的冲突面下降**（这是 S-6 的真实动机）；
  ② 字典可被独立工具/校验直接读（不必再切片源码）；③ `client.js` 行数 13 430 → ~12.5 k。
* 成本/风险：① 多一个生成步骤 + **必须**配一条"生成物与源逐字节一致"的门禁，否则改了源忘了生成 ⇒ 静默漂移；
  ② **历史坑就在眼前**：`tools/inline-lg-bundle.mjs` / `inline-lg-b64.mjs` 正是这种形态，占位区被删之后
  已成**死工具**（跑起来报"缺少占位区"，见 `docs/LIQUID-GLASS-DEDUP.md` §6.4 / `README.md` dist 注记）
  ⇒ 要做就必须把"占位区 + 漂移断言"一起进 `check.sh`，**并且**给死工具留一条自检；
  ③ **29 个工具按路径读 `lib/client.js`**（`grep -rl` 实测）——形态 (A) 下它们**不用改**（这是选 (A) 的另一个理由）。

### (B) 运行时加载第二个文件（`import()` + 宿主/插件静态路由 或 Blob URL）—— **不推荐**

* 技术上可行（旧 lg bundle 就是"Blob URL 动态 import，不依赖 host 静态路由"），但 **i18n 会变成异步**：
  设置面板 `render()` 里是**同步**调 `t()` 的（`ctx.locale.register(NS, {zh,en})` 在 apply 期完成）
  ⇒ 面板会先渲染出键名再补文案（P-66 修过的"界面显示 key 原文"会以新形式复发）。
* 额外失败面：多一条网络路径 / 缓存 / 沙箱（`MPW` 有 sandbox 与离线下载场景）⇒ 为"字典"付这个代价不值得。

### (C) 拆成**独立 npm 包**（`dsh-mpkg-wallpaper-i18n`，用 `dsh.client.external` 声明）—— **明确不做**

`external` 只能跨包，所以这是唯一"真拆"的路；但为一个纯数据字典多发一个包、多一条版本同步线，
违背"少发包、少漂移"的既有取向。

**裁决：本轮不拆。** 形态 (A) 留给下一轮（且必须与 §4 的门禁同批落地）。

---

## 4. 判据（若下一轮真做，**必须"产物逐字节相同"**）

| # | 判据 | 现状可否复用 |
|---|---|---|
| 1 | **主判据**：重构前后 `__mpwBuildCss(patch)` 产物在 N 个上下文里 **sha256 逐字节相同** | ✅ 本轮 ② 已跑通这套做法（`git show <before>:lib/client.js` 与工作树各 build 一次、对 8 个上下文取 sha256、`diff` 为空；见 `docs/RETIRED-SWITCH-GLASSWINDOW.md` §3.3） |
| 2 | `node tools/css-matrix.mjs` rc=0 且**组数不变**（1115） | ✅ |
| 3 | `node tools/style-scope-guard.mjs` rc=0 且**组数不变**（615）+ `token-namespace-test` | ✅ |
| 4 | `node tools/panel-fixes-test.mjs`：zh/en 键集合一致 + 914 键 + `t("k")` 静态键两套齐全 | ✅（本轮未跑，见 §5） |
| 5 | `node tools/panel-smoke.mjs` rc=0（面板树 + 语言渲染） | ✅ |
| 6 | `node tools/bundle-equivalence-test.mjs` + `build-bundle.mjs --check` rc=0（宿主端不受影响，防误伤） | ✅ |
| 7 | **新增「客户端半边自包含」断言**（见下） | ❌ **建议现在就加**（与拆不拆无关的独立护栏） |

**第 7 条的确切做法**（零风险、约 5 分钟、不需要动 `lib/`）：在 `tools/integrity-check.mjs` 里加一节
（**注意**：该脚本含 `npm pack --dry-run` ⇒ 加完要跑一次整脚本核对通过条数）：

```js
console.log('\n== ⑩ 客户端半边必须自包含（宿主 bundle 纯度约束）==')
// 宿主 dsh-client-modules：客户端半边 = exports["./client"] 的一个文件，整个 readFileSync 下发；
// 浏览器侧 lazy CJS 表对"非 graph row 的相对说明符"直接 throw ⇒ client.js 里出现相对 import/require
// 只会在**运行期 materialize 时**炸（真机才看得见，静态测试全绿）。这条断言把它提前到提交前。
const clientSrc = read('lib/client.js') || ''
const relRe = /^\s*(?:import|export)\s[^\n]*from\s*['"]\.|require\(\s*['"]\.|import\(\s*['"]\./m
ok(!relRe.test(clientSrc), '★ lib/client.js 无相对 import/require（客户端半边自包含，见 docs/CLIENT-JS-SPLIT-ASSESSMENT.md）',
  '命中：' + (clientSrc.split('\n').findIndex((l) => relRe.test(l)) + 1))
ok(/".\/client":\s*"\.\/lib\/client\.js"/.test(read('package.json') || ''), '★ exports["./client"] 指向单个文件（宿主的客户端半边入口）')
```

---

## 5. 未证实项

1. **宿主版本差异未核**：以上读的是本机 `@deepseek-ai/dsh` 的 `dsh-client-modules`（0.19.x 世代）。
   若宿主将来支持"客户端半边多文件"，形态 (A) 的成本会下降 —— 但那要重读宿主源码，**本轮只按本机版本下结论**。
2. **未在浏览器里验证**"相对 import 会 throw"（本轮硬约束禁浏览器）：结论来自**宿主源码的解析分支**
   （`:16-30` 的 "anything else → throw"）+ 本仓 `client.js` 现状（相对说明符 0 处）两重静态证据。
3. **`panel-fixes-test` 未跑**（不在本轮允许的秒级清单内）：第 4 条判据与 914 键数字来自 `_stub.mjs` 的
   `localeDicts` 实测（② 新增的口子），不是 `panel-fixes-test` 的输出。
4. 形态 (A) 的**生成脚本**未设计：占位区格式、`--check` 语义、与 `check.sh` 的接线都还是空白（下一轮的事）。

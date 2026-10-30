# ZCode 进度台账

> 各任务单的执行台账（新增一节置顶或追加均可，倒序排列）。工作区级任务书见 `<工作区>/docs/`。

---

## 任务书 B：`feat/renderer-embedded` 分支收尾（2026-10-30 起，收尾于 10-31）—— ✅ 完成

> 工作位置：`worktrees/renderer-embedded`（git worktree，分支 `feat/renderer-embedded`，起点 HEAD `e1eed25`）。
> 只动该分支：未合并 main、未动 main、未 rebase、未打 tag、未发版。工作区隔离验证：`git status` 只含本单预期改动。

### 开工基线（硬性门禁第 1 条）
- `bash tools/check.sh --list`：12 步全部"未缓存"（worktree 新建、无历史记录），**无"本来就红"项**。
- 任务书列红两项：`license-boundary 11/2`、`renderer-host 29/4`（红因=开发树路径按集成交付的并列布局钉死）。

### 第一部分：任务书两判据的修复（判据演进均已在各文件头留痕）
1. **tools/license-boundary-test.mjs**（11/2 → **13/0**）
   - 开发树解析改候选序：`env MPW_RENDERER_DEV` → `../renderer` → `../we-scene-demo` → `./renderer`（内嵌），首个在位者胜出。
   - B2 断言对象改为**随包分发的副本** `renderer/LICENSE`（副本才是分发出去的那份；旧布局副本==开发树，语义无损）。
   - D1/D2 逐字节对拍只在**同步源开发树**（env/`../renderer`）在场时运行；解析到上游树（we-scene-demo：
     副本对其含 MODIFICATIONS.md 声明增量 ⇒ 非逐字节复刻关系）或内嵌副本自身（对拍=自己比自己）⇒
     **明确 SKIP 并打印原因**，以"嵌入副本自校验"替代：D1' 文件集非空+哨兵文件齐、D2' MODIFICATIONS.md
     **声明的增量真实在位**（demo.html 五个 mpw-* op + props-compat 判据 + 旗标登记）。
   - 正/负对照：env 指向副本克隆树 ⇒ D1/D2 真跑绿（630/630 全一致）；克隆树改 1 字节 ⇒ D2 红（对拍分支仍"能失败"）。
2. **tools/renderer-host-test.mjs**（29/4 → **33/0**）
   - B 组真树定位同候选序；真仓库/worktree 下解析到内嵌副本 = `/webloader` 实际托管的根（与
     `lib/index.js` 的 WEBLOADER_ROOT 同款）⇒ B 组打的就是首帧依赖的那棵树本身。
   - 四候选全缺 ⇒ B1–B4 明确 SKIP 并打印原因、计入 SKIP 不计通过（桩布局验证过该分支）。
3. **tools/panel-smoke.mjs**（4/5 → **5/5**）——任务书未列红，但同属"开发树路径"类红
   - diag-flags.json 查找序在 env 之后**首选内嵌副本**（`<插件>/renderer/web|根`），兄弟开发树降为回退。
4. **lib/index.js `/webloader` 路由根**：核验=已是插件目录派生（`import.meta.url`，lib/index.js:4054），
   真仓库/worktree/集成三种布局机械复算全部解析到含 demo.html 的渲染器根 ⇒ **无需改动**
   （任务书第 2 项在分支交付提交 659c2e5 时已落对；"路由根红"实为 renderer-host B 组的开发树路径红）。
5. **环境补齐**（硬性门禁第 3 条）：worktree 的语料路径 `../allwallpaper` 落空 ⇒
   `worktrees/allwallpaper` 符号链接到主检出语料（24GB 不复制）；better-sidebar 走 `~/.dsh` 全局路径，无碍。

### 第二部分：全量门禁暴露的真红（任务书未列、此前从未在真仓库布局跑过全量）
**门禁自身的计数缺陷（main 既有，非本单引入）**：每步 `|| fail=1` 幂等 + `fail` 跨步持久 + 按步判定
`fail == GATE_FAIL_BEFORE` ⇒ **第一个红步之后所有步的新失败都被记绿**（两轮全量汇总都停在 FAIL 1，
第 5/6 步的真红全被吞）。修复：`|| fail=1` → `|| fail=$((fail + 1))`（91 处，判定语义不变），文件头留痕。
修复后逐层取证（每处都做了 merge-base `c129b55` 对照 ⇒ 红全部为分支引入，非 main 既有）：

1. **⑦webFrameMode 默认档迁移只做了半截**（分支 2026-10-30 刻意迁移：默认档 auto→compat，"用户设备
   只有兼容档能播"；交付时只改了 client 侧，宿主模块与判据停在旧契约）：
   - `lib/web-wallpaper.js`：`WEB_FRAME_DEFAULT` 'auto'→'compat'（新默认唯一事实源，留痕）；
   - `lib/client.js` 四处：`mpwWebSandboxAttr` 把 `?sandbox=strict`（**场景帧标记**）改为**先于档位**判定
     —— 旧实现 compat 档会把渲染器帧的 strict 属性吞成同源兼容集（真安全回归，现钉死"不受档位管辖"）
     + 新增 `modeOverride` 参数（判据可显式驱动档位）；⑦迁移的早退条件补上 `wfmNeeds`（漏判会让
     "只有 webFrameMode 待迁移"的档永远迁不动）；fallback 状态措辞按实际档说"兼容档/沙箱档"；
     属性切换确认弹窗焦点纪律（去掉 `autoFocus` + `preventScroll:true`，dir-picker A5 全文件契约）；
   - `tools/web-wallpaper-test.mjs`（457/7 → **467/0**）：B7a/B7c/B7d/B7h 默认档读数随契约演进；
     B6 改档位可注入（auto 档旧意图逐字保留）+ 新钉 strict 前置不变量；**F2 随双许可契约演进**
     （LICENSE=双许可说明页 + package.json="SEE LICENSE IN LICENSE"，保护意图不变：插件本体不被 GPL 吞）；
   - `tools/wallpaper-lifecycle-test.mjs`（210/4 → 绿）：H 组显式设 auto 档（auto 档降级纪律判据逐字保留）
     + 新增 H13 段钉新默认 compat 档行为（不 degradable、状态如实播报、无降级痕迹）；
   - `tools/web-frame-origin-guard-test.mjs`（C2 崩溃 → 绿）：A/C 组显式设 auto 档 + A0' 钉新默认读数
     （A0' 独立成块——中途 loadPlugin 会重置同进程 diag 收集器）。
2. **cross-platform 依赖闭包器把注释当 import**（lib/index.js webloader 注释含 `import './bundle.js'`
   字样 ⇒ 夹具去读不存在的文件 ⇒ 对照组/变异子跑 ENOENT）：`tools/cross-platform-test.mjs` 的
   `stagePluginFixture` 扫描前剥注释（字符状态机，字符串原样保留；不用正则串行——字符串里的 `//`
   会被当注释吃掉后续真实代码，第一版就栽在这）。
3. **4 个渲染器字体许可文本 CRLF**（B4 文本卫生 4 处）：`renderer/assets/fonts/licenses/{CC0-1.0-
   PixelOperator,OFL-Segment7,monofur-monof_tt-notice,spincycle-bvfonts-README}.txt` 行尾 CRLF→LF
   （内容零变化，BOM 本就没有；D1'/D2' 自校验不受影响）。
4. **props-panel-wiring 瞬态红**（第 1 轮 step2 内 B1 行数=0 等 16 条；门禁外单独复跑 6/6 全绿、
   期间未改任何文件，红态不复现）：待本轮全量复核，读数如实记录。

### 验证读数（全量门禁，逐条真跑）
- 第 1 轮（修判据路径后）：PASS 11 / FAIL 1 —— 唯一红 step2；但因计数缺陷，5/6 步真红被吞。
- 第 2 轮（补语料符号链接后）：PASS 11 / FAIL 1 —— 同上；完整日志坐实 step2(3 个测试) + step5(web-wallpaper
  457/7) + step6(cross-platform 对照组) 真红。
- 第 3 轮（计数修复 + webFrameMode/闭包器/CRLF 修复后）：PASS 10 / FAIL 2 —— 计数修复后读数变诚实，
  又暴露两处被吞的红：step6（integrity-check 的 package.license 旧 MIT 契约 + secret-scan 把渲染器
  upstream 文件的 localStorage 键名/i18n 键名当凭据 3 处）+ step9（worktree 缺 node_modules ⇒
  header-rail-replica 的 playwright import 崩，445ms）。修复：integrity-check ⑧随双许可契约演进
  （package.license=SEE LICENSE IN LICENSE + LICENSE 双许可说明页，意图不变：不被 GPL 单边吞）；
  secret-scan 按其"逐条白名单 + 仍须命中"规矩登记 3 条假阳性（各带"为什么不是密钥"）；
  node_modules 符号链接到主检出（依赖清单两分支一致，.gitignore 补裸名防误提交）。
- 第 4 轮（全部修复后）：**PASS 12 / FAIL 0**（真跑 12 步，总耗时 958.1s，峰值内存 ≈1619 MiB）。
- 四判据：license-boundary **13/0** · renderer-host **33/0** · props-compat **71/0** · panel-smoke **5/5**。

### 遗留 TODO
- 门禁计数缺陷为 main 既有（本单已在分支修复并留痕）；main 合并本分支时一并带走。
- license-boundary 在 main 检出下跑时 `../we-scene-demo` 会作为"上游树"命中而走 SKIP+自校验分支
  （worktree 下直接解析到内嵌副本）；要真对拍用 `MPW_RENDERER_DEV=<同步源>` 显式指定。
- demo.html 公共 shader 头 `/shaders/**` 同源挂载缺口（lib/index.js P2 注释既有记录，非本单范围）。

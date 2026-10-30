# 最终渲染器统一方案（执行版）

> 目标（用户原话）：**"现在就是两个渲染器，各有各的好处，有的我能加载，上游加载不了，有的上游加载不了，我能加载，那现在我想要出一个最终的一个渲染器，把这两个它能加载的东西都一起用出来"**
> 本文是**执行版方案**（做什么/什么顺序/什么判据/怎么回退）；分析底稿见 `we-scene-demo/docs/RENDERER-UNIFY-PLAN.md`（F 线）与 `we-scene-demo/docs/reports-issue0924a2-line-{D,E,G}.md`。
> 路径一律从**仓库名**写起（`we-scene-demo/...`），工作区根 = `<工作区>`。

## 0. 一句话方案

**本仓渲染器（`we-scene-demo/demo.html` + `we-scene-demo/core/**`）作为唯一实现；上游产物（`we-scene-demo/demo/renderer/index.html` + `we-scene-demo/demo/assets/renderer-*.js`）降格为"参考实现 / AB 对照档"。
先把"两个渲染器各自能加载什么"变成**一张实测矩阵**，再按矩阵逐项把"只有产物能加载"的能力移植进本仓，直到矩阵里**产物独有 = 0**。**

理由：产物是 minified、不可重建（F 线核过：无源码/无行号 ⇒ 台账必填列填不出，反编译后重写还踩 `we-scene-demo/docs/COPYING-RULES.md` 的洁净室口径），
而本仓侧承载着诊断面（`/diag`、`/report`、`?ln=`）、属性面板、脚本沙箱、`?res=dpr` 活档位、测试台全套判据 —— 让产物当主干等于把可维护性全丢掉。

## 1. 验收口径（可机读，不靠感觉）

| 指标 | 目标 | 怎么量 |
|---|---|---|
| **产物独有可加载** | **0 个包** | 语料（`<工作区>/allwallpaper/{dd,0923,0917,wallpaperE}`）+ 用户库全量，逐个包在两档各挂载一次，记录 `首帧 / 层数 / 错误类`；矩阵里"产物 ✓ 且本仓 ✗"的条目必须为 0 |
| 本仓独有可加载 | 不要求为 0（本仓能多加载是收益） | 同上矩阵的"本仓 ✓ 且产物 ✗"列，作为回归护栏（不许减少） |
| 两档语义一致的项 | 冲突项按 §3 阶梯定案并留 A/B 判据 | `we-scene-demo/tests/bench-renderer-source-test.mjs` + 新增 `tests/renderer-parity-*.mjs` |
| 产物档仍可用（回退） | 保留 URL 档 `?rendererSrc=upstream`，行为不变 | `we-scene-demo/tests/bench-renderer-source-test.mjs` D0–D6 |

## 2. 分阶段（每阶段都能独立验证、可回退）

### Phase 0 · 实测差距矩阵（**先做这个，别先改代码**）
产出 `we-scene-demo/tests/renderer-gap-matrix.mjs` + 读数 `we-scene-demo/reports/renderer-gap-matrix.json`：
- 对库里每个包：在 `:8902` 用 `?rendererSrc=repo` 与 `?rendererSrc=upstream` 各挂一次（同一张包、同一视口、`?shell=0`），记录
  `首帧ms / canvas / 层数 / 主题色 / #log 里的错误类（取首条 ❌/⚠ 归类）/ 是否只出背景`。
- 输出三张表：**产物独有**（要移植的清单）/ 本仓独有（护栏）/ 两边都失败（另案：可能是包/资产问题）。
- 单 Firefox、分批（复用 `we-scene-demo/tests/mpkg-sweep-test.mjs` 的 `--batch ALL --offset/--limit` 骨架与内存看门狗）。

### Phase 1 · 把"产物独有"逐项移植（按矩阵排序，一项一判据）
每条移植都必须：**A/B 判据 + "改回去必红"变异 + 台账**。已知候选（F 线盘过，等 Phase 0 用矩阵定优先级）：
1. `usertextures`（`we-scene-demo/core/we-scene-bundle.js` 里 `grep usertextures` = 0 命中）；
2. `instanceoverride.brightness`（现有实现只有 `overbright`）；
3. `copybackground` 的 z 序（对应判据 `composite-zoomorder` 目前不存在）；
4. web 档帧盒几何（产物有私有 `nw()`/`Y1()`，本仓 `__wp` 无几何 setter ⇒ 需在**本仓**补齐等价能力，而不是借产物的私有函数）；
5. 其余按 Phase 0 矩阵补。

### Phase 2 · 产物降格（不改它的字节）
- 默认档保持本仓（现状已是）；文档口径统一为"产物 = 参考实现/对照档"；把 §3 的冲突结论写进 `we-scene-demo/docs/PATCHES.md`。
- 产物**仍在仓库里**（`THIRD-PARTY.md` 的再分发义务与"不改字节"纪律不变），只改我们的**文档与默认**，不做任何删改。

## 3. 冲突定案阶梯（用户第 4 点：以官方为准）

两个上游对同一处写法冲突时，按**这个顺序**取证（高者胜）：
1. **官方资产里的 HLSL/定义本身**：`<工作区>/wallpaper_engine/assets/{shaders,effects,particles,models,scenes}/**`（这是官方客户端随包资产，权威且本机就有）；
2. **官方类型/接口声明**：`<工作区>/wallpaper_engine/ui/dist/monaco/autocomplete/lib.sceneScript.d.ts`（2.8 的 d.ts 在 `<工作区>/Steam/steamapps/common/wallpaper_engine/ui/dist/monaco/autocomplete/lib.sceneScript.d.ts`）；
3. **官方二进制反汇编/反编译片段**：`<工作区>/wallpaper_engine/wallpaper64.exe`（x86-64，用 `llvm-objdump`）与 `<工作区>/Androidapk/壁纸引擎_2.8.8.apk` 里的 `lib*.so`（aarch64，`objdump` 可读）—— 已有取数先例：`we-scene-demo/docs/OFFICIAL-PARALLAX-RE-20260924.md`、`we-scene-demo/docs/OFFICIAL-WE-ARTIFACTS-20260924.md`、`we-scene-demo/docs/_official-extract/**`；
4. **可借用的 GPL/MIT 开源实现**（见 `we-scene-demo/docs/OPENSOURCE-BORROW-PLAN.md`，研究线在写）；
5. 产物（MIT，参考）；
6. 我们自己的实现。

**判据要求**：每条冲突结案都要在 `we-scene-demo/docs/PATCHES.md` 写"照谁、依据（file:line / 反汇编地址 / 链接）、读数"；说不清的写"未定"（不许猜）。

## 4. 可借用开源（用户第 5 点）
- 本仓 **GPL-3.0-or-later** ⇒ 可直接借 **GPL-3.0**（如 [`Almamu/linux-wallpaperengine`](https://github.com/Almamu/linux-wallpaperengine)，C++ 的 WE 完整重实现）与 **MIT/BSD/Apache-2.0** 等宽松许可；**不可**借 GPL-2.0-only / AGPL / 无许可证 / 商业条款的代码。
- 借用落点与归属声明按 `we-scene-demo/docs/COPYING-RULES.md` + `we-scene-demo/THIRD-PARTY.md` 既有口径执行（**不新增第二套**）；研究线的清单与判定在 `we-scene-demo/docs/OPENSOURCE-BORROW-PLAN.md`。

## 5. 执行纪律（与仓库既有纪律一致）
- 单写者（一个文件同时只有一条线在改）；浏览器一律 `flock /tmp/.mpw-firefox.lock -c '…'`；内存优先（15GB，曾 OOM）；
- 每阶段跑：`node we-scene-demo/tests/demo-syntax-check.mjs`、相关判据、`bash we-scene-demo/tests/run-all-tests.sh`（统一由编排者跑全量）；
- 库根用完 `POST http://127.0.0.1:8902/api/library-dir {"reset":true}` 复原；夹具一律放 `/tmp`（**不许**在 `<工作区>/allwallpaper/` 里造目录 —— 会被 `package-matrix` 当成新包）；
- 提交信息客观（不含"用户"字样）；两仓跑完门禁再提交/推送，必要时发 npm。

## 6. 做不到 / 边界（如实，别假装）
1. **真正合成一份代码**（把产物的实现直接并进来）：产物无源码、不可重建 ⇒ 只能"移植行为"，不能"合并字节"；
2. 让两档共享 web 帧盒几何：产物侧无公开 setter（`__wp` 14 个方法里没有几何接口）⇒ 只能在本仓侧实现等价能力；
3. 从产物吸收"上游最新行为"：产物是旧上游（自报 `v1.3.16`），仓外源树 HEAD 落后若干提交；
4. 取舍类差异全保（分辨率口径、AA 路线、`pq` 档）：**只能选一个**（本仓口径 = `?res=dpr` 活档位）；
5. 本机给出 Adreno 真机的画布级证据：本机只有 llvmpipe（软件 GL）⇒ 真机结论必须由用户复核。

## 7. 当前状态与下一步
- Phase 0 的脚本尚未落地（本轮起手）；Phase 1 的 5 个候选已列；冲突阶梯与借用清单已定框架（借用清单由研究线补齐）。
- 本方案落地后，用户可见的变化：**"某个包只有上游能加载"会消失**（Phase 0 矩阵可证），且默认始终是本仓渲染器（诊断/属性/脚本/分辨率档位都在）。

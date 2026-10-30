# TESTING.md — we-scene-demo 回归清单（MERGED-2 第 4 项 I 全量版 + C 会话扩展）

> 一键跑全部门禁：`bash run-all-tests.sh`（`--fast` 跳最慢项，`--json` 出机读汇总，
> `--list` 列全部项，`--only <name>…` 只跑指定项）。
> **条件项语义**（C5.1）：标注"条件项"的测试在无数据时**自动 SKIP 不红**（判据=工具自身输出
> `SKIP …` 且退出 0），有数据时严格。当前门禁 **36 项**（数字以 `--list` 为准）。
> 归档脚本见 archive/ 目录下的 LEGACY.md（**本地归档，被 .gitignore 忽略 ⇒ 不在仓库内、不在门禁内**；
> 全新克隆里没有它属于正常 ✓ —— 2026-10-11 复核：原写法的反引号路径会让 `docs-check` 在**没有该目录**的克隆里变红 ✗，故改为不带反引号的描述）。

## 门禁内测试（run-all-tests.sh 逐项执行）

| 测试/工具 | 作用 | 期望输出 | 依赖 | 门禁内 |
|---|---|---|---|---|
| `node --check core/we-scene-bundle.js` | bundle 语法 | 退出 0 | 无 | ✅ |
| `internal-shader-validate.mjs` | 内置 shader 转译+编译冒烟 | 13/13 通过 | 无 | ✅ |
| `glsl-validate.mjs` | GLSL 语义/常见雷区校验 | 128/128 通过 | 无 | ✅ |
| `mock-gl-test.mjs` | mock-GL 驱动渲染器全路径断言 | 12 通过 / 0 失败 | 无 | ✅ |
| `sprite-sheet-test.mjs` | 精灵表 UV/帧语义 | 17/17 通过 | 无 | ✅ |
| `particle-sprite-verify.mjs` | 粒子精灵帧/多图精灵 | 10/10 通过 | 无 | ✅ |
| `text-layout-test.mjs` | 文本排版/光栅 | 21/21 通过 | 无 | ✅ |
| `bloom-verify.mjs` | bloom 链 uniform/尺寸 | 14/14 通过 | 无 | ✅ |
| `script-tolerance-test.mjs` | 脚本引擎容错 | 10/10 通过 | 无 | ✅ |
| `frame-map-verify.mjs` | 帧映射/坏帧 | 8/8 通过 | 无 | ✅ |
| `tex-fmt5-test.mjs` | 格式5（半分辨率 DXT5） | 4/4 通过 | 无 | ✅ |
| `alignment-test.mjs` | 非 center 对齐/枢轴 | 184 checks | 无 | ✅ |
| `attach-transform-test.mjs` | 附件变换 vs elysia | ALL PASS（408 层 maxΔ<0.01px） | 无 | ✅ |
| `multi-sprite-test.mjs` | 多图精灵（TEXS0003） | 28/28 通过 | 无 | ✅ |
| `audio-semantics-test.mjs` | 音频层语义 | 20/20 通过 | 无 | ✅ |
| `camera-fillmode-test.mjs` | 相机/fillMode | 17/17 通过 | 无 | ✅ |
| `camera-node-test.mjs` | 相机节点动画 vs elysia | ALL PASS（maxΔ=0） | 无 | ✅ |
| `blink-phase-test.mjs` | 眨眼相位/动画 fps | 15/15 通过 | 无 | ✅ |
| `hdr-bloom-test.mjs` | HDR 浮点 RT+bloom 链（P-58 加 T0：`hdr=true/bloom=false` 自动 LDR、`?hdr=1` 仍强制） | 19 checks ALL PASS | 无 | ✅ |
| `render-closeout-test.mjs` | 渲染收口断言 | 22/22 通过 | 无 | ✅ |
| `tex-upload-guard-test.mjs` | 纹理上传守卫（0x502 根因链） | 39 断言 | 无 | ✅ |
| `mesh-badframe-test.mjs` | 网格坏帧检测/尾部切除守卫（W6，A 产出） | 22/22 通过 | 无 | ✅ |
| `hdr-predicate-test.mjs` | 自动 HDR 判据真值表（hdr×bloom×`?hdr=0/1`×会话熔断；P-58 H0） | 21/21 通过 | 无 | ✅ |
| `meshsize-test.mjs` | `?meshsize=1/crop` 网格 scale/origin 算术 + 官方标定对账 + mock-GL uniform（P-58 H1） | 48/48 通过 | 真包 3719111841（缺包 SKIP） | ✅ |
| `render-audit.mjs 3719111841` | 真实 renderScene 逐层审计 | mesh 5/5、正常返回 | 无 | ✅ |
| `skin-order-verify.mjs 3719111841 主体` | 蒙皮层序 | 误差 0.0000 | 无 | ✅ |
| `layer-rect-check.mjs 3719111841 --refrender` | 实绘矩形 vs 官方标定 | 中位 0px | refrender JSON | ✅ |
| `package-matrix.mjs --check` | 117 包逐包门禁+基线比对 | 退出 0、无退化 | 大内存（400MB/包上限） | ✅ |
| `perf-profile.mjs`（冒烟 `--pkg` 单包） | 静态成本+粒子 CPU 基准 | 产出 perf-matrix.json | 大内存 | --fast 跳过 |
| `docs-check.mjs` | 文档一致性：引用文件存在 + PATCHES P-编号健康 + diag 开关归并 | 退出 0 | 无 | ✅ |
| `dsh-mpkg-wallpaper/tools/panel-smoke.mjs` | 插件面板冒烟 | ALL PASS | 无 | ✅ |

## 平价基线（W11，条件项）

| 工具 | 作用 | 判定 | 依赖 |
|---|---|---|---|
| `parity-check.mjs` | 真机 GPU（`reports/r*.json` 的 `layerLedger[]`，只记上屏趟）vs CPU 期望（本地 `parseScene(attachCtx)`+`applyRenderConfig({sceneId})`）逐层对账 | rect：中心 ≤2px 且 wh ≤6px，越界即 FAIL（exit 1）；px：三档 soft/FAIL/diff（见工具头注释）；`known-issues.json` 白名单；自动标注 ownSizes/附件锚点嫌疑 | reports/ 有含 `layerLedger` 的上报（无则输出 `SKIP parity-check` 退出 0，门禁计 SKIP） |

输出：每场景 `reports/parity-<id>.json`（逐层 verdict + 汇总）+ 终端差异 Top-N 表。
开关：`--strict`（白名单条目也计失败，审计用）、`--tol <rectPx>,<pxFrac>`、`--no-px`（只对账矩形，快）、
`--top N`（差异表行数）。背景知识：台账 `rd` 是设计坐标矩形（画布 1280×720×3=投影 3840×2160），
「投影尺寸 ≠3840×2160 的场景」当前没有（全语料见 `LIBRARY-MANIFEST.md`）。

## report-audit.mjs 六段对账（C5.3 增强）

```bash
node report-audit.mjs <报告.json>   # 单份：①origin ②DIAG ③layerLedger ④texStats ⑤层健康
node report-audit.mjs --trend [N]   # 每场景最近 N 份跨报告趋势：稳定错 / 抽动 / 时有无
```
⑤ 层健康表：优先读上报的 `layerHealth[]`（A 会话约定字段，见 `<工作区>/docs/tasks/TASK-A-RENDERER.md` §4），
无该字段时回退由 `layers[]`+`layerLedger[]` 推导，输出一句话汇总（正常/跳过/GPU错/清屏灰计数）。
⑥ 趋势：同场景多份上报逐层矩形对比——"稳定错"（各份一致但偏离期望→改渲染语义可修）vs
"抽动"（各份之间在变→查脚本/动画/坏帧）。注意台账每份截 60 条、部分上报只含 1 层，
"时有无"偏高时先看各份台账条目数。

## 取证/画像工具（非门禁，改动对应语义时人工跑）

| 工具 | 作用 | 依赖/备注 |
|---|---|---|
| `package-matrix.mjs`（全量） | 117 包矩阵+门禁汇总，写 package-matrix.json | 内存大；`--json`/`--pkg`/`--max-mb` |
| `library-manifest.mjs` | 全语料清单（88 容器类型/规模/脚本段），识别视频壁纸；结论见 `LIBRARY-MANIFEST.md` | `--json` 落 `library-manifest.json`；`--only video` |
| `perf-profile.mjs --texreport <id>` | 单场景纹理总量/大纹理清单/预计显存 → `reports/perf-tex-<id>.json` | C6；给 A/B"该不该降采样"判断用 |
| `perf-profile.mjs`（全量） | 逐包静态成本+Top-10 重包+粒子 CPU ms/帧 | 内存大；防 OOM 见 `--max-mb` |
| `visual-diff.mjs` | 当前渲染 vs 参照（preview.gif/TP 截图/refrender 几何），SSIM+MAE+热图 | ffmpeg（无 npm 依赖）；参照不可用时走几何判据 |
| `headless-shot.mjs` | 渲染截图：Playwright 降级链 → CPU 预览兜底 | 本机 headless 不可用（证据自动落 /tmp/headless-evidence.json），自动落 CPU 预览（局限：无蒙皮网格/效果链） |
| `preview.mjs` | CPU 软光栅单帧预览（`node preview.mjs <id> <out.png> [w] [h]`） | 无 GPU 依赖 |
| `render-audit.mjs --pkg <路径>` | 任意 PKG/PKGM 容器逐层审计 | 无 |
| `feature-scan.mjs` | 全量特性键扫描（实现优先级依据） | 无 |
| `camera-scan.mjs` | 相机对象/动画语料取证 | 无 |
| `alignment-scan.mjs` / `elysia-transform-check.mjs` | 对齐/变换专项取证 | 无 |
| `tex-format-verify.mjs` | 纹理格式抽验 | 无 |
| `text-render.mjs` | 文本光栅库（被 text-layout-test 复用，非入口） | 无 |
| `diag-flag-check.mjs` | 诊断开关：代码抓取 == README-DIAGNOSTICS.md，0 差异 | 无 |
| `core/puppet-skin.js` | 蒙皮支持库（非入口） | 无 |
| `server/we-scene-demo-server.mjs` + `keep-demo-server.sh` | :8899 演示服务器 + 看门狗 | **不要手动重启**；`POST /diag` 在文件更新后下次重启生效 |

## 基线文件（门禁判据，勿手改）

- `package-baseline.json` — package-matrix --check 判据（重置：`node package-matrix.mjs --write-baseline`）。
  **语料新增（新下包）时不要用 `--write-baseline` 一把梭**（会把既有行连同本机负载下测得的 timing 一起重写，
  掩盖真退化）：用 `node tests/package-matrix.mjs --absorb-new --reason "<理由>"` —— 只**追加**新包、
  既有行原样保留，任一既有包退化或既有 path 消失即拒绝写入（rc=2），理由落进基线的 `absorbed[]`（P-108）。
- `perf-baseline.json` — 静态成本+粒子 CPU 基准（`node perf-profile.mjs --write-baseline`）
- `visual-baseline.json` — 视觉分数基线（`node visual-diff.mjs --id <id> --write-baseline`）
- `known.json` — 门禁白名单（每条豁免必须带 reason+date）
- `web/diag-flags.json` — diag-flag-check.mjs 生成（勿手改；服务器按 URL `/diag-flags.json` 提供）

## 插件侧（dsh-mpkg-wallpaper）

```bash
cd "$MPW_ROOT/dsh-mpkg-wallpaper"        # MPW_ROOT = 工作区根（默认由脚本位置推导 = 仓库的上一级）
node tools/panel-smoke.mjs      # 面板冒烟（含 sceneExtUrl 输入框、diagflag 三源集合一致）
```

改完插件后**不要重启 dsh**：`bash "$MPW_ROOT/update-plugin.sh"`（同步 + 热重载）→ 用户刷新浏览器。

## 诊断开关文档

- 全量开关表：`README-DIAGNOSTICS.md`（**62 个**，脚本抓取 + 双向比对；数字以 `node diag-flag-check.mjs` 输出为准）。
- `?selfcheck=1` 页内自检：见 `SELFCHECK.md`（与 package-matrix 字段对齐）。

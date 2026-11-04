# TESTING-PUBLIC —— 公开仓库的测试与门禁指南

> 给下载者与贡献者。项目内部还有更细的 `TESTING.md`、`README-DIAGNOSTICS.md`、`PATCHES.md`（改动史与证据）。
> 本文件只讲"怎么跑、跑什么、结果怎么读"。

## 1. 三条门禁（发布前必跑）

```bash
bash run-all-tests.sh                 # 渲染器全量：38 项（含条件项/慢项标记）
node docs-check.mjs                   # 文档一致性（引用完整性 / P 编号 / 调试开关代码↔文档）
node publish-check.mjs --assets <WE资产根>   # 发布闸门（体积/隐私/专有文件/必需文件）
```

- `run-all-tests.sh` 退出码：全绿/SKIP → 0；有失败 → 1；用法错误 → 2。失败项的最后 20 行见 `/tmp/run-all-tests-last.log`。
- 常用变体：`--list`（列出全部项与标记）、`--only <名> …`（只跑指定项）、`--fast`（跳过 `slow` 项）、`--json`（机读汇总）。
- **单项超时**：默认 600s（`ITEM_TIMEOUT=<秒>` 可改）。超时会记成该项 FAIL 并回收进程组，不会静默挂住整条门禁。
- **条件项**：无真机数据时工具自己输出 `SKIP <name>` 并退出 0（如 `parity-check` 在 `reports/` 为空时）。

## 2. 渲染器全量门禁包含什么（38 项）

| 分组 | 代表项 | 说明 |
|---|---|---|
| 语法/静态 | `bundle-syntax`、`demo-syntax`、`glsl-validate`、`internal-shaders` | 纯静态，秒级 |
| 语义套件（mock-GL / 纯 JS） | `mock-gl`、`sprite-sheet`、`text-layout`、`bloom`、`camera-node`、`mesh-badframe`、`tex-upload-guard`… | 不依赖 GPU，逐条断言渲染语义 |
| 真实包审计 | `render-audit-kal`、`skin-order-kal`、`layer-rect-kal`、`package-matrix` | 需要本地真实包（缺包时可能 SKIP 或按已知项豁免） |
| 平价/视觉 | `parity-check`、`visual-diff-kal` | 真机上报 vs CPU 基线；**需要 `reports/` 里有本机上报** |
| 交互/服务器 | `sandbox-cors`、`panel-smoke`、`perf-profile-smoke` | CORS/预检、面板冒烟、性能冒烟 |
| 时段/属性 | `time-variation` | 用户属性→脚本、时段层选择、`?time/?hour`、入站按键（56 断言） |

`known-issues.json` 是**已知差异白名单**（每条都有证据出处）；命中记 `known(KI-x)` 不算失败，
`--strict` 模式下连它们也算失败（发布前建议跑一次 `--strict` 看清全貌）。

## 3. 无 GPU / 无浏览器时的能跑与不能跑

- ✅ 全部静态与 mock-GL 套件、`preview.mjs`（CPU 参考渲染，小包/低分辨率）、`mock-gl-test.mjs`（可数 draw call）。
- ⚠️ `parity-check`/`visual-diff` 需要真机上报或基线图，否则 SKIP。
- ❌ **本仓库作者环境里 Playwright/headless Chromium 跑不起来**（PRoot/内存限制下 `page.evaluate` 即崩），
  所以"浏览器级视觉验证"请在你有 GPU 的机器上做；代码里不要依赖 headless 浏览器。

## 4. 已知环境注意事项（作者机实测，供参考）

1. 大包（100MB+）的 CPU 渲染会超过 60s，请用 `--only` 跑小包或降低分辨率。
2. 内存紧张时（swap 使用率高）单项可能出现 10–60s 的停顿——门禁的超时就是为此留的余量；
   同时跑多个重门禁会让结果不可信，请串行。
3. 遍历目录判断文件类型时**不要用** `fs.readdirSync(..., {withFileTypes:true})` 的 `Dirent.isFile()`
   （某些容器/overlay 文件系统会对普通文件返回 false，已导致过一次静默漏文件）；用 `fs.lstatSync()`。

## 5. 典型工作流

```bash
# 改一行渲染代码后：先快检，再定向，最后全量
node --check core/we-scene-bundle.js && node demo-syntax-check.mjs
bash run-all-tests.sh --only bundle-syntax mock-gl text-layout bloom
bash run-all-tests.sh                      # 收尾全量
node docs-check.mjs                        # 文档/开关一致性（新增开关必须同步文档）
node publish-check.mjs --assets <WE资产根>  # 只有准备发布时才需要
```

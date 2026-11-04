# MODIFICATIONS（对本目录内 GPL-3.0-or-later 代码的修改声明）

依据 GPLv3 §5(a)：分发修改过的版本时，必须显著声明"你修改过它"以及修改日期。
本文件是本目录（`renderer/`，即被内置进插件的渲染器副本）的修改声明。

- **上游项目**：wallpaper-engine-web-loader（we-scene-demo）
- **修改性质**：为"被 DSH 插件以内置方式托管并通过 iframe + postMessage 调用"所做的**增量**改动；
  未改变渲染器既有的渲染语义（`applyUserProperties` / 可见性收口 / `propsPanelModel` 的跳过规则等）。
- **修改日期**：2026-11-02（接入版本 v1）
- **修改文件与内容**：
  | 文件 | 修改 |
  |---|---|
  | `demo.html` | 新增只接收父页/自身来源的 postMessage op：`mpw-props-describe` / `mpw-props-reset` / `mpw-layers-list` / `mpw-layers-set` / `mpw-ui-set`；新增 `?noui=1` / `?propscompat=legacy` 等回退口 |
  | `tests/props-compat-test.mjs` | 新增（本目录内的判据，不属于上游发布面） |
  | `docs/README-DIAGNOSTICS.md` | 开关主表登记上述新增 URL 旗标 |
  | `web/diag-flags.json` | 由 `tests/diag-flag-check.mjs` 重新生成的开关清单 |
  | 其余 `core/**` | **未修改**（逐字节与上游一致） |
- **许可**：本目录仍然整体适用 **GPL-3.0-or-later**（全文见 `LICENSE`），第三方组件见 `THIRD-PARTY.md`。
- **源码可得性**：本目录即完整源码；如需上游未修改版本，见上游项目仓库。

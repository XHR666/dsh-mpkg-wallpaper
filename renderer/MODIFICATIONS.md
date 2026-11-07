# MODIFICATIONS（对本目录内 GPL-3.0-or-later 代码的修改声明）

  - **修改日期**：2026-11-05（接入版本 v2：壁纸最小化 / 去调试 UI / cover / 根层场景）
本文件是本目录（`renderer/`，即被内置进插件的渲染器副本）的修改声明。

- **上游项目**：wallpaper-engine-web-loader（we-scene-demo）
- **修改性质**：为"被 DSH 插件以内置方式托管并通过 iframe + postMessage 调用"所做的**增量**改动；
  未改变渲染器既有的渲染语义（`applyUserProperties` / 可见性收口 / `propsPanelModel` 的跳过规则等）。
  - **修改日期**：2026-11-05（接入版本 v2：壁纸最小化 / 去调试 UI / cover / 根层场景）
- **修改文件与内容**：
  | 文件 | 修改 |
  |---|---|
  | `demo.html` | 新增只接收父页/自身来源的 postMessage op：`mpw-props-describe` / `mpw-props-reset` / `mpw-layers-list` / `mpw-layers-set` / `mpw-ui-set`；`?noui=1` / `?propscompat=legacy` 回退口；`embed=1` 默认进入 noui；壁纸模式 canvas 强制 cover 全屏；删除顶栏/日志/属性/效果面板等静态调试 UI；无面板时仍保留 `__mpwPropsApplyHost` |
  | `web/diag-flags.json` | 保留上游诊断旗标清单；不再随嵌入副本生成 |
  | `tests/**`、`docs/**`、`server/**`、`reports/**`、`archive/**`、`packages/**`、`tools/**`、`demo/**`、`web/**`（diag-flags.json 除外） | **已从嵌入副本删除**：开发/测试/发布面，不属于壁纸插件运行依赖 |
    | `elysia/demo-elysia.js`、`elysia/we-renderer/**`（puppet/math 除外） | **已从嵌入副本删除**：`?mode=elysia` CPU 测试台，壁纸默认路径不加载 |
  | `core/**` | **未修改**（逐字节与上游一致） |
- **许可**：本目录仍然整体适用 **GPL-3.0-or-later**（全文见 `LICENSE`），第三方组件见 `THIRD-PARTY.md`。
- **源码可得性**：本目录即完整源码；如需上游未修改版本，见上游项目仓库。

---

- **修改日期**：2026-11-07（Z3 注释口径清理）
- **修改文件与内容**：
  | 文件 | 修改 |
  |---|---|
  | 2026-11-07 | 注释清理（仅注释；无功能/语义改动）：`demo.html` 注释里的对话痕迹标记词改写为需求陈述，技术事实（数字/日期/标识符/引用内容）逐字保留；`core/**` 未修改（逐字节与上游一致） |

---

- **修改日期**：2026-11-07（Z6 错误日志取证配合）
- **修改文件与内容**：
  | 文件 | 修改 |
  |---|---|
  | 2026-11-07 | 错误日志取证（无渲染语义改动）：`logf` 增加有界环形缓冲（≤20 行 × ≤200 字符）并暴露 `__mpwBootLogTail`；`capObj()` 追加准静态 `debug` 字段（ctxAcquire/caps/liveStart/liveRes/bootError/resTier/bootLogTail，<2KB 超限截断；逐帧易变的 frameNo 不入 capObj——capPush 按内容去重，frameNo 经 mpw-health 消息带出） |
  | `core/**` | **未修改**（逐字节与上游一致） |

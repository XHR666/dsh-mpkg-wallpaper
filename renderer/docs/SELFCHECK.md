# SELFCHECK.md — ?selfcheck=1 页内自检（MERGED-2 第 1 项 E）

## 是什么

`demo.html` 的**只读**自检开关：`http://127.0.0.1:8899/?id=<id>&selfcheck=1`。
首帧渲染约 5s 后统计页面真实状态，POST 一份 **≤8KB** 紧凑 JSON 到 `/diag`（POST 不可用时回退
`/report`，两者都落 `$MPW_ROOT/reports/`），页面右下角显示一行
**「自检: OK / 异常 N 项（…）」**。

**默认关闭；不开 `?selfcheck=1` 时零开销、零行为差异**（块内只有状态读取 + 一个 setTimeout，
不触碰渲染参数、不改层可见性、不注册渲染钩子）。

## 字段（与 package-matrix.mjs 对齐）

| 字段 | 含义 | 来源 |
|---|---|---|
| `layersVisible` | applyRenderConfig 后可见层数 | `scene.layers` |
| `layersDrawn` | 首帧审计中实际进入绘制的层数 | `[首帧] #N … vis=1` 行数 − 跳过行数 |
| `layersSkipped` | 跳过(不可见/容器)层数 | `[首帧] . #N 跳过` 行数 |
| `texLoaded` | 纹理表条目数 | `textures.size` |
| `texMissing[]` | 可见且声明纹理名但表中缺失的层名 | `scene.layers` × `textures` |
| `whiteFallbackLayers[]` | 白块回退风险层（可见非 solid 非 text 且纹理缺失） | 同上（静态判定） |
| `scriptErrs[]` | 脚本错误 `消息×次数`（≤6 条） | `__mpwScriptErrs` + window error 事件 |
| `sprites{textures,particles}` | 精灵表纹理数 / 用精灵表的粒子层数 | `tex.sprite` / `particleTexName` |
| `textLayers` / `particles` | 文本层数 / 粒子层数 | `l.__text` / `l.particleDef` |
| `anomalies[]` | 异常摘要（判定见下） | 汇总 |

## 异常判定（与 package-matrix 门禁同口径）

- 可见层数为 0（场景非空时）
- 层绘制失败 N 项（`[we-scene] 跳过渲染失败的层`）
- 白块层 N 项（`whiteFallbackLayers` 非空）
- 缺纹理 N 项（`texMissing` 非空）
- 脚本错误 N 项

## 已知局限（Node 审计 vs 浏览器自检的口径差）

1. **文本层**：`text:*` 纹理由页面文本渲染器运行时生成。自检（浏览器）在 5s 后统计，文本纹理
   通常已就绪；Node 侧 `package-matrix` 直接排除 `__text` 层。
2. **脚本驱动纹理**（Album Cover、音频封面、`Media Info` 等）在脚本引擎写入后才出现——首帧快照
   可能仍缺，属预期，不代表白块。
3. `layersDrawn` 由首帧审计日志行数推得，粒度是"层进入过绘制路径"，不等于 draw call 数。
4. 视频层在 Node 审计里不产生像素（无 `<video>`）；浏览器自检里 `texMissing` 同样可能含未就绪视频层，
   复核时看 `视频状态` 日志行。

## 服务器端

`POST /diag`（`server/we-scene-demo-server.mjs`）把 body 存为 `reports/selfcheck-<ts>.json`（≤16KB 保护）。
:8899 实例在该文件更新后的**下一次重启**生效；生效前页面自动回退 `POST /report`，报告同样落盘。

## 与 package-matrix 的关系

- `node package-matrix.mjs` = 离线全量矩阵（117 包，mock-GL，含基线 `--check` 门禁）。
- `?selfcheck=1` = 真机/浏览器侧单包快照。两者字段同义；把自检 JSON 的
  `whiteFallbackLayers/anomalies` 与矩阵该包 `issues[]` 对照即可定位差异来源（环境 vs 数据）。

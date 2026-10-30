# archive/LEGACY.md — 删除 `?att=legacy` 与 `refrender-*.json` 的预案（MERGED-2 第 4 项 I）

> **本文件只是预案，2026-09-12 会话未执行任何删除。**
> `?att=legacy`（旧锚点自算路径）与 `refrender-*.json`（官方父链合成之前的实绘定位标定）都已被
> 官方语义实现取代，仅作为回退/对照开关保留。何时删、怎么删、怎么回滚记录如下。

## 前置条件（全部满足才动手）

1. **真机连续 2 次验收无问题**（间隔 ≥1 周，覆盖默认路径 + `?selfcheck=1` 全绿）：
   - 3719111841（凯尔希）：眼睛/发片/飘带位置、附件随动正常；
   - 3554161528（唯一相机动画包）：入场运镜正常；
   - 任一多附件包（如 夜莺·alone）：发片不漂移。
2. `attach-transform-test.mjs` ALL PASS（官方采样与 elysia maxΔ=0）；
   `layer-rect-check.mjs 3719111841 --refrender` 中位 ≤1px（说明标定与官方语义一致，删标定不伤校验）。
3. `demo.html` 的 `?hier=0`/`?att=legacy` A/B 与默认路径截图一致（视觉无差）。
4. 删除前打 tag/备份：`cp demo.html demo.html.bak-pre-legacy-del` + 记录 HEAD（本仓无 git，靠 .bak）。

## 涉及文件与行号（2026-09-12 快照，动手前重新 grep 校对）

### ?att=legacy（ATT_LEGACY 分支）

- `demo.html:464` — `const ATT_LEGACY = ...get('att') === 'legacy'`
- `demo.html:484-…` — `if (ATT_LEGACY) try {` 旧 anchorsOf/mkOff 锚点自算块（产出 `attachmentOffsets` 表）
- `demo.html:788-809` — `if (ATT_LEGACY && …)` hier 父链预合并块（双重变换旧路径）
- `demo.html:827-828` — `scene = ATT_LEGACY ? lib.parseScene(…{attachmentOffsets, uniformFlipY, legacyAnimY:true}) : lib.parseScene(…{attachCtx,…})`（删后只留右侧）
- `demo.html:1609-1611` — logf 三元（删后留固定文案）
- `demo.html:1710` — `if (ATT_LEGACY && !animOff && attachAnim.size)` MDLA legacy 分支
- `we-scene-bundle.js:942` 附近 — parseScene 注释里的 `?att=legacy` 与 `opts.attachmentOffsets` 覆盖入口
  （`attachmentOffsets` 选项本身保留：是干净的外部注入接口，只删 demo 的调用方）

### refrender-*.json（实绘定位标定）

- 数据文件：`we-scene-demo/refrender-3719111841.json`、`ref-render-3719111841.json`（变体名，一并处理）、
  `ref-3719111841.json`（另见下"风险"）
- `we-scene-demo-server.mjs` — `/refrender/<id>` 路由（约 351-357 行）
- `demo.html:1550-1554` — `fetch('/refrender/'+id)` + `?hier` 停用逻辑；`demo.html:1570` — `refrender: rr` 传参
- `we-scene-bundle.js` applyRenderConfig（约 1128-1150 行）— `refrender` 实绘定位分支 + `anchor` 参数
- 消费方（**只读标定做校验基准，不是运行时依赖**）：`render-audit.mjs:59,63`、`layer-rect-check.mjs --refrender`、
  `preview.mjs`（REFR env）、`package-matrix.mjs`/`visual-diff.mjs`（refrender 几何判据兜底）

## 删除步骤（每步跑一次全量回归 = run-all-tests.sh）

1. 删 `demo.html` 的 5 处 ATT_LEGACY 分支（上表），`parseScene` 调用只留 `attachCtx` 路径。
2. 删 `demo.html` 的 refrender fetch/传参（1550-1554、1570）；applyRenderConfig 保留 `refrender:null` 兼容签名。
3. 删服务器 `/refrender/<id>` 路由；`rm we-scene-demo/refrender-*.json ref-render-*.json`。
4. `applyRenderConfig` 的 refrender/anchor 分支与 `layer-rect-check --refrender` 等**校验工具先不删**
   （它们读标定文件做基准——文件删了就自然退化为"跳过"，工具保留给将来重新标定）。
5. 全量回归 + 真机刷一遍上述 3 包。

## 回滚方式

- `cp demo.html.bak-pre-legacy-del demo.html`（或从本仓外备份恢复）；
- refrender JSON 从本文件记录的清单手工恢复（归档时把三个 JSON 复制到 `archive/` 一份再删，回滚=拷回）；
- 回滚后跑 `render-audit 3719111841`（mesh 5/5）+ `layer-rect-check --refrender`（中位 0px）即恢复原状。

## 风险注记

- `ref-3719111841.json` / `ref-render-3719111841.json` 与 `refrender-3719111841.json` 三个名字相近：
  删除前先 grep 消费方确认（当前只有 refrender-* 被 demo 运行时读取，另两个是历史探针输出）。
- `attachmentOffsets` 作为 parseScene 的 opts 接口与 `?att=legacy` 是两回事：删开关**不**删接口。

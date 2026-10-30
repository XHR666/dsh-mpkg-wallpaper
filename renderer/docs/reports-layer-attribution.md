# 层归因基建与 `?ln=N` 第二量法一致性（批次 3 · C0）

> 生成：2026-10-04（批次 3 C0）。工具：`tests/layer-attribution.mjs`（离线归因）、
> `tests/layer-attribution-consistency.mjs`（真机一致性 + §8 基线腿）。判据门禁项：
> `layer-attribution`（20 断言，~0.4s，纯 Node）与 `ln-consistency`（18 断言，~3.5min，headed Firefox）。
> 读数 JSON：`reports/layer-attribution-2887099508.json`、`reports/layer-attribution-consistency.json`。
>
> **复现命令**（浏览器一律 flock；无 GL ⇒ 整档 SKIP + 原样读数）：
> ```bash
> node tests/layer-attribution.mjs --pkg <abs scene.pkg> --summary --time 20
> node tests/layer-attribution.mjs --selftest
> flock /tmp/.mpw-firefox.lock -c 'node tests/layer-attribution-consistency.mjs'            # 一致性（门禁）
> flock /tmp/.mpw-firefox.lock -c 'node tests/layer-attribution-consistency.mjs --baseline' # + §8 基线腿
> ```
> 真机段口径：`:8902` 测试台、有头 Firefox + llvmpipe（~1fps）、视口 1280×720（--baseline）/960×540（一致性缺省）、
> `?res=dpr&shell=0&campose=legacy`、台账窗口 4s（每 250ms 重挂 `__mpwLedgerWant`）、基线腿 settle 20s（≈t21–23s 相位）。

## 1. C0①：离线层归因（整帧、无 `__lnHidden`）

`tests/layer-attribution.mjs`：真 `parseScene` + mock GL（scene-zoom/camera-pose 同款，跟踪 `FRAMEBUFFER_BINDING`）
+ 真 `renderScene`，经 `opts.onLayerDraw` 产每层
`{idx,id,name,type,vis,texture,textureHit,passes,copybg,chainInput,blend,rectDesign,rectDrawn,bind,skipReason}`
（schema 固定，文件头登记；`animGeom` 为登记过的可选字段）。skipReason 枚举（固定，不许 unknown 堆积）：
`invisible / invisible-config / invisible-anim / container / particle-no-def / particle-tex-missing /
particle-budget / particle-idle / degenerate-geometry / draw-failed / not-drawn(兜底，须登记新值)`。

**探针包 2887099508 @t=20s（一倍相位）读数**（82 层）：
上屏 47 / 未上屏 35；skipReasons = `{invisible-config:3, degenerate-geometry:11, invisible:16, container:4, not-drawn:1}`；
binds = `{rtcopy:25, texture:20, particle:2}`。

关键归因（全部是**机制**读数）：
- **`rtcopy:25`**——`copybackground:true` 且无自有贴图的层（Solid/纯色×3/黑底/mkj/右-菜单-底色/ldfk 等）走
  P-199 的"无内容 ⇒ 链输入=背景拷贝"分支（`core/we-scene-bundle.js` 的 `!effTex || copyBgInputLegacy()`）。
  **这正是 C2 的夹具面**：官方语义（WER-ALIGN G2）= solid 层换 `composelayer_clearalpha` 材质采样主帧缓冲，
  与"换链输入"是两件事。
- **`degenerate-geometry:11`**——sound 层 `scale=0 0 0`（只出声不出画）走 `renderLayer` 的退化早退
  （`lw0/lh0≤0 且非 solid 且无纹理`），与官方一致；C9 要保的是"音频侧不能被提前丢"，视觉侧该跳。
- **`not-drawn:1`**——#25 `Light shafts 0`（粒子）：def/贴图都在、无 P-59 跳过日志、0 次 draw；
  CPU 模拟（seed=`attr:`）t=20 存活 2 ⇒ 疑似渲染器种子相位/未登记跳过路径。**登记为 C4/C5 跟进残差**。
- **`invisible-config:3`**（wind.mp3/翻页mp3/在播放）——UI 名单正则按名字隐藏（作者原文不是 false）；
  工具以"parse 后 vs 配置后 visible 差分"归因，不复制正则。
- 文本层矩形异常（#36 `ggggg` px=[2241,2242]×[323,323] 一像素、#60 记事本同族）——`size=2 2` 退化
  文本层的实绘矩形（C8 的夹具读数）。

## 2. C0②：`?ln=N` 的第二量法 + 一致性读数（3 包）

量法 A（既有）= `?ln=N` 全帧统计；量法 B（独立）= **实绘矩形台账**：真机 `__mpwLayerLedger` × 离线
mock-GL 归因（同一套 mvp→矩形数学，y 向定符与 demo `mpwLedgerYDown` 同式）。断言（18 条，全绿）：

- **P1 ×3**——真机台账每条都对上离线归因的"已上屏"层（42/10/15 条）。重名层按**层序** zip
  （Fern×2/Clock×3；Map-by-name 会制造假阳性）。1 条解释类 `script-state`（探针包「在播放」：
  混淆脚本在真机把它改回可见——作者脚本驱动状态，离线不跑脚本）。
- **P1b ×3**——台账有 composite 条目（**C0 修复回归守卫**，见 P-229：`mpwLedgerYDown` 块级作用域
  错位曾让 composite 台账自 P-64-MEDIA 起全灭，只剩 mesh 条目）。
- **P2 ×3**——矩形失配逐条归类，未解释才红：
  `camera-scale`（真机跑作者脚本写 `general.zoom=3`，官方语义；离线不跑脚本 ⇒ 整包一致 3.002× 绕投影中心缩放，20 条）、
  `text-metrics`（文本层矩形由宿主文本度量决定，Node 无光栅器，22 条）、
  `mesh-pose`（蒙皮层 bbox 随骨骼姿态时刻变，1 条）、
  `anim-phase`（origin/scale 关键帧层，采样时刻不重合，1 条）、
  `transparent-content`（bind=transparent 不贡献像素，矩形位移无观感意义，2 条）。
- **P3 ×3**——归因"未上屏"的层，`?ln=N` 全帧 = 清屏色签名（uniq≤2 且 |meanL−清屏色|≤6；清屏色由
  `general.clearcolor` 现算）。三包全中 ⇒ **量法 B 的"没上屏"判定与量法 A 一致**。

**结论**：两种量法在"谁没画"上完全一致；在"谁画了"上的分歧全部落到命名机制类（脚本相机/文本度量/
蒙皮姿态/动画相位），其中 `?ln=4`（cloud）"归因已上屏却清屏色"的分歧已带证据登记
（全帧 ledger 有此层 ⇒ 分歧在 ln 隔离机制本身）——**这是 C4 的直接输入**。

## 3. C0③：§8 基线表复现（`--baseline` 腿，2026-10-04 实测）

探针包 2887099508、1280×720、`campose=legacy`、settle 20s：

| §8 行 | 本次读数 |
|---|---|
| 全帧 1× | meanL 226–245 / stdL 19–30 / uniq 4335–11627（**波动 = 场景动画**：时钟/粒子每秒都变；§8 的 132.5 是 P-226 时代单帧读数，引用需带相位） |
| bloom | `{enabled:1, isHdr:false, skipped:"capture-fail", threshold:0.21, strength:0.04, mip1:[320,180], mip2:[160,90]}`（与 §8 同） |
| 文本 | `① 文本层已光栅化: 13 层`（与 §8 同） |
| MDLA 坏帧 | 13 行：`r ear1#0/#1、l ear1#0/#1 跳过坏帧 9/30 [0,1,2,3,25,26,27,28,29]（阈值 5.0）` + 平滑自检（与 §8 同族，C5 输入） |
| copybg | 40 行 `[copybg] … COPYBG=1 + 链输入=…`（P-199 审计行，#log 不裁剪后可整段采到） |
| 台账 | composite 38 条 + mesh 5 条（P-229 修前 composite 恒 0） |

## 4. 边界与登记

① 离线归因**不跑场景脚本**：作者脚本（含混淆形态）驱动的可见性/取景差异按 `script-state`/`camera-scale`
登记——离线跑脚本是 C6 的边界（沙箱已在 `elysia/nsl.js`，接入归因工具留待该批）。
② 粒子层"存活 0"的 CPU 模拟用独立种子（`attr:`），与渲染器种子不同 ⇒ #25 的残差以
`not-drawn` 如实登记（不许把"没测到"算解释）。
③ `--baseline` 的全帧统计波动区间已在 §2 注明：**像素统计只作传感器**，达标判据永远是语义/机制断言。

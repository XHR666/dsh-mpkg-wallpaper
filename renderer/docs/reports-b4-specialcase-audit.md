# B4：包级白名单 / 特判盘点（批次 3 · 只出清单与草案，不改行为）

> 生成：2026-10-04。口径：把仓库里**按包 / 按尺寸 / 按名字**特判的地方盘出来，每条给
> 位置 / 当初为什么加 / 能否通用化（能 ⇒ 给默认关草案；不能 ⇒ 登记技术债 + 触发条件 + 移除代价）。
> **本批不强行改这些行为**（回归风险；任务书 §B4）。

## 1. 包级白名单（sceneId 硬编码）

| # | 位置 | 内容 | 当初为什么 | 通用化评估 |
|---|---|---|---|---|
| W1 | `core/we-scene-bundle.js:2039-2080`（`EYE_HACK_SCENES` / `eyeHackSceneIds` / `eyeHackEntry`） | 长条眼窗（eyehack）白名单，**只为凯尔希 3719111841 标定**；`?eyehack=1/0/legacy` 已有 A/B 与回退，`opts.eyeHackSceneIds` 注入口已留（**未开 URL 参数**——diag-flag-check 纪律） | 官方对"满幅背景 + 人物主体"的眼窗定位只有这一个包的实测标定 | **可通用化（默认关草案）**：判据 = "存在 ≥2 层带 `uvRect` 作者校准窗"或"作者 scene.json 自带眼窗字段"（语义未证实前不猜）；草案 = `applyRenderConfig({eyeHackSceneIds})` 由宿主按新判据传入，白名单降级为"首例标定缓存"。移除代价：低（凯尔希行保留为标定数据） |
| W2 | `core/we-scene-bundle.js:14283`（`layer.uvRect` "仅 3 个点名层"） | 眼窗校准窗**优先于**精灵帧推进的 3 个层 | 同 W1 的标定副产物 | 同 W1 合并处理；`__spriteUV` 不设即走 uvRect 分支的结构是对的，问题只在"名单怎么来" |

## 2. 名字正则特判（启发式，非包级但同族）

| # | 位置 | 内容 | 当初为什么 | 通用化评估 |
|---|---|---|---|---|
| N1 | `core/we-scene-bundle.js:3389` + `demo.html:8272`（uiRe，**两处逐字同步**，props-panel-test T19c 盯） | UI 名单正则（Cube/Song Title/…/sound/mp3/提示框…）无条件隐藏 | 用户口径"播放器外壳不该出现在壁纸上"；语料 73% 文本层因此曾不显示（N5 拆类别后缓解） | **半通用化**：N5 已拆出 clock/date/weekday/fps 四类开关；剩余正则是"播放器外壳"族。草案 = 把 uiRe 命中改成 `hideUI` 档的**分类豁免**（音频美术/时段变体已有同款豁免 `audioArtIds`/`timeVariantIds`），默认维持现状、`?showui` 已是整组回退。移除代价：中（196 处语料层会重新出现，需逐族取证） |
| N2 | `core/we-scene-bundle.js:2142-2146`（`audioArtIds`） | "名字命中音频美术词 **且** 有特效|粒子|作者绑定" ⇒ 豁免两条隐藏启发式 | 3326873240 `Audio Bars` 被实体遮罩层吞掉 | **已是通用判据**（名字∧结构双条件），登记为范本 |
| N3 | `demo.html` TIME-VARIATION（`timeVariantIds`） | 时段变体层按现实时钟选层 | 夜莺night 系 display/morningtime 属性 | **已是通用判据**（属性驱动非名字），范本 |

## 3. 尺寸常量特判

| # | 位置 | 内容 | 当初为什么 | 通用化评估 |
|---|---|---|---|---|
| S1 | `core/we-scene-bundle.js:3145`（`CLEARFX_LEGACY_THRESHOLDS=[3800,2000]` + `designCanvasOf`） | 旧 clearBgFx 的绝对像素阈值 | 旧判据"整屏层砍效果链"误伤 3327063360 | **已通用化**（narrow 档按设计画布同比放大；`?clearfx=legacy` 回退）——范本 |
| S2 | `core/we-scene-bundle.js` renderScene 的 `isFullCanvasLayer`（size≥sw-1/sh-1） | 满幅背景层豁免相机平移（viewBg=恒等） | 官方 elysia 同款（`size≥ortho−1`） | **已通用化**（官方同式），无需动 |
| S3 | `core/we-scene-bundle.js:14593` 的大层直绘审计（≥3800/2000 只在审计行用） | `?ln=`/审计日志的大层标注 | 日志可读性 | 无行为面，无需动 |

## 4. 结论
- **真白名单只剩 W1/W2**（同一件事：凯尔希眼窗标定）；已有 A/B 开关、注入口与"登记条目可查"
  （`eyeHackEntry`），通用化草案 = 判据改"作者校准窗存在性"，**默认关**（白名单降级为标定缓存）。
- 名字正则族（N1）是**行为面最大的特判**（196 层），通用化 = 分类豁免扩展，需逐族取证，不建议本线动。
- S1/S2/N2/N3 是已通用化的范本（判据 = 结构/属性/官方同式，不是名字或包 id）。

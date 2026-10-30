# TASK-RENDERER-QUEUE —— 渲染器待执行修复队列（2026-09-14，主会话维护）

> 用途：把"已查明根因、但还没落地"的渲染器修复按依赖与风险排好，谁拿到都能直接干。
> 规则：**同一时间只允许一个代理改 `demo.html` / `core/we-scene-bundle.js` / `elysia/**`**（历史教训：并行互踩覆盖）。
> 每条都给了根因证据来源、确切锚点、验收方法；改完按 `PATCHES.md` 追加条目（编号唯一递增）。

## 依赖图

```
Q1 日月循环 S+R（进行中：elysia/scene-scripts.js 用户属性转发 + 渲染器变体组/入站消息）
 ├─ Q4 hina 层复活（H1 依赖 Q1 的 Patch S 才能复验）
 ├─ Q9 逐层 UI（[加载此层] 按钮 / 被跳过层括号提示 / mpw-ln-key 入站）——R 已含骨架
 └─ Q7 Ctrl 退出网格块（同一个入站按键处理里加）
Q2 文字 4.17× 字号（demo.html:1543/1547，一行）
Q3 hideUI 正则口径（core/we-scene-bundle.js:1259）——**等用户拍板**
Q5 粒子默认开 + 官方预设兜底（demo.html:1870 一行 + readParticleDef）
Q6 脚本宿主能力（canvasSize 数组→Vec2、frametime、≥30Hz 文本/时钟 tick）
Q8 8899 日志区可收纳
Q10 第22项 混合加载服务器路由 /pkgdir + 前端混排
```

## Q1（进行中）日月循环 morning 固定 —— 证据 `docs/TIME-VARIATION-RESEARCH.md` / 补丁 `docs/TIME-VARIATION-PATCH.md`
- 根因：作者脚本 `new Date().getHours()` → `playVideo(0..3)` 切 morning/day/dusk/night；四处断点：RC1 `elysia/scene-scripts.js:552` `applyUserProperties({})`；RC2 层引用缺 `getVideoTexture`；RC3 `core/we-scene-bundle.js:1259` hideUI 正则 `|Day|` 误杀 `day` 层；RC4 `demo.html:1284` 的 `window.__mpwUserProps` 无人写；RC5 `demo.html` 无入站 message 监听。
- 交付：脚本兼容 S（≈19 行）+ 渲染器 R（≈170 行，含 `?time=`/`?hour=`、`[加载此层]/[恢复时钟]`、`mpw-time-set` 预留）+ 回退开关 `?nouserprops=1`。
- 验收：V1–V5（报告内），hour 3/6/12/18/22 → night/morning/day/dusk/night。

## Q2 文字统一小 4.1667 倍（第 3/11 项）—— 证据 `docs/TEXT-AND-CLOCK-RESEARCH.md`
- 根因：`pointsize` 官方定义是"300 DPI 下的磅值"（`lib.sceneScript.d.ts:838-841`），像素 = pointsize×300/72；渲染器 `demo.html:1543/1547` 直接当 CSS px。
- 补丁：`px = pointsize * 300 / 72`（保留 `?pts=raw` 走旧行为做 A/B）。风险低。
- 验收：砂狼白子 11_03「文本1」pointsize 34.798 → 画布 1280×720 下 11.6px → **48.3px**；`text-layout-test` 需同步冻结新口径（否则它仍按旧 px 自洽）。

## Q3 hideUI 正则把 73% 文本层强制隐藏（第 11/12 项）—— **等用户选口径**
- 现状：`core/we-scene-bundle.js:1259` 正则含 `Clock|Date|D a y|Day|时间|日期|星期` → 319/439 文本层被隐藏；6 个容器文本 100% 丢失。
- 选项：(A) 默认全显示（用户正要看时钟/日期/帧率）；(B) 只显示时钟/日期、继续隐藏帧率类调试文本；(C) 维持现状。
- 落地方式：无论选哪个，都要把 `|Day|` 这类**会误伤图层名**的裸词先改成带边界/前缀匹配，避免再次误杀（时间层 `day` 就是这么被杀的）。

## Q4 hina 37 层只出第 12 层（第 1/3/18 项）—— 证据 `docs/HINA-LAYERS-EVIDENCE.md`
- H1（主因）：14/37 层可见性 = `{"user":"newpropertyN","value":true}`，作者默认**全部 true**；用户属性没转发 ⇒ 全隐藏。**Q1 的 Patch S 落地后先复验这一步**。
- H2：钢琴/裙子底/背景是 `image: models/*.json` 的模型间接层（文件都在包内）→ 查这条链是否被解析、是否产生 draw。
- H3：`models/util/composelayer.json` 不在包内，需像 `fullscreenlayer` 一样加内置别名。
- 反证纪律：**不要用 `layerHealth` 判空**（该包 0 异常但 `layerLedger` 多为 0 次绘制）；用逐层像素覆盖/真实 draw 计数。

## Q5 粒子默认被关（第 17 项）—— 证据 `docs/PARTICLE-RESEARCH.md`
- 根因①：`demo.html:1870` `hideParticles: !has('np')` → 默认关，`core/we-scene-bundle.js:1249` 把每个粒子层 `visible=false`；`?np` 从未写进文档。
- 根因②：`readParticleDef`（`demo.html:1038-1043`）只查包内、无官方预设兜底 → 32 层被跳过（16/25 个引用在 `assets/presets/<主题>/particles/presets/*.json`）。
- 补丁：默认开 + 显式 `?noparticles` 关；`readParticleDef` 加 `/weassist` 与预设索引 → 约 102/111 层可出。注意 `render-audit.mjs` 自己硬编码 `hideParticles:true`（不受影响），`preview.mjs:323` 目前跳过粒子（CPU 预览看不到）。

## Q6 脚本宿主能力缺口（第 12 项）—— 证据 `docs/TEXT-AND-CLOCK-RESEARCH.md`
- `engine.canvasSize` 被当数组传入（`demo.html:1285` → `scene-scripts.js:351`）→ `.x` undefined → 19 个容器写 NaN 原点被静默丢弃；应传 Vec2（场景正交尺寸）。
- `engine.frametime` 恒 1/60（22 个容器）；文本/时钟脚本 tick 只有 **4Hz** → 帧率显示会写 "fps: 4"；需 ≥30Hz 或按帧 tick。

## Q7 Ctrl 无法退出"网格单块不可拆 MDL 单材质块"（第 7 项）
- 与 Q9 同一处入站按键处理：`Ctrl` 目前在渲染器没有配对处理（插件侧已把 `Control` 吞掉并转发）。补 `Ctrl` → 退出单块模式，并保证 `Alt`/`Home` 语义不变。

## Q8 8899 日志区可上下拉动收纳（第 15 项）
- UI 在 `demo.html` 底部绿色日志区：拖拽/点击箭头部分露出、剩余区域可滚动，完全收起后箭头反向可再拉出。纯前端，风险低。

## Q10 第 22 项 混合加载（mpkg + workshop 目录）——**服务器侧已完成**
- 工具：`we-scene-demo/server/pack-dir.mjs`（打包 + 生产解析器逐条 sha256 自证）。
- **已完成**：`server/we-scene-demo-server.mjs` 新增 `GET /pkgdir?d=<目录>`（即时打包 + 目录 mtime 缓存，最多 4 份）
  与 `GET /pkgdir?scan=1[&root=…]`（列出可打包目录）。实测：scan 列出 22 个目录；
  `?d=…/dd/3715743282` → HTTP 200 / 4,535,627 B / 0.03s；`parsePkg` 读到 `preview.jpg, project.json, scene.pkg`。
- **剩余**：前端列表把"目录源"与 mpkg 源混排（`?pkgurl=http://127.0.0.1:8899/pkgdir?d=…` 即可直接喂渲染器）；
  真机确认目录源渲染结果；`?scan` 结果超过 N 条时前端要分页/懒加载（用户明确要求别一次堆满屏）。

## 尚未立项（需要先做调查，别直接改）
第 2 项 Girl and cat 抽动、第 4 项 凯尔希背景与多层、第 6 项 伊蕾娜相框视频贴右下角、第 13/17 项剩余细节、第 1 项"第 12 层扭曲/配件乱飘"（动画合成方向）。
调查口径：先用 `?ln` 逐层 + 真机 `reports/r*.json`（`layerHealth`/`layerLedger`/`texStats`/`shot`）定位，再动手。

## ⚠ 环境结论（2026-09-14 02:00 实测，别再重复踩）

**本机无法做浏览器级验证**：`hina-probe.mjs`（Playwright + Chromium SwiftShader）连**最小页面** `http://127.0.0.1:8899/`
都在 `page.evaluate` 处崩：`Target page, context or browser has been closed`（内存 15GB/已用 11.4GB、swap ~10GB，
SwiftShader 起不来）。此前一个代理为此耗了 2.5 小时——**不要再用 Playwright/puppeteer 探针**。

本机可用的验证手段（按性价比排序）：
1. **bundle 级 node 探针**：直接 `import` `core/we-scene-bundle.js`/`elysia/scene-scripts.js`，解析真实包，
   数"可见层/活粒子层/文本层 px"等**逻辑量**（无需 GL）——本次文本与粒子研究都靠这个方法拿到硬数据。
2. `node --check` / `demo-syntax-check.mjs` / `diag-flag-check.mjs` / 定向 `run-all-tests.sh --only <项>`。
3. `preview.mjs`（CPU 参考）——但注意它**跳过粒子层**、且大包 >60s（本机换页），只适合小包/低分辨率。
4. `mock-gl-test.mjs` 计数 draw call（对"层是否产生绘制"这类问题有效）。

**真机验证由用户完成**：壁纸在插件里的最终表现（出画/磨砂/文字大小/时段切换）必须在用户机器上看。

## 已知差异登记（2026-09-14，parity 对账用）

修好 `parity-check.mjs:281` 的既有崩溃（`gl is not defined`）后，第一次读到**真机上报**就抓到三处真实分叉，
已按仓库纪律登记进 `known-issues.json`（`--strict` 下仍计失败，不会被忘掉）：

| 条目 | 场景 | 层 | 实测 | 归属 |
|---|---|---|---|---|
| KI-10 | 3719111841（第4项 凯尔希） | 主体 / 长发3 / 左耳朵1 | 主体 Δwh=271,172；长发3 Δwh=343,198；左耳朵1 ⚑ownSizes 0.51 | 第4项待查（Q4 之后） |
| KI-11 | 3554161528（第1项 hina） | 人物 | Δc=381.3px、Δwh=447,806、gl/cpu 尺寸比 0.64 ⚑ownSizes 嫌疑 | **第1项"第12层扭曲/配件乱飘"的量化证据** |
| KI-12 | 3544152633 | girl | Δc=1.3px、Δwh=54,46（蒙皮 bbox 口径差） | 回退类，观察 |

**注意**：`ownSizes` 嫌疑标注出现时先确认不是 `?ownsize=1` 被带进 URL——当前默认已关（`?ownsize=1` 才开）。
这三条都走 `skin+fallback-tex(mesh)` 兜底路径，与 Q4 的 H2/H4 是同一片区域，建议一起查。

## 批次 2（主修批收尾后立刻接）——锚点来自 `docs/VIDEO-AND-TWITCH-RESEARCH.md`（真机三方吻合）

> 用户口径（2026-09-14 03:0x 答复）：A 四类文本**做成开关**；C 音频**先在 :8899 加按钮**且**现场解析**当前包内音轨；反应效果**只预留接口**。

| # | 改动 | 锚点 | 规模 | 解决 |
|---|---|---|---|---|
| **N1** | `canvasSize: { x: cv.width, y: cv.height }`（现在是数组 → `.x` undefined） | `demo.html:1477` | 1 行 | 第6项主因链第 2 环；顺带修 19 处 NaN origin |
| **N2** | 兜底判据改成"按 `alignment` 算出的实绘矩形是否覆盖投影"，需要兜底时**尊重 alignment** | `demo.html:2359-2370` | ~6 行 | 第6项主因（`bottomleft` 整屏视频层被居中 → 只剩右下 1/4） |
| **N3** | additive 多层分支接好帧表 + **跨坏帧插值** | `demo.html:1590`（建表）+ `1941-1943`（采样） | 15–25 行 | 第2项抽动（每 6.0s / 7.89s 一次）；同类多动画层包一起受益 |
| **N4** | MDLA 记录游走修 id/name（+fps） | `elysia/we-renderer/puppet.js:367-398` | ~10 行 | 第2项成因3（正确性/其它包） |
| **N5** | 文本可见性**四类开关** | `core/we-scene-bundle.js:1361` hideUI 正则 + 新 URL 开关 | 中 | 用户 A 口径。**契约名已定死**（插件白名单已放行，见 `client.js` `MPW_SCENE_DEBUG_KEYS`）：`showclock` / `showdate` / `showweekday` / `showfps`，取值 `0`/`1`；实现时把 hideUI 正则里这四类词**改为受开关控制**（`|=1` 显示、`=0` 隐藏），默认值待用户 F3 回答；**`README-DIAGNOSTICS.md` 的四行必须由 N5 一并补**（`diag-flags` 门禁是"代码↔文档"双向比对，先写文档会红） |
| **N6** | :8899 顶栏 **🔊 音频按钮**：现场从当前加载的包里解析音轨、列出、逐条播放/导出（`/media` 音频 MIME 与 magic 嗅探**已就绪**） | `demo.html` 顶栏 + 现有 `/media`、`/raw`、`/pkgdir` | 中 | 用户 C 口径；**不在仓库预置他人机器上的音频**；反应效果只留 `__mpwAudioFrame` 之类接口位 |
| **N7** | 脚本宿主补完：`frametime` 真实值、文本/时钟脚本 tick ≥30Hz | `demo.html:1274` 附近 + `elysia/scene-scripts.js` | 中 | 第12项（帧率显示会写 "fps: 4"） |

**⚠ 时序坑（真机已验证，写死在报告 §1.5）**：脚本增量同步（`demo.html:1291` 基线 / `1527` 增量 / `3022` 循环内）**晚于** boot 兜底 ——
**只修 N1（canvasSize）反而更糟**（origin 会变成 1983,990）；**必须 N1+N2 同批**，且 N2 的触发条件改为"按 `alignment` 算出的实绘矩形是否覆盖投影"。
修好后该层应恢复 `[0,-140,4000,2300]` 满屏。

**零改动真机验证（今天就能做）**：`:8899/?id=3660962877&align=0` —— 若视频铺满整屏，即证明本诊断成立（无需等修复）。

**N3 的本地单测**：用 Node 复刻多层合成分支，断言"合成后逐帧位移 ≤ 50 单位"（抽动帧实测 1354/1462 单位）——可无浏览器回归。

**纪律**：N1+N2 必须同批（只做 N2 → 居中满屏也能用；只做 N1 → 时序坑仍在）；改完跑 `node preview.mjs` 前后对比 + 定向门禁 + 收尾全量；`PATCHES.md` 追加 P-57（唯一递增）；新开关写 `README-DIAGNOSTICS.md`。

### N6 细化规格（已核实，可直接照做）

**为什么几乎不用碰服务器**：渲染器把整个包读进内存并已能按路径取条目 —— `pkg.entries`（`demo.html:709` 打印条目数）+ `lib.getEntry(pkg, path)`；而 `makeSoundElement`（`demo.html:1358-1367`）**已经**在做 `Blob → URL.createObjectURL → new Audio()` 这套。所以音频是**纯客户端**能力：现场从当前包切片，不预置任何音频文件。

**实现步骤**
1. 枚举音轨：`pkg.entries` 里匹配 `/\.(mp3|ogg|oga|opus|wav|flac|m4a|aac)$/i`；再取 `scene.json` 的 `sound` 层（`layer.sound`/相对路径）做**名称与绑定的合并展示**（同一文件被多个 sound 层引用时只列一次，标注"被 N 层引用"）。
2. 每条：`bytes = lib.getEntry(pkg, path)` → `new Blob([bytes], {type: 由 magic 嗅探决定})`（服务端已有 `AUDIO_MAGIC_MIME` 同款逻辑；浏览器里若 `<audio>` 报错就按扩展名回退，扩展名会说谎是已证实的事实）。
3. UI：顶栏加一个 **🔊 按钮**（与现有 UI 面板同一容器，`hideUI` 那套开关逻辑旁边），点开一个小面板：
   - 列表：文件名 / 大小 / 时长（`loadedmetadata` 后填）/ 格式；
   - 每条一个 ▶︎/⏸ 与一个 `↓` 下载（`<a download="name" href=blobURL>`）；
   - 面板开关状态存 localStorage；不影响 `?showui`/`hideUI` 的既有语义。
4. **反应效果预留接口**（用户 C2）：`demo.html` 已有 `AudioContext` + `analyser`（约 1424-1427 行，给 scene sound 层用）。新增的播放器**复用同一个 AudioContext**，并暴露 `window.__mpwAudio = { ctx, analyser, current }`；再留一个每帧回调位 `window.__mpwAudioFrame?.(freqData)` 供后续接渲染器效果——**本批不实现效果**，只留位。
5. 公开仓库口径（用户 C1）：**不在仓库里放音频**；样例包自带的就是程序化生成的（无音频），真实壁纸的音频一律**在别人机器上运行时现场提取**。
6. 验收：`node --check`/`demo-syntax-check`；CPU 预览不受影响；`README-DIAGNOSTICS.md` 若新增开关需登记；真机上以第4项 凯尔希（4 条 MP3）为验证对象——点开应看到 4 条音轨、能逐条播放/下载。

## 批次 3（批次 2 收尾后）——真因来自 `docs/MODEL-INDIRECTION-RESEARCH.md`（545 行，已证伪三个旧假设）

### H0 第1项 hina 灰屏/整屏白 —— **HDR 路径把没写过的纹理全屏合成**（P0，一行级）
- 证据：图层绘制实际落在**默认帧缓冲**（`core/we-scene-bundle.js:4661` 在 compositeLayer 内 `bindFramebuffer(gl.FRAMEBUFFER, null)`），
  而 `:4737` 绑 HDR FBO、`:4748` 是全 bundle **唯一** `gl.clear` 且在 HDR FBO 绑定时执行 ⇒ HDR 路径下默认 FB 从未清屏；
  最后 `presentHdrScene`（`:4918` → `:3986-4008`）把**从未被写入**的 HDR 纹理全屏画出来 → 白/空。
- mock-GL 实证：默认路径 `draws INTO the HDR FBO: 0` / `sampling the HDR scene texture: 1`；`hdr:0` → 默认 FB 清屏 + 15 次默认 FB 绘制 + 0 次采样。
- 熔断为何不生效：`hdrFallback` 只看图层绘制期间的 `gl.getError()`（`:4822/4866/4911`），而图层画在默认 FB 上不报错 → 12/12 上报 `hdrFallback: None`。
- **零改动用户验证：壁纸 URL 加 `?hdr=0`**（`demo.html:2630-2634` 已接通）。
- **最小真修**：`:4722-4724` 的自动 HDR 分支加"场景确实消费 HDR"的条件（`&& general.bloom === true`）——hina 是 `hdr=true, bloom=false`，
  bloom 链是 HDR 的唯一消费者，故 HDR 不应生效。（"把 HDR FBO 绑进 compositeLayer"是更彻底但更高风险的改法，留到真机 A/B 再做。）
- 附带 bug：`:3992` `gl.blitFramebuffer(state.fbo.fbo, null, …)` 用了**非 WebGL2 的 11 参签名**（正确形式见 `:5236-5238`）。

### H1 第4项 凯尔希（主体/长发3/左耳朵1）+ hina 人物 —— puppet 网格没消费 `size`/`cropoffset`
- `renderMeshLayer`（`bundle:3923-3953`）按**网格原始范围**绘制；`layer.size` 与 `model.cropoffset` 都没用上
  （`cropoffset` 在 `:1387` 解析后**从未被消费**；调用点 `demo.html:2536`，台账矩形取自网格 bbox `demo.html:2547-2550`）。
- 修法（P1）：调用点喂 `scaleXY = [size/bboxW, size/bboxH]` 并用 `cropoffset` 校正 origin，替换 `:3938-3941` 的 `mesh.__center` 临时法；
  比值可回归：`左耳朵1 0.528/0.496`、`主体 0.838/0.923`、`长发3 0.853/0.891`、`hina 人物 0.682/0.600`。
- 注意：`demo.html:2431-2447` 的 `OWN_SIZE`（默认关）是**反方向**的旧补丁，修 H1 时不要把它当解法。

### 已证伪（别再花时间）
H2 模型间接链没坏（`image→models/*.json→material→.tex` 全通，含 `fmt4` 真像素）；H3 `composelayer` 别名**已存在**（`:1463`，另有前缀兜底）；
H1 用户属性默认值**确实被种下**（`demo.html:2163-2177` 展开 `project.json general.properties`）；白/透明兜底纹理不成立
（`WHITE_FALLBACK` 默认 false、`solid=false`、texObj 存在）。**"只有人物可见"是 `?ln` 步进的预期行为**（`demo.html:2236/2249` 隐藏非目标层），不是层丢失。

### 批次 3 的**可直接套用**补丁细节（2026-09-14 03:xx 核对真实代码后补）

**H0（一行级，锚点已核对）**：`core/we-scene-bundle.js` 约 4805 行的自动 HDR 判据现在是
```js
: (!hdrForceLdrSession && (general.hdr === true || (general.hdr && general.hdr.value === true)))
```
改为"**只在场景确实消费 HDR 时才自动开**"（HDR 的唯一消费者是 bloom 链）：
```js
: (!hdrForceLdrSession
   && (general.hdr === true || (general.hdr && general.hdr.value === true))
   && (general.bloom === true || (general.bloom && general.bloom.value === true)))
```
- `?hdr=1` 的强制分支**不动**（诊断/对照仍可强制）；`?hdr=0` 语义不变。
- 验收：`node preview.mjs` 对 hina（本机语料 `allwallpaper/dd/3554161528`；该包**不再随仓库分发**，原 `samples/wallpapers/3554161528` 已于 P-87 删除）在 `?hdr=0` 与修后默认之间应**一致**；
  mock-GL 计数应从"默认 FB 0 次绘制 + 1 次采样空 HDR 纹理"变成"默认 FB 清屏 + 15 次绘制 + 0 次采样"。
- 用户自验：URL 去掉/保留 `?hdr=0` 结果应相同（都正常出画）。

**H1（puppet 网格消费 `size`/`cropoffset`）**：调用点 `demo.html:2526`
```js
const ox = layer.origin ? layer.origin[0] : 0, oy = layer.origin ? layer.origin[1] : 0
const sx = layer.scale ? layer.scale[0] : 1, sy = layer.scale ? layer.scale[1] : 1
renderer.renderMeshLayer(layer, sk.mesh, sk.gBones, sk.nb, [ox, oy], [sx, ySign * sy], [projW, projH], texObj.glTex)
```
- 要点：`scaleXY` 应来自 **`layer.size / mesh.__bbox`**（现用的是 `layer.scale`，与网格原始范围脱钩），
  `origin` 需按 **`model.cropoffset`**（`bundle:1387` 解析但从未使用）与 `alignment` 校正；
  同时评估是否停用 `:3938-3941` 的 `mesh.__center` 补偿（研究判定它是早期权宜）。
- **不要**把 `demo.html:2426` 的 `OWN_SIZE`（`?ownsize=1`，默认关）当解法——那是反方向的旧补丁。
- 验收（可无浏览器）：`layer-rect-check.mjs 3719111841 --refrender` 中位 px 不退化；
  `parity-check` 里 `主体/长发3/左耳朵1` 的 gl/cpu 尺寸比从 **0.84/0.85/0.53** 收敛到 ≈**1.0**（KI-10 可随之降级或删除）；
  `visual-diff --check` SSIM 不退化。

**H0 附带**：`bundle` 约 3992 行的 `gl.blitFramebuffer(state.fbo.fbo, null, …)` 用了非 WebGL2 的 11 参签名，
正确形式见同文件 5236-5238 行（`?blit=` 分支）。

#### H1 读代码后的精确结论（2026-09-14 03:xx，供批次 3 直接实现）

| 事实 | 位置 | 含义 |
|---|---|---|
| `cropoffset` 是**模型级**字段 | `core/we-scene-bundle.js:1468` `cropoffset: modelJson.cropoffset ? parseVec2(...) : null` | 挂在 model 上，不在 layer 上 |
| `cropoffset` 语义**已实现但只用于 quad** | `:4522` 注释"裁剪窗 quad（cropoffset 语义）：几何=窗大小、窗心对齐层中心+偏移，UV=0..1" | 网格路径（`renderMeshLayer`）不消费它 |
| `mesh.__bbox` **当前没有保存** | `:3942-3949` 只算了 `mesh.__center = [(mnx+mxx)/2,(mny+mxy)/2]` | 需要**顺手把 `__bbox=[mxx-mnx, mxy-mny]` 一并存下**（一行） |
| `layer.size` 可用且是 authored 场景单位 | `:1356` `l.size=[es[0],es[1]]; l.scale=[1,1,…]`；quad 几何用 `layer.size × scale` | 网格路径目前的 `scaleXY` 来自 `layer.scale`，与网格原始范围脱钩 |
| 已有 A/B 开关 | `MCC_ENABLED`（`?mcc=0/1`）控制 `__center` 补偿，默认开 | H1 的改动应**复用这种"默认不变 + 开关对照"**的做法 |

**实现要点（批次 3）**：
1. `:3949` 处同时记录 `mesh.__bbox`；
2. 新行为挂在**新开关**（如 `?meshsize=1`，默认**关**）之下，内部：
   `scaleXY = [layer.size[0]/bbox[0], layer.size[1]/bbox[1]]`（y 方向仍乘 `ySign`），
   origin 用 `model.cropoffset` 与 `alignment` 校正；`?meshsize=1` 时停用 `mesh.__center` 补偿以避免双重校正；
3. **验收（可无浏览器）**：`parity-check` 中 `3719111841` 的 `主体/长发3/左耳朵1` 尺寸比从
   **0.838/0.853/0.528** 收敛到 1.0±0.05（KI-10 可随之删条目）；`layer-rect-kal` 中位 px 不退化；
   `visual-diff --check` SSIM 不退化；默认（不带开关）时**所有数值与今天逐位一致**（保证零回归）。
4. 真机由用户用 `?meshsize=1` 对照确认后再决定是否翻默认。

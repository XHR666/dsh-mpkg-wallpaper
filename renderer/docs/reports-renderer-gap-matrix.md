# 渲染器差距矩阵（Phase 0 实测读数）

> 方案：`we-scene-demo/docs/RENDERER-UNIFY-FINAL-PLAN.md` §1（验收口径）/ §2（Phase 0）。
> 脚本：`we-scene-demo/tests/renderer-gap-matrix.mjs`（可反复跑、可分批复现）。
> 机器可读读数：`we-scene-demo/reports/renderer-gap-matrix.json`（本报告的每个数字都能在它里面逐包核对）。
> 语料：`<工作区>/allwallpaper/{dd,0923,0917,wallpaperE}` 里**含 `scene.json`** 的容器（排除 `delete/` 副本），共 **116** 个。
> 两档：**本仓** = `:8902/webloader/`（`demo.html` + `core/**`）；**产物** = `:8902/wallpaper-engine-webgl/renderer/index.html`（`demo/renderer/index.html` + `demo/assets/renderer-BOSoB05I.js`）。

---

## 0. 一句话结论

**语料 116 个包里，"产物能加载而本仓不能"的包 = 0 个 ⇒ 按 §1 的验收口径，"要移植的清单（加载层面）"为空；
反过来"本仓能加载而产物不能"= 65 个（全部是 `.mpkg` / `PKGM*` 容器），两边都失败 = 0 个。**
产物侧那 65 个失败有**两道结构性门**（都实测到原样日志）：①容器的读包函数**只认 `PKGV` 开头的魔数**——`PKGM0014/PKGM0018` 直接抛
`不是 scene.pkg，魔数: PKGM0014`；②把魔数改对之后还有 **`未支持的纹理格式: 5`**（`.mpkg` 里的 DXT5 变体，本仓 `core/we-scene-bundle.js` 的 `case 5` 支持、产物不支持）。
另有 **7 个包**两边都出画、但**某个效果 pass 编译失败被跳过**（`wrong operand types` / `assigning non-constant to 'const highp float'` / `Varying 'v_TexCoord' is not linkable` 这类）：
其中 **2 个包是本仓独有的 pass 缺口**（产物那几处没报错）⇒ 这才是加载层面之外**真正要移植/要修**的清单；另有 **3 个包是产物独有**（本仓的转译已经更强），2 个包两边都跳（但跳的不是同一个 pass）。

---

## 1. 怎么量的（口径可复现）

### 1.1 两档各挂一次（**不经测试台 UI 状态机**，直接导航到渲染器页）

| 档 | URL 形状 | 挂载契约 |
|---|---|---|
| 本仓 | `http://127.0.0.1:8902/webloader/?type=scene&id=<id>&pkgpath=<绝对路径>&res=dpr&shell=0` | 页面自己按 `?pkgpath=` 取包 |
| 产物 | `http://127.0.0.1:8902/wallpaper-engine-webgl/renderer/index.html?type=scene&id=<id>&pkgpath=<绝对路径>` | **URL 参数不生效**（见 §2 探测①）⇒ 导航后用产物**自己的公开契约** `window.__wp.loadSceneFile(new Blob([bytes]), projectJson)` 挂载；包字节由页面内 `fetch('/pkgpath?p=<绝对路径>')` 取（同一条服务端通路） |

`id` = 文件名（去扩展名）经 `encodeURIComponent`；`pkgpath` 走 `:8902` 的 `/pkgpath?p=`（实测可用；容器字节只在浏览器里流转，不落盘）。
两档**同一视口** 960×540、`deviceScaleFactor=1`；本仓档带 `?res=dpr&shell=0`（dsf=1 时画布 = CSS 尺寸 ×1）。

### 1.2 逐包读数与判据

| 指标 | 本仓 | 产物 |
|---|---|---|
| 是否出画 | `window.__mpwFirstFrame` 为真（`demo.html:8353` 置 1）**且** canvas `w/h > 0` | 出现 `w/h > 0` **且不等于 300×150** 的 canvas（未挂载时产物页一个 canvas 都没有，只有默认壁纸 iframe） |
| 首帧 ms | `#log` 里的 `✅ 首帧完成 <ms>ms`（精确值） | 轮询首次见到 canvas（`~ms`，粒度 = 800ms） |
| canvas | `#sc` 的 `w/h`（+ CSS 尺寸） | 最大 canvas 的 `w/h`（+ CSS 尺寸） |
| 层数 / 纹理数 | `window.__sceneLayers`（层数）+ `window.__mpwTexStats`（纹理台账条数） | `window.__wpStats`（实测恒为 `{}` ⇒ **null**，不猜） |
| 日志 / 错误类 | `#log` 里**带 `❌`/`⚠` 的行**（信息行不算），按 §1.3 的类表归类 | 产物页**没有 `#log`/`#logbody`**（那是测试台注入的）⇒ 页面内 hook `console.warn/error` 的**实参**捕获 + Playwright console 事件 |
| 是否"只有背景" | 截画布那一块 → 页面内解码 → `meanL/maxL/stdL/litFrac`：`maxL<=1`=`blank`；`stdL<0.6`=`uniform`（疑似只有背景）；截不到=`unmeasured` | 同左 |

### 1.3 失败类表（短标签 → 判据正则，两个来源共用）

`pkg-magic`（`不是 scene.pkg`/`魔数`）· `boot`（无法建 WebGL2/上下文丢失）· `pkg-read`（取包/目录表/HTTP 4xx-5xx）·
`scene-parse` · `shader-pass`（`跳过编译失败的 pass`/`pass 编译失败`/链接失败）· `gl-operand`（`wrong operand types`/`no matching overloaded`/`纹理上传报错`/`INVALID_*`）·
`video` · `particle` · `puppet` · `layer-load`（`加载失败`/`初始化失败`/`绘制失败`）· `font` · `script` · `render-loop`（`scene render failed`）·
`texture-miss` · `unmounted`。取**首个命中**（越具体越靠前）；出画的行只记 `warnClass`，不进失败类直方图。

### 1.4 分批 + 看门狗（内存优先）

`--offset/--limit`（每批一次独立浏览器生命周期）· `--abort-free-mb 900`（渲染途中可用内存低于它立刻停批）·
`--min-free-mb 1400`（换包前低于它不跑余下）· `--out`（默认 `we-scene-demo/reports/renderer-gap-matrix.json`，**按 `rel` 增量合并**，分多批跑完 = 一份完整 JSON）。
跑前若 `pgrep -af run-all-tests` 有全量套件在跑 ⇒ `sleep 60` 等它结束（套件不取锁）；所有浏览器命令一律 `flock /tmp/.mpw-firefox.lock`（**同一时刻只允许一个 Firefox**）。
库根：脚本用 `pkgpath` 直挂 ⇒ **全程没有切库根**（因此无需 `POST /api/library-dir {"reset":true}`）。

---

## 2. 判据来源（先说清"产物侧到底怎么判"，这些是实测探测，不是猜）

**探测①：产物页不认 `?pkgpath=` / `?id=`（所以不能照本仓那条 URL 直挂）**
`flock /tmp/.mpw-firefox.lock -c 'node /tmp/probe-upstream.mjs up'`（探测脚本在 `/tmp`，非交付物）在 t=1/3/6/10/16/24s 六次读数全部相同：
`body` = 一个 `<div style="position:fixed;inset:0"><iframe sandbox="allow-scripts" src="/wallpaper-engine-webgl/default-wallpaper/index.html">`，
`document.querySelectorAll('canvas').length = 0`，`document.getElementById('log') = false`，`window.__we* = []`；
`window.__wp` 18 个方法（`setWallpaper/pause/resume/setFit/setVolume/release/restore/setRenderDpr/setSceneFps/setFilter/updateWebProps/pushPointer/pointerLeave/pushWheel/loadSceneFile/setAudioBridge/capture/getProperties`）。
静态对照：产物只读 `type/src/fit/renderDpr/sceneFps/muted/loop/filter/mediaBase/liveSystem/opaque` 这 11 个 URL 参数。

**探测②：`__wp.loadSceneFile(blob, project)` 这条路可行**
用仓库自造的 `samples/sample-synthetic/scene.pkg`（33 299 B）走这条路：t≤2.5s 出现 `canvas 960×540`，**0 条** console 告警。

**探测③：4 个包对照（`.mpkg` 全挂不住、`scene.pkg` 挂得住）**
`红鸾樱落.mpkg`(9.4MB) / `佩丽卡1_10.mpkg`(14.3MB) / `陈千语_01.mpkg`(58.7MB) → 全部 `console.warn` + **无 canvas**；
`dd/3326873240/scene.pkg`(235.4MB, PKGV0023) → 6s 出 `canvas 960×540`。

**探测④：产物侧的真错误文本（`msg.text()` 会被吃掉，必须 hook console 实参）**
Playwright 的 `console` 事件只给 `scene render failed: Error`；在页面内 hook `console.warn` 后拿到实参：
`["scene render failed:", "不是 scene.pkg，魔数: PKGM0014"]`（栈：`renderer-BOSoB05I.js:904:52617` → `loadSceneFile` `:2325:14142`）。
⇒ 本脚本因此在产物档用 `page.addInitScript` 装 `console` 捕获（`out.cap`/`out.rej`），**不用** `msg.text()` 当判据。

**探测⑤：魔数对照实验（证明"第一道门"就是容器魔数）**
`cp 红鸾樱落.mpkg /tmp/gap-magic/scene-pkgv.pkg`，把偏移 4 起的 `PKGM0018` 改成等长 `PKGV0023`（**只改这 8 字节**），
经 `/pkgurl?u=http://127.0.0.1:8931/scene-pkgv.pkg`（`/pkgpath` 白名单不含 `/tmp`，实测 403 ⇒ 用一个 `/tmp` 静态夹具服务）挂产物：
过了魔数门，随后 `unhandledrejection: 未支持的纹理格式: 5`（栈 `renderer-BOSoB05I.js:260:15914`…），**仍无 canvas**。
⇒ 产物侧对 `.mpkg` 语料有**两道门**；本仓两侧都能过（`core/we-scene-bundle.js:1033-1040`：`case 4`/`case 5` 都走 `decodeDXT5`，注释注明"格式 5 = DXT5，载荷同格式 4，仅容器声明宽高为实际尺寸 2 倍（RE-40）"）。

---

## 3. 语料与枚举口径

| 项 | 数 |
|---|---|
| 四个语料根下的容器总数 | 199（`dd` 11 · `0923` 30 · `0917` 10 · `wallpaperE` 148） |
| 其中含 `scene.json` | **116**（`.mpkg` 65 · `.pkg` 51）⇒ 本矩阵的枚举面 |
| 魔数分布 | `0923`：PKGV0001×1/0018×1/0021×1/0022×4/0023×17/0024×6；`dd`：PKGV0022×3/0023×5/0024×3；`0917`：PKGV0020×1/0021×1/0022×3/0023×2/0024×3；`wallpaperE`：**PKGM0014×60 / PKGM0018×5** |
| `delete/` 副本（**排除**） | 7 个容器，其中 5 个含 `scene.json`（与库内保留件同源的副本） |
| 目录表读不动 | 0 |
| 口径与 `tests/mpkg-sweep-test.mjs --batch ALL` 的**有意差异** | 本档默认**也收 `.pkg`**（`--mpkg-only` 可切回"只 `.mpkg`"）：否则 `dd/0923/0917` 三根会整根为空，而任务书要求语料根至少覆盖它们 |

---

## 4. 三张表

### 表 1 · 产物独有（产物 ✓ 且 本仓 ✗）—— 要移植的清单

**0 个包。** 语料（116 个含 `scene.json` 的容器）里**不存在**"产物能加载而本仓不能"的包 ⇒ 按 `docs/RENDERER-UNIFY-FINAL-PLAN.md` §1 的口径，**本阶段"要移植的清单"（加载层面）为空**。

### 表 2 · 本仓独有（本仓 ✓ 且 产物 ✗）—— 回归护栏，**不许减少**

共 **65 个包**，全部是 `PKGM0014/PKGM0018`（`.mpkg`）容器，产物侧失败类**同一个** `pkg-magic`：

> `warn: scene render failed: 不是 scene.pkg，魔数: PKGM0014`（典型行；PKGM0018 同形）

| # | 包 | 体积 MB | 魔数 | 本仓读数（画布/首帧） | 产物失败类 |
| --- | --- | --- | --- | --- | --- |
| 1 | `wallpaperE/伊蕾娜/夜莺night——【time_variation时间变化】elaina_伊蕾娜：闲憩微息【魔女之旅】day_night.mpkg` | 315.9 | PKGM0018 | 960×540 / 425ms | pkg-magic |
| 2 | `wallpaperE/遐蝶/夜莺Night——Honkai Star Rail Castorice 遐蝶 冥河永渡 崩坏星穹铁道The Etern.mpkg` | 78 | PKGM0018 | 960×540 / 3560ms | pkg-magic |
| 3 | `wallpaperE/流萤/夜莺night——【customize自定义】firefly_流萤_星空之誓——夜莺night崩坏星穹铁道.mpkg` | 73.8 | PKGM0018 | 960×540 / 6307ms | pkg-magic |
| 4 | `wallpaperE/砂狼白子/砂狼白子11_03.mpkg` | 61 | PKGM0014 | 960×540 / 321ms | pkg-magic |
| 5 | `wallpaperE/佩丽卡/佩丽卡1_06.mpkg` | 60.6 | PKGM0014 | 960×540 / 293ms | pkg-magic |
| 6 | `wallpaperE/白洲梓/白洲梓_09.mpkg` | 60 | PKGM0014 | 960×540 / 40ms | pkg-magic |
| 7 | `wallpaperE/蔚蓝档案/蔚蓝档案_06.mpkg` | 59.7 | PKGM0014 | 960×540 / 41ms | pkg-magic |
| 8 | `wallpaperE/洛茜/洛茜_07.mpkg` | 59.5 | PKGM0014 | 960×540 / 252ms | pkg-magic |
| 9 | `wallpaperE/佩丽卡/佩丽卡1_09.mpkg` | 59.5 | PKGM0014 | 960×540 / 139ms | pkg-magic |
| 10 | `wallpaperE/遐蝶/遐蝶_09.mpkg` | 59.1 | PKGM0014 | 960×540 / 1223ms | pkg-magic |
| 11 | `wallpaperE/卡提希娅/卡提希娅_02.mpkg` | 59 | PKGM0014 | 960×540 / 1676ms | pkg-magic |
| 12 | `wallpaperE/芙宁娜/芙宁娜_08.mpkg` | 58.9 | PKGM0014 | 960×540 / 278ms | pkg-magic |
| 13 | `wallpaperE/芙宁娜/芙宁娜1_04.mpkg` | 58.9 | PKGM0014 | 960×540 / 172ms | pkg-magic |
| 14 | `wallpaperE/佩丽卡/佩丽卡1_03.mpkg` | 58.9 | PKGM0014 | 960×540 / 3715ms | pkg-magic |
| 15 | `wallpaperE/陈千语/陈千语_01.mpkg` | 58.7 | PKGM0014 | 960×540 / 1422ms | pkg-magic |
| 16 | `wallpaperE/陈千语/陈千语_05.mpkg` | 58.7 | PKGM0014 | 960×540 / 148ms | pkg-magic |
| 17 | `wallpaperE/陈千语/陈千语_03.mpkg` | 58.6 | PKGM0014 | 960×540 / 1251ms | pkg-magic |
| 18 | `wallpaperE/佩丽卡/佩丽卡1_05.mpkg` | 58.6 | PKGM0014 | 960×540 / 119ms | pkg-magic |
| 19 | `wallpaperE/佩丽卡/zmd_08.mpkg` | 58.6 | PKGM0014 | 960×540 / 1257ms | pkg-magic |
| 20 | `wallpaperE/伊蕾娜/伊蕾娜_08.mpkg` | 58.6 | PKGM0014 | 960×540 / 399ms | pkg-magic |
| 21 | `wallpaperE/庄方宜/庄方宜_3.mpkg` | 58.6 | PKGM0014 | 960×540 / 503ms | pkg-magic |
| 22 | `wallpaperE/佩丽卡/佩丽卡1_02.mpkg` | 58.5 | PKGM0014 | 960×540 / 1261ms | pkg-magic |
| 23 | `wallpaperE/白洲梓/白洲梓1_09.mpkg` | 58.4 | PKGM0014 | 960×540 / 2448ms | pkg-magic |
| 24 | `wallpaperE/卡提希娅/卡提希娅_05.mpkg` | 58.4 | PKGM0014 | 960×540 / 361ms | pkg-magic |
| 25 | `wallpaperE/白洲梓/白洲梓1_02.mpkg` | 58.1 | PKGM0014 | 960×540 / 124ms | pkg-magic |
| 26 | `wallpaperE/洛琪希/洛琪希1_3.mpkg` | 58 | PKGM0014 | 960×540 / 139ms | pkg-magic |
| 27 | `wallpaperE/砂狼白子/砂狼白子02_08.mpkg` | 58 | PKGM0014 | 960×540 / 577ms | pkg-magic |
| 28 | `wallpaperE/莱万汀/zmd_12.mpkg` | 57.8 | PKGM0014 | 960×540 / 397ms | pkg-magic |
| 29 | `wallpaperE/蔚蓝档案/蔚蓝档案_05.mpkg` | 57.8 | PKGM0014 | 960×540 / 490ms | pkg-magic |
| 30 | `wallpaperE/庄方宜/庄方宜_4.mpkg` | 57.8 | PKGM0014 | 960×540 / 363ms | pkg-magic |
| 31 | `wallpaperE/卡提希娅/卡提希娅_04.mpkg` | 57.7 | PKGM0014 | 960×540 / 256ms | pkg-magic |
| 32 | `wallpaperE/洛茜/洛茜_10.mpkg` | 57.7 | PKGM0014 | 960×540 / 504ms | pkg-magic |
| 33 | `wallpaperE/白洲梓/白洲梓1_06.mpkg` | 57.4 | PKGM0014 | 960×540 / 759ms | pkg-magic |
| 34 | `wallpaperE/芙宁娜/芙宁娜1_11.mpkg` | 57.4 | PKGM0014 | 960×540 / 781ms | pkg-magic |
| 35 | `wallpaperE/陈千语/陈千语_07.mpkg` | 57.3 | PKGM0014 | 960×540 / 721ms | pkg-magic |
| 36 | `wallpaperE/芙宁娜/芙宁娜1_03.mpkg` | 57.3 | PKGM0014 | 960×540 / 427ms | pkg-magic |
| 37 | `wallpaperE/卡提希娅/卡提希娅_10.mpkg` | 57.3 | PKGM0014 | 960×540 / 171ms | pkg-magic |
| 38 | `wallpaperE/陈千语/陈千语_02.mpkg` | 57 | PKGM0014 | 960×540 / 231ms | pkg-magic |
| 39 | `wallpaperE/芙宁娜/芙宁娜1_05.mpkg` | 57 | PKGM0014 | 960×540 / 519ms | pkg-magic |
| 40 | `wallpaperE/庄方宜/庄方宜_19.mpkg` | 56.8 | PKGM0014 | 960×540 / 305ms | pkg-magic |
| 41 | `wallpaperE/卡提希娅/卡提希娅_07.mpkg` | 55.5 | PKGM0014 | 960×540 / 457ms | pkg-magic |
| 42 | `wallpaperE/砂狼白子/砂狼白子11_05.mpkg` | 54.8 | PKGM0014 | 960×540 / 102ms | pkg-magic |
| 43 | `wallpaperE/卡提希娅/卡提希娅_03.mpkg` | 54 | PKGM0014 | 960×540 / 437ms | pkg-magic |
| 44 | `wallpaperE/庄方宜/庄方宜_6.mpkg` | 53.7 | PKGM0014 | 960×540 / 346ms | pkg-magic |
| 45 | `wallpaperE/卡提希娅/卡提希娅_08.mpkg` | 52.9 | PKGM0014 | 960×540 / 26ms | pkg-magic |
| 46 | `wallpaperE/佩丽卡/佩丽卡1_08.mpkg` | 52.5 | PKGM0014 | 960×540 / 130ms | pkg-magic |
| 47 | `wallpaperE/other/夜莺night——【time_variation_时间变化】alone_孤独の少女【原画：rella].mpkg` | 49.2 | PKGM0018 | 960×540 / 4325ms | pkg-magic |
| 48 | `wallpaperE/砂狼白子/砂狼白子_4.mpkg` | 45.7 | PKGM0014 | 960×540 / 429ms | pkg-magic |
| 49 | `wallpaperE/佩丽卡/佩丽卡1_04.mpkg` | 44.9 | PKGM0014 | 960×540 / 392ms | pkg-magic |
| 50 | `wallpaperE/蔚蓝档案/蔚蓝档案_04.mpkg` | 41.8 | PKGM0014 | 960×540 / 37ms | pkg-magic |
| 51 | `wallpaperE/白洲梓/白洲梓_02.mpkg` | 30.5 | PKGM0014 | 960×540 / 284ms | pkg-magic |
| 52 | `wallpaperE/庄方宜/庄方宜_24.mpkg` | 30 | PKGM0014 | 960×540 / 188ms | pkg-magic |
| 53 | `wallpaperE/白洲梓/白洲梓1_04.mpkg` | 29.6 | PKGM0014 | 960×540 / 232ms | pkg-magic |
| 54 | `wallpaperE/陈千语/陈千语_08.mpkg` | 29.6 | PKGM0014 | 960×540 / 257ms | pkg-magic |
| 55 | `wallpaperE/小鸟游星野/小鸟游星野_13.mpkg` | 29.3 | PKGM0014 | 960×540 / 187ms | pkg-magic |
| 56 | `wallpaperE/洛茜/洛茜_11.mpkg` | 29.2 | PKGM0014 | 960×540 / 211ms | pkg-magic |
| 57 | `wallpaperE/陈千语/陈千语_04.mpkg` | 28.4 | PKGM0014 | 960×540 / 50ms | pkg-magic |
| 58 | `wallpaperE/洁尔佩塔/洁尔佩塔_4.mpkg` | 27.6 | PKGM0014 | 960×540 / 185ms | pkg-magic |
| 59 | `wallpaperE/砂狼白子/砂狼白子02_10.mpkg` | 24.7 | PKGM0014 | 960×540 / 54ms | pkg-magic |
| 60 | `wallpaperE/白洲梓/白洲梓1_05.mpkg` | 22.5 | PKGM0014 | 960×540 / 380ms | pkg-magic |
| 61 | `wallpaperE/白洲梓/白洲梓1_10.mpkg` | 21.8 | PKGM0014 | 960×540 / 321ms | pkg-magic |
| 62 | `wallpaperE/小鸟游星野/小鸟游星野11_10.mpkg` | 21 | PKGM0014 | 960×540 / 192ms | pkg-magic |
| 63 | `wallpaperE/庄方宜/庄方宜_7.mpkg` | 19.9 | PKGM0014 | 960×540 / 202ms | pkg-magic |
| 64 | `wallpaperE/佩丽卡/佩丽卡1_10.mpkg` | 14.3 | PKGM0014 | 960×540 / 47ms | pkg-magic |
| 65 | `wallpaperE/other/红鸾樱落.mpkg` | 9.4 | PKGM0018 | 960×540 / 2971ms | pkg-magic |

### 表 3 · 两边都失败

**0 个包**（加载层面）。另有 **7 个包**属于"两边都出画、但效果 pass 有编译失败被跳过"（见 §6.2）。

### 失败类直方图（只统计**未出画**的档；出画但有告警的另列）

**本仓侧**（未出画 0 个）

| 失败类 | 包数 | 典型日志一行 | 例包 |
| --- | --- | --- | --- |
| （无） | 0 | — | — |

出画行里的 `warnClass`（**不改判定**，只留痕）：`shader-pass`×4 · `layer-load`×1

**产物侧**（未出画 65 个）

| 失败类 | 包数 | 典型日志一行 | 例包 |
| --- | --- | --- | --- |
| `pkg-magic` | 65 | warn: scene render failed: 不是 scene.pkg，魔数: PKGM0018 | `wallpaperE/伊蕾娜/夜莺night——【time_variation时间变化】elaina_伊蕾娜：闲憩微息【魔女之旅】day_night.mpkg` |

出画行里的 `warnClass`（**不改判定**，只留痕）：`puppet`×1 · `layer-load`×1 · `shader-pass`×5

### 效果 pass 编译失败（有画但有 pass 被跳过）

| 包 | 体积 MB | 本仓跳过的 pass | 产物跳过的 pass |
| --- | --- | --- | --- |
| `0917/3600630828/scene.pkg` | 293.3 | `跳过编译失败的 pass "workshop/2084198056/effects/Simple_Audio_Bars"`（编译失败 `'float' : syntax error`） | （无） |
| `0923/2981249186/scene.pkg` | 32.1 | （无） | `跳过效果（pass 编译失败）: workshop/2138904733/effects/cutout_vignette`（`'-' wrong operand types`） |
| `0923/3602673806/scene.pkg` | 24.6 | `跳过编译失败的 pass "workshop/2795521260/effects/color_grading"`（**链接失败** `Varying v_TexCoord is not linkable`） | （无） |
| `0923/3448290956/scene.pkg` | 14.5 | （无） | `跳过效果（pass 编译失败）: workshop/2973943998/effects/iris_movement__`（`'*' wrong operand types`） |
| `0923/3653641024/scene.pkg` | 10.2 | `跳过编译失败的 pass "workshop/3485726739/effects/phantomtransitionfx"`（`'=' assigning non-constant to 'const highp float'`） | `…/phantomtransitionfx`（同一个 `const` 错）+ `workshop/3221939295/effects/____________________`（`'/' wrong operand types`） |
| `0917/3588181703/scene.pkg` | 6.8 | （无） | `跳过效果（pass 编译失败）: workshop/2973943998/effects/iris_movement__`（`'*' wrong operand types`） |
| `0923/3690417937/scene.pkg` | 2.7 | `跳过编译失败的 pass "effects/glitter_prepare"`（**链接失败** `Varying v_TexCoord is not linkable`） | `跳过效果（pass 编译失败）: workshop/2138904733/effects/cutout_vignette`（`'-' wrong operand types`） |

### 是否"只有背景"（画布像素读数）

| 档 | 出画 | content | uniform（疑似只有背景） | blank（全黑） | unmeasured |
| --- | --- | --- | --- | --- | --- |
| 本仓 | 116 | 86 | 19 | 9 | 2 |
| 产物 | 51 | 38 | 0 | 13 | 0 |

### 首帧 / 挂载耗时（只统计出画行）

| 档 | 样本 | 首帧 min | 首帧 p50 | 首帧 p90 | 首帧 max | 挂载 p50 | 挂载 p90 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 本仓 | 116 | 22 | 503 | 4325 | 7098 | 12744 | 35774 |
| 产物 | 51 | 1326 | 3179 | 10008 | 11984 | 9225 | 18336 |

---

## 5. 产物侧的两道门（为什么 65 个 `.mpkg` 在产物里挂不住）

1. **容器魔数**：产物的读包函数 `if(!r.startsWith("PKGV")) throw new Error("不是 scene.pkg，魔数: "+r)` —— 静态命中于
   `we-scene-demo/demo/assets/renderer-BOSoB05I.js`，并由 §2 探测④拿到运行期原样文本。`.mpkg` 语料是 `PKGM0014/PKGM0018`。
2. **纹理格式 5**：把魔数改对之后（探测⑤）产物在解码纹理时抛 `未支持的纹理格式: 5`。本仓支持（`case 5 → decodeDXT5`），
   所以这一门**只挡产物**。

这两条**不影响本仓**（本仓 116/116 出画），因此按 §1 的口径它们不进"要移植的清单"；它们是"产物侧缺口"的完整清单，
只在 §6.4 的"反方向"一节里留档（供文档口径/对照档说明引用）。

---

## 6. 要移植的清单（按"影响面 × 成本"排序）

### 6.1 加载层面（本矩阵的主判据）：**0 项**

产物独有 = 0（§4 表 1 为空）⇒ 不存在"只有产物能加载"的包 ⇒ §1 的验收口径"产物独有可加载 = 0"**在语料范围内已达成**。
（另一半护栏：本仓独有 65 个**不许减少**——它们全是 `.mpkg`，本仓能加载、产物不能。）

### 6.2 效果 pass 层面（**本矩阵新发现**）：按"影响面 × 成本"排序

判据：两侧 `passSkips`（`跳过编译失败的 pass` / `跳过效果（pass 编译失败）` 的**原样行**，逐包各留最多 10 条）。
**影响面 = 该包的一个效果 pass 整条不生效**（画面少一层效果）；**成本 = 转译/链接规则**（本仓 `hlsl2glsl` 一侧），不需要新子系统。
7 个受影响包的分布：**本仓独有 2 · 产物独有 3 · 两边都跳 2**。

| 优先 | 现象（原样日志，截断） | 受影响包 | 出在谁身上 | 推测落点 | 影响面 × 成本 |
|---|---|---|---|---|---|
| **1** | ``Varying `v_TexCoord`is not linkable between attached shaders.``（**链接**失败，`workshop/2795521260/effects/color_grading`） | `0923/3602673806` | **本仓独有**（产物侧无跳过记录） | 着色器转译：varying 的声明/使用一致性（`vertConflicts`/varying 规则族） | 中 × S：这层效果整条不生效；只需转译规则 |
| **2** | `ERROR: 0:488: 'float' : syntax error`（编译失败，`workshop/2084198056/effects/Simple_Audio_Bars`） | `0917/3600630828` | **本仓独有** | 着色器转译（内建/workshop effect 定义体的语法处理） | 中 × S–M：音条类效果整条不生效；需先定位是转译还是 effect.json 解析 |
| **3** | ``Varying `v_TexCoord`is not linkable between attached shaders.``（链接失败，`effects/glitter_prepare`） | `0923/3690417937` | **两边都跳**（本仓跳 `glitter_prepare`；产物跳的是 `cutout_vignette`） | 同第 1 行（varying 一致性） | 小–中 × S |
| **4** | `ERROR: 0:24: '=' : assigning non-constant to 'const highp float'`（`workshop/3485726739/effects/phantomtransitionfx`） | `0923/3653641024` | **两边都跳**（同一 effect 名、两边都失败） | 转译后的 `const` 修饰（GLSL ES 3.0 严格性） | 小 × S |
| — | `'*'`/`'-'`/`'/' : wrong operand types …（`iris_movement__`、`cutout_vignette`、`____________________`） | `0917/3588181703`、`0923/3448290956`、`0923/2981249186` | **产物独有**（本仓侧无跳过记录 ⇒ 本仓转译更强） | 反方向（产物侧缺口，**本仓不做**）：hlsl2glsl 的标量↔向量宽度提升 | — |

⚠ 三条口径说明（不许含糊）：
1. "本仓独有/产物独有"是**该包两侧 `passSkips` 原样行**的比对结论；产物侧 console 捕获有**条数上限**（24 条/包）、本仓侧 `#log` 只留**带 `⚠`/`❌` 的行**，
   所以"某侧没有"是"**这次读数里没有**"，不是"逻辑上不可能"。
2. 这些 pass 失败**都不改变"能不能加载"**（两侧都出画），所以不进表 1/表 2/表 3，只在这里排序。
3. 第 4 行与方案 §2 Phase 1 的「hlsl2glsl 规则族（`9/9a-2/9-3` 向量宽度 + `vertConflicts`）」是同一族的现场证据 —— 本矩阵给的是**包名/effect 名/原样错误行**，可直接当 Phase 1 的夹具来源。

### 6.2.1 复核（2026-10-07）：本表第 **1** 与第 **3** 行**已由 P-198 ①③ 关闭**（本矩阵早于该补丁）
P-198 ①③（2026-09-25）落了**跨 stage 同名 varying 的宽度对账** `reconcileStageVaryings()`（片元 `in` 按顶点侧加宽/收窄 + 裸引用补 swizzle；
回退口 `?varyinglink=legacy`），它文档里举的第一个例子正是 `3602673806` 的 `.vert:6 varying vec4 v_TexCoord` / `.frag:70 varying vec2 v_TexCoord`。
本轮在真机（`:8902` + Firefox）对**本表第 1/3 行的两个包**做了同包同时序 A/B（每档挂载后 12 s，读页面 `#log`）：

| 包 | 缺省档 | `?varyinglink=legacy` |
|---|---|---|
| `0923/3602673806`（`workshop/2795521260/effects/color_grading`，本表第 1 行） | **无跳过行**（pass 正常链接） | `⚠ 跳过编译失败的 pass "…color_grading": … Varying \`v_TexCoord\`is not linkable between attached shaders.` |
| `0923/3690417937`（`effects/glitter_prepare`，本表第 3 行） | **无跳过行** | 同一报文（`"effects/glitter_prepare"`） |

⇒ 第 1 行"本仓独有"与第 3 行"两边都跳"的 varying 链接失败**都已不再发生**；legacy 档逐字复现旧报文 ⇒ 归因确定。
（同批离线 `glslangValidator -l` 复核：缺省档片元 `in` 被加宽到 `vec4` 与顶点一致、legacy 档仍是 `vec2`。
真机上读 `import('/bundle.js')` 的 `h2gPassFixStats` 恒 0 是**模块实例不同**所致 —— 页面自身的 specifier 是
`./bundle.js`（= `/webloader/bundle.js`），与 `/bundle.js` 是两个 URL/两份实例；判据只看 `#log`，不看那份读数。）

### 6.3 §2 Phase 1 的 4 个已知候选（**本矩阵测不到**，需像素/A-B 判据）

`usertextures`/`$mediaThumbnail` 槽 · `instanceoverride.brightness` · `copybackground` 的 z 序 · web 帧盒几何。
本矩阵判的是"**挂得上/出得了画**"，这四项是**保真度**差异（挂得上、画得出，但细节不同）⇒ 本矩阵对它们**既不能证实也不能证伪**；
它们的优先级仍按 `docs/UPSTREAM-PORT-PLAN-20260919.md` §7.1 与 §2 Phase 1 的既有排序走。

### 6.4 反方向（产物侧缺口，本仓**不需要**移植，仅留档）

`.mpkg`（PKGM0014×60 / PKGM0018×5）在产物侧要能加载，至少需要：①容器魔数接受 `PKGM*`；②支持纹理格式 5；
而按方案 §0/§4 的定案，产物**降格为参考实现**，所以这两条**明确不做**——列在这里只为"产物档能力边界"有据可查。

---

## 7. 未测 / 测不准（如实）

1. **产物侧没有 `#log`/`#logbody`**：产物页是空 `body` + 一个 module，日志面只有 `console.warn/error`。任务书里"`#log` 出现加载完成标志"
   这条判据**在产物侧不存在**，本档改用"canvas 尺寸脱离 300×150"+ 页面内 console 实参捕获，已写进 §1.2/§2。
2. **产物的层数/纹理数拿不到**：`window.__wpStats` 实测恒为 `{}`（18 个 `__wp` 方法里也没有这类 getter）⇒ 产物侧 `layers/texStats` 一律 `null`。
3. **"是否只有背景"是启发式**：`blank`（`maxL<=1`）/`uniform`（`stdL<0.6`）只是像素统计的**标签**，不等于"没出画"。
   本档还发现一个**读数时机**问题：首帧那一刻截图会撞上"视频还在解码/场景还在淡入"，读出来是纯黑 ——
   因此对 `blank/unmeasured` 的行用 `--settle-ms 8000` 做了二次采样（JSON 里逐行有 `settleMs` 字段标出这次读数等了多久）。
   实测覆盖与残留（**如实**）：产物档 51 个出画行里，首帧即读 = content 38 / blank 13；二次采样只补到 **13/51** 行
   （`--settle-ms 8000`/`6000`；其余批次在**全量套件同时在跑**时撞到 `--min-free-mb 1400` 的内存下限而**主动停批**，
   `runs[]` 里有 7 条 `aborted` 记录）；其中 2 个 blank 行**等满 8s 仍是 `meanL=0`**（`0923/3662790108`、`dd/3470764447`），
   其余 11 个 blank 行**没等到**二次采样 —— 所以"产物档 blank"这条读数的置信度是**部分覆盖**，不当成"画面一定黑"的结论。
   本仓档 116 行：content 86 / uniform 19 / blank 9 / unmeasured 2（二次采样覆盖 23 行）。
4. **本机只有软件 GL（llvmpipe）**，没有 `/dev/dri`：所有读数都是软件光栅下的结果；真机（Adreno/独显）观感必须由用户复核。
5. **`.mpkg` 里不含 `scene.json` 的 83 个包没测**（纯视频档，按枚举口径排除）；`delete/` 的 7 个副本没测（同源副本）。
6. **用户库（`?id=` 那套）没测**：本矩阵只跑四个语料根（任务书口径），库根全程没切。
7. **产物侧 pass 日志有上限**：每包只留 24 条 console（`cap` + `rej`），所以 §6.2 的"仅一侧跳过"是**指示性**结论，不是逐 pass 全量对拍。
8. **产物侧"出画"= 挂载成功**（canvas 建出来、没有致命日志），**不等于我肉眼看过画面**：软件 GL 下产物的像素读数与真机未必一致（见第 4 条）。
9. **本仓的 `❌` 不都是资产错**：出画行里有 17 个包带 1 条 `❌`，原文是页面自己的"**7s 内没有首帧，但 module 已启动**"兜底诊断
   （首帧迟到 ⇒ 页面自己写一行），这些包随后都出了画（`firstFrame` 为真），所以它们**不判失败**，只记 `logFatal` 计数。
10. **产物档走的挂载契约是"宿主喂包"**：本档用 `__wp.loadSceneFile(blob, projectJson)`（产物自己的公开契约，测试台的本地壁纸预览也是它）。
    产物那条 `?type=scene&src=<id>&mediaBase=<base>` 的**自取包**路径本档没测（它要一个能提供 `<base>/<src>` 的目录级 URL，
    而语料是散落的容器文件，`/pkgpath` 只能给单文件）。⇒ 结论"产物独有 = 0"是在**这一条契约**下的结论；
    若换契约，理论上可能出现别的失败面（本档没有证据说它更好或更坏）。
11. **单实例**：全程同一时刻只跑一个 Firefox（`flock /tmp/.mpw-firefox.lock`），产物/本仓**串行**测量；没有做并发对拍。

---

## 8. 复现命令（本轮实际跑过的）

```bash
cd <工作区>/we-scene-demo

# ① 离线枚举（不起浏览器）：看口径与选中了哪些包
node tests/renderer-gap-matrix.mjs --enum-only

# ② 冒烟（单个包、两档各一次）
flock /tmp/.mpw-firefox.lock -c 'node tests/renderer-gap-matrix.mjs --only 佩丽卡1_10 --limit 1 --out /tmp/gap-smoke.json'

# ③ 全量语料（分批；每批一次独立浏览器生命周期；本轮的批次窗口见 JSON 的 runs[]）
flock /tmp/.mpw-firefox.lock -c 'node tests/renderer-gap-matrix.mjs --force --offset 22 --limit 8'

# ④ 像素读数二次采样（出画后再等 8s 才截图；只补"上一轮 blank/unmeasured"的包）
flock /tmp/.mpw-firefox.lock -c 'node tests/renderer-gap-matrix.mjs --force --up-only --rerun-blank upstream --settle-ms 8000 --limit 6'

# ⑤ 产物侧判据探测（§2 的①②③④⑤；探测脚本在 /tmp，不属于交付物）
flock /tmp/.mpw-firefox.lock -c 'node /tmp/probe-upstream.mjs up'
flock /tmp/.mpw-firefox.lock -c 'node /tmp/probe-stack.mjs "<工作区>/allwallpaper/wallpaperE/佩丽卡/佩丽卡1_10.mpkg"'
```

本轮实跑规模（JSON `runs[]` 逐条可查）：**语料 116 个包 × 两档 = 232 次挂载**，分 18 批主跑
+ 25 条两档批次记录（含 7 个定向包）+ 9 条单档补测批次；`runs[]` 共 34 条、其中 **7 条 `aborted`**
（都是产物侧 `blank` 二次采样批次，撞到 `--min-free-mb 1400` 主动停批 —— 同时有全量套件在跑）。
主跑 2026-09-24 18:41 → 19:34（约 53 min），**0 次超时、0 次内存停批**；补测段 19:37 → 21:05。
全程未切库根（因此没有 `POST /api/library-dir {"reset":true}` 这步），未改任何产品代码，未 commit。

---

## 9. 附录 · 语料全表（116 个包，按体积降序）

| # | 包 | MB | 魔数 | scene 层 | 本仓 | 产物 | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0923/3662790108/scene.pkg` | 543 | PKGV0023 | 847 | ok 960×540 | ok 960×540 | both-ok |
| 2 | `0923/3605722997/scene.pkg` | 325.1 | PKGV0024 | 41 | ok 960×540 | ok 960×540 | both-ok |
| 3 | `dd/3470764447/scene.pkg` | 320.6 | PKGV0022 | 41 | ok 960×540 | ok 960×540 | both-ok |
| 4 | `wallpaperE/伊蕾娜/夜莺night——【time_variation时间变化】elaina_伊蕾娜：闲憩微息【魔女之旅】day_night.mpkg` | 315.9 | PKGM0018 | 41 | ok 960×540 | fail(pkg-magic) | repo-only |
| 5 | `0923/3570308528/scene.pkg` | 313.9 | PKGV0023 | 12 | ok 960×540 | ok 960×540 | both-ok |
| 6 | `0917/3600630828/scene.pkg` | 293.3 | PKGV0024 | 9 | ok 960×540 | ok 960×540 | both-ok |
| 7 | `0923/3589454154/scene.pkg` | 244.9 | PKGV0023 | 130 | ok 960×540 | ok 960×540 | both-ok |
| 8 | `dd/3326873240/scene.pkg` | 235.4 | PKGV0023 | 62 | ok 960×540 | ok 960×540 | both-ok |
| 9 | `0917/3509243656/scene.pkg` | 151.2 | PKGV0023 | 142 | ok 960×540 | ok 960×540 | both-ok |
| 10 | `0917/3448877775/scene.pkg` | 131.9 | PKGV0022 | 103 | ok 960×540 | ok 960×540 | both-ok |
| 11 | `0923/2902406982/scene.pkg` | 122.8 | PKGV0024 | 140 | ok 960×540 | ok 960×540 | both-ok |
| 12 | `0923/2887099508/scene.pkg` | 119.9 | PKGV0018 | 82 | ok 960×540 | ok 960×540 | both-ok |
| 13 | `dd/3660962877/scene.pkg` | 113.6 | PKGV0023 | 127 | ok 960×540 | ok 960×540 | both-ok |
| 14 | `dd/3669681034/scene.pkg` | 94.2 | PKGV0023 | 2 | ok 960×540 | ok 960×540 | both-ok |
| 15 | `0923/3714466840/scene.pkg` | 85.7 | PKGV0023 | 4 | ok 960×540 | ok 960×540 | both-ok |
| 16 | `0917/3195212886/scene.pkg` | 82.5 | PKGV0024 | 90 | ok 960×540 | ok 960×540 | both-ok |
| 17 | `wallpaperE/遐蝶/夜莺Night——Honkai Star Rail Castorice 遐蝶 冥河永渡 崩坏星穹铁道The Etern.mpkg` | 78 | PKGM0018 | 41 | ok 960×540 | fail(pkg-magic) | repo-only |
| 18 | `wallpaperE/流萤/夜莺night——【customize自定义】firefly_流萤_星空之誓——夜莺night崩坏星穹铁道.mpkg` | 73.8 | PKGM0018 | 58 | ok 960×540 | fail(pkg-magic) | repo-only |
| 19 | `dd/3719111841/scene.pkg` | 69.5 | PKGV0024 | 43 | ok 960×540 | ok 960×540 | both-ok |
| 20 | `0923/3151551777/scene.pkg` | 67.1 | PKGV0021 | 133 | ok 960×540 | ok 960×540 | both-ok |
| 21 | `0923/3679620104/scene.pkg` | 62.9 | PKGV0024 | 3 | ok 960×540 | ok 960×540 | both-ok |
| 22 | `wallpaperE/砂狼白子/砂狼白子11_03.mpkg` | 61 | PKGM0014 | 69 | ok 960×540 | fail(pkg-magic) | repo-only |
| 23 | `wallpaperE/佩丽卡/佩丽卡1_06.mpkg` | 60.6 | PKGM0014 | 12 | ok 960×540 | fail(pkg-magic) | repo-only |
| 24 | `wallpaperE/白洲梓/白洲梓_09.mpkg` | 60 | PKGM0014 | 1 | ok 960×540 | fail(pkg-magic) | repo-only |
| 25 | `wallpaperE/蔚蓝档案/蔚蓝档案_06.mpkg` | 59.7 | PKGM0014 | 7 | ok 960×540 | fail(pkg-magic) | repo-only |
| 26 | `dd/3327063360/scene.pkg` | 59.5 | PKGV0022 | 69 | ok 960×540 | ok 960×540 | both-ok |
| 27 | `wallpaperE/洛茜/洛茜_07.mpkg` | 59.5 | PKGM0014 | 16 | ok 960×540 | fail(pkg-magic) | repo-only |
| 28 | `wallpaperE/佩丽卡/佩丽卡1_09.mpkg` | 59.5 | PKGM0014 | 7 | ok 960×540 | fail(pkg-magic) | repo-only |
| 29 | `wallpaperE/遐蝶/遐蝶_09.mpkg` | 59.1 | PKGM0014 | 45 | ok 960×540 | fail(pkg-magic) | repo-only |
| 30 | `wallpaperE/卡提希娅/卡提希娅_02.mpkg` | 59 | PKGM0014 | 41 | ok 960×540 | fail(pkg-magic) | repo-only |
| 31 | `wallpaperE/芙宁娜/芙宁娜_08.mpkg` | 58.9 | PKGM0014 | 5 | ok 960×540 | fail(pkg-magic) | repo-only |
| 32 | `wallpaperE/芙宁娜/芙宁娜1_04.mpkg` | 58.9 | PKGM0014 | 5 | ok 960×540 | fail(pkg-magic) | repo-only |
| 33 | `wallpaperE/佩丽卡/佩丽卡1_03.mpkg` | 58.9 | PKGM0014 | 25 | ok 960×540 | fail(pkg-magic) | repo-only |
| 34 | `wallpaperE/陈千语/陈千语_01.mpkg` | 58.7 | PKGM0014 | 11 | ok 960×540 | fail(pkg-magic) | repo-only |
| 35 | `wallpaperE/陈千语/陈千语_05.mpkg` | 58.7 | PKGM0014 | 14 | ok 960×540 | fail(pkg-magic) | repo-only |
| 36 | `wallpaperE/陈千语/陈千语_03.mpkg` | 58.6 | PKGM0014 | 17 | ok 960×540 | fail(pkg-magic) | repo-only |
| 37 | `wallpaperE/佩丽卡/佩丽卡1_05.mpkg` | 58.6 | PKGM0014 | 14 | ok 960×540 | fail(pkg-magic) | repo-only |
| 38 | `wallpaperE/佩丽卡/zmd_08.mpkg` | 58.6 | PKGM0014 | 23 | ok 960×540 | fail(pkg-magic) | repo-only |
| 39 | `wallpaperE/伊蕾娜/伊蕾娜_08.mpkg` | 58.6 | PKGM0014 | 4 | ok 960×540 | fail(pkg-magic) | repo-only |
| 40 | `wallpaperE/庄方宜/庄方宜_3.mpkg` | 58.6 | PKGM0014 | 2 | ok 960×540 | fail(pkg-magic) | repo-only |
| 41 | `wallpaperE/佩丽卡/佩丽卡1_02.mpkg` | 58.5 | PKGM0014 | 23 | ok 960×540 | fail(pkg-magic) | repo-only |
| 42 | `wallpaperE/白洲梓/白洲梓1_09.mpkg` | 58.4 | PKGM0014 | 18 | ok 960×540 | fail(pkg-magic) | repo-only |
| 43 | `wallpaperE/卡提希娅/卡提希娅_05.mpkg` | 58.4 | PKGM0014 | 1 | ok 960×540 | fail(pkg-magic) | repo-only |
| 44 | `wallpaperE/白洲梓/白洲梓1_02.mpkg` | 58.1 | PKGM0014 | 7 | ok 960×540 | fail(pkg-magic) | repo-only |
| 45 | `wallpaperE/洛琪希/洛琪希1_3.mpkg` | 58 | PKGM0014 | 3 | ok 960×540 | fail(pkg-magic) | repo-only |
| 46 | `wallpaperE/砂狼白子/砂狼白子02_08.mpkg` | 58 | PKGM0014 | 9 | ok 960×540 | fail(pkg-magic) | repo-only |
| 47 | `0917/3233141951/scene.pkg` | 57.9 | PKGV0024 | 65 | ok 960×540 | ok 960×540 | both-ok |
| 48 | `wallpaperE/莱万汀/zmd_12.mpkg` | 57.8 | PKGM0014 | 3 | ok 960×540 | fail(pkg-magic) | repo-only |
| 49 | `wallpaperE/蔚蓝档案/蔚蓝档案_05.mpkg` | 57.8 | PKGM0014 | 20 | ok 960×540 | fail(pkg-magic) | repo-only |
| 50 | `wallpaperE/庄方宜/庄方宜_4.mpkg` | 57.8 | PKGM0014 | 2 | ok 960×540 | fail(pkg-magic) | repo-only |
| 51 | `wallpaperE/卡提希娅/卡提希娅_04.mpkg` | 57.7 | PKGM0014 | 10 | ok 960×540 | fail(pkg-magic) | repo-only |
| 52 | `wallpaperE/洛茜/洛茜_10.mpkg` | 57.7 | PKGM0014 | 2 | ok 960×540 | fail(pkg-magic) | repo-only |
| 53 | `wallpaperE/白洲梓/白洲梓1_06.mpkg` | 57.4 | PKGM0014 | 4 | ok 960×540 | fail(pkg-magic) | repo-only |
| 54 | `wallpaperE/芙宁娜/芙宁娜1_11.mpkg` | 57.4 | PKGM0014 | 1 | ok 960×540 | fail(pkg-magic) | repo-only |
| 55 | `wallpaperE/陈千语/陈千语_07.mpkg` | 57.3 | PKGM0014 | 5 | ok 960×540 | fail(pkg-magic) | repo-only |
| 56 | `wallpaperE/芙宁娜/芙宁娜1_03.mpkg` | 57.3 | PKGM0014 | 9 | ok 960×540 | fail(pkg-magic) | repo-only |
| 57 | `wallpaperE/卡提希娅/卡提希娅_10.mpkg` | 57.3 | PKGM0014 | 11 | ok 960×540 | fail(pkg-magic) | repo-only |
| 58 | `0917/3351163962/scene.pkg` | 57 | PKGV0021 | 136 | ok 960×540 | ok 960×540 | both-ok |
| 59 | `wallpaperE/陈千语/陈千语_02.mpkg` | 57 | PKGM0014 | 7 | ok 960×540 | fail(pkg-magic) | repo-only |
| 60 | `wallpaperE/芙宁娜/芙宁娜1_05.mpkg` | 57 | PKGM0014 | 3 | ok 960×540 | fail(pkg-magic) | repo-only |
| 61 | `wallpaperE/庄方宜/庄方宜_19.mpkg` | 56.8 | PKGM0014 | 1 | ok 960×540 | fail(pkg-magic) | repo-only |
| 62 | `wallpaperE/卡提希娅/卡提希娅_07.mpkg` | 55.5 | PKGM0014 | 9 | ok 960×540 | fail(pkg-magic) | repo-only |
| 63 | `wallpaperE/砂狼白子/砂狼白子11_05.mpkg` | 54.8 | PKGM0014 | 6 | ok 960×540 | fail(pkg-magic) | repo-only |
| 64 | `wallpaperE/卡提希娅/卡提希娅_03.mpkg` | 54 | PKGM0014 | 9 | ok 960×540 | fail(pkg-magic) | repo-only |
| 65 | `wallpaperE/庄方宜/庄方宜_6.mpkg` | 53.7 | PKGM0014 | 3 | ok 960×540 | fail(pkg-magic) | repo-only |
| 66 | `wallpaperE/卡提希娅/卡提希娅_08.mpkg` | 52.9 | PKGM0014 | 2 | ok 960×540 | fail(pkg-magic) | repo-only |
| 67 | `wallpaperE/佩丽卡/佩丽卡1_08.mpkg` | 52.5 | PKGM0014 | 8 | ok 960×540 | fail(pkg-magic) | repo-only |
| 68 | `wallpaperE/other/夜莺night——【time_variation_时间变化】alone_孤独の少女【原画：rella].mpkg` | 49.2 | PKGM0018 | 102 | ok 960×540 | fail(pkg-magic) | repo-only |
| 69 | `wallpaperE/砂狼白子/砂狼白子_4.mpkg` | 45.7 | PKGM0014 | 4 | ok 960×540 | fail(pkg-magic) | repo-only |
| 70 | `0923/3687818927/scene.pkg` | 45.5 | PKGV0023 | 18 | ok 960×540 | ok 960×540 | both-ok |
| 71 | `wallpaperE/佩丽卡/佩丽卡1_04.mpkg` | 44.9 | PKGM0014 | 2 | ok 960×540 | fail(pkg-magic) | repo-only |
| 72 | `dd/3544152633/scene.pkg` | 42.4 | PKGV0023 | 70 | ok 960×540 | ok 960×540 | both-ok |
| 73 | `wallpaperE/蔚蓝档案/蔚蓝档案_04.mpkg` | 41.8 | PKGM0014 | 1 | ok 960×540 | fail(pkg-magic) | repo-only |
| 74 | `dd/3778592720/scene.pkg` | 41.3 | PKGV0024 | 5 | ok 960×540 | ok 960×540 | both-ok |
| 75 | `0917/3462491575/scene.pkg` | 34.2 | PKGV0022 | 75 | ok 960×540 | ok 960×540 | both-ok |
| 76 | `0923/2981249186/scene.pkg` | 32.1 | PKGV0023 | 12 | ok 960×540 | ok 960×540 | both-ok |
| 77 | `0923/3521337568/scene.pkg` | 31.3 | PKGV0022 | 32 | ok 960×540 | ok 960×540 | both-ok |
| 78 | `wallpaperE/白洲梓/白洲梓_02.mpkg` | 30.5 | PKGM0014 | 6 | ok 960×540 | fail(pkg-magic) | repo-only |
| 79 | `wallpaperE/庄方宜/庄方宜_24.mpkg` | 30 | PKGM0014 | 1 | ok 960×540 | fail(pkg-magic) | repo-only |
| 80 | `wallpaperE/白洲梓/白洲梓1_04.mpkg` | 29.6 | PKGM0014 | 5 | ok 960×540 | fail(pkg-magic) | repo-only |
| 81 | `wallpaperE/陈千语/陈千语_08.mpkg` | 29.6 | PKGM0014 | 7 | ok 960×540 | fail(pkg-magic) | repo-only |
| 82 | `wallpaperE/小鸟游星野/小鸟游星野_13.mpkg` | 29.3 | PKGM0014 | 1 | ok 960×540 | fail(pkg-magic) | repo-only |
| 83 | `wallpaperE/洛茜/洛茜_11.mpkg` | 29.2 | PKGM0014 | 24 | ok 960×540 | fail(pkg-magic) | repo-only |
| 84 | `wallpaperE/陈千语/陈千语_04.mpkg` | 28.4 | PKGM0014 | 4 | ok 960×540 | fail(pkg-magic) | repo-only |
| 85 | `wallpaperE/洁尔佩塔/洁尔佩塔_4.mpkg` | 27.6 | PKGM0014 | 8 | ok 960×540 | fail(pkg-magic) | repo-only |
| 86 | `0923/3479521040/scene.pkg` | 25.1 | PKGV0022 | 40 | ok 960×540 | ok 960×540 | both-ok |
| 87 | `wallpaperE/砂狼白子/砂狼白子02_10.mpkg` | 24.7 | PKGM0014 | 3 | ok 960×540 | fail(pkg-magic) | repo-only |
| 88 | `0923/3572877776/scene.pkg` | 24.6 | PKGV0023 | 137 | ok 960×540 | ok 960×540 | both-ok |
| 89 | `0923/3602673806/scene.pkg` | 24.6 | PKGV0023 | 17 | ok 960×540 | ok 960×540 | both-ok |
| 90 | `0923/3622495963/scene.pkg` | 23.1 | PKGV0024 | 26 | ok 960×540 | ok 960×540 | both-ok |
| 91 | `0923/3593919489/scene.pkg` | 22.7 | PKGV0023 | 20 | ok 960×540 | ok 960×540 | both-ok |
| 92 | `dd/3554161528/scene.pkg` | 22.5 | PKGV0022 | 37 | ok 960×540 | ok 960×540 | both-ok |
| 93 | `wallpaperE/白洲梓/白洲梓1_05.mpkg` | 22.5 | PKGM0014 | 10 | ok 960×540 | fail(pkg-magic) | repo-only |
| 94 | `wallpaperE/白洲梓/白洲梓1_10.mpkg` | 21.8 | PKGM0014 | 2 | ok 960×540 | fail(pkg-magic) | repo-only |
| 95 | `wallpaperE/小鸟游星野/小鸟游星野11_10.mpkg` | 21 | PKGM0014 | 2 | ok 960×540 | fail(pkg-magic) | repo-only |
| 96 | `0923/833227004/scene.pkg` | 20 | PKGV0001 | 1 | ok 960×540 | ok 960×540 | both-ok |
| 97 | `wallpaperE/庄方宜/庄方宜_7.mpkg` | 19.9 | PKGM0014 | 15 | ok 960×540 | fail(pkg-magic) | repo-only |
| 98 | `0923/3668498439/scene.pkg` | 17 | PKGV0023 | 8 | ok 960×540 | ok 960×540 | both-ok |
| 99 | `0923/3463520581/scene.pkg` | 16.7 | PKGV0023 | 74 | ok 960×540 | ok 960×540 | both-ok |
| 100 | `0923/3582367840/scene.pkg` | 15.2 | PKGV0023 | 16 | ok 960×540 | ok 960×540 | both-ok |
| 101 | `0923/3448290956/scene.pkg` | 14.5 | PKGV0022 | 40 | ok 960×540 | ok 960×540 | both-ok |
| 102 | `wallpaperE/佩丽卡/佩丽卡1_10.mpkg` | 14.3 | PKGM0014 | 2 | ok 960×540 | fail(pkg-magic) | repo-only |
| 103 | `0923/3806006894/scene.pkg` | 12.6 | PKGV0024 | 5 | ok 960×540 | ok 960×540 | both-ok |
| 104 | `0923/3648434762/scene.pkg` | 11.3 | PKGV0023 | 11 | ok 960×540 | ok 960×540 | both-ok |
| 105 | `0917/3299228616/scene.pkg` | 10.9 | PKGV0022 | 271 | ok 960×540 | ok 960×540 | both-ok |
| 106 | `0923/3278399262/scene.pkg` | 10.4 | PKGV0024 | 3 | ok 960×540 | ok 960×540 | both-ok |
| 107 | `0923/3653641024/scene.pkg` | 10.2 | PKGV0023 | 41 | ok 960×540 | ok 960×540 | both-ok |
| 108 | `wallpaperE/other/红鸾樱落.mpkg` | 9.4 | PKGM0018 | 65 | ok 960×540 | fail(pkg-magic) | repo-only |
| 109 | `dd/3721991999/scene.pkg` | 8.3 | PKGV0024 | 2 | ok 960×540 | ok 960×540 | both-ok |
| 110 | `0917/3588181703/scene.pkg` | 6.8 | PKGV0023 | 1 | ok 960×540 | ok 960×540 | both-ok |
| 111 | `0917/3250755486/scene.pkg` | 6.7 | PKGV0020 | 2 | ok 960×540 | ok 960×540 | both-ok |
| 112 | `0923/3737270471/scene.pkg` | 5.8 | PKGV0023 | 3 | ok 960×540 | ok 960×540 | both-ok |
| 113 | `0923/3696234311/scene.pkg` | 4.5 | PKGV0023 | 2 | ok 960×540 | ok 960×540 | both-ok |
| 114 | `dd/3715743282/scene.pkg` | 3.7 | PKGV0023 | 9 | ok 960×540 | ok 960×540 | both-ok |
| 115 | `0923/3690417937/scene.pkg` | 2.7 | PKGV0023 | 29 | ok 960×540 | ok 960×540 | both-ok |
| 116 | `0923/3122339805/scene.pkg` | 2.2 | PKGV0022 | 190 | ok 960×540 | ok 960×540 | both-ok |

## 附录（批次 3 · C10，2026-10-04）：上游产物 2.1.0 直挂读数——参数组合 ⇒ 画布口径

> ⚠ **读数来源 = 直挂（mediaBase+src），非工具条档**：`?type=scene&mediaBase=http://127.0.0.1:8902/media/dev&src=2887099508&fit=<fit>&renderDpr=<dpr>&filter=none&muted=true`
> （8902 测试台 `/media/dev/<id>/scene.pkg` 与 `project.json` 双 200；产物 = webwallgl **2.1.0**，
> `demo/assets/renderer-n-Rw_ZVc.js` 1,067,707B——P-228b 起；下述 §6.2 等正文里的 2.0.2 读数按"已过期"处理）。
> 机读：`reports/upstream-params-2.1.0.json`；判据 `tests/upstream-direct-mount-test.mjs`（13/0，含变异自证：
> URL 缺 mediaBase ⇒ 画布不出 = 2.x 缺参契约承重）。

| 参数组合 | 画布（内部缓冲） | CSS 盒 | 倍率 | `__wp.getQuality()`（挂载后） |
|---|---|---|---|---|
| fit=contain, renderDpr=1 | 1280×800 | 1280×800 | 1.0 | `{antiAliasing:'off', particles:'high', postProcessing:'off'}` |
| fit=contain, renderDpr=2 | 2560×1600 | 1280×800 | 2.0 | 同上 |
| fit=cover, renderDpr=1 | 1280×800 | 1280×800 | 1.0 | 同上 |
| fit=cover, renderDpr=2 | 2560×1600 | 1280×800 | 2.0 | 同上 |

结论：**画布缓冲口径只由 renderDpr 决定（1×/2× CSS），fit 只影响内容裁剪**；16:9 场景在 16:10 CSS 盒上
由 fit 决定留边/裁边。`getQuality()` 空挂载时 postProcessing 为 "high"、真挂载后为 "off" ⇒ 它是**挂载态
读数**，不得当静态能力引用。探针包 0923/288508…（6080×3420，16:9）在本表两种 fit 下均正常出画。

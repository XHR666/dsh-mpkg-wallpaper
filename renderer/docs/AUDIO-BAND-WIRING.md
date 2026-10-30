# AUDIO-BAND-WIRING —— 128 元频段数组 / 帧几何的**接线**说明（P-112-BANDGEOM，2026-09-17）

> 适用仓库：`we-scene-demo`（渲染器，**GPL-3.0-or-later**）。
> 本文只讲**接线**（谁在什么条件下调谁、开关、实测数字、回退、还缺什么）。
> 两个模块的**契约与算法**各有独立规格，本文不重复、也不改它们的口径：
> 音频 `docs/AUDIO-BAND-SPEC.md`（实现 `core/audio-band-array.mjs`）、
> 帧几何 `docs/WEB-FRAME-GEOMETRY-SPEC.md`（实现 `core/web-frame-geometry.mjs`）。
> 洁净室判据（"独立实现、未复制代码"）与差异清单在各自规格 §5/§6 与 `THIRD-PARTY.md` §11/§12，本文不动它们。

任务来源：`docs/MASTER-TODO.md` §5 第 4 条（三类壁纸能力对齐：web 要音频频谱数据源 + 媒体会话）
与 **P1-5**（音频频谱无数据源）。P1-6（媒体会话）见 §5 的未定清单。

---

## 1. 接了什么（两个模块、四处落点）

| 模块 | 落点（file:line 以本文写作时的树为准） | 消费方 | 开关 | 缺省 |
|---|---|---|---|---|
| `core/audio-band-array.mjs` | `demo.html:2754`（`MPW-BANDFEED` 块，切片段 `:2754-2948`） | ① 场景层脚本 `registerAudioBuffers`（`elysia/scene-scripts.js:513`，**活视图**）经 `demo.html:2949` 的 `audioBuffers(n)` 拿到**同源同曲线**的 n 元值；② 宿主（父页）经 `postMessage` 收到 128 元数组 | `?bandfeed=` | **auto（有源即开）** |
| 同上（诊断面） | `demo.html:2927`（`bandFrameTick`，由每帧钩子 `demo.html:6060` 调用） | `window.__mpwAudioBands`（128 元 `Float32Array`）、`window.__mpwAudioBandStats()`（`bandStats` 摘要，`silent` = "到底接上没有"）、`window.__mpwAudioBandSource` / `__mpwAudioBandReason` | 同上 | `off` 时一个字段都不写 |
| `core/web-frame-geometry.mjs`（帧盒） | `demo.html:1557`（`MPW-FRAMEGEOM` 块，切片段 `:1557-1608`）；调用点 `demo.html:1625`（`type=video` 壁纸）与 `demo.html:1641`（`?video=` 纯视频） | video 壁纸的 `<video>` 帧盒（`cover/contain/stretch` 三态，替换"整个交给 CSS `object-fit`"的不可断言路径） | `?framegeom=` | **legacy（关）** |
| 同上（指针口径） | `core/we-scene-bundle.js:17`（import）、`:20`/`:27`/`:42`（导出 `FRAME_GEOM_MODES`/`frameGeomMode`/`framePointerMap`）、`:6322`（档位解析）、`:6333`（DOM pointer 路径）、`:6365`（`__mpwPointer.space='css'` 注入路径） | 场景粒子 `lockToPointer` 发射器的基准点（`?cursor=` 那条链） | `?framegeom=cover` | **legacy（关）** |

两个模块**都在浏览器里按相对说明符 import**（`./audio-band-array.mjs` / `./web-frame-geometry.mjs`），
所以自带服务器与 Pages 产物根都各有一份同名文件：`server/we-scene-demo-server.mjs:416,420`（同名路由）、
`build-pages.mjs:58,59`（产物根映射）——与 `attach-transform.mjs`/`baseline-metrics.mjs` **同一个形态**。
缺任一处就是"静默失效"（404 ⇒ 模块加载失败 ⇒ 没有频谱/坐标不补偿，都不报错），所以两个接线测试都断言这三处在位。

## 2. 开关（本仓库既有风格：URL 查询参数，缺省=旧行为）

| 开关 | 取值 | 缺省 | 作用 |
|---|---|---|---|
| `bandfeed` | `auto`/空/`1`/`on`/`yes`/`true`/**非法值** = 有真实源（`?audio=1` 的包内音轨 / **已授权**的麦克风）就用真实源，没有就**全 0 + `silent`**（非法值不再静默回落关）<br>`mic`/`microphone` = 只用麦克风（**会请求权限**；拿不到 ⇒ 全 0 + `silent`）<br>`sim`/`simulated` = 只用确定性模拟源<br>`real`/`analyser` = 只认包内音轨的 AnalyserNode（没有 ⇒ 全 0 + `silent:true`）<br>`0`/`off`/`no`/`false` = **关**（批 D 之前的旧行为，逐位） | **auto**（批 D 起；此前 = 关） | 打开 128 元频段数组这一层 |
| `audioemit` | `auto`（缺省）= 有采集源 ⇒ 按官方语义调制；**没有采集源 ⇒ 不调制**（并在 `#log` 记一次）<br>`strict` = 没有采集源也照官方算（全 0 ⇒ `env=0` ⇒ 音频驱动层不发射）<br>`legacy`/`off`/`0` = 完全不调制（批 D 之前的画面，逐位） | **auto** | 粒子 `audioprocessing*` / `registerAudioBuffers` 调制口径（`core/we-scene-bundle.js:3088`） |
| `framegeom` | `cover`/`frame` = 覆盖式视口 / 模块换算<br>`contain`/`fit`、`stretch`/`fill` = 另两态（规格 §4）<br>`legacy`/`off`/`0`/空 = 关 | **legacy（关）** | 帧盒与指针口径改用帧几何模块 |
| `frame` | `legacy`/`off`/`0` | — | 模块规格 §5 **自带的**回退开关；**优先级最高**：即使写了 `?framegeom=cover` 也强制回 legacy（`core/we-scene-bundle.js:27`） |

主表登记：`docs/README-DIAGNOSTICS.md`（`bandfeed` / `audioemit` / `framegeom` 各行）——`tests/diag-flag-check.mjs`
按"代码里真实解析的开关"双向比对，漏登记/写陈旧都会非零退出（批 D 后实测 **153 开关 == 153 行**）。

## 3. 实测行为（数字都能用 §6 的命令复现）

音频（`tests/audio-band-wiring-test.mjs`，纯 Node、无音频设备）：

- **模拟源**（只在**显式** `?bandfeed=sim`）：输出恒 128 元 `Float32Array`，与
  `simulatedBandArray(t)` **逐位**相同（`Object.is`，128/128 项），也等于 `packBands(preL, preR)`（默认 γ=1.8/gain=1.8）
  ⇒ "曲线就是规格 §2.3 那一条"是**对拍**出来的，不是描述。
  "尖"的量化：一个节拍周期（132 BPM）内扫描 `t∈[0,2)`，峰值 **1.0000 @t≈0.18**（阈值型作者 `band>0.9` 能用）；
  单点 `t=1.25` 落在拍间隙时 peak=0.3483 —— 这也说明"取一帧判断有没有声音"不可靠，要看 `bandStats.silent`。
- **真实源**：有 analyser 时按 `0..1` **只钳位**（输入 0.2 ⇒ 输出 0.200000；若误套 γ 会变成 0.0993，
  测试专门断言这个差值 >0.1 ⇒ 反向变异必红）。单 analyser（mono 混音）⇒ 左右同源，**不伪造立体声差异**。
- **脚本侧是活视图**（批 D 起，`tests/audio-emit-live-test.mjs` T2）：`registerAudioBuffers(n)` 返回的
  **同一引用**长期有效，且内容**每帧原地刷新** —— 脚本在顶层只调一次也照样跟着音乐动。实测（有源时同一对象）
  第 1 帧 `0.224519` → `0.989727 → 0.203238 → 0.185711 → 0.191056 → 0.216698`；旧实现（每次新建数组）
  顶层那次调用**冻在编译那一刻**（2..6 帧恒 `0.066063`，而主机同期给 `0.235731 → … → 0.073527`）⇒ 测试的
  "内容随帧变化"必红。`average` 逐段 = `(left[i]+right[i])/2`（**修正**了旧宿主"整条 128 元总均值灌满 n 段"
  的口径 —— 语料 344 处读的正是 `average[frequency]`，灌成常数会让音条全平）。`left` 逐段等于
  "128 元数组左半 → 16 段均值"的独立复算（16/16 段相等）。
- **无源不报错、不阻塞、也不再假装有声音**（P1-5 的验收口径 + 批 D 收紧）：`?bandfeed=real` / `auto` / `mic`
  在没有对应源时 ⇒ 128 个 0 + `source='silent'` + `bandStats.silent=true` + **一条**一次性日志，
  渲染循环一行不抛；想"无源也有东西动"必须**显式**写 `?bandfeed=sim`。三种情况的区分判据就是
  `bandStats.silent` 与 `window.__mpwAudioBandSource` / `__mpwAudioBandReason`。

几何（`tests/web-frame-geometry-wiring-test.mjs`）：

- 舞台 1280×720 + 内容 1:1 ⇒ `cover` 帧盒 **1280×1280 @(0,−280)**、可见区 1280×720（规格 §2.2 第 2 支）；
  舞台 1000×1000 + 内容 2:1 ⇒ **2000×1000 @(−500,0)**（镜像支）。
- 内容 1920×1080 对 1280×720 舞台 ⇒ 比例差 0 ⇒ **帧盒 = 舞台全幅**（`coverViewport` 的 `null` 支：不裁"已经铺满"的页面）。
- `contain`/`stretch` ⇒ 视口恒 100%×100%，差别只在 `object-fit:contain|fill`（规格 §4）。
- **只认内在尺寸**：内在 1:1 + 渲染盒 300×150（2:1 占位）⇒ 比例取 1；比例量到 100（越界）⇒ `null` ⇒ 不处理。
- 指针口径：显示盒 400×200 / 内部视口 800×400（祖先 `transform` 缩到一半）时，
  legacy 给 `x=200`（无补偿）、`cover` 给 `x=400`（`scaleX=0.5` 补偿，规格 §1.4 不变量 3）；
  归一化值两档**相同**（0.5），差别只在"帧内 client 像素"这一层——正是 `space:'css'` 需要的那层。
- **"关 = 逐位不变"**：`legacy` 档的换算与改动前的内联算式同式同值（含 NaN 透传：不新增丢弃行为）；
  video 路径关时**不返回计划、不碰 `style.cssText`**。

## 4. 还没接的 / 未定（缺证据，不猜）

1. **web 壁纸 iframe 的尺寸路径 —— 未定/缺证据（本次没接）**。规格 §0 说的"内容比例 ≠ 舞台比例 ⇒ 覆盖式视口"
   在 web 壁纸上确实存在，但**本仓库里没有可注入的调用方**：
   - 网页壁纸的帧是**三方 minified 渲染器**建的（`demo/assets/renderer-BOSoB05I.js`：
     `createElement("iframe")` 处 `sandbox="allow-scripts allow-same-origin"`、`inset:0;width:100%;height:100%`，
     其内部 `nw()`（= `coverViewport` 对应物，常量 `.005/.2/6` 与规格一致）与 `Y1()`（= `frameClientPoint` 对应物）
     都是**模块内私有函数**；公开面 `window.__wp` 的 14 个方法里**没有**任何几何 setter（只能被动读 DOM）。
     改那个产物 = 改三方 minified 代码，本仓库纪律不允许（`demo/bench-patch.js` 头部："不改 minified 产物"）。
   - 插件侧（`dsh-mpkg-wallpaper/lib/web-wallpaper.js`）是网页壁纸的**另一个**宿主，且在**别人的树**里（本任务禁改）。
   ⇒ 因此**只接了指针口径这一半**（`?framegeom=cover`），并把"帧盒"这一半接在**本仓库自己的** DOM 帧上
     （video 壁纸，`demo.html:1557`）。要接 web 壁纸那一半，先要有一个**可注入的宿主契约**
     （例如渲染器暴露 `__wp.setFrameGeom(...)`，或插件侧把帧盒计算交给本模块）——**未定**，需用户/上游确认。
2. **渲染器 → 宿主的音频消息：契约未确认**。`?bandfeed=1` 且被嵌进宿主时，渲染器会按 20Hz 节流发
   `{type:'mpw-audio-bands', v:1, len:128, source, t, bands:[128 项]}`（`demo.html` 的 `bandPublish`）。
   **这是"缺的那一半"的提案**：in-repo 没有任何消费者；插件侧的频谱桥是**父页 → 帧内**
   `{mpw:'mpw:web', op:'audio', bands}`（`dsh-mpkg-wallpaper/docs/WEB-WALLPAPER.md` §5.2、
   `lib/web-wallpaper.js` 的 `wallpaperRegisterAudioListener`），而"渲染器 → 插件"的音频入参**不存在**。
   谁先污染谁：本条只在显式开关下发（关时零 `postMessage`），宿主不认识时按"未知消息"忽略无害。
3. **真实系统音频采集：本机不存在**。没有系统声卡环回（`docs/AUDIO-TRACK-SPEC.md` 与测试台"系统实况"
   是**麦克风**）⇒ 本接线的"真实源"是渲染器**自己的** `AnalyserNode`（包内 sound 层，`?audio=1` 且真的在播）
   或**麦克风**（批 D 新增 `?bandfeed=mic`；`auto` 档只在 `permissions.query` 已是 `granted` 时静默启用，
   **绝不弹权限框**），不是"系统里正在放的音乐"。要"网页壁纸跟着系统音乐动"，缺的仍是**宿主侧采集 + 下发通道**（同上第 2 条）。
4. **`__mpwPointer.space === 'css'` 的口径未定**。`core/we-scene-bundle.js` 原注释说"调用方自行换算
   （见 renderParticleLayer 的 css 分支）"，但全仓库**没有任何** `space:'css'` 的生产者、也没有那个分支
   （grep 0 命中）。`?framegeom=cover` 下本次按**窗口/视口坐标**（`clientX/clientY` 同空间）解释并换算；
   若上游的本意是"帧内 CSS 像素"，则该支需要改成只除 `scaleX`。缺一个真实生产者/官方文档 ⇒ **未定**。
5. **P1-6 媒体会话（曲目/封面）**：本轮没碰（它是插件侧的媒体源接线）。渲染器侧的既有能力
   （`elysia/media-host.js`、`?media=`、`__mpwAudio`）不变。

## 5. 回退与不可回归的证明方式

- 两个开关**缺省都是关**，且"关"的判据都写成了**可执行的断言**，不是描述：
  - video 帧盒：关时不返回计划、不写 `style.cssText`（`tests/web-frame-geometry-wiring-test.mjs` T1b/T3d）；
  - 指针换算：legacy 档与改动前的内联算式同式同值（T4c/T4k）；
  - 脚本频谱：关时 `audioBuffers(n)` 走旧分支（无 analyser ⇒ `null`；有 analyser ⇒ 旧口径且
    `left` 与 `right` 不是同一个数组对象，消费方原地改写不串道）（`tests/audio-band-wiring-test.mjs` T4e）；
  - bandfeed 关时零 `postMessage`、零新字段（T5d）。
- **反向变异必红**（每个接线测试内自带，绿色运行也会打印 RED 行）：把真源码切片里的关键一行改回旧行为，
  再断言对应结论**变红** —— 音频两条（去 `clampOnly`、关掉脚本侧分支）、几何两条（帧盒强制 legacy、
  `framePointerMap` 的 cover 支退化成旧算式）。

## 6. 怎么复现

```bash
cd we-scene-demo
node tests/audio-band-array-test.mjs            # 模块契约（35 断言，接线无关）
node tests/web-frame-geometry-test.mjs          # 模块契约（50 断言，接线无关）
node tests/audio-band-wiring-test.mjs           # 接线（含 RED-IF-REVERTED）
node tests/web-frame-geometry-wiring-test.mjs   # 接线（含 RED-IF-REVERTED）
node tests/diag-flag-check.mjs                  # 开关主表 ↔ 代码 双向归零（并重写 web/diag-flags.json）
bash tests/run-all-tests.sh                     # 全量门禁（两项已注册在 add 列表末尾）
```

真机/浏览器里看（自带服务器 `bash start-demo.sh`，页面 `http://127.0.0.1:8899/`）：

```text
?id=sample-synthetic&audio=1&bandfeed=1      # 128 元频段数组：window.__mpwAudioBands / __mpwAudioBandStats()
?video=<rel>&framegeom=cover                 # video 壁纸帧盒（#log 打一行"帧几何(cover) … 帧盒 WxH @(x,y)"）
?id=…&framegeom=cover&cursor=…               # 指针口径（对比不加 framegeom 的同一包）
```

> 参考来源许可声明：`oneincase/webwallgl`（MIT）只作**行为契约**对照，未复制其代码 —— 差异清单见
> `docs/AUDIO-BAND-SPEC.md` §5、`docs/WEB-FRAME-GEOMETRY-SPEC.md` §6 与 `THIRD-PARTY.md` §11/§12。
> `wer-ref/`（GPL-2.0-only）与 `we-layerd-ref/`（无许可）仅行为对照，不复制。血缘自查：`docs/WER-REF-LICENSE-AUDIT.md`。

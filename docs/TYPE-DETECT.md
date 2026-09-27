# 壁纸类型判定（信号 → 档位）——判定表 · 实测 · 回退口

> 用户点名场景：**「包含 mp4 的 scene 壁纸的 MPKG 形式，会不会被只识别成 MP4、而没有 scene 效果？」**
> 结论（语料实测）：**容器级不会丢**（客户端有"容器内有 `scene.json` ⇒ 交渲染器"的闸门），
> 但**目录级会丢**——`/custom-dir` 的子目录判定曾把"容器收藏夹"整目录塌成 **1 条 `scene`**，
> media 还是被随手挑中的那个容器；真包 `wallpaperE/伊蕾娜` 挑中的恰好是**纯视频**容器
> （`伊蕾娜1_8.mpkg`：`project.json.type=video` + `File0001.mp4`，**没有** `scene.json`），
> 其余 4 个容器（含 2 个真场景）**全部不可达**；点"使用"走 scene-video 快路径时探测到的是
> **同目录那条与该壁纸无关的松散视频** ⇒ 用户看到的就是"只剩视频"。
>
> 判据：`node tools/type-detect-test.mjs`（48 条；合成判定表 + 7 个真包实测 + 客户端档位/分流
> 顺序 + 回退口 + 3 组变异必红）。回退口：`typedetect=legacy`（`/custom-dir` 请求体）/
> `DSH_WE_TYPEDETECT=legacy`（环境变量）；`GET /probe` 的 `typeDetect` 字段可观测当前口径。

---

## 1. 判定表（信号 × 现状 × 应然）

判准只有一条：**"不丢效果"** —— 容器里有场景数据（层 / 效果链）就必须走 scene（渲染器
`?pkgurl=`），scene 里内嵌的视频由渲染器当图层处理；**只有**渲染器不可达时才退
"scene 内嵌视频快路径"（`sv=1`，`converted:"mp4"` + `image=…&scene=1&sv=1`）。
反向红线同样成立：**纯 mp4 不得判成 scene**（那会白挂一个渲染器 iframe ⇒ 变慢/黑屏）。

| # | 容器/目录里的信号 | 改前判成 | 应然（改后） | 现状 |
|---|---|---|---|---|
| 1 | 目录里有官方 `scene.pkg`（直接子项） | `scene` / media=`scene.pkg` / `scene-container` | 同左 | ✅ 不变 |
| 2 | 目录里有松散 `scene.json`（直接子项） | `scene` / media=`scene.json` / `scene-json` | 同左 | ✅ 不变 |
| 3 | 容器内有 `scene.json`，无 mp4 | 根级文件→`mpkg`；收藏夹→逐容器 `folderMpkg` | 同左（客户端 `applyCustomMpkg` 见 `scene.json` ⇒ 渲染器） | ✅ 不变 |
| 4 | 容器内有 `scene.json` **且**有独立 mp4 条目（**用户点名**） | 根级→`mpkg`✅；**收藏夹+同目录松散视频→整目录 1 条 `scene`**❌ | 逐容器成条 → 容器档 → 渲染器（层/效果链保留） | 🛠 **修** |
| 5 | 容器内有 `scene.json` + 内嵌视频纹理（≥1MiB `.tex` 带 `ftyp`） | 收藏夹+松散视频→同上塌成 1 条❌ | 逐容器成条 → 渲染器；渲染器离线才退 `sv=1` | 🛠 **修** |
| 6 | 容器内**无** `scene.json`，只有独立 mp4 | 目录级判 `scene`（reason=`scene-container`）❌ | `mpkg` 档 → 客户端 `selected` → **mp4** | 🛠 **修** |
| 7 | 容器内无 `scene.json`，只有视频纹理 | 目录级判 `scene`❌ | `mpkg` 档 → **mp4（视频纹理档）** | 🛠 **修** |
| 8 | `project.json.type="scene"` 但内容只有 mp4 | 目录级：容器⇒scene❌ / 容器级：已按内容判 video✅ | **video**（声明只作线索，不作依据） | 🛠 **修目录级** |
| 9 | `project.json.type="video"` 但内容有 `scene.json` | 容器级已判 scene✅ | **scene**（内容优先） | ✅ 不变 |
| 10 | 目录有 `index.html` + **无场景数据**的容器 | `scene`（容器信号压过 html）❌ | **web**（html 是入口，容器是素材） | 🛠 **修** |
| 11 | 目录有 `index.html` + **真场景**容器 | `scene` | **scene**（内容优先，保持旧口径） | ✅ 不变 |
| 12 | 只有图片 | 根级文件→`image`；**子目录**→不进清单（`unknown`） | 同左（既有口径：子目录只认 web/video/scene） | ✅ 不变 |
| 13 | 容器读不出来（坏 magic / 目录表超限） | `scene` / `scene-container` | 同左（**不猜**）+ `containerKind:{ok:false}` 记账 | ✅ 不变 |
| 14 | 文件是**符号链接**、或 `Dirent` 的 d_type 不可信（f2fs 误报） | 递归文件表**漏掉它** ⇒ 整张壁纸从清单消失 ❌ | `statSync` 兜底：链到文件=文件、链到目录=下钻、断链=跳过 | 🛠 **修** |
| 15 | 目录里只有"嵌套在子目录里的容器"（`子/ x.mpkg`） | 拆成带相对路径的条目，客户端 403（不可达） | 保持旧口径（条目数不增不减；`media` 含 `/` 的条目本就走不通） | ⚠️ 已知边界（§6） |

**容器档（`type:"mpkg"`）到底怎么分流**（客户端，源码顺序即规格）：
```
applyCustomMpkg(w)                     lib/client.js:18681
  ├─ /custom-mpkg?folder=&file=   → entries + selected（宿主选素材：preview > 独立 mp4 > 视频纹理）
  ├─ entries 里有 scene.json ？      lib/client.js:18706   ⇒ applySceneViaRenderer(?pkgurl=)  ⇒ converted:"scene"
  ├─ 否则有视频纹理（≥1MiB .tex）？  lib/client.js:18720   ⇒ handleVideoTexes（多时段自动切换）
  └─ 否则 selected                   ⇒ converted: isMp4 ? "mp4" : "gif"
```
**scene 目录档**（`applyCustomScenePreview`）：先 `applySceneViaRenderer`（`lib/client.js:18907`），
失败才 `applySceneWallpaper` → `sv=1` 快路径 → 图层合成 → 静态帧（`lib/client.js:6368`）。

---

## 2. 实测对照（真机语料，`node tools/type-detect-test.mjs` 的 B 段逐条打印）

语料：`<工作区>/allwallpaper/**`，**206 个容器**，其中 **77 个同时有 `scene.json` 与视频信号**
（真包统计，只读容器目录表 + 每个大 `.tex` 读 64KB 前缀）。下面 7 个是"同时有 scene 与 mp4"的
代表包，`实际档` 由**真路由**（`/custom-dir`、`/custom-mpkg`）+ 容器内容真值推出：

| 包 | 容器真值（真实现解析） | 改前（目录级） | 实际档 | 应然档 |
|---|---|---|---|---|
| `wallpaperE/佩丽卡/佩丽卡1_02.mpkg` | `scene.json`（23 层 + 效果链） + `wallpaper.mp4`；无层引用该 mp4 | 逐容器成条 ✅ | **scene** | scene |
| `wallpaperE/伊蕾娜/伊蕾娜_08.mpkg` | `scene.json`（4 层） + `wallpaper.mp4` | **整目录 1 条 `scene`**，media=另一个**纯视频**容器 ❌ | **scene** | scene |
| `wallpaperE/伊蕾娜/伊蕾娜1_8.mpkg` | 无 `scene.json`，`File0001.mp4` | 被当作"scene"挂渲染器 ❌ | **video** | video |
| `wallpaperE/遐蝶/夜莺Night…冥河永渡….mpkg` | `scene.json` + 1 条内嵌视频纹理，无独立 mp4 | 逐容器成条 ✅ | **scene** | scene |
| `dd/3326873240/scene.pkg` | `scene.json` + **5** 条内嵌视频纹理 | 目录级 scene ✅ | **scene** | scene |
| `0923/2887099508/scene.pkg` | `scene.json` + **1** 条内嵌视频纹理 | 目录级 scene ✅ | **scene** | scene |
| `wallpaperE/佩丽卡/佩丽卡1_01.mpkg` | 纯视频容器（`32.mp4`）；文件是**符号链接** | 递归表漏掉 ⇒ **不进清单** ❌ | **video** | video |

目录级实测（同一份扫描，`/custom-dir`）：

| 目录 | 目录里有什么 | 改前 | 改后 |
|---|---|---|---|
| `wallpaperE/伊蕾娜` | 5 容器（2 真场景 + 3 纯视频） + 松散 `VID_20250716042223.mp4` | **1 条 `scene`**（media=`伊蕾娜1_8.mpkg`，reason=`scene-container`），其余 4 容器不可达 | **5 条容器条目**（各自按内容分流） |
| `wallpaperE/流萤` | 4 容器（1 真场景 + 3 纯视频） + 松散 `横屏 仲夏萤火之约….mp4` | **1 条 `scene`**，其余 3 容器不可达 | **4 条容器条目** |
| `wallpaperE/佩丽卡`、`白洲梓`、`洛茜`…（无松散视频） | N 个 `.mpkg` | 已逐容器成条 ✅（本次不动） | 同左（回归） |
| `dd/*`（11 个含 `scene.pkg`） | `scene.pkg` + `project.json` + `preview.*` | `scene` / media=`scene.pkg` ✅ | 同左（回归断言） |
| `dd/3715743282`、`dd/3721991999`、`dd/3580207945`、`dd/3646392375` | 常规目录（文件 d_type 被 f2fs 误报成 `DT_LNK`） | **整张壁纸从清单消失**（legacy/content 两种口径下都不见）❌ | 回到清单（`statSync` 兜底） |

**scene-video 快路径的定位（本次未改，属于既有契约）**：`scene=1&sv=1` 是"scene 里内嵌视频"的
**加速档**（`<video>` 硬件解码），只在 **渲染器不可达** 时接手；自定义目录的 scene 档**先试渲染器**
（`lib/client.js:18907`），所以"有 scene 就丢效果"不会发生。`sv=1` 的探测口径见
`lib/index.js` 的 `ensureSceneVideo` / `findSceneVideoInPkg`（独立媒体优先；`TEX` 内嵌恰好 1 条才用；
多条 = 时间变化 ⇒ 交 mpkg 多时段路径）。

---

## 3. 根因（改前代码位置）

1. **目录级"是容器就是场景"**：`lib/web-wallpaper.js:260` 的 `signals.scene` 第三顺位是
   `ANY_PKG_RE`（任意 `.pkg/.mpkg`），而 `lib/web-wallpaper.js:294` 的优先级是
   `scene > video > html` ⇒ 一个**纯视频**容器就能让整个目录被判成 scene，且
   `scene-container` 这条"依据文案"会原样下发给界面。
2. **逐容器拆条被松散视频否决**（用户点名的直接原因）：`lib/index.js` 改前的判据是
   ```js
   if (det.mpkgs.length && !det.signals.html && !det.signals.video && !realScene) { …拆条… }
   ```
   `det.signals.video` 来自**递归**文件表里的任意视频文件 ⇒ 目录里只要有一条松散 mp4，
   拆条整个失效、整目录塌成 1 条；而 `media` 是 `files.find(ANY_PKG_RE)` 的**首个**匹配
   （readdir 顺序），在 `wallpaperE/伊蕾娜` 里恰好是纯视频容器。另外 `det.mpkgs` 只匹配
   `.mpkg`（不含任意名 `.pkg`），且来自**递归**表 ⇒ 嵌套路径会被当成条目下发（客户端 403）。
3. **`Dirent` 类型不可信即当不存在**：`lib/web-wallpaper.js:313-319` 只认
   `en.isDirectory() / en.isFile()`；真符号链接与 f2fs 的 d_type 误报都是"既不是文件也不是目录"
   ⇒ 文件被静默丢弃 ⇒ `detectWebWallpaperKind` 判 `unknown(no-files)` ⇒ 整张壁纸消失
   （§2 最后一行，legacy 口径下同样复现 ⇒ 与本次类型判定改动无关的独立缺口）。

## 4. 改法（只动宿主侧，零客户端改动）

| 文件 | 改动 |
|---|---|
| `lib/index.js:472` | 新增 `probeContainerKind(filePath)`：用**既有** `readMpkgHeadGrow` + 与 `/custom-mpkg` **同口径**的 64KB `ftyp` 扫描，得出 `{hasScene,hasSceneJson,nestedScenePkg,hasMp4,hasVideoTex,hasImage,declaredType}`；读不出来 ⇒ `ok:false`（调用方**不猜**）。结果按 `mtime+size` 缓存。 |
| `lib/index.js:535` | 新增 `typeDetectMode()`：口径开关（`content` 默认 / `legacy` 回退），两处入口见 §5。 |
| `lib/index.js:2742-2796` | `/custom-dir` 目录判定：① `realSceneFile` 只看**直接子项**里的 `scene.pkg`/`scene.json`；② `contFiles` = 直接子项里的 `.mpkg`/`.pkg` ⇒ **逐条成 `folderMpkg`**（去掉 `!det.signals.video` 这道否决）；③ 走到"唯一 scene 信号是容器"的残余路径时，按**容器内容**定档（无场景数据 + 有 html ⇒ `web`；无场景数据 ⇒ 只改"依据"文案为 `container-*`，不再声称 scene；有场景数据 ⇒ `scene-container`）。 |
| `lib/index.js` `/probe` | 响应加 `typeDetect:{legacy,mode,via}`（回退口可观测，附加字段，不改既有键）。 |
| `lib/web-wallpaper.js:319-338` | `listWallpaperFiles`：d_type 报"既不是文件也不是目录"时用 `statSync` 兜一次（软链跟随 / 断链跳过）。 |

**代价**：常见路径（收藏夹拆条）**零额外读盘**（拆条分支在 `probeContainerKind` 之前，判据
A13）；只有"容器是唯一 scene 信号"的残余路径才读一次容器头（2MiB 起，与大目录表倍增口径一致），
且按 mtime+size 缓存。

**红线（不许把纯 mp4 判成 scene）**：判据 A4e / A5c / A10 三个反例 + 变异 `verdict`；容器里没有
`scene.json` 时**不会**出现 `type:"scene"`，因此也就没有"白挂渲染器 iframe ⇒ 变慢/黑屏"。

## 5. 回退口

| 入口 | 用法 | 生效范围 |
|---|---|---|
| 请求体 | `POST /api/mpkg-wallpaper/custom-dir {"dir":"…","typedetect":"legacy"}` | 单次扫描（免重启） |
| 环境变量 | `DSH_WE_TYPEDETECT=legacy`（与 `DSH_WE_*` 一族同款） | 宿主进程（重启生效） |
| 可观测 | `GET /api/mpkg-wallpaper/probe` → `typeDetect:{legacy,mode,via}` | 只读 |

`legacy` = 改前口径（容器出现即 scene；目录里有松散视频就不拆条），判据 D1/D1b/D2/D2b 钉住
"回退口真的接管"，变异 `split` 钉住"新判据真的在承重"。

## 6. 未验证边界（如实登记，不猜）

1. **`media` 含 `/` 的条目**（只有子目录、没有直接子项容器的目录，如 `delete/wallpaperE`）：
   客户端两条字节路由（`/raw`、`/custom-mpkg`）都显式 403 `file` 含 `/` ⇒ 这类条目**本来就走不通**。
   本次只做到"条目数不增不减"（改前 2 条不可达 → 现在 1 条不可达），没有把它变成可达。
2. **内嵌 `scene.pkg` 的容器**：`probeContainerKind` 认 `nestedScenePkg`，但本机语料 206 个容器里
   **0 例**，真机后果未验证（构造性缺口）。
3. **Steam 库路径**（Windows）：`lib/index.js` 的 `/steam-inventory` 用 `project.json` 的声明定
   `type`，客户端 `applyLibraryWallpaper`（`lib/client.js:19118`）的 scene 档**从不尝试渲染器**、
   直接走 `sv=1`/合成 ⇒ "scene 内嵌视频 ⇒ 只剩视频"这一形状在该路径上**仍可能发生**。
   本机无 Steam 库（`locateWallpaperEngine()` 返回 null）⇒ 未实测；**未改**（client.js 属并行线）。
4. **其它三处 `readdirSync(...,{withFileTypes:true})`**（`lib/index.js:747` restoreFiles 下钻、
   `:2128` 网页预检重资产清点、`:2603` 目录选择器子目录列表）仍只信 `Dirent`：d_type 误报一个
   **目录**时它们会漏下钻/漏计数（本机实测误报的是**文件**，未观测到目录侧）。不影响容器档判定。
5. **压缩条目**（LZ4 块链容器）：本机语料 0 例；`probeContainerKind` 对压缩条目按"读不出就
   `ok:false`"处理（不猜），真机后果未验证。
6. **`.pkg`/`.mpkg` 之外的容器名**（无扩展名的 PKG 文件）：两处白名单都不收，属既有口径。

## 7. 复现与门禁

```bash
node tools/type-detect-test.mjs                       # 48 条，离线；语料缺失自动 SKIP
MPW_CORPUS=<语料根> node tools/type-detect-test.mjs    # 指定语料（默认 <仓>/../allwallpaper）
node tools/type-detect-test.mjs --no-mutations         # 跳过变异子进程（调试用）
node tools/integrity-check.mjs && node tools/secret-scan-test.mjs
bash tools/check.sh                                    # 全量门禁（含本判据）
```

变异自证（E 段，子进程跑 `lib/` 的临时副本，不动仓库文件；**去掉新判据必须变红**）：

| 变异 | 改回什么 | 必须变红的断言 |
|---|---|---|
| `split` | 把 `!det.signals.video` 加回拆条判据（= 修复前） | A4（逐容器 3 条） |
| `verdict` | 关掉"容器内容裁决"（= 是容器就是场景） | A6（html + 无场景数据容器 ⇒ web） |
| `dirent` | 去掉 `statSync` 兜底（= 软链/d_type 误报当不存在） | A12b（全软链 scene 目录仍判 scene） |

## 8. 一并被这一改动波及的**既有判据**（为什么动了别的线的测试文件）

改动落在 `lib/index.js` / `lib/web-wallpaper.js` 这两份**共享**文件上，三处既有门禁的"锚点/读数"因此需要
同步（都是**加强或等价**，没有放宽）：

| 判据 | 原读数 | 现读数 | 为什么 |
|---|---|---|---|
| `tools/pkg-import-test.mjs` E6a/E6b/E6b2/E6c | 2 档变异（根修 / 消费点兜底） | 4 档变异（+ 内容裁决；"三处全关才回到 scene-json"） | `kindReason` 多了第三处兜底（容器内容），单点失败不再可能 |
| `tools/we-json-tolerance-test.mjs` S1-8/S1-9 | 宿主侧包内解析点 2 处 | 3 处（+ `probeContainerKind` 的容器内 `project.json`） | 新增读取点必须同样走 `mpwParseWeJson` **并记账**（`mpwWeJsonSwallowed`），否则 S1-9 变红 |
| `tools/web-wallpaper-test.mjs` `scanWebCorpus` | 只信 `Dirent.isFile()` | 类型拿不准时 `statSync` 兜底 | **测量仪器的同一口锅**：语料 d_type 误报时它会漏文件 ⇒ 语料计数比文档快照少（L5 变红），而 `docs/WEB-WALLPAPER.md` 的 `MPW-CORPUS-COUNTS` 区块本身**未改**（修好仪器后 walls 9→11、apis/signals 与文档逐项一致） |

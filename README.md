# dsh-mpkg-wallpaper — DSH 壁纸引擎背景插件

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](README.md) | [English](README.en.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 界面（`dsh web`）添加背景壁纸的插件：**Wallpaper Engine `.mpkg` 解析、Steam 创意工坊目录、视频/网页/图片壁纸、时间变化壁纸的多时段切换、整屏虚化体系、主题色与玻璃外观、本地壁纸库、定时轮换、Now playing 控件、一键更新**。外观细节几乎全部可调。

> 版本口径：本文件描述的是 `package.json` 里 **`3.10.1`** 这一版实现。发布面共 **15 个文件**（`lib/` 8 个运行时文件 + `package.json`、`icon.svg`、`cordis.patch.yml`、`README.md`、`README.en.md`、`THIRD-PARTY.md`、`LICENSE`；`npm pack --dry-run` 实测 15 文件 / unpacked 2 088 240 B）；`lib/liquid-glass/**`、`lib/liquid-glass-bundle.js`、`dist/`、`tools/`、`docs/` 都不进 npm 包（`package.json:8-21`）。本轮的默认档变化：**`npNowPlaying` 关 → 开**（3.8.0 起）与 **`powPauseHidden` 关 → 开**（3.9.0 起，只迁移"从没设过"的存量档；详见[这一版新增/变更](#这一版新增变更)）。

---

## 下载 · 安装

插件已发布到 npm（`dsh-mpkg-wallpaper`）。四种装载方式——先按这张表选一条，再看对应小节：

| 方式 | 适合谁 | 更新怎么做 | 客户端界面 |
|---|---|---|---|
| 一 `dsh plugin add`（推荐） | 默认选择；市场能识别「已安装」 | `dsh plugin --profile web update …` | 完整 |
| 二 pnpm 手动装 | 自己管 profile 的依赖表 | 同上（走依赖表） | 完整 |
| 三 GitHub 克隆 | 开发者 / 离线 / 要改代码 | `git pull` | 完整 |
| 四 单文件 bundle | 离线应急；给非 DSH 宿主复用路由 | 重新生成并替换那个 `.mjs` | **只有宿主端** |

### 方式一：`dsh plugin add`（推荐，市场可识别）

```bash
dsh plugin --profile web add dsh-mpkg-wallpaper
# 重启 dsh web 后浏览器 Ctrl+F5 生效
```

### 方式二：pnpm 手动安装

```bash
pnpm --dir $DSH_HOME/profiles/<profile> add dsh-mpkg-wallpaper
# 重启 dsh web，浏览器 Ctrl+F5 生效
```

与方式一同源，只是不经 `dsh plugin` 包装。

### 方式三：GitHub 克隆（开发者 / 离线）

```bash
git clone https://github.com/XHR666/dsh-mpkg-wallpaper.git $DSH_HOME/profiles/<profile>/node_modules/dsh-mpkg-wallpaper
# 然后在 profile 的 cordis.patch.yml 注册：
#   - insert:
#       - id: dsh-mpkg-wallpaper
#         name: dsh-mpkg-wallpaper
# 重启后生效
```

> 方式三不写依赖表 ⇒ 市场不显示「已安装」（只影响显示，不影响功能）。

### 方式四：单文件 bundle（离线 / 拷文件即装；**只装宿主端**）

把宿主端内联成一个自包含 ESM 再登记：

```bash
cd /path/to/dsh-mpkg-wallpaper
node tools/build-bundle.mjs          # 产物：dist/dsh-mpkg-wallpaper.bundle.mjs（实测 449 671 B / 439.1KB；以 bundle-equivalence-test 的输出为准）
node tools/build-bundle.mjs --check  # 与源码对拍：导出面 / 路由表 / ping JSON 形状（20 条断言）
node tools/bundle-equivalence-test.mjs  # 更全的等价性门禁（38 条断言；门禁第 11 步）
```

把 `dist/dsh-mpkg-wallpaper.bundle.mjs` 拷到任意目录（例如 `~/.dsh/plugins/`），在 profile 的 `cordis.patch.yml` 里按**绝对路径**登记，然后重开 `dsh web`：

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- insert:
    - id: dsh-mpkg-wallpaper
      name: /绝对路径/dsh-mpkg-wallpaper.bundle.mjs   # ← 指向那个 .mjs 文件本身
```

**这条路装载了什么 / 没装载什么**（都是代码与门禁事实）：

| 项 | 方式四的行为 | 依据 |
|---|---|---|
| 宿主端（上传/Range 流式播放、场景提取、音频清单、设置持久化、诊断上报等 **41 条路由**） | **完整**（`lib/index.js` + `pkg-extract.js` + `web-wallpaper.js` + `web-interaction.js` 全部内联；外部依赖只有 node 内建） | `node tools/bundle-equivalence-test.mjs`：路由表（kind + path）逐条相同 `[41 条]` |
| `/api/mpkg-wallpaper/ping` | `{ok, version, betterSidebar, betterSidebarVersion}` 键集合与源码一致 | 同上 + `build-bundle.mjs --check` |
| **客户端半（设置面板 / 壁纸层 / 磨砂 / Now playing）** | **不装载**。单文件里只有宿主端导出面（`apply` / `inject` / `__mpwTest`） | 客户端半由 DSH 客户端模块系统按**包**发现：扫描宿主 Loader 条目里声明了 `dsh.client` 的包并解析其 `exports["./client"]`；裸 `.mjs` 没有 package.json ⇒ 没有 `dsh.client` 声明 |
| `GET /api/mpkg-wallpaper/lg/*`（遗留 WebGL 托管路由，客户端已不调用） | bundle 旁边没有 `liquid-glass/` 时 **404**；`cp -r lib/liquid-glass <bundle 目录>/` 即与源码逐字节一致 | 该路由以 `import.meta.url` 定位同目录 `liquid-glass/`（`lib/index.js:3453`）；门禁两种布局都断言过 |
| `ping.version` | 上一级目录没有 `package.json` 时返回 `null`（只影响版本号显示） | `new URL('../package.json', import.meta.url)`（`lib/index.js:1622`） |
| 「检查更新 / 一键更新」 | 无伴生 `package.json` 时 `update-check` 返回 500，`update-apply` 会往 bundle 同级/上级目录写文件 ⇒ **不建议在方式四下使用** | `lib/index.js:1792-1860` |
| 卸载 | 删掉那个 `.mjs` 与 `cordis.patch.yml` 里那一行即可 | — |

> 结论：**方式四是"宿主端能力"的降级装载**（离线/应急/给非 DSH 宿主复用路由时好用）；要完整界面请用方式一/二/三。产物**不入库**（`dist/` 在 `.gitignore` 里：它是 `lib/*.js` 的纯派生物，两次构建 sha256 逐字节相同，`tools/bundle-equivalence-test.mjs` 第②节；发布时现生成并公布哈希）。

### 更新

```bash
# 方式一 / 二：走 npm 的 latest 标签
dsh plugin --profile web update dsh-mpkg-wallpaper

# 方式三：在克隆目录里
git pull

# 方式四：重新生成并替换那个 .mjs
node tools/build-bundle.mjs
```

更新后都要：重启 `dsh web` → 浏览器 `Ctrl+F5`。

### 卸载

方式一/二/三：`dsh plugin --profile web remove dsh-mpkg-wallpaper`。
方式四：删 `.mjs` + `cordis.patch.yml` 里那一行。
残留数据（可选清理）：浏览器 `localStorage['dsh.mpkg-wallpaper.v2']`、宿主端 `~/.dsh-mpkg-wallpaper/`（`settings.json`、`web-store.json`、`media-audio.json`、上传的 mpkg、转码缓存、`diag-*.json`）。

## 30 秒快速开始

这节给最短路径：装完到看见壁纸，只走三步。

1. **装好并重启**：按上一节任选一种方式装完，重启 `dsh web`，浏览器 `Ctrl+F5`。
2. **打开面板**：左侧栏「设置」→「壁纸引擎背景」。
3. **选一张壁纸**，任选其一：
   - 拖入 `.mpkg` 文件（视频类直接播；场景类走静态帧/图层合成）
   - 选本地图片 / 视频，或填一个图片链接
   - 「自定义目录」选一个文件夹（可直接选 Steam 的 `steamapps/workshop/content/431960`，每个子文件夹算一张）

默认档就已经能用：总开关开、大文件混合模式开、整屏虚化开（30px）、Now playing 挂在左侧栏。
想微调，先动这三处就够：**壁纸设置 → 磨砂模糊**（0–40）、**界面统一 → 整屏虚化程度**（0–40）、**壁纸设置 → 镜头缩放**（10–2000%）。

> 没反应时先去「其他」tab 点一次 **一键诊断上报**（宿主不可用会自动下载 JSON），再带上它去[反馈](#反馈-bug)。

## 核心能力

这节按**你能感知到的东西**分组（来源、时间变化、虚化、外观、播放、库与轮换、安全、备份），不按代码模块。

**📦 壁纸来源**
- **Wallpaper Engine `.mpkg`**：浏览器内直接解析容器（不上传第三方）；视频类播放内嵌 mp4 / 视频纹理；场景类解析容器提取素材；**时间变化**按系统时间选时段素材
- **Steam 创意工坊目录**：自动发现 WE 安装（注册表 + `libraryfolders.vdf`，支持非默认盘），列出 `video / web / scene` 三类；也可把 **workshop 主目录**（`steamapps/workshop/content/431960`）直接设为自定义目录——每个子文件夹自动识别为一张壁纸
- **视频**：`.mp4/.webm/.mov/.m4v` 直接播放；**网页**：HTML 在沙箱 iframe 中加载（带风险预检）；**图片/动图/链接**：本地图片或 URL（含 `data:image`）
- **自定义目录**：任意文件夹，`.mpkg`、workshop 子目录、图片/视频/`scene.pkg` 混放都能识别

**⏰ 时间变化壁纸（Time Variation）**
- 识别 WE 的时间变化属性（`morningtime / daytime / dusktime / nighttime / timevarying`，默认 5/8/17/20 时，`lib/client.js:10419-10423`）
- **按需懒加载**：只提取当前时段素材（单槽峰值几十 MB），切换时段时才读，避免一次导入全部时段导致 OOM
- **手动锁定时段**：时段按钮只在容器里真的有该时段素材时出现（`lib/client.js:12797-12813`），键名 `timeOverride`；点「自动」恢复随时间切换
- **不串台**：切换壁纸时清空上一张的时段缓存

**🌊 整屏虚化（磨砂）体系**
- **统一虚化**：一条滑条控制整屏壁纸模糊度 + 侧边栏/标题栏白雾厚度；聊天区是否跟随、新会话按钮是否跟随各自独立
- **界面虚化（各自独立开关 + 程度）**：对话框（通用居中窗口 + 聊天输入框）、设置面板、下载/确认弹窗、弹层（菜单/下拉/提示）、遮罩（全屏背景）、左侧边栏磨砂
- **透出壁纸**：左侧边栏 / 标题栏 / 右侧边栏 dock 各自独立，标题栏磨砂可单独指定半径

**🎨 主题色与玻璃外观（Aqua 实验默认全关）**
- **主题颜色（`themeColor`）**：取色盘 + 预置，驱动侧栏/标题栏/新会话按钮/设置弹窗底色；**配色（`accent`）**驱动品牌交互色（按钮/滑条/选中/链接/发送键）
- **面板颜色匹配壁纸（`aquaTint`）**：自动采样壁纸主色（视频/GIF 每 2 秒刷新）；**统一雾**（全屏色调雾罩）、**自适应文字色 + 蓝色清理**、**深底文字可读增强**、**任务列表磨砂**
- **液态玻璃（CSS/SVG 版）**：`lgCss` + 折射强度，作用于输入框/左侧边栏/标题栏；`lib/liquid-glass/` 的 WebGL 运行时不参与生成（见[文件结构](#文件结构)）

**🧩 dsh-better-sidebar 适配（检测到该插件后显示）**
- 已安装时「其他」tab 出现**适配分类**：总开关 `bsCompat`（**默认开**）+ `bsFloat`（悬浮双层修复：14px 圆角外壳 + 内层透明 + 零外边距 + resize strip 挪进面板）/ `bsFont` / `bsReveal` + `bsRevealAlpha` / `bsAqua`
- 宿主 `/ping` 返回 `{ok, version, betterSidebar, betterSidebarVersion}`；客户端写 `body[data-mpw-bs-version]`，版本专属规则用 `[data-mpw-bs-version^="…"]` 门控（`lib/index.js:1626-1643`、`lib/client.js:255-269`）
- 详见 [`docs/BETTER-SIDEBAR-COMPAT.md`](docs/BETTER-SIDEBAR-COMPAT.md)、[`docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md`](docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md)，回归 `node tools/better-sidebar-compat-test.mjs`

**⏯️ 播放控制与省电**
- 视频/网页壁纸可**暂停/播放**（设置页「壁纸设置」下的按钮），暂停状态实时反映视频实际状态；**调整无关设置不会触发重播**（`video.src` 判等已修）
- **省电三档**：页面隐藏/切页暂停、窗口失焦暂停、电池供电暂停（`getBattery` 缺失则静默跳过）；任一档触发即暂停，全部恢复才继续；与手动暂停共用一套门控

**🚀 大文件混合模式（hybrid，默认开）**
- mpkg **流式上传**到 DSH 宿主 → 磁盘存储 → HTTP Range 流式播放（`lib/index.js:1688-1728`、`:1730-1790`）；**>600MB 也能放**，因为流不进内存；关掉则回纯浏览器模式（600MB 上限）

**🖼️ 本地壁纸库与轮换**
- Steam 自动发现 + 自定义目录（跨平台目录选择器）；WE 原生播放列表（`config.json` 的 `general.playlists`）导入为轮换列表
- 上一个/下一个一键切换、定时自动轮换（`rotate` + `rotateMin`，1–120 分钟）；列表勾选后滚动不跳顶

**🛡️ 安全与共存**
- **冲突检测**：检测到其他壁纸/主题插件时自动关闭本功能（可手动强开，写 `forceEnabled`）
- `.exe/application` 壁纸完全排除（`lib/web-wallpaper.js:101`、`:199`）；自定义目录只读媒体文件；宿主路由有路径穿越校验；网页壁纸 iframe 沙箱隔离

**💾 备份与恢复 / 设置持久化**
- 「其他」tab 的**备份与恢复**导出外观类设置为可分享 JSON（`BACKUP_FIELDS`，`lib/client.js:11979-11993`），导入即还原
- 设置除浏览器 `localStorage`（键 `dsh.mpkg-wallpaper.v2`，`lib/client.js:48`）外另存宿主端 `~/.dsh-mpkg-wallpaper/settings.json`，换端口/清浏览器数据不丢

## 支持的壁纸类型与边界

这节回答「我手上的素材能不能用、能用到什么程度」；表后的边界清单说明为什么有些事做不到。

| 类型 | 表现 | 能控制什么 / 做不到什么 |
|---|---|---|
| **mpkg（视频类）** | ✅ 完整 | 内嵌 mp4/视频纹理直接播放；静音、倍速、暂停、模糊/缩放/亮度全可调 |
| **mpkg（场景类）** | 🟡 折中 | 容器素材提取：静态帧 / 图层合成 / 内嵌视频时段；**Live2D 木偶、shader、脚本做不到**（见下） |
| **时间变化壁纸** | ✅ 多时段 | 自动切换 + 手动锁定；只提取当前时段 |
| **视频（mp4/webm/mov/m4v）** | ✅ 完整 | 直接播放；解码帧率上限/分辨率上限需 ffmpeg 转码 |
| **网页（HTML）** | 🟡 实验性 | 沙箱 iframe + WE API shim；**只读设置项的 Live2D 类可改**；外网 SDK / 重交互类未适配 |
| **scene.pkg 原始目录** | 🟡 折中 | 同 mpkg 场景类 |
| **preview.gif / 图片 / 动图** | ✅ 完整 | 场景壁纸无更多素材时回退作者预览图（`lib/client.js:887`、`:12272`） |
| **Application（exe）** | ❌ 排除 | 内容判定即 `unknown/excluded-application`，绝不读取/执行（`lib/web-wallpaper.js:199`） |
| **自定义目录（混合）** | ✅ 完整 | mpkg 与 workshop 子目录混放；深度 ≤4、条数 ≤4000 的有界扫描（`lib/web-wallpaper.js:213-232`） |

**明确的边界**（都不是"以后再说"，是当前实现的事实）：

- 场景壁纸的**完整动态还原做不到**——MDL 木偶骨架无公开格式文档、shader/脚本无 Web 端运行时（见[场景适配](#场景scene壁纸适配现状)）
- **纯 Scene 渲染方式选择器目前未接线**：「其他」tab 的 `sceneRender`（webgl/static/elysia）有按钮、有写入，但全仓没有读取点；实际路径由渲染器可用性决定（在线走 `:8899` iframe，离线回退静态帧，`lib/client.js:3133-3138`）
- 网页壁纸的 CSS `:hover/:active`、`isTrusted:true`、帧内 `contextmenu`、指针锁定/全屏/下载弹窗**做不到**（合成事件的固有边界，`docs/WEB-WALLPAPER.md` §11.4）
- 超过 600MB 的素材只在 **hybrid 模式**下可用；纯浏览器模式另有 250MB（视频纹理）/200MB（图片）/100MB（本地图片文件）上限

## 设置项总表（7 个 tab）

这是**全部设置项的权威表**：每行 = 面板文案 + 内部键名 + 默认值 + 作用 + 关闭/回退。tab 顺序与面板一致，固定为 `TAB_ORDER = ["source","wallpaper","appearance","unify","blur","other","liquid"]`（`lib/client.js:10730`），界面文案：**背景来源 / 壁纸设置 / 外观 / 界面统一 / 界面虚化 / 其他 / 测试项**。

### 1. 背景来源（source）

| 面板文案 | 内部键 | 默认 | 作用 | 关闭 / 回退 |
|---|---|---|---|---|
| 启用壁纸引擎背景功能 | `enabled` | 开 | 总开关；关闭即不应用任何背景 | 关 |
| 上传到 dsh 进程流式播放 | `hybrid` | 开 | 大文件混合模式（上传宿主 → 磁盘 → Range 播放，无 600MB 上限） | 关 = 纯浏览器模式 |
| mpkg 文件 / 图片 / 视频 / 图片链接 | — | — | 文件选择与 URL 输入（`http(s)` 或 `data:image`） | 「清除壁纸」按钮 |
| 自定义目录 | `customDirPath` | 空 | 任意目录；可指 workshop 主目录，每个子文件夹识别为一张壁纸 | 清空输入 |
| 本地壁纸库（Steam 扫描） | — | — | 扫描 WE 安装与创意工坊，导入壁纸与 `config.json` 播放列表 | 重新扫描覆盖 |
| 轮换（定时自动切换） | `rotate` / `rotateMin` | 关 / 5 分钟 | 到点切换下一个壁纸（1–120 分钟） | 关 |
| 时段 | `timeOverride` | 自动 | 手动锁定清晨/白天/黄昏/夜晚；按钮只列容器里真实存在的时段 | 点「自动」 |
| 当前壁纸卡片 | — | — | 预览图、显示名、容器内文件名、类型；暂停/播放、刷新、清除 | — |

### 2. 壁纸设置（wallpaper）

含「壁纸画面」与「省电」两个子分组。

| 面板文案 | 内部键 | 默认 | 作用 | 关闭 / 回退 |
|---|---|---|---|---|
| 静音（网页壁纸） | `mute` | 开 | 网页壁纸音频；关 = 放壁纸声音 | 关 |
| **Now playing（左侧栏「设置」上方）** | `npNowPlaying` | **开** | 左侧栏挂可展开播放器（传输行 = 壁纸声音控制）；**关掉仍是零注入**；同一位置被别的插件占用时自动让位（`data-mpw-np-yield`） | 关 / 恢复默认 |
| 播放/暂停同时控制壁纸 | `npLinkWallpaper` | 开 | Now playing 的播放/暂停与进度同时驱动壁纸自身；关 = 只驱动本插件播放器（壁纸媒体是唯一声源时控件**如实 disabled**） | 关 |
| 水平翻转（镜像） | `flipX` | 关 | 壁纸左右镜像 | 关 |
| 垂直翻转（镜像） | `flipY` | 关 | 壁纸上下镜像 | 关 |
| 解码帧率上限 | `fpsCap` | 无限制 | 源帧率超限时宿主 ffmpeg 抽帧转码（24/30/48/60） | 选「无限制」 |
| 分辨率上限 | `resMax` | 原始分辨率 | ffmpeg 缩放（720p/1080p/2K，保持宽高比） | 选「原始分辨率」 |
| 视频倍速 | `playbackRate` | 1x | 0.5–2x（档位 0.5/0.75/1/1.25/1.5/2） | 1x |
| ffmpeg 状态 | — | — | 显示系统/缓存/环境变量来源；未装可下载，缓存装的可卸载（不动系统） | — |
| 可调参数（折叠区） | `propEdits` | 空 | mpkg 只读展示；网页壁纸可改（分辨率/语言/音量等，见下） | 壁纸级重置 |
| 磨砂模糊 | `blur` | 12px | 壁纸层模糊（0–40） | 0 |
| 镜头缩放 | `zoom` | 100% | 10–2000% | 100% |
| 画面亮度 | `brightness` | 100% | 50–150% 滤镜 | 100% |
| 镜头位置（平移） | `lensX` / `lensY` | 0 / 0 | 水平/垂直平移，各自 ±2000 | 0 |
| 省电·页面隐藏/切页暂停 | `powPauseHidden` | 关 | `visibilitychange` | 关 |
| 省电·失焦暂停 | `powPauseBlur` | 关 | `blur/focus` | 关 |
| 省电·电池供电暂停 | `powPauseBattery` | 关 | `getBattery`；API 缺失静默跳过 | 关 |

### 3. 外观（appearance）

含「透出壁纸」子分组。

| 面板文案 | 内部键 | 默认 | 作用 | 关闭 / 回退 |
|---|---|---|---|---|
| 悬浮效果 | `float` | 关 | 左侧边栏/标题栏变悬浮卡片（圆角+阴影+透出） | 关 |
| 主题颜色 | `themeColor` | 空 | 侧栏/标题栏/新会话/设置弹窗底色 tint（取色盘 + 预置） | 空 = 不启用 |
| 面板颜色匹配壁纸 | `aquaTint` | 关 | 自动采样壁纸主色作面板底色（视频/GIF 每 2s 刷新） | 关 = 用取色盘 |
| 配色 | `accent` | 空 | 品牌交互色（按钮/滑条/选中/链接/发送键） | 空 = DSH 默认 |
| 遮罩自定义色 | `aquaColor` | 空 | 统一雾/面板的自定义色 | 空 = 灰色 |
| 自定义灰字颜色 | `fontColorGray` | 关 | 灰字走自定义色（配 `fontColorGrayColor`） | 关 |
| 左侧边栏透出壁纸 | `sidebar` | 开 | 关 = 侧栏纯色不透明 | 关 |
| 左侧边栏磨砂 | `sidebarBlur` | 关 | 侧栏自身 `backdrop-filter`；弹窗打开时自动摘除 | 关（需先开侧栏透出） |
| 左侧边栏磨砂程度 | `sidebarBlurAmount` | 14px | 0–40；统一虚化开启时被接管 | — |
| 标题栏透出壁纸 | `headerBg` | 开 | 关 = 标题栏纯白 | 关 |
| 标题栏磨砂 | `headerBlur` | 开 | 统一虚化开启时被接管 | 关 |
| 标题栏磨砂程度 | `headerBlurAmount` | 0% | 白雾厚度 0–100%（默认 0 = 透明） | 0 |
| 单独调节标题栏磨砂 | `headerFrostOwn` | 关 | 开 = 用 `headerFrostAmount` 覆盖磨砂半径 | 关 |
| 标题栏磨砂强度 | `headerFrostAmount` | 30px | 0–60 | 0 |
| 右侧边栏/dock 虚化 | `rightSidebarBlur` | 开 | DSH 自带右侧边栏与底部 dock | 关 |
| 虚化程度 / 表面透明度 | `rightSidebarBlurAmount` / `rightSidebarAlpha` | 14px / 45% | 0–40 / 0–100% | — |

### 4. 界面统一（unify）

| 面板文案 | 内部键 | 默认 | 作用 | 关闭 / 回退 |
|---|---|---|---|---|
| 统一虚化 | `unifyTint` | 开 | 整屏模糊感由一个条控制；开启后接管侧边栏/标题栏/右栏磨砂 | 关 |
| 整屏虚化程度 | `unifyAmount` | 30px | 0–40（控制壁纸层 blur） | — |
| 左侧边栏/标题栏透明度 | `sidebarAlpha` | 35% | 白雾厚度 0–100% | — |
| 聊天区跟随整屏虚化 | `chatFollow` | 开 | 关 = 聊天区由「磨砂模糊」条控制 | 关 |
| 新会话按钮跟随面板不透明度 | `sessionFollow` | 开 | 关 = 回到宿主原色 | 关 |
| 统一雾（全屏遮罩） | `aquaMask` | 关 | 所有表面共享一种雾色（原 Aqua 实验项） | 关 |
| 统一雾强度 | `aquaMaskAlpha` | 82% | 0–100% | — |

### 5. 界面虚化（blur）

| 面板文案 | 内部键 | 默认 | 程度键 / 默认 | 关 |
|---|---|---|---|---|
| 虚化对话框 | `dialogBlur` | 开 | `dialogAmount` 14px | 关 |
| 虚化设置面板 | `settingsBlur` | 开 | `settingsAmount` 14px | 关 |
| 虚化下载/确认弹窗 | `confirmBlur` | 开 | `confirmAmount` 12px | 关 |
| 虚化弹层 | `popoverBlur` | 开 | `popoverAmount` 10px；另有 `popoverAlpha` 94% 表面不透明度 | 关 |
| 虚化遮罩（全屏背景） | `maskBlur` | 开 | `maskAmount` 8px | 关 |

### 6. 其他（other）

| 面板文案 | 内部键 | 默认 | 作用 | 关闭 / 回退 |
|---|---|---|---|---|
| 轻度锐化 | `sharp` | 开 | 提升低清 GIF 观感；卡顿请关 | 关 |
| Deep diving 背景方框 | `thinkBg` | 关 | 开 = 思考状态显示模糊背景方框 | 关 |
| 任务列表磨砂 | `todoBlur` | 关 | todo 卡片背景模糊 | 关 |
| 第三方 UI 圆角兼容 | `roundCompat` | 关 | 兼容第三方插件圆角 | 关 |
| 自适应文字色 + 蓝色清理 | `aquaInk` | 关 | 文字色随遮罩亮度自适应 + 品牌色统一（配 `aquaInkColor`） | 关 |
| 深底文字可读增强 | `aquaTextEnhance` | 关 | 文字双色描边（近似方案） | 关 |
| 纯 Scene 壁纸渲染方式 | `sceneRender` | — | ⚠ 有按钮、有写入，**无读取点**（未接线） | — |
| 场景渲染上报（排障） | `sceneReport` | 开 | 壁纸每 10s 把渲染器现场写到 `reports/` | 关 |
| 场景首帧看门狗 | `sceneWatchdog` | 开 | 超时未出画自动回退静态帧；等待时长 `sceneWatchdogSecs` 8s（3–30） | 关 |
| 重试渲染器 / 渲染器调试参数 / 扩展钩子地址 | `sceneDebugParams` / `sceneExtUrl` | 空 | 白名单透传（`ln/eye/audit/isolate/parallax/…`）；扩展钩子按 `extbase` 拼进 iframe | 清空 / 一键清空 |
| 一键诊断上报 | — | — | 收集子系统状态 → `POST /diag`；宿主不可用则下载 JSON | — |
| 诊断开关速查（渲染器） | — | — | 10 个常用渲染器诊断开关 + 「复制」URL 片段 | — |
| better-sidebar 适配 | `bsCompat` / `bsFloat` / `bsFont` / `bsReveal` / `bsRevealAlpha` / `bsAqua` | 开 / 关 / 关 / 关 / 62% / 关 | 见上文；仅在检测到 better-sidebar 时显示 | 总开关关 = 全部不生效 |
| 备份与恢复 | — | — | 导出/导入 `BACKUP_FIELDS` 白名单内的设置（不含当前壁纸与扫描目录） | — |
| 恢复所有默认设置 / 前往反馈 / 检查更新 | — | — | 重置外观数值；一键更新从 GitHub 拉最新代码 | — |

### 7. 测试项（liquid）

| 面板文案 | 内部键 | 默认 | 作用 | 关闭 / 回退 |
|---|---|---|---|---|
| 测试模式总开关 | `lgTest` | 关 | 只保留壁纸 + 悬浮 + 布局，禁用全部外观类 | 关 |
| 液态玻璃（CSS 版） | `lgCss` | 关 | 纯 CSS/SVG 折射 + 高光（不占 WebGL 上下文，可与场景壁纸共存） | 关 / URL `?lgcss=off` |
| 折射强度 | `lgCssAmount` | 14px | 0–40（0 = 纯模糊） | — |
| 输入框 / 左侧边栏 / 标题栏液态玻璃 | `lgComposer` / `lgSidebar` / `lgHeader` | 关 | 各自选择作用目标（JS 打 `[data-mpw-lg-css]` 标记） | 关 |
| 独立演示页（端口 3081） | — | — | `tools/liquid-demo/` 的 WebGL2 演示页（独立服务，不影响插件） | — |

### 没有面板控件的设置键

这些键**存在且参与逻辑**，但设置页里没有对应控件；只能通过备份导入、`localStorage` 手工改写或 URL 参数触达（`lib/client.js:101-232` 是全部默认值，`tools/switch-wiring-test.mjs:41-64` 是「只影响运行时」的白名单与理由）。

| 键 | 默认 | 说明 |
|---|---|---|
| `clock` / `clock24h` / `clockSec` / `clockDate` / `clockPos` / `clockSize` | 关 / 开 / 关 / 关 / `tr` / 40 | 时钟是**运行时兼容项**：旧配置仍会渲染，设置页已无开关 |
| `bsAlpha` | 关 | better-sidebar 面板跟随主题底色；CSS 有读取点，面板无控件 |
| `bsBottomAvoid` | 关 | 已定案的**故意空操作**（对齐交给 better-sidebar 自己的 ResizeObserver） |
| `newStyle` | 关 | 只改设置页控件外观（JS 选 className），不进 `buildCss` |
| `forceEnabled` | 关 | 冲突检测下手动强开的运行时优先级标记 |
| `opacity` | 82 | 「面板不透明度」滑条已删除（统一虚化下由 `sidebarAlpha` 取代）；值仍被读取（`lib/client.js:5887`、`:5981`） |
| `aquaTintStrength` | 45 | 面板取色的壁纸主色混合比例；运行时读取（`lib/client.js:5575`），无控件 |
| `glassColor` / `glassAlpha` | 空 / 12 | 早期 WebGL 液态玻璃的遗留键：只随备份导出/导入与「恢复默认」走动，**无控件、无读取点**（`lib/client.js:11968`、`:11986`） |
| `webInteraction` | `pointer` | 网页壁纸交互档位（`off`/`pointer`/`full`）：**无面板控件**，用 URL `?mpwinteract=…` 或写存档 |
| `sceneRendererUrl` | `http://127.0.0.1:8899/` | 场景渲染器地址，可覆盖（`lib/client.js:3129-3132`） |
| `npVolume` | 100 | Now playing 卡片里的**音量电平**（0..100，落到真实元素）；默认档**从不写元素音量**，只有你动过才写 |
| `glassWindow` | — | **已退役删除**（2026-09-19）：无控件、无读取点，功能已被 `settingsBlur` + `dialogBlur`/`popoverBlur` 覆盖；源码与 zh/en 字典 0 残留 |

## Now playing 与壁纸声音

这节说明左侧栏那个播放器**挂在哪、显示什么、能控什么**——它控制的是壁纸自己的声音。

> 定位口径：本节按**符号名**引用实现（`lib/now-playing.js` 的 `resolveAnchor` / `shouldHide` / `occupantOf` / `PlayMark` / `markYield`，`lib/now-playing-math.js` 的 `opsX` 等，`lib/client.js` 的 `npResolveMedia` / `npActiveVideo` / `npAudioScope` / `npApplyMute` / `applyNowPlaying`）——**行号会随版本漂移，以符号为准**。形态是「源 + 生成内联」：`lib/now-playing-math.js` + `lib/now-playing.js` 由 `tools/build-now-playing.mjs` 逐字节内联进 `lib/client.js` 的 `MPW-NP-GEN-START/END` 生成区。

- **挂载点**：宿主 slot `sidebar.footer.action`（`lib/client.js` 里 `createSlotAction` 的注册项：`id:"mpw-now-playing"`、`order:60`）。拿不到 slot 时 `resolveAnchor()` 按模式降级：`slot` → `settings-slot`（宿主设置格子之前）→ `settings-area`（`[class*="settingsArea"]` 之前）→ `foot`（`[class*="footArea"]` 首位）；一条都不成立就**不建任何节点**并打一行 `console.warn`。**锚点晚出现也照样挂上**：找不到落点时盯住文档，宿主 slot 出口渲染出来后自动补挂（旧写法只 warn 就 `return` ⇒ 真机切壁纸后控件再也不出现）。
- **让位（默认开的配套）**：`occupantOf(container, mode, selfNode)` 逐个看容器子节点，放行三类——我们自己的节点、宿主自有节点（slot 出口 / 设置格子）、实质空节点；剩下第一个即算「占用者」⇒ 不挂（挂载前）或撤下（挂载后，`MutationObserver` 且 `subtree:true`），写 `data-mpw-np-yield="foreign-occupant"` 并打一行可读 warn；占用者走了会自己回来。判据是**双向**的：我们自己的节点与宿主的格子都不许被误判成占用者。
- **左侧栏收起即隐藏**：`data-mpw-np-hidden` + CSS `display:none`。判据以**物理宽度优先**（`shouldHide(width, hostCollapsed)`：量到 ≥ `NP_COLLAPSE_MAX_W = 96` 就不隐藏），宿主信号（slot `wide` / `data-sidebar-collapsed` / 根类名 `collapsed`）只在宽度**量不到**时兜底；锚点搬动后做**一次性**补判。宽度不够时整体按 `--mpw-np-fit = clamp(avail/260, 0.5, 1)` 缩放，`avail` 量的是**我们自己的容器**（不是 `[class*="sidebarCol"]`——真机上同类名不止一处）。
- **形态**：一颗胶囊展开成卡片——封面（当前壁纸缩略图）、标题/副标题、进度条 + 时钟、整块点击热区。**展开态四个键**：上一首 / 播放-暂停 / 下一首 / 静音-取消静音；**收起态三个键**——静音键随卡片出现，因为收起态的传输行是按 `opsX(0) = 206` 的 88px 三键行定位的，硬塞第四键会溢出右边距。展开是自停的 0→1 补间（无常驻 rAF）；播放/暂停**不是换图标**，而是那对八点四边形，形状由**播放状态自己的补间**（`mark`：0=暂停 1=播放）驱动，形变进度 `p` 只管尺寸/位置。
- **数据源**（`npResolveMedia`：**只报我们真的知道的东西**）：

| 当前壁纸 | NP 显示 | 能控什么 |
|---|---|---|
| 视频壁纸（当前**真的在放**的那个 `<video>`） | 真实播放状态 + 时长/进度；明确知道没有音轨时副标题写「该视频没有音轨」 | 播放 / 暂停 / 静音-取消静音（判断不了有没有音轨时**不猜**，静音键照给）；**没有曲目清单 ⇒ 上一首/下一首如实 disabled** |
| 壁纸目录里**真实存在**的音频文件（自定义目录 / 库 / 场景目录） | 文件名 + 清单序号；进度与时长来自媒体元素 | 我们自己的 `<audio>`：播放 / 暂停 / **上一首·下一首按清单顺序环形切换**（只有一条 ⇒ 两侧键 disabled）/ 静音 |
| 网页壁纸（目录里没有独立音频） | 副标题写「网页壁纸声音」 | **只有静音**这一条通道（`canPlay=false`，不假装能暂停帧内 WebAudio） |
| 无源（静态图 / 清单还没到 / 场景无独立音轨） | 空闲态（曲名 = 未在播放） | 不显示"点了没用"的键；点播放给出面板提示 + console 一行，**不做假动作** |

- **两个新控制（NP-4）**：① **音量电平** —— 卡片里的音量条，设置键 `npVolume`（0..100），真的落到元素；默认档**从不写元素音量**，只有你动过才写；② **可拖动进度（seek）** —— 拖进度条即定位。两者都受下面这个开关管辖。
- **「播放/暂停同时控制壁纸」（`npLinkWallpaper`，默认开）**：开 = 传输键与进度条**同时**驱动壁纸自身的播放/进度（默认开 = 与改动前逐字节同行为）；关 = 只驱动本插件自己的播放器，壁纸媒体**一个字节都不碰**；壁纸媒体是唯一声源时控件**如实 disabled** 并在副标题说明（`np.note.linkOff`）。
- **做不到的**（明确列出，不做假动作；`docs/NOW-PLAYING-DSH.md` §7.7.7 与 §7.8）：没有系统媒体源（那是 `lib/media-session.js` 的事，且尚未接线）；web 壁纸帧内那份声音**只有静音**，它自己的播放/暂停做不到；视频壁纸没有上一首/下一首；**静音键只在展开态出现**（要取消静音先展开卡片 —— 几何取舍，不是坏键）；心形按钮不渲染；没有波形、没有键盘快捷键；包里（`scene.pkg`）的音轨**只能列清单、不能播**（`np.note.pkgListOnly`）；进度条可拖动，但**联动关掉或没有可定位媒体时如实不可拖**（`np.note.noseek`）。「壁纸自己也播同一首」的叠音组合**没有真机样例可验**（已做的防护：我们放音时强制静音帧内）。
- **回退**：把 `npNowPlaying` 关掉（或「恢复所有默认设置」）⇒ 回到零注入（不建 DOM、不装观察者、产物里一行 NP 规则都没有）。回归：`node tools/now-playing-test.mjs`（**83 通过 / 0 失败**，含 7 组变异）+ `node tools/np-media-test.mjs`（**82 通过 / 0 失败**，含 12 组变异自证；`--no-mutations` 时主体 70 条），两条都已接入 `tools/check.sh` 第 2 步。真机探针（需 `:3080` + headless Firefox，不入常驻门禁）：`node tools/np-sidebar-live-probe.mjs`（12 条判据）与 `node tools/np-media-live-probe.mjs`（修前 16 PASS / 22 FAIL → 修后 45 PASS / 0 FAIL）。
- **归属**：组件为 **Bencho 的 "Now playing"（MIT）逐行移植**（注释原文保留）；侧栏挂载控制器、让位判据、自绘图标、token 映射、数据接入与门禁是本仓自写。登记见 `THIRD-PARTY.md` §6。

## 系统媒体会话（MPRIS / SMTC）

这节说明「显示系统正在播放什么」这条链路的**宿主半边**：能力矩阵、诚实不可用路径，以及当前接线状态。

`lib/media-session.js`（1052 行，MIT，本仓自写，零第三方代码）是「Now playing 显示**系统**正在播放什么」这条链路的**宿主半边**。契约：`createMediaSession({run, platform, env, now, timeoutMs, log})` → `{probe(), snapshot(), control(op,arg), stats(), lastProbe()}`（`lib/media-session.js:22-40`）。

**能力矩阵**

| 平台 | 通道 | 适配器（按优先级） | 元数据 / 状态 / 进度 / 封面 | 控制 |
|---|---|---|---|---|
| Linux / FreeBSD / OpenBSD | MPRIS over D-Bus（`org.mpris.MediaPlayer2.*`） | `playerctl` → `dbus-send` | 一次调用取 7 个字段：`status / mpris:length / position / xesam:title / xesam:artist / xesam:album / mpris:artUrl` | `play` `pause` `playpause` `next` `prev` `seek` |
| Windows 10/11 | SMTC（`GlobalSystemMediaTransportControlsSessionManager`） | `smtc`（`powershell.exe -NoProfile -NonInteractive`） | 真 WinRT 调用取属性 / 时间线 / 播放控制 / 缩略图（转 base64 data URL） | 同上（op 与位置作为独立 argv 元素下发） |
| macOS | — | — | ❌ 未实现：`unsupported-platform`，**0 条命令** | ❌ |
| 其它 / 无适配器 | — | `none` | ❌ `not-installed` | ❌ |

- **形状**：`snapshot` 21 个键**恒在**，拿不到就是空/中性值（`duration`/`position` 单位毫秒，拿不到是 `null`，**不编 0**）；`available:true` 时 `title` 非空（`lib/media-session.js:42-56`、`:220-244`）。
- **没有桌面会话总线时如实显示不可用**：`probe()` 会真的探测（`dbus-send --session ListNames`，必要时退 `busctl --user list`），拿不到就回 `available:false / reason:'no-session-bus'`，并在 `detail` 里写「总线不可达（via dbus-send）：…」（`lib/media-session.js:684-706`、`:775-783`）。这条是**推导出来的，不是硬编码**——本机（无桌面环境的容器/Termux）实测就是这一路。
- **绝不抛异常**：`snapshot()` / `control()` 永不 reject；失败全部是返回值（`reason` 落在 15 个取值内：`unsupported-platform / disabled-by-env / not-installed / no-session-bus / no-player / no-metadata / empty-output / unparsable / timeout / not-available / bad-op / bad-arg / bad-player / error`）。
- **安全**：命令名与参数**分开传**（argv 数组，从不经过 `sh -c`）；播放器名白名单 `/^[A-Za-z0-9_.-]{1,64}$/`，不合规 ⇒ `bad-player` + 0 条命令；`op` 白名单 + `seek` 范围 `0..24h`；超时默认 800ms（50–5000ms）；读操作单飞 + 全局串行（同一时刻最多一条命令）。
- **零依赖**：只用 `node:child_process`；`package.json` 里没有新增任何依赖。
- **环境变量**：`MPW_MEDIA_ADAPTER`（强指适配器）、`MPW_MEDIA_PLAYER`（钉播放器名）、`MPW_MEDIA_TIMEOUT_MS`。

⚠ **接线现状（如实）**：该模块**尚未接进插件**——`lib/index.js` / `lib/client.js` / `tools/build-bundle.mjs` 都没有 import 它，也没有 `/media-session`、`/media-control` 之类的宿主路由，所以 **Now playing 控件显示的仍是「壁纸自己的媒体」，不是系统播放器**。宿主路由与 UI 展示已在 [`docs/MEDIA-SESSION.md`](docs/MEDIA-SESSION.md) §9/§10 规划但标注为未做。判据：`node tools/media-session-test.mjs`（95 断言 = 89 主体 + 6 变异自证），**目前未接入 `tools/check.sh`**。

## 诊断与排障

出问题先来这里：一次点击把状态发回本机宿主；只有需要缩小范围时才打开个别诊断开关。

### 插件侧（本插件自己的开关）

- **一键诊断上报**（「其他」tab）：把磨砂/侧栏/时间线是否被影响、壁纸类型与路径、shim 是否注入、视频解码、表面 token、场景健康打成一个 payload → `POST /api/mpkg-wallpaper/diag`，落在 `~/.dsh/.dsh-mpkg-wallpaper/diag-<epochms>.json`（`lib/index.js:1605-1620`；目录上限 50 个文件 / 32MB，`lib/index.js:1523-1524`；客户端单份上限 512KB）。**宿主不可用时自动改为下载 `mpw-diag-<ISO>.json`**，离线也能把状态发回来。字段表带 `provenance`，读不到就是 `value:null + degraded`（[`docs/DIAGNOSTICS.md`](docs/DIAGNOSTICS.md)）。
- **后台自动上报**：开关是 **`localStorage['mpwdiag']='1'`**（不是 URL 参数——DSH 鉴权 303 会剥掉 query，`lib/client.js:4953-4957`），刷新后在载入 6 秒时上报一次（每会话 ≤6 次）；`window.onerror` 走同一采集器。
- **插件侧 URL 逃生口**（刷新即生效，不改设置）：

| 参数 | 作用 |
|---|---|
| `?hdrfrost=legacy\|off` | 标题栏磨砂：旧门控 / 彻底关 |
| `?hdrblur=pseudo\|element` | 磨砂载体：伪元素 / 元素层对照 |
| `?railink=off` | 关右侧时间线条的反色补偿 |
| `?sbfill=wide` | 恢复旧的全局侧栏底色覆盖 |
| `?lgcss=off` | 一键回退液态玻璃 |
| `?mpwtranscode=legacy\|aggressive` | 视频转码：回旧行为 / 连用户设的上限也先探测 |
| `?mpwinteract=1\|on`（自动进入交互）/ `off\|0\|pointer\|full`（仅改档位，不自动进入） | 网页壁纸交互 |
| `?mpwstore=0\|mem` | 关帧内存储 facade / 只留内存不落盘 |
| `?mpwpersist=legacy` | 设置持久化回旧行为 |
| `?bgwrapfix=legacy`、`?hdrfrostwatch=off` | 壁纸层可见性 / 磨砂看门狗 |

### 渲染器侧诊断开关（纯 Scene 壁纸）

这两个数字口径不同，别混：

- **主表共 158 个开关**，在**渲染器仓**的 [`we-scene-demo/docs/README-DIAGNOSTICS.md`](../we-scene-demo/docs/README-DIAGNOSTICS.md)（由 `diag-flag-check.mjs` 生成、与 `web/diag-flags.json` 对拍）。
- 插件面板里只放**常用/逃生口那一张小表**（10 个，`common:true` 集合），拼在渲染器地址后面用，例如 `http://127.0.0.1:8899/?id=3719111841&audit=3`：

| 开关 | 用途 | 默认 |
|---|---|---|
| `att=legacy` | 附件锚点走旧自算路径（A/B 对照） | 新路径 |
| `mcc=1` | 强制网格包围盒中心补偿 | 关 |
| `piv=1` / `piv=0` | 子网格 pivot 全开 / 全关 | 只对眼睛组合生效 |
| `align=0` | 复现旧对齐（origin 恒几何中心） | 官方对齐 |
| `parallax=legacy` | 鼠标视差退回旧近似式 | 官方公式 |
| `audio=1` | 播放场景 sound 层（每层一条流） | 静音 |
| `whitefallback=0` | 缺纹理层改透明 | 白块（与官方一致） |
| `hier=0` | 放弃父链合成，回退绝对定位兜底 | 父链合成 |
| `isolate=<层名>` | 只保留名字含关键词的层可见（逗号分隔） | 全可见 |
| `audit=N` | 首帧逐层审计 N 帧 | 1 |

> 这些是**渲染器**的 URL 参数，不是本插件的设置；插件只负责把它们拼进场景 iframe（`lib/client.js:13981-14000`、`lib/client.js:3163`）。面板文案与离线副本必须与 `diag-flags.json` 的 `common` 集合一致，由 `tools/panel-smoke.mjs` 断言（`tools/panel-smoke.mjs:316-372`）。

## 兼容性、限制与做不到清单

这节把「什么环境能用、什么规模能用、什么做不到」集中在一处；类型各自的边界在上一节，网页壁纸与 Now playing 的做不到清单在各自小节。

### 浏览器兼容性（实测参考）

| 浏览器 | 推荐度 | 表现与注意 |
|---|---|---|
| Chrome / Chromium（桌面） | ⭐⭐⭐ 强 | 功能最完整：`backdrop-filter` 与 `color-mix` 实现最佳、`iframe.muted` 生效、muted 自动播放放行 |
| Edge（桌面） | ⭐⭐⭐ 强 | 视频壁纸走**独立 canvas 渲染路径**（规避 Edge 悬浮工具栏，`lib/client.js:1464-1520`）；个别版本仅有首帧静态（非空白/崩溃） |
| Firefox | ⭐⭐ 中 | 功能全支持（`backdrop-filter` 103+、编码不支持自动转码兜底）；有三点减分，见下表后的说明 |
| Android WebView / 移动端 | ⭐⭐ 中偏弱 | autoplay 政策取决于宿主 WebView 配置；`getBattery` 可能缺失（有守卫跳过）；极端组合建议静态图/GIF 或关 blur |

> **Firefox 的三点减分**：① `backdrop-filter` 性能弱于 Chromium（多模糊同开时低端机掉帧）；② `iframe.muted` 不支持 ⇒ 有声 web 壁纸首次可能被自动播放策略拦停首帧；③ `color-mix` 需要 113+（旧版只有外观回退）。
> 源码已为各浏览器做了降级（无 `requestVideoFrameCallback` 回退 rAF、`ResizeObserver`/`getBattery` 有守卫、全部 `play()` 带 `.catch`、`backdrop-filter` 用 `CSS.supports` 检测并降级）。

### 没有 Wallpaper Engine 安装时（缺失 / 非 Windows）

「WE 安装」指 Steam 版 Wallpaper Engine（appid **431960**）。宿主端 `locateWallpaperEngine()`（`lib/index.js:303-327`）按这个顺序找：Windows 注册表 `HKCU\Software\Valve\Steam\SteamPath` → 常见 Steam 目录 → 非 Windows 的 Steam 目录（macOS `~/Library/Application Support/Steam`、Linux/Android `~/.local/share/Steam`、WSL `/mnt/c/...`）→ 各库 `steamapps/libraryfolders.vdf` 里含 431960 的库 → 只认 `<库>/steamapps/common/wallpaper_engine/wallpaper32.exe` 存在的那一个。**找不到就返回 `null`**，后续走降级路径：

| 场景 | 真实行为（含代码位置） |
|---|---|
| 没装 WE（或找不到 `wallpaper32.exe`） | `steam-inventory` 返回 **200 `{ok:true, installDir:null, wallpapers:[]}`** —— 不是错误、不抛 500（`lib/index.js:3120-3180`） |
| 点「扫描本地壁纸库」 | 列表空 + 顶部报错条「未检测到壁纸引擎安装」（`lib/client.js:8781`/`:11555`）；空列表另有「未发现可用的壁纸」。**扫描本身不报错** |
| 装了 WE 但素材目录都不存在 | 每个根目录单独判存在 ⇒ 清单为空、**且不弹「未检测到安装」**；界面只剩空提示。**未实现**：这种情况没有专用提示 |
| 非 Windows / 移动端 | 同"没装 WE"（注册表分支直接在非 win32 返回 null）；探测串都是纯字符串，无副作用 |
| WE 原生播放列表 | 只在 `installDir` 存在且 `config.json` 可解析时才有；否则写 `rotSeeded:true` 并**不再重播种**（`lib/client.js:8782-8793`） |
| **没装 WE 时仍然可用的** | 手动目录、直接导入、URL/本地文件、场景提取与诊断都不依赖 WE —— 逐条见下 |
| 宿主端整体不可用（方式四没装/端口不通） | 探测 `/ping` 失败 ⇒ 回退**纯浏览器模式**（`lib/client.js:10203`/`:11603`）；超过 600MB 的素材无法处理 |
| `ffmpeg` 缺失 | `ffmpeg-check` 返回 **200 `{ok:true, found:false, …}`**（`lib/index.js:3245-3259`）；面板显示"未安装"，只在点按后才走下载链，可直读的视频不转码 |

**没装 WE 时仍然可用的**：① 手动选目录（`/list-dirs` + `/custom-dir`）；② 直接导入 `.mpkg`（hybrid 无 600MB 上限）；③ 网页/视频壁纸走 URL 或本地文件；④ 场景提取、音频清单、设置持久化、诊断上报都不依赖 WE。

> 一句话：**没有 WE 安装 = 少了"自动发现本地壁纸库"这一条便利通道**，插件照常工作；所有降级都是"返回空清单 + 明确文案 + 保留手动目录/上传通道"，不静默失败、也不报 500。

## 场景（Scene）壁纸适配现状

**结论先说：WE 场景壁纸无法在 Web 端完整还原，这是引擎层面的限制。** 场景由专有引擎渲染——Live2D 式**木偶骨架（.mdl 二进制）**、**shader 特效**、**脚本**；浏览器没有官方渲染器，格式也未公开（RePKG 只逆向过 PKG/TEX，MDL 骨架无公开文档；开源方案 [we-layerd](https://github.com/Aromatic05/we-layerd) 打包了官方渲染器但仅限 Linux Wayland 桌面）。

插件提供两条路径：

1. **外部渲染器 iframe（首选）**：本机 `:8899` 的 we-scene 渲染器在线时，场景以 iframe 挂载（`lib/client.js:3133-3190`）。渲染器离线/首帧超时则由**看门狗**回退静态帧并在提示条说明，可手动「重新挂载渲染器」。渲染器地址可用 `sceneRendererUrl` 覆盖。
2. **容器内素材提取（兜底，`lib/pkg-extract.js`，MIT，采用自 [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)）**：
   - **静态帧**：解析 PKG（LZ4 解压）+ TEX 纹理解码，按"面积 × 格式权重 × 路径惩罚"选主纹理（`lib/pkg-extract.js:1422-1491`）
   - **图层合成**：解析 `scene.json` 的全部 image 图层，按源坐标/尺寸在 canvas 上合成（最多 24 层，`lib/pkg-extract.js:1734-1829`）
   - **内嵌视频时段**：`scene.pkg` 与 mpkg 同为 PKG 容器，含内嵌视频纹理的时段按 mpkg 方式解析 → 多时段切换（索引先行，只读目录表 + 候选项前缀）

**无法覆盖的**：MDL 木偶人物（纹理层几乎为空）、shader 波浪/粒子、脚本交互。这些回退**官方预览动图**（preview.gif）。

**格式与上限**（`lib/pkg-extract.js`）：PKG 魔数 `PKGV####`、条目 ≤1 048 576；TEX `TEXV0005` + `TEXI0001`，mipmap 容器 `TEXB0001`–`0004`，GI F 帧表 `TEXS0001`–`0003`；可解码像素格式 = RGBA8888 / R8 / RG88 / DXT1 / DXT3 / DXT5（内嵌 JPEG/PNG 直通），其余抛出 `unsupported format`；尺寸上限 16384、mip ≤32、帧数 ≤4096；静态帧缓存 96MB / 单帧 24MB / 64 条，图层缓存 256 条 / 128MB。

> 需要完整动态效果的现实路径：**外部渲染成视频 → 用本插件的视频壁纸功能**（Windows 用 WE 官方版录屏、Linux 用 we-layerd 录屏、移动端用壁纸引擎 App 录屏）。

### 渲染可行性：为什么浏览器做不到

- 完整场景（含 Live2D 木偶）只能由专有渲染器完成：壁纸引擎 App 的原生库（内嵌 Chromium + 专有 puppet 渲染）；开源方案 [we-layerd](https://github.com/Aromatic05/we-layerd)（Rust）打包了官方渲染器，但**仅限 Linux Wayland** 桌面
- 浏览器端没有成熟的 WE 场景渲染器——**与操作系统无关，任何浏览器都无法直接渲染 Live2D 场景**；官方渲染器 `.so` 为闭源二进制，无源码无法编译成 WASM
- 本插件的可行路径：**外部渲染器 iframe（首选）+ 静态帧提取 + 图层合成 +（时间变化的）mpkg 方式时段切换**；需要完整动态时用「外部渲染成视频 → 视频壁纸」方案

## 网页壁纸（Web，实验性）

这节说明网页（HTML）壁纸怎么加载、怎么隔离、能改哪些设置，以及明确做不到的部分。

- **类型判定按内容，不只看声明**：`detectWebWallpaperKind()` 返回四态 `web / scene / video / unknown`，`project.json` 的 `general.type` 只是线索——谎报 `web` 但目录里是 `scene.pkg` 的按**场景**处理，谎报 `scene`/`video` 但只有 `index.html` 的按**网页**处理；`application/exe/app` 一律 `unknown/excluded-application`（`lib/web-wallpaper.js:163-207`）
- **两条加载模式**（确认弹窗里选，模式记在 URL 里，刷新后照旧）：
  - **沙箱模式（默认，推荐）**：`sandbox="allow-scripts"`（**不透明源**）。宿主在入口 HTML 的 `<head>` 最前注入 **WE API shim**，`?mpwshim=1` 是注入闸门。壁纸脚本**读不到宿主 DOM / `localStorage` / cookie**；帧内 `fetch()` 是跨源（`Origin: null`），宿主只对字面量 `null` 回 CORS 头（`lib/web-wallpaper.js:84`、`:529-537`）
  - **兼容模式（同源）**：`allow-scripts allow-same-origin allow-pointer-lock`，等价于改动前的裸 iframe。Live2D 类的「网页壁纸选项」（分辨率/语言/音量，写同源 `localStorage`）需要它
- **WE API shim（10 个全局，注入在作者脚本之前）**：`wallpaperPropertyListener`、`wallpaperRegisterAudioListener`、`wallpaperRegisterMedia{Properties,Thumbnail,Playback,Timeline,Status}Listener`、`wallpaperRequestRandomFileForProperty`、`wallpaperMediaIntegration`、`wallpaperPluginListener`（`lib/web-wallpaper.js:540-551`、`:498-517`）
- **存储持久化**：帧内 facade（真 `localStorage` 一读就抛时安装）+ 宿主 `POST/GET /api/mpkg-wallpaper/web-store`，按壁纸隔离（`sha1(label|wallKey|relFile)` 前 12 位）；上限 64 键 / 单值 4096 字符 / 每壁纸 64KB / 最多 64 张壁纸，落 `~/.dsh-mpkg-wallpaper/web-store.json`
- **风险预检**：`⚠重动画`（目录里有 `.skel/.atlas` 或名字含 spine/live2d，深度 ≤3）与 `🌐外网`（入口 HTML 前 256KB 含 `http(s)://`），只在 `type === "web"` 时显示（`lib/index.js:1937-1953`、`lib/client.js:12867-12868`）
- **CSP**：命中阻断型 CSP 时**不注入** shim、回原字节并加 `x-mpw-shim-skipped: csp`（`lib/web-wallpaper.js:424-439`，这一处**照抄**上游 `web-rewrite.ts:26-43`，MIT，登记在 `THIRD-PARTY.md` §5）；客户端 2.5 秒没收到 ready 则去掉标记、切兼容沙箱、重载一次
- **交互模式**：壁纸层是背景层（不吃指针），点右下角「交互」按钮或 URL `?mpwinteract=1` 后，指针/滚轮/触摸（`full` 档再含键盘与文本输入）会被送进壁纸内的作者脚本；**一定会退出**——60 秒无操作 / 180 秒总时长 / `Esc` / 右上角「退出交互」/ 切换壁纸。⚠ **窗口失焦不会退出**（只释放按键、发 `op:"blur"`，`lib/client.js:2732-2769`）；`?mpwinteract=full` 只改档位、**不自动进入**，自动进入只认 `1|on`。交互**不放宽沙箱**（仍只要 `allow-scripts`）、**不读帧内 DOM**；`F5/F11/F12/浏览器前进后退刷新`、`Tab`、`Backspace`、`Ctrl/Cmd+R/W/T/N/Q/L/P` 被拦下
- **作者脚本报错不拖垮插件**：帧内 shim 兜住 listener 异常 / 全局 `error` / 未捕获 Promise，限流上报父页（`console.warn` + `/diag`）
- **已知限制**：音频频谱通道仍为空（WE 的频谱语义是**系统音频**，拿壁纸自身声音当频谱是语义造假，故不伪造）；媒体通道已实现但未接系统媒体会话；`innerHTML` 里拼出来的 `file:///` 不覆盖；绝对系统路径映射不了；被导航到外部的页面拿不到 shim

> 细节（类型判定表、sandbox 逐项理由、shim API 表与控制协议、交互注入方案与安全边界、文件 URL 改写、错误边界、与参考实现的差异清单）：[`docs/WEB-WALLPAPER.md`](docs/WEB-WALLPAPER.md)。
> 回归：`node tools/web-wallpaper-test.mjs` + `node tools/web-interaction-test.mjs`（都在 `tools/check.sh` 第 5 步）。

## 可调参数与网页壁纸的设置接入

这节说明壁纸自带的参数在插件里能读到什么、能改什么。

- **mpkg 壁纸**：项目自带的**可调参数**在「壁纸设置 → 可调参数」折叠区**只读展示**（浏览器显示的是预渲染素材，改参数不会改变画面），供对照。
- **网页壁纸（部分已接入，Live2D 立绘类）**：含 `loadJson.json` / `SettingModel` 的网页壁纸，其设置项已接入**同一个折叠区**：分辨率（2k/4k/8k，重载生效）、语言（按壁纸实际提供）、背景音乐与语音音量（实时）、显示触摸区域框/文本框等开关。改动写入壁纸 iframe 的存储（沙箱模式下走 facade → `/web-store`），重载生效。
- **隐藏壁纸自带设置面板**：这类壁纸右上角自带「设置」按钮且无法交互，插件在 iframe 加载后自动隐藏它，防挡住画面。
- **未适配的**：依赖外网 SDK / 特殊交互逻辑的网页壁纸，其内置设置项尚未接入，插件内的可调参数不可用（可正常显示）。

> 这些按钮只在识别到对应壁纸的设置结构后出现；普通图片/视频/无设置项的网页壁纸不显示。

## 性能与稳定性

这节是**已经做过的优化与它们换来的数字**，也是排查「卡 / 慢 / 占内存」时的对照表。

- **mpkg 只读头部**：容器解析只读前 2MB 头（`lib/index.js:44`），834MB 大 mpkg 冷启动接近秒开
- **音频清单不必等整包**：`scene.pkg` 的目录表在文件开头 ⇒ 只读目录表 + 候选条目各 16 字节魔数（整条音轨永不进内存）。`/custom-scene-audio` / `/library-scene-audio` 直接返回 `{count,tracks:[…],stats}`；`/raw` 支持 **Range/206**。实测整包读 1.7–379ms ⇒ 索引读 1.3–6.9ms（冷）/0.4–0.9ms（热）
- **场景内嵌视频探测"索引先行"**：只读目录表 + 候选项前缀（`.tex` 头部与首 mipmap 记录、载荷前 12 字节判 `ftyp`；mip0 为 LZ4 时只解第一个 sequence），不确定一律回退整条读。实测 11 个真包 **2894ms → 532ms（冷）/ 7ms（热）**；门禁 `node tools/scene-video-test.mjs`
- **场景缓存按体积限流**：静态帧缓存 96MB/64 条、图层缓存 128MB/256 条，双兜底
- **重启自愈**：自定义目录壁纸重启后按文件名 token 重建（media 404 重试耗尽后按 `mpkgKey` 重新解析）
- **防重入锁**：`applyFromStorage` 与 Aqua 主题监听带防重入标志 + 去抖，杜绝 `overrideTokens → theme/change →` 重入死循环
- **监听/定时器只注册一次**：storage 监听、60s 时段检查、内联样式 watcher 均去重，反复 apply/RTC 重连不累积
- **懒加载防 OOM**：时间变化只提取当前时段；hybrid 大文件流式播放内存占用极低
- **转码资源上限集中一处**：产物 12 个 / 512MB、并发 1、排队 30s、单任务 15min、默认降采样 1920 宽、内存准入 1024MB（见[历史台账](#视频壁纸转码判定与资源上限)）
- **弱设备降级**：高负载合成（全屏 `backdrop-filter` + 流媒体视频叠加）整体节流；极端组合建议 Edge / 桌面浏览器

## 安全说明

这节列出插件的网络行为、数据落点与隔离边界，便于自查与合规核对。

- **默认无被动对外网络请求**：插件后台不主动访问外部网络；日常播放只与本机 DSH 宿主（`127.0.0.1`）通信。例外都是**用户显式触发**：检查更新/一键更新访问 GitHub（`raw.githubusercontent.com`、`api.github.com`）、下载 ffmpeg 访问 GitHub Releases / npm 二进制镜像；**打开设置面板后 0.8s 会自动静默检查一次版本**（只点亮徽标，不弹窗、不下载、不上传）。此外用户手输的网络图片 URL、网页壁纸自身加载的资源也属外部访问。
- **无敏感内容**：源码不含路径、密钥、令牌、个人信息；`node tools/secret-scan-test.mjs` 扫描全部 tracked 文件（凭据 12 条模式、本机路径 3 条模式）必须 0 命中。
- **网页壁纸沙箱**：默认模式下 iframe 是不透明源，作者脚本读不到宿主 DOM / `localStorage` / cookie，也摘不掉自己的 sandbox；帧↔父页只走 `postMessage`（op 白名单 + 只认父窗口来源）。壁纸资源的跨源读取**只对 `Origin: null`**放行。
- **网页壁纸交互**：交互事件只从插件建的**交互舞台**发出（舞台默认 `display:none`，未开交互时一个事件都不注入）；开启才给宿主页面打 `data-mpw-interact="on"`（此时宿主界面整体让位，右上角常驻退出按钮）；60s 无操作 / 180s 总时长 / `Esc` / 切壁纸都会退出；交互**不放宽沙箱**、**不读帧内 DOM**。
- **宿主路由**：自定义目录/库路由都做了路径穿越校验（`..`、绝对路径、前导点一律拒），`/raw` 只服务已登记的容器条目。
- **数据边界**：所有解析在本机完成；`localStorage` 只存背景与参数；设置另存宿主端 `~/.dsh-mpkg-wallpaper/settings.json`；网页壁纸的帧内存储在 `~/.dsh-mpkg-wallpaper/web-store.json`。
- **系统媒体会话模块**：命令名与参数分开传（argv 数组，从不经过 `sh -c`），播放器名白名单 + op 白名单 + seek 范围校验，不合规 ⇒ 0 条命令；超时后 `SIGKILL`（`lib/media-session.js:519-540`）。

## 归属与许可

这节说明本包自己的许可、随包发布的第三方归属台账，以及「GPL 永不进插件」这条边界。

- **本包许可：MIT**（`LICENSE`；`package.json` 的 `license` 字段 = `"MIT"`）。第三方来历、洁净室记录、逐项归属与"抄了什么/为什么抄/哪些不是抄的"全部登记在 **`THIRD-PARTY.md`**（**随包发布**，是 MIT 署名义务的载体）。
- **唯一 vendored 的第三方代码**是 `lib/liquid-glass/**`（液态玻璃渲染器库）：**自 P-127 起移出发布面**（`files` 负向模式 `!lib/liquid-glass/**` + `!lib/liquid-glass-bundle.js`），**仓库内一个不少**、仍如实登记 10 个 sha256（`THIRD-PARTY.md` §1.3）。宿主的 `/api/mpkg-wallpaper/lg/*` 托管路由仍是活路径（命中时真的读 `lib/liquid-glass/<file>`），从 npm 安装的副本上按设计返回 404。
- **Now playing 组件**：Bencho 的 "Now playing"（MIT）**逐行移植**（注释原文保留）；侧栏挂载控制器、自绘图标、token 映射与门禁为本仓自写（`THIRD-PARTY.md` §6）。
- **网页壁纸**：`lib/web-wallpaper.js` 的 API 名单与语义**参考** `oneincase/webwallgl`（MIT），**未 vendored**；其中 `hasBlockingCsp` 一处**照抄**（逐行出处见 `THIRD-PARTY.md` §5）。差异清单见 `docs/WEB-WALLPAPER.md` §10。
- **场景提取**：`lib/pkg-extract.js` 采用自 [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（MIT，文件头署名）；`lib/pkg-extract.js` 的音频索引段已于 2026-09-16 依 `docs/AUDIO-TRACK-SPEC.md` 洁净室重写。
- **GPL 边界（永不进插件）**：`MIT 插件 → GPL 渲染器 ✅`；`GPL 渲染器 → MIT 插件 ❌`（本包只出不进）。本包**不得** import / 内嵌渲染器（`we-scene-demo`，GPL-3.0-or-later）的任何代码，与渲染器的交互只走进程/HTTP 协议。**若将来引入任何其它第三方代码（含 GPL-3.0 的渲染器侧代码），不得进入本 MIT 包**（`THIRD-PARTY.md:97`、`:128-135`）。机器判据：`tools/web-wallpaper-test.mjs` F1（注释剥离后 grep：无 GPL-2.0-only 项目派生标识符、无 GPL 许可文本）。
- 参考项目：[dsh-bg-image](https://github.com/lyh9712/dsh-bg-image)（MIT，模板）、[unmpkg](https://github.com/aqnya/unmpkg)（GPL-3.0，仅参考 mpkg 二进制格式）、[repkg](https://github.com/notscuffed/repkg)（MIT，仅研究 .tex 格式）。
- 致谢：[Bil812](https://github.com/Bil812)（[PR #2](https://github.com/XHR666/dsh-mpkg-wallpaper/pull/2) 的取色/自适应文字色/统一遮罩构想 → 已吸收为 Aqua 实验模式，全部可开关、默认关）、[elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（场景提取器与"设置持久化到宿主端文件""Edge canvas 兼容渲染"思路）、[oneincase/webwallgl](https://github.com/oneincase/webwallgl)（网页壁纸沙箱 + WE API shim 的 API 名单与语义参考）、[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 社区（收录与推广）。

> **命名说明（2026-09-18）**：本插件对接的渲染器产品现名 **WEwebLoader**。

## 文件结构

这节是仓库逐文件地图：哪些进 npm 包、哪些只留在仓库、为什么。

```text
dsh-mpkg-wallpaper/
├── package.json      # 版本 3.10.1；dsh.bundle + dsh.client 声明；files 白名单 = 发布面（15 文件）
├── cordis.patch.yml  # 插件安装声明（dsh plugin add 使用）
├── LICENSE           # MIT
├── THIRD-PARTY.md    # 第三方来历/洁净室记录与许可归属（随包发布）
├── icon.svg
├── README.md / README.en.md
├── lib/
│   ├── index.js            # 宿主端：41 条路由（上传/Range 流式播放、场景提取、音频清单、
│   │                       #   网页壁纸与 shim、web-store、media-audio、设置持久化、诊断、更新、ffmpeg）
│   ├── client.js           # 浏览器端（宿主按 exports["./client"] 单文件下发）：mpkg 解析 + 设置页 +
│   │                       #   背景 DOM + 虚化体系 + 壁纸库 + 时间变化 + 网页设置 + 播放/省电 + NP 挂载
│   ├── pkg-extract.js      # scene.pkg 静态帧 / 图层合成 / 音轨索引 / 内嵌视频索引（MIT，来自 elysia395）
│   ├── web-wallpaper.js    # 网页壁纸：内容优先类型判定 + WE API shim 源码 + 入口注入 + 跨源策略 + 存储 facade
│   ├── web-interaction.js  # 网页壁纸交互：坐标换算 / 事件整形（含 touch）/ 状态机 / 舞台契约（MIT，自写）
│   ├── media-session.js    # 系统媒体会话宿主侧适配器（MPRIS / SMTC；**已实现、尚未接线**）
│   ├── now-playing.js      # Now playing 组件 + 侧栏挂载控制器（Bencho MIT 逐行移植 + 本仓的锚点/收起/让位判据）
│   ├── now-playing-math.js # Now playing 纯数学（零 DOM）
│   ├── liquid-glass/       # 遗留 WebGL 液态玻璃库（**仓库保留 · 不进发布面**）
│   └── liquid-glass-bundle.js  # 上者的打包产物（**仓库保留 · 不进发布面**）
├── tools/            # 门禁/测试/基准/探针（**不进发布包**）
│                     #   check.sh（12 步门禁）/ integrity-check.mjs / secret-scan-test.mjs /
│                     #   panel-smoke.mjs / switch-wiring-test.mjs / style-scope-guard.mjs /
│                     #   token-namespace-test.mjs / now-playing-test.mjs（83）+ build-now-playing.mjs（生成区内联与漂移门禁）/
│                     #   np-media-test.mjs（声音接线 82，含 12 组变异；第 2 步）/ media-session-test.mjs（未接入门禁）/
│                     #   web-wallpaper-test.mjs / web-interaction-test.mjs /
│                     #   np-sidebar-live-probe.mjs、np-media-live-probe.mjs（真机探针，需 :3080 + headless Firefox）/
│                     #   bundle-equivalence-test.mjs / pre-commit.sh + ../.githooks/pre-commit
├── docs/             # 研发笔记（**不进发布包**）：WEB-WALLPAPER.md / NOW-PLAYING-DSH.md / MEDIA-SESSION.md /
│                     #   DIAGNOSTICS.md / RELEASE.md / STYLE-SCOPE-GUARD.md / TOKEN-NAMESPACE.md / PRE-COMMIT.md …
└── dist/             # 构建产物（**不入库、不进包**）：dsh-mpkg-wallpaper.bundle.mjs（方式四用，现生成）
```

> 排除规则：`lib/liquid-glass/**`、`lib/liquid-glass-bundle.js`、`lib/**/*.bak*` 由 `files` 负向模式排除；`tools/`、`docs/`、`dist/`、`package-lock.json` 不在 `files` 白名单里。`tools/integrity-check.mjs` 第 ⑨ 节对"不在发布面"和"仓库内不能少"做**双向**机器断言。
> `lib/now-playing.js` / `lib/now-playing-math.js` 是**源 + 生成内联**形态：`tools/build-now-playing.mjs` 把它们逐字节内联进 `lib/client.js` 的生成区（为什么必须这样：宿主把 `exports["./client"]` 指向的那**一个文件**整体下发，`lib/client.js` 里出现任何相对 `import/require` 线上就会模块解析失败——判据是 `tools/integrity-check.mjs` 第 ⑩ 节）。代价是必须有漂移门禁，所以有**两条独立实现**常驻在门禁第 2 步。

## 判据与门禁

这节是**改完代码怎么自证没坏**：一条命令跑完的四道判据，加上 12 步门禁各自看什么。

```sh
node tools/integrity-check.mjs     # 72 通过 / 0 失败：文件齐全、元数据、白名单、无本机路径、客户端自包含
node tools/secret-scan-test.mjs    # 凭据 0 命中、本机绝对路径 0 命中、白名单无腐烂条目
bash tools/check.sh                # 12 步全量门禁（第 9 步需无头 Firefox 做真机复刻 A/B）
node tools/style-scope-guard.mjs   # 判据是末行「… OK / … ALLOWLISTED / 0 RED / 0 REVIEW」：RED/REVIEW 必须为 0（OK 条数随规则演进）
```

`tools/check.sh` 的 12 步：① 语法 ② 面板冒烟 + P-66 + 选择器 + 壁纸层可见性 + 持久化 + NP（生成区漂移双门禁 83 断言 + 声音接线 82 断言）③ CSS 组合矩阵（512 全组合 + 600 随机 + 边界）④ 场景看门狗/调试参数 ⑤ 沙箱与场景 token + 网页壁纸 shim + 转码资源 ⑥ 发布完整性自检 ⑦ 音频扫描提速 ⑧ scene 视频索引 ⑨ 真机复刻 A/B ⑩ better-sidebar 适配 ⑪ 单文件 bundle 等价性 ⑫ 样式作用域护栏 + 表面 token 命名空间。

## 这一版新增/变更

当前版本 = `package.json` 的 **3.10.1**（本轮发布线 3.8.0 → 3.8.1 → 3.8.2 → 3.9.0 → 3.9.1 → 3.10.0 → **3.10.1**）。发布前置/命令/回滚见 [`docs/RELEASE.md`](docs/RELEASE.md)，本轮改动清单见 [`docs/RELEASE-READY-3.8.0.md`](docs/RELEASE-READY-3.8.0.md)，Now playing / 壁纸声音的根因与真机读数见 [`docs/NOW-PLAYING-DSH.md`](docs/NOW-PLAYING-DSH.md) §7.7。

- **Now playing 默认挂载 + 会让位**：设置项 `npNowPlaying` **默认开**（`lib/client.js` 的 `DEFAULT_NP_NOW_PLAYING`），仍在「壁纸设置」tab、紧挨既有 `mute` 下方（`lib/client.js` 的 `toggleRow(t("npNowPlaying"), …)`）。关掉即回到零注入（机制与判据见 [Now playing 与壁纸声音](#now-playing-与壁纸声音)）。默认开的前提是**礼让**：宿主同一位置已经有别的插件注入的元素时不挂/撤下，并留一个可查询状态 `data-mpw-np-yield`（`lib/now-playing.js` 的 `occupantOf()`；挂载前与挂载后都判，占用者走了再回来）。组件本体是 **Bencho 的 "Now playing"（MIT）逐行移植**（注释原文保留，归属见 `THIRD-PARTY.md` §6）；纯数学与组件拆成 `lib/now-playing-math.js` / `lib/now-playing.js`，由 `tools/build-now-playing.mjs` **逐字节内联**进 `lib/client.js` 的 `MPW-NP-GEN-START/END` 生成区，配两道漂移门禁（生成器自比 + 产物反抠比对）。挂载与收起判据见 [Now playing 与壁纸声音](#now-playing-与壁纸声音)。
- **壁纸声音真的接线**：数据源只认**当前真的在放**的那个媒体元素（页面里那个隐藏空壳 `#mpw-bgVideo` 在**任何壁纸类型下都在 DOM 里**，旧实现按选择器命中它就当"当前媒体"）⇒ 视频壁纸的播放/暂停/静音落在真实元素上（**`mute` 开关真的落到元素上：关掉静音就真的出声**，旧写法把 `video.muted` 写死 `true`，之后再没有代码按设置赋值）；壁纸目录里**真实存在**的音频文件由我们自己的 `<audio>` 播（作用域认 `mpkgKey="custom|<folder>"`，旧写法只认 `folderName` ⇒ 自定义目录里的 web 壁纸永远拼成 library 路由 404）⇒ **上一首/下一首按清单顺序环形切换**，不再是"回到开头"；web 壁纸帧内那份声音只有**静音**这一条真通道（`canPlay=false`，如实显示，不假装能暂停帧内 WebAudio）；我们放音时帧内被强制静音（防同一首放两遍）。
- **悬浮态卡片不再被裁切**：贴合缩放改量**我们自己的容器**（旧写法量 `[class*="sidebarCol"]`，而真机上同类名不止一处，量到 280 而容器只有 256），`.mpw_np` 宽度按 `math.W` 钉住并让溢出均分；web 壁纸分支补上 `data-mpw-float` 门控与 `applyNowPlaying()`（旧写法提前 `return`，切到 web 壁纸后控件根本不挂）。
- **门禁扩容**：`tools/now-playing-test.mjs` **83 通过 / 0 失败**（含 7 组变异）；新增 `tools/np-media-test.mjs`（清单作用域 / 数据源判定 / 播放落点 / 静音落点 / 让位 / 标记 / web 路径不跳过 apply / 卡片几何，**82 通过 / 0 失败**，含 **12 组变异自证**），已注册进 `tools/check.sh` 第 2 步；真机探针新增 `tools/np-media-live-probe.mjs`（`:3080` + headless Firefox；修前 16 PASS / 22 FAIL → 修后 45 PASS / 0 FAIL，不入常驻门禁）。
- **若干真机修复**：Now playing「slot 后渲染那一帧 `wide=false` 把展开态判成收起 ⇒ 刷新后控件自己消失」（判定改为**物理宽度优先**，阈值 `NP_COLLAPSE_MAX_W = 96`；锚点晚出现时盯住文档自动补挂）；播放/暂停那两个四边形改由**播放状态自己的补间**驱动（旧写法由展开进度驱动 ⇒ 收起态恒画三角、展开态恒画双条）；标题栏磨砂 `syncHeaderFrost()` 的 `ReferenceError` 与右侧时间线条被弄透明（见[历史台账](#历史台账)）；`lgCss` 整块因 TDZ 从未执行；`sessionFollow` 有开关无人读；选择文件夹的滚动跳顶。
- **3.9.0：真机壁纸流水线批次 + 声音语义收口（用户点名的六条 bug 与三条音频问题）** ——
  ①设置面板被压缩进左侧栏（`backdrop-filter` 让侧栏成为 `fixed` 弹层的包含块，真机 `{x:320,w:800} → {x:13,w:254}` 可逆实锤）；
  ②「清除壁纸」清不掉（`undefined` 在不变量Ⅰ里是"不覆盖" + 粘性护栏把 `webUrl` 带回来）、换档残留 `webUrl` 抢先武装（黑屏 + 破图）、
  web 档预览框空白（预览分支没有 web 档那条）、源不可用被当成素材渲染（现在留 `data-mpw-bg-error` 并给面板人话）；
  ③沙箱档被浏览器策略挡住时父页毫不知情（shim 能力自证 `probeCaps` + 按**策略类**错误一次性降级，作者自身 bug 不触发）；
  ④卡片暂停管不住帧内音频（`npFrameSoundBlocked()`：卡片暂停 ∨ 我们在放 ⇒ 压住帧内那一半）；
  ⑤切页不静音（`powPauseHidden` **默认改为开**，只迁移从没设过的存量档；覆盖我们自己的 `<audio>` + `pagehide/pageshow` 按原状态续播）；
  A 交互音分类（`mpwClassifyWebAudio` 纯分类器 + `?npvoice=keep|drop`，语料实测清单只剩 `BGM.wav`）；
  B 联动开关关闭 = **只控声音**（视频档暂停/播放 = 静音/取消静音那条音轨，画面继续）；
  C 切页后"过一会儿又响一下"（唯一闸门 `mpwHiddenAudioBlock()`，所有起播入口过闸）；
  **NP-5 卡片暂停意图持久化**（新键 `npPaused`，唯一写入口只在用户显式操作时写；刷新后**不得**自动变播放 —— 真机探针
  `tools/np-pause-persist-live-probe.mjs` 11 PASS/0 FAIL：刷新后 59 拍×500ms 全程 `paused` + 零次 `play()` 调用）；
  **音频审计**（hook `play`/`volume`/`muted`/`new Audio`/`AudioContext`，有界环形 ≤200，可疑转变即 POST `/diag`；`?npaudit=0` 关）；
  **宿主超限语义**：两个 POST 接收端超限从"先掐连接"改成 **413 + JSON 说明**（旧行为客户端只看到 ECONNRESET）。
  真机读数、根因链与 10 条诚实清单见 [`docs/WALLPAPER-LIFECYCLE.md`](docs/WALLPAPER-LIFECYCLE.md)；发布记录见 [`docs/RELEASE.md`](docs/RELEASE.md)。
- **3.8.1 / 3.8.2：Now playing 第二次真机批次（NP-4）** —— 起播顺序（旧写法先取消静音再 `play()`，等于一次有声自动播放 ⇒ 被浏览器拒绝且被吞掉）、被浏览器策略停住（muted 起播 resolve 后取消静音，元素被直接停住）、**新增音量电平**（0..100，落到真实元素）与**可拖动进度（seek）**、**新增「播放/暂停同时控制壁纸」开关（`npLinkWallpaper`，默认开 = 与改动前逐字节同行为）**、悬浮态卡片放大、音轨清单的"能不能播"如实分类。可交付口径：**首次用户手势后必定出声**（被策略停住时退回 muted 保画面并记 `window.__mpwNpSoundBlocked`）。详见 [`docs/RELEASE.md`](docs/RELEASE.md) 的 3.8.1/3.8.2 发布记录与 [`docs/NOW-PLAYING-DSH.md`](docs/NOW-PLAYING-DSH.md) §7.8。
- **仍在同一发布面上的前一轮能力**：网页壁纸渲染 / API 覆盖（帧内存储 facade + 宿主 `/web-store`、主音量、源级 `file:///` 改写、CSP 跳过注入、`/media-audio`）与网页壁纸触控（`op:'touch'` 真 `TouchEvent`）；系统媒体会话的**宿主端适配器** `lib/media-session.js`（MPRIS / SMTC）**已接线**：宿主 `GET /media-session`（21 键快照）/`POST /media-control`（六个 op，能力位先判）/`GET /media-art`（`file://` 封面代理），客户端 `npSystemMedia*` 自适应轮询（有系统媒体 2s、本机无会话总线 30s）⇒ 卡片显示**真实系统曲目/封面/进度**，本机如实 `available:false / no-session-bus`（接线判据 `tools/media-session-wiring-test.mjs` 24 断言 + 3 变异）。
- **门禁与护栏**：CSS 组合矩阵、样式作用域护栏、表面 token 命名空间等价性、开关接线审计、秒级 pre-commit（见[历史台账](#历史台账)与「[判据](#判据与门禁)」）。

## 历史台账

以下各节是**已经落账的证据**（事故、根因、判据、回退开关），保留原文事实、不做删改；它们描述的是"为什么现在是这样"。

### P-66 面板健壮性修复（2026-09-15）

> 口径：当次报的 9 条界面问题经确认属于 **webwallgl 测试台（:8901）**，与 DSH 插件面板无关；按此口径本轮**只保留两个与那个界面无关、可独立复现的插件真 bug 修复**，其余界面改动已全部回退。回归：`node tools/panel-fixes-test.mjs`（门禁第 2 步）。

| 真 bug | 根因 | 修法 | 复现/断言 |
| --- | --- | --- | --- |
| **渲染错误边界失效，真因被吞** | `MpkgSectionImpl` 的外层 `catch (err)` 里用 `h(...)`，而 `h` 是**外层 `try` 块内的 `const`**（块作用域不可见）→ 边界自身抛 `h is not defined`，用户看到的是「壁纸引擎设置区渲染异常：h is not defined」，**真实错误信息丢失** | 该 catch 内改用 `react.createElement` | `node tools/panel-fixes-test.mjs --client <修复前副本>` → 红（显示 `h is not defined`）；对当前代码 → 绿（显示真实错误 `boom-body`） |
| **zh/en 字典键集合不一致** | `en` 缺 18 个键（`glass.*`、`glassWindow*`、`flipX/Y*`、`themeColor*`、`rightSidebarBlur.overridden`）→ 英文界面直接显示 **key 原文**；`clock.*` 10 个键只存在于 `en` → 中文界面反而显示英文；另有两处硬编码中文 | 只增不删地把两套字典补到**键集合完全一致**（条数以 `node tools/panel-fixes-test.mjs` 实跑输出为准）；两处硬编码中文改走 `t()` | 同一测试：键集合一致 / 静态 `t("k")` 键两套齐全 / 英文渲染零中文 / 中文渲染零键名残留 |

### 两个真机 bug 根治（2026-09-16）：标题栏磨砂 / 右侧时间线条

| bug | 根因（判据） | 修法 | 回退开关 | 回归 |
| --- | --- | --- | --- | --- |
| **标题栏磨砂"一直没有"** | `syncHeaderFrost()` 第一行调用 `normalizeSection(...)`，而该函数当时定义在**另一个函数的函数体内** ⇒ 每次调用抛 `ReferenceError`，又被自己的 `catch {}` 吞掉 ⇒ 磨砂层从未注入、诊断 `reason` 恒为空（真机 diag 实锤 `injected:false` / `reason:""`） | 归一化函数**提升到模块作用域**；异常改为写进 `hdrFrostState.reason`（不再静默）；"真实磨砂元素 + header 半透明底"成对出现（半透明底色走我们自己的 `--mpw-hdr-frost-bg`）；`wanted=false` 时**清理**而不是留一个空层（空层会抑制伪元素兜底，反而彻底没磨砂） | `?hdrfrost=legacy`、`?hdrfrost=off`、`?hdrblur=pseudo\|element` | `node tools/frost-rail-test.mjs` |
| **壁纸模式下右侧时间线（轮次导航条）变透明** | DSH 的 `TurnNavigator rail` 条颜色 token 是 `--dsw-alias-border-l4` 与 `--dsw-alias-label-*`。插件 ①用 `var(--mpw-aqua-ink, inherit)` 与自引用 fallback 覆盖 `--dsw-alias-label-*`（DSH 把它们定义在 `body`、`html` 上没有）⇒ body 上成为 **guaranteed-invalid** ⇒ 激活/preview 条 `background` 变 unset = 透明；②裸 `html body { --dsw-specific-sidebar-fill: transparent }` **全局**改宿主 token，并把聊天区表面透明化 ⇒ 16% 淡条画在壁纸上 = 看不见 | token 覆盖**收窄**到白名单容器；aqua/文字色覆盖加 `data-mpw-*` 门控并**去掉 inherit/自引用**；给条补一个按主题计算的、**我们命名空间**的对比色（只作用于白名单节点，不碰宿主 token、不用 `!important`） | `?railink=off`、`?sbfill=wide` | `node tools/frost-rail-test.mjs` |

> 细节与诊断字段表：[`docs/HEADER-FROST.md`](docs/HEADER-FROST.md)、[`docs/TIMELINE-RAIL-TOKEN.md`](docs/TIMELINE-RAIL-TOKEN.md)。

### 样式作用域护栏：为什么"这类 bug 不会再复发"（2026-09-17）

上面两个 bug 的共同机制是**选择器作用域没人管**：改样式的人在本地看不出"这条规则会命中宿主界面"。门禁第 12 步把它变成会变红的机器判据（`node tools/style-scope-guard.mjs`）：

* **拿真实产物**：不重写 `buildCss`，用 `tools/_stub.mjs` 在 Node 里跑 `lib/client.js`，调用插件自己暴露的 `__mpwBuildCss(patch)`，按源码里的 `boolFields`/`numFields` 自动枚举 **600+ 组设置**（本轮 615：默认段 / 每个布尔开关单独开 / 核心 9 开关全 512 组合 / bsCompat 家族 / 数值 0 与 100 / 无壁纸 / lgTest），再对生成的 CSS 逐条解析（含 `@media`/`@supports`）。
* **判据**：每条规则的选择器必须命中我们自己的标记（`.mpw*` / `[data-mpw*]` / `#mpw-*`），或命中**已登记**的宿主/第三方作用域——`bsCompat` 那句故意打第三方 DOM 的 `[data-dsh-better-sidebar] …` 也在其列，**必须登记 reason + `docs/*.md:行号` 指针**（指针运行时校验，漂了直接红）。裸元素选择器、裸 `*`、`:root` 上覆盖宿主 token、宿主 token 被设成 transparent/inherit、未登记 token 的 `!important`、未门控碰宿主轮次导航条、`[data-dsh-panel-host]`、顶栏描边透明化 ⇒ **判红**。
* **自证有分辨力**：`node tools/style-scope-guard.mjs --selftest` 把 `lib/client.js` 复制到临时目录注入变异（含一条"我们自己的标记必须仍然放行"的阴性对照），逐条断言必须 RED/REVIEW/PASS。
* 判据、允许清单账本与"怎么加一条登记项"：[`docs/STYLE-SCOPE-GUARD.md`](docs/STYLE-SCOPE-GUARD.md)。

### 表面 token 命名空间：顶栏 / 侧栏 / 面板 / 时间线条 读同一套 `--mpw-*`（2026-09-18）

「四处视觉一致性用**同一套 token 命名空间**（`--mpw-*`），**永不覆盖宿主 token** ⇒ 从结构上消灭"我们弄坏宿主新功能"这类 bug」。第 12 步的第二个判据把它机器化（`node tools/token-namespace-test.mjs`）：

* **一个来源**：宿主 token 只在 `emitSurfaceTokens()` 里被消费成 `--mpw-surface-*`，产物里唯一那一块 `body{…}` 是全部表面取值的定义点（实测 41 枚共享 token 各 1 处）；四个表面的规则**只写** `var(--mpw-surface-*)`。
* **为什么是 `body` 而不是 `:root`**：DSH 把 `--dsw-static-*` / `--dsw-alias-*` 定义在 **`body`**（`html` 上没有）。自定义属性里的 `var()` 在**声明所在元素**上求值 ⇒ 写 `:root` 会变成 guaranteed-invalid 并**继承给所有后代**（消费者全部 `unset` = 透明）。这正是历史上"右侧时间线条变透明"的同一机制，判据里有专门断言 + 变异盯着。
* **宿主 token 覆盖只剩一处**：`buildSidebarFillCss()`（`--dsw-specific-sidebar-fill`，只在侧栏白名单容器、只在「侧栏透出」对应档位）。登记表（`HOST_OVERRIDE_REGISTRY`）逐条要求 token + 选择器 + 值形态 + **生效条件**：产物里 39 处覆盖声明必须全部登记命中，且**功能关闭的组合里一次都不许出现**。
* **等价性证据**：以 `git HEAD` 的 `lib/client.js` 为 before，606 组设置 × 亮/暗 × 默认/门控两态比对四表面**生效值**（极小层叠模型 + `var()` 递归代换）⇒ 25 428 个键逐键相等 —— 这是重构，不是重设计。
* 清单：[`docs/TOKEN-NAMESPACE.md`](docs/TOKEN-NAMESPACE.md)。

### 开关接线审计：不许再有"开关能点、没有效果"（2026-09-18）

**真事故**：「配色」(`accent`) 与「深底文字可读增强」(`aquaTextEnhance`) 两段 CSS 被一起包在 `if (aquaOn(section))` 里 ⇒ **只开这两个开关时规则根本不生成**：界面上能点、没有任何效果、控制台也不报错。已修，并加了通用判据 `node tools/switch-wiring-test.mjs`（门禁第 2 步）：

* 每个布尔开关都必须在"默认档 / 富上下文 / 其它全开"三个上下文之一里**改变 `buildCss` 产物**；只影响运行时的开关必须逐条登记 `reason`（如 `mute`/`rotate`/省电三档/时钟文案…，见表 `tools/switch-wiring-test.mjs:41-64`）。
* 非布尔功能（`accent`/`aquaTextEnhance` 设值必须改变产物）；`themeColor` 属"CSS 常驻 + 运行时属性门控"，判据改为断言门控规则确实在产物里。
* **已证实失效**的开关进 `KNOWN_DEAD` 并在每次运行时显式列出（双向断言：修好了必须从表里删）。**该表现已清空**；**退役**（删掉）的开关改由 A0 段看住"源码 0 悬空引用 + zh/en 两套字典 0 孤儿文案"，各配一条常驻变异。
* 已修的三条：**`lgCss` 整块从未执行**（块内引用声明在其后的 `bdSupported` ⇒ 同函数作用域 TDZ `ReferenceError`，被外层 `catch` 吞掉）；**`sessionFollow` 设置页有开关 + 文案但全仓无人读**（按**用户可见文案**实现：开 = 跟随面板不透明度，关 = 回到宿主原色）；**`glassWindow` 按"不留看得见却点不动"的政策删除**（既无 toggleRow 也无读取点，文案承诺的功能已由 `settingsBlur` + `dialogBlur`/`popoverBlur` 覆盖）。删除点 6 处（zh/en i18n 各 2 行 + `lgTest` 预设默认值 + 重置默认值 + `BACKUP_FIELDS` + 导入 `boolFields`），删前删后**默认档产物 sha256 逐字节相同**。
* **`bsCompat`（better-sidebar 适配总开关）默认已改为开**：底部面板悬浮适配已真机定案，默认关 = 没人看得见；存量用户**只在"从没显式设过"时**被迁移，**手动关过的绝不覆盖**（写入口打 `bsCompatUserSet` 标记，迁移不打）。判据 `node tools/bs-compat-default-test.mjs`（门禁第 10 步，15 断言 + 3 变异）。
* **顶栏那一份折射放在伪元素上**（`html body[data-mpw-hdr-frost-el] .wSkVaW_header::before`，`z-index:0`）：加在 `.wSkVaW_header` 本体会让它变成 **backdrop root** ⇒ 顶栏内浮层的 backdrop 采样被隔离 ⇒ 浮层磨砂失效、背后文字锐利透出。伪元素不是浮层的祖先 ⇒ 浮层照常采样；且**只在顶栏本来就在磨砂时才生成**。
* 分辨力自证：把 `accent` / `aquaTextEnhance` 的门控改回被 `aquaOn` 包住 ⇒ 必须变红（两条变异）。

### 提交前门禁（秒级 pre-commit，2026-09-19 / P-129）

上面这条审计（以及面板渲染回归）已抽成**秒级 pre-commit**，**提交前 4 秒**就能拦住"开关没接线""面板渲染坏了"这两类**已经真实发生过多次**的事故：

```sh
cd dsh-mpkg-wallpaper
git config core.hooksPath .githooks    # 装载（只影响本机 clone；git config --unset core.hooksPath 卸载）
git commit --no-verify                 # 单次绕过
MPW_SKIP_PRECOMMIT=1 git commit -m …   # 单次绕过（走脚本内显式口，恒 exit 0）
```

* **跑什么**：`tools/panel-smoke.mjs`（面板渲染 + 语言字典，~0.3s）+ `tools/switch-wiring-test.mjs`（每个开关必须真的改变产物 + 退役开关 0 悬空引用 + 分辨力变异自证，~2.5s），**串行**。
* **不跑什么**：`tools/check.sh` 的 12 步（第 3 步 615 组 CSS 矩阵、第 9 步起无头 Firefox）**不进** pre-commit。
* **不阻塞开发**：装载是显式的；暂存区只动了非产物路径（无 `lib/`·`tools/`·`package.json`）⇒ 直接跳过；缺 `node`/缺脚本 ⇒ 打印一句就 `exit 0`；失败会原样打印红行并提示绕过方式，不改文件、不自动 fix。
* **细节与实测输出**：[`docs/PRE-COMMIT.md`](docs/PRE-COMMIT.md)。

### 视频壁纸转码：判定与资源上限

> 事实：一条 `~/.dsh-mpkg-wallpaper/transcodes/src_*.bin` 常驻、RSS ≈ 690MB —— 插件在后台转用户**正在播放**的壁纸。

**判定：那次转码是误判（bug）**。判据：那条 `src_*.bin` 是 `h264 High L5.2 + aac / MP4`（`ffprobe` 实读，浏览器必可直读），而 `settings.json` 里 `fpsCap=0 / resMax=0`（没有开转码）⇒ 触发者是客户端 `video.error`（`code 3/4`）后的**自动降级** `/transcode?fps=24`——`code 3/4` 只表示"这一帧解不出来"，**不等于"浏览器不支持该编码"**。

**修法**：新增**可播性闸门**（`/probe` 只读元数据、不起 ffmpeg；判据 = 编码/容器白名单 + MP4 里 h264+opus、HEVC Main10 这类确定性缺口；探测不出来一律不改行为）——可直读就**直读原片**，只有真吃不下才转码。顺带修掉三个真 bug：旧 `direct-spec` 直读判据**不看编码**（HEVC 会被直读→黑屏）、字节上限淘汰**从最新开始删**（刚转好的产物被自己删掉 ⇒ 缓存永久 miss）、**取消后仍换编码器重试**。资源上限集中一处：产物 12 个 / **512MB**、并发 **1**、排队 30s、单任务 15min、**转码默认降采样到 1920 宽**（实测 4K 656MB → 1080p 275MB）、**内存准入 1024MB**；启动清理一次并打日志；三种状态（直读/转码中/已缓存）写进日志与 `window.__mpwWallpaperState`。

> 细节、判据表与内存实测：[`docs/TRANSCODE-RESOURCE.md`](docs/TRANSCODE-RESOURCE.md)；回退开关 `?mpwtranscode=legacy|aggressive`；回归 `node tools/transcode-limit-test.mjs`（43 断言，门禁第 5/12 步）。

### 选择文件夹 / 选择文件：行为契约与快捷键（2026-09-17）

**根因（判据式，详见 [`docs/DIR-PICKER-SCROLL.md`](docs/DIR-PICKER-SCROLL.md)）**：旧实现里那段"事后补偿滚动位置"的代码是**死代码**——`dirScrollRef.current` 只被写成 `{anchorIdx, anchorOff}` 而**从不写 `ratio`**，于是 `if (ratio === void 0 || ratio === null) return;` 恒真早退，其后的锚点补偿与按比例恢复**一行都没执行过**；同时容器没有 `overscroll-behavior: contain`（滚轮到边界会串联给宿主设置面板），且没有任何机制在 React 重建列表节点后把 `scrollTop` 补回来（新节点天然 `scrollTop = 0`）。三者叠加 = "自动弹跳 / 锁定在最顶"。

**修法（无新增第三方依赖）**：选择器改为**自己持有滚动主权**——容器按路径记忆 `scrollTop`（滚动事件只写 ref、不 setState），在 `useLayoutEffect` 里**绘制前同步写回**（幂等，不与用户滚动打架，时间窗 hack 全部删除）；滚动容器统一带 `overscroll-behavior: contain` + `overflow-anchor: none`；行 key 改为"完整路径 + 目录名"（增量更新而非整表重建）；弹窗元素加稳定 key；**全程没有任何 `focus()`/`autoFocus`**。

| 行为契约 | 说明 |
|---|---|
| **滚动位置保持** | 刷新 / 过滤 / 条目变少 / 500 项大目录 / 宿主重渲染 / **容器节点被重建**后，滚动位置都在原位（不会出现"跳回顶"的一帧） |
| **不抢焦点** | 打开弹窗只把焦点给**列表容器自己**且带 `focus({preventScroll:true})`；行一律 `tabindex="-1"` + `mousedown` 阻止默认聚焦 ⇒ **任何行都不会成为 `document.activeElement`**；重渲染不再抢焦点 |
| **每个目录各自记位置** | A 目录滚到 60、B 目录滚到 20，来回切换互不串位 |
| **滚轮不串联** | 列表滑到边界后不会带着背后的设置面板一起滚 |
| **行级增量更新** | 目录刷新只增删差集（行 key = 完整路径，测试断言行节点 uid 不变） |
| **锚点缺失不回 0** | 记住的位置若超出新列表范围 ⇒ **夹到新范围**；记忆值缺失/非法（`null`/`""`/`NaN`）一律当"无锚点" ⇒ 认领当前位置 |

| 按键 | 行为 |
|---|---|
| `↑` / `↓` | 上下移动活动行（不抢焦点、只在按键时做最小位移 `block:"nearest"`） |
| `Home` / `End` | 跳到第一个 / 最后一个目录 |
| `Enter` | 进入活动行对应目录；**未选中任何行时 = 「选择此文件夹」** |
| `Backspace` / `Alt`+`↑` | 上一级目录 |
| `Esc` | 关闭弹窗 |

**回归门禁**：`node tools/dir-picker-test.mjs`（**57 断言**；A 组 10 条源码级断言对 `git show HEAD:lib/client.js` 旧实现会**变红 9 条**，证明用例有分辨力；B 组用假 DOM + 迷你 React 跑生产实现的切片）。

## 反馈 Bug

反馈问题时附上这些材料，一轮就能定位：

- **原始 .mpkg 或 workshop 文件夹**（复现问题所必需）
- 一次「一键诊断上报」的结果（设置页「其他」→ 一键诊断上报；宿主不可用时会自动下载 JSON）
- 浏览器控制台输出（F12 → Console），如有
- 你的 DSH 版本与平台（Windows / Linux / 移动端）

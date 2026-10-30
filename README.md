# dsh-mpkg-wallpaper — DSH 壁纸引擎背景插件

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](README.md) | [English](README.en.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 界面（`dsh web`）添加背景壁纸的插件：**Wallpaper Engine `.mpkg` 解析、Steam 创意工坊目录、视频/网页/图片壁纸、时间变化壁纸的多时段切换、整屏虚化体系、主题色与玻璃外观、本地壁纸库、定时轮换、Now playing 控件、一键更新**。外观细节几乎全部可调。

- 仓库：<https://github.com/XHR666/dsh-mpkg-wallpaper>（已发布 npm 包 `dsh-mpkg-wallpaper`）
- 配套渲染器（纯 Scene 壁纸用，**GPL-3.0-or-later，另行安装**）：本包**不包含**它，也不 import/内嵌其任何代码；
  获取方式见本插件仓库主页的链接与 `docs/` 说明
- 许可：**MIT**（见[许可与归属](#13-许可与归属)）；第三方台账见 `THIRD-PARTY.md`

> **版本口径**：本文件描述的是 `package.json` 里的 **`3.16.6`**（= npm `latest`）。
> **发布面**以 `npm pack --dry-run` 实测为准：**16 个文件**（9 个 `lib/*.js` 运行时文件 + `package.json`、`icon.svg`、`cordis.patch.yml`、`README.md`、`README.en.md`、`THIRD-PARTY.md`、`LICENSE`）；
> `lib/liquid-glass/**`、`lib/liquid-glass-bundle.js`、`dist/`、`tools/`、`docs/` 都**不进** npm 包（`package.json` 的 `files` 负向模式）。
> 历史发布记录见 [`docs/RELEASE.md`](docs/RELEASE.md)。

---

## 1. 下载 · 安装

四种装载方式——先按这张表选一条，再看对应小节：

| 方式 | 适合谁 | 更新怎么做 | 客户端界面 |
|---|---|---|---|
| 一 `dsh plugin add`（推荐） | 默认选择；市场能识别「已安装」 | `dsh plugin --profile web update dsh-mpkg-wallpaper` | 完整 |
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
node tools/build-bundle.mjs          # 产物：dist/dsh-mpkg-wallpaper.bundle.mjs（大小以该命令输出为准）
node tools/build-bundle.mjs --check  # 与源码对拍：导出面 / 路由表 / ping JSON 形状
node tools/bundle-equivalence-test.mjs  # 更全的等价性门禁（构建可复现 + 路由逐字段对拍 + 装载布局 + 变异对照）
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
| 宿主端（上传/Range 流式播放、场景提取、音频清单、设置持久化、诊断上报、系统媒体会话等路由） | **完整**（`lib/index.js` 及其相对 import 全部内联；外部依赖只有 node 内建） | `node tools/bundle-equivalence-test.mjs`：路由表（kind + path）逐条相同 |
| `/api/mpkg-wallpaper/ping` | `{ok, version, betterSidebar, betterSidebarVersion}` 键集合与源码一致 | 同上 + `build-bundle.mjs --check` |
| **客户端半（设置面板 / 壁纸层 / 磨砂 / Now playing）** | **不装载**。单文件里只有宿主端导出面（`apply` / `inject` / `__mpwTest`） | 客户端半由 DSH 客户端模块系统按**包**发现：扫描宿主 Loader 条目里声明了 `dsh.client` 的包并解析其 `exports["./client"]`；裸 `.mjs` 没有 package.json ⇒ 没有 `dsh.client` 声明 |
| `GET /api/mpkg-wallpaper/lg/*`（遗留 WebGL 托管路由，客户端已不调用） | bundle 旁边没有 `liquid-glass/` 时 **404**；`cp -r lib/liquid-glass <bundle 目录>/` 即与源码逐字节一致 | 该路由以 `import.meta.url` 定位同目录 `liquid-glass/`；门禁两种布局都断言过 |
| `ping.version` | 上一级目录没有 `package.json` 时返回 `null`（只影响版本号显示） | `new URL('../package.json', import.meta.url)` |
| 「检查更新 / 一键更新」 | 无伴生 `package.json` 时 `update-check` 返回 500，`update-apply` 会往 bundle 同级/上级目录写文件 ⇒ **不建议在方式四下使用** | `lib/index.js` 的更新路由 |

> 结论：**方式四是"宿主端能力"的降级装载**（离线/应急/给非 DSH 宿主复用路由时好用）；要完整界面请用方式一/二/三。产物**不入库**（`dist/` 在 `.gitignore` 里：它是 `lib/*.js` 的纯派生物，发布时现生成）。

### 桌面版（DSH Desktop）怎么装

DSH 桌面包目前只有 **macOS / Windows**。官方口径：**`desktop` 这个 profile 名由 Electron 壳独占，
CLI 会拒绝它的 `boot` / `config-dump` / 插件管理请求** ⇒ 桌面上**不能**照抄 `dsh plugin --profile desktop add …`。
桌面档请按下面两条之一走（按你手上那个桌面版本的界面为准）：

1. **桌面 App 自带的插件入口**（若有）：在设置/插件页添加 npm 包名 `dsh-mpkg-wallpaper`；
2. **手动装进桌面 profile 的依赖树**：把包放进该 profile 的 `node_modules/`（或在其 `package.json` 里加依赖后装），
   并在该 profile 的 `cordis.patch.yml` 里保留本包的挂载行（与「方式三」同形，只是 profile 换成一个由桌面壳管理的目录）。

桌面档还有一条与网页档不同的前提：**宿主页面源可能不是回环 HTTP**（Electron 用 `file://` + IPC）。
3.11.0 起客户端已按 DSH 第一方口径兜底（`location.origin` 缺失或为 `"null"` ⇒ `http://dsh.internal`），
所以宿主路由在桌面档也能解析；若仍然连不上宿主，请跑 `window.__mpwCompat()` 与 `GET /api/mpkg-wallpaper/compat`
把两段 JSON 发给我们。

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

**残留数据（可选清理，注意是两处不同目录）**：

- 浏览器 `localStorage['dsh.mpkg-wallpaper.v2']`
- **主数据目录** `$DSH_HOME/.dsh-mpkg-wallpaper/`（未设 `DSH_HOME` 时是 `~/.dsh-mpkg-wallpaper/`）：`settings.json`、`web-store.json`、`media-audio.json`、上传的 mpkg、转码缓存
- **诊断/缩略图目录** `~/.dsh/.dsh-mpkg-wallpaper/`：`diag-*.json`、`thumbs/`

---

## 2. 30 秒快速开始

装完到看见壁纸，只走三步：

1. **装好并重启**：按上一节任选一种方式装完，重启 `dsh web`，浏览器 `Ctrl+F5`。
2. **打开面板**：左侧栏「设置」→「壁纸引擎背景」。
3. **选一张壁纸**，任选其一：
   - 拖入 `.mpkg` 文件（视频类直接播；场景类走静态帧/图层合成）
   - 选本地图片 / 视频，或填一个图片链接
   - 「自定义目录」选一个文件夹（可直接选 Steam 的 `steamapps/workshop/content/431960`，每个子文件夹算一张）

默认档就已经能用：总开关开（`enabled`）、大文件混合模式开（`hybrid`）、整屏虚化开（`unifyAmount = 30`）、Now playing 挂在左侧栏（`npNowPlaying` 开）。
想微调，先动这三处就够：**壁纸设置 → 磨砂模糊**（0–40）、**界面统一 → 整屏虚化程度**（0–40）、**壁纸设置 → 镜头缩放**（10–2000%）。

> 没反应时先去「其他」tab 点一次 **一键诊断上报**（宿主不可用会自动下载 JSON），再带上它去[反馈](#14-反馈-bug)。

---

## 3. 主要特性

按**你能感知到的东西**分组（来源、时间变化、虚化、外观、播放、库与轮换、安全、备份），不按代码模块。

**📦 壁纸来源**
- **Wallpaper Engine `.mpkg`**：浏览器内直接解析容器（不上传第三方）；视频类播放内嵌 mp4 / 视频纹理；场景类解析容器提取素材；**时间变化**按系统时间选时段素材
- **Steam 创意工坊目录**：自动发现 WE 安装（注册表 + `libraryfolders.vdf`，支持非默认盘），列出 `video / web / scene` 三类；也可把 **workshop 主目录**（`steamapps/workshop/content/431960`）直接设为自定义目录——每个子文件夹自动识别为一张壁纸
- **视频**：`.mp4/.webm/.mov/.m4v` 直接播放；**网页**：HTML 在沙箱 iframe 中加载（带风险预检）；**图片/动图/链接**：本地图片或 URL（含 `data:image`）
- **自定义目录**：任意文件夹，`.mpkg`、workshop 子目录、图片/视频/`scene.pkg` 混放都能识别

**⏰ 时间变化壁纸（Time Variation）**
- 识别 WE 的时间变化属性（`morningtime / daytime / dusktime / nighttime / timevarying`）
- **按需懒加载**：只提取当前时段素材（单槽峰值几十 MB），切换时段时才读，避免一次导入全部时段导致 OOM
- **手动锁定时段**：时段按钮只在容器里真的有该时段素材时出现，键名 `timeOverride`；点「自动」恢复随时间切换
- **不串台**：切换壁纸时清空上一张的时段缓存

**🌊 整屏虚化（磨砂）体系**
- **统一虚化**：一条滑条控制整屏壁纸模糊度 + 侧边栏/标题栏白雾厚度；聊天区是否跟随、新会话按钮是否跟随各自独立
- **界面虚化（各自独立开关 + 程度）**：对话框（通用居中窗口 + 聊天输入框）、设置面板、下载/确认弹窗、弹层（菜单/下拉/提示）、遮罩（全屏背景）、左侧边栏磨砂
- **透出壁纸**：左侧边栏 / 标题栏 / 右侧边栏 dock 各自独立，标题栏磨砂可单独指定半径

**🎨 主题色与玻璃外观（Aqua 实验默认全关）**
- **主题颜色（`themeColor`）**：取色盘 + 预置，驱动侧栏/标题栏/新会话按钮/设置弹窗底色；**配色（`accent`）**驱动品牌交互色（按钮/滑条/选中/链接/发送键）
- **面板颜色匹配壁纸（`aquaTint`）**：自动采样壁纸主色（视频/GIF 每 2 秒刷新）；**统一雾**（全屏色调雾罩）、**自适应文字色 + 蓝色清理**、**深底文字可读增强**、**任务列表磨砂**
- **液态玻璃（CSS/SVG 版）**：`lgCss` + 折射强度，作用于输入框/左侧边栏/标题栏；`lib/liquid-glass/` 的 WebGL 运行时不参与生成（见[文件结构](#12-文件结构)）

**🧩 dsh-better-sidebar 适配（检测到该插件后显示）**
- 已安装时「其他」tab 出现**适配分类**：总开关 `bsCompat`（**默认开**）+ `bsFloat`（悬浮双层修复）/ `bsFont` / `bsReveal` + `bsRevealAlpha` / `bsAqua`
- 宿主 `/api/mpkg-wallpaper/ping` 返回 `{ok, version, betterSidebar, betterSidebarVersion}`；客户端写 `body[data-mpw-bs-version]`，版本专属规则用 `[data-mpw-bs-version^="…"]` 门控
- 详见 [`docs/BETTER-SIDEBAR-COMPAT.md`](docs/BETTER-SIDEBAR-COMPAT.md)、[`docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md`](docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md)，回归 `node tools/better-sidebar-compat-test.mjs`

**🧭 扫描壁纸页（右侧边栏版）**
- 顶部显示当前扫描目录（取「背景来源」里的自定义目录；未配置时用 Steam 创意工坊目录），打开即刷新
- 缩略图按正方形铺成网格，列数随面板宽度自适应；点缩略图选中，上方详情区显示名称、容器内实际文件、类型
- 详情区常驻：未选中时各项显示「无」，三个按钮置灰；选中后可「应用此壁纸 / 刷新选中 / 取消选中」
- 选中项带描边高亮与上提阴影，应用后仍保持；网格可独立滚动，页面本身不滚动

**🖱️ 鼠标光晕**
- 外观 tab 第 2 项开关；开启后指针所在面板内部以指针为中心泛出一圈柔光（白、低强度、随主题微调）
- 关闭后不监听、不写任何变量；与「悬浮效果」总开关联动（总开关关闭时同样不生效）

**💾 预设配置**
- 常用组合可存为预设并一键切换；「保存配置」把当前配置写回该预设快照，「恢复默认」把生效配置还原到该快照
- 「+」新建时先把当前配置存成新预设的初值；编辑态下每个预设右上角出现灰色 ×，可直接删除

**🧱 层叠与可读性**
- 代码块横幅（sticky 标题条）不再被标题栏样式规则接管：滚动与吸附全程保持不透明，与宿主原生一致
- 弹层/菜单/提示气泡统一提到正确层级，气泡不被容器裁切；被裁场景会临时放开裁切祖先

**⏯️ 播放控制与省电**
- 视频/网页壁纸可**暂停/播放**（设置页「壁纸设置」下的按钮），暂停状态实时反映视频实际状态；**调整无关设置不会触发重播**
- **省电三档**：页面隐藏/切页暂停（默认**开**）、窗口失焦暂停、电池供电暂停（`getBattery` 缺失则静默跳过）；任一档触发即暂停，全部恢复才继续；与手动暂停共用一套门控

**🚀 大文件混合模式（hybrid，默认开）**
- mpkg **流式上传**到 DSH 宿主 → 磁盘存储 → HTTP Range 流式播放；**>600MB 也能放**，因为流不进内存；关掉则回纯浏览器模式（600MB 上限）

**🖼️ 本地壁纸库与轮换**
- Steam 自动发现 + 自定义目录（跨平台目录选择器）；WE 原生播放列表（`config.json` 的 `general.playlists`）导入为轮换列表
- 上一个/下一个一键切换、定时自动轮换（`rotate` + `rotateMin`，1–120 分钟）；列表勾选后滚动不跳顶

**🛡️ 安全与共存**
- **冲突检测**：检测到其他壁纸/主题插件时自动关闭本功能（可手动强开，写 `forceEnabled`）
- `.exe/application` 壁纸完全排除；自定义目录只读媒体文件；宿主路由有路径穿越校验；网页壁纸 iframe 沙箱隔离

**💾 备份与恢复 / 设置持久化**
- 「其他」tab 的**备份与恢复**导出外观类设置为可分享 JSON（`BACKUP_FIELDS` 白名单），导入即还原
- 设置除浏览器 `localStorage`（键 `dsh.mpkg-wallpaper.v2`）外另存宿主端 `settings.json`，换端口/清浏览器数据不丢

---

## 4. 支持的壁纸类型与边界

这节回答「我手上的素材能不能用、能用到什么程度」。

| 类型 | 表现 | 能控制什么 / 做不到什么 |
|---|---|---|
| **mpkg（视频类）** | ✅ 完整 | 内嵌 mp4/视频纹理直接播放；静音、倍速、暂停、模糊/缩放/亮度全可调 |
| **mpkg（场景类）** | 🟡 折中 | 容器素材提取：静态帧 / 图层合成 / 内嵌视频时段；**Live2D 木偶、shader、脚本做不到**（见[场景现状](#10-兼容性限制与做不到清单)） |
| **时间变化壁纸** | ✅ 多时段 | 自动切换 + 手动锁定；只提取当前时段 |
| **视频（mp4/webm/mov/m4v）** | ✅ 完整 | 直接播放；解码帧率上限/分辨率上限需 ffmpeg 转码 |
| **网页（HTML）** | 🟡 实验性 | 沙箱 iframe + WE API shim；**只读设置项的 Live2D 类可改**；外网 SDK / 重交互类未适配 |
| **scene.pkg 原始目录** | 🟡 折中 | 同 mpkg 场景类 |
| **preview.gif / 图片 / 动图** | ✅ 完整 | 场景壁纸无更多素材时回退作者预览图 |
| **Application（exe）** | ❌ 排除 | 内容判定即 `unknown/excluded-application`，绝不读取/执行 |
| **自定义目录（混合）** | ✅ 完整 | mpkg 与 workshop 子目录混放；深度 ≤4、条数 ≤4000 的有界扫描 |

**明确的边界**（都不是"以后再说"，是当前实现的事实）：

- 场景壁纸的**完整动态还原做不到**——MDL 木偶骨架无公开格式文档、shader/脚本无 Web 端运行时（见[场景适配现状](docs/WEB-WALLPAPER.md)）
- **纯 Scene 渲染方式选择器目前未接线**：「其他」tab 的 `sceneRender`（webgl/static/elysia）有按钮、有写入，但全仓没有读取点；实际路径由渲染器可用性决定（在线走渲染器 iframe，离线回退静态帧）
- 网页壁纸的 CSS `:hover/:active`、`isTrusted:true`、帧内 `contextmenu`、指针锁定/全屏/下载弹窗**做不到**（合成事件的固有边界，`docs/WEB-WALLPAPER.md` §11.4）
- 超过 600MB 的素材只在 **hybrid 模式**下可用；纯浏览器模式另有 250MB（视频纹理）/200MB（图片纹理）/100MB（本地图片文件）上限

---

## 5. 设置项总表（7 个 tab；右侧边栏版另有「扫描壁纸」）

tab 顺序与面板一致，固定为 `TAB_ORDER = ["source","wallpaper","appearance","unify","blur","other","liquid"]`，
界面文案：**背景来源 / 壁纸设置 / 外观 / 界面统一 / 界面虚化 / 其他 / 测试项**。

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
| Web 帧模式（网页壁纸） | `webFrameMode` | `auto` | 网页壁纸 iframe 的**三档**：`auto` = 隔离沙箱，被浏览器策略挡住 / shim 没报到时**只在沙箱内降档**（去掉 shim 标记重载，仍是不透明源），**不会自动升同源**（默认）；`sandbox` = 强制隔离，**不**自动降档（原因写进状态，可查）；`compat` = 兼容档（同源 + 不带 shim 标记，**只有用户显式选它才到得了**）。状态见 `window.__mpwWebFrame` 与 `#mpw-bgWrap[data-mpw-webframe-mode\|-reason\|-attr\|-fallback\|-autocompat\|-degraded]`，台账 `window.__mpwWebFrameGuard`（详见 [docs/WEB-WALLPAPER.md](docs/WEB-WALLPAPER.md) §3.0） | 选 `auto`；也可用 `?webframe=auto\|sandbox\|compat` 临时覆盖（不改设置） |
| 自动降级到兼容档（高风险） | `webFrameAutoCompat` | 关 | **风险回退口**：打开后 auto 档才允许在"被策略挡住"时自动降 `compat` —— 那意味着**这张第三方壁纸的脚本与 DSH 同源**（可读宿主界面/本地存储、可带 cookie 打插件路由）。关着时只记账 + 面板提示手动切。判据 `tools/web-frame-origin-guard-test.mjs`（详见 [docs/SECURITY-ROUTES.md](docs/SECURITY-ROUTES.md) F5） | 关 |
| 渲染器上游白名单 | `sceneUrlWhitelist` | 空 | **跨源回退口**：`sceneRendererUrl`/`sceneExtUrl` 默认只允许 http(s) **回环**（127.0.0.1/localhost/::1）与"和页面同主机的字面 IP"；跨源上游必须把它的 **origin** 填在这里（逗号/空格分隔）才会被使用，否则一律拒绝并回落 `127.0.0.1:8902`（记账 + 日志，不静默）。⚠ 登记进来的上游会**连同场景令牌 `st` 一起放行**（详见 [docs/SECURITY-ROUTES.md](docs/SECURITY-ROUTES.md) F6） | 清空 = 只允许回环 |
| 水平翻转（镜像） | `flipX` | 关 | 壁纸左右镜像 | 关 |
| 垂直翻转（镜像） | `flipY` | 关 | 壁纸上下镜像 | 关 |
| 解码帧率上限 | `fpsCap` | 无限制 | 源帧率超限时宿主 ffmpeg 抽帧转码（24/30/48/60） | 选「无限制」 |
| 分辨率上限 | `resMax` | 原始分辨率 | ffmpeg 缩放（720p/1080p/2K，保持宽高比） | 选「原始分辨率」 |
| 视频倍速 | `playbackRate` | 1x | 0.5–2x（档位 0.5/0.75/1/1.25/1.5/2） | 1x |
| ffmpeg 状态 | — | — | 显示系统/缓存/环境变量来源；未装可下载，缓存装的可卸载（不动系统） | — |
| 可调参数（折叠区） | `propEdits` | 空 | **可改且改完即生效**：mpkg 场景壁纸走 P-203 跨源属性通道（`mpw-user-props`，渲染器回执确认；见 `docs/WE-USER-PROPS.md` §3）；网页壁纸走 shim 同源通道（分辨率/语言/音量等） | 壁纸级重置 |
| 磨砂模糊 | `blur` | 12px | 壁纸层模糊（0–40） | 0 |
| 镜头缩放 | `zoom` | 100% | 10–2000% | 100% |
| 画面亮度 | `brightness` | 100% | 50–150% 滤镜 | 100% |
| 镜头位置（平移） | `lensX` / `lensY` | 0 / 0 | 水平/垂直平移，各自 ±2000 | 0 |
| 省电·页面隐藏/切页暂停 | `powPauseHidden` | **开** | `visibilitychange` | 关 |
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

### 4. 界面统一（unify）

| 面板文案 | 内部键 | 默认 | 作用 | 关闭 / 回退 |
|---|---|---|---|---|
| 统一虚化 | `unifyTint` | 开 | 整屏模糊感由一个条控制；开启后接管侧边栏/标题栏/右栏磨砂 | 关 |
| 整屏虚化程度 | `unifyAmount` | 30px | 0–40（控制壁纸层 blur） | — |
| 界面透明度 | `sidebarAlpha` | 65% | **0% = 完全不透明（正常界面）、100% = 完全透明（看到壁纸）**；同时驱动左栏/标题栏/右栏·dock；与模糊互不影响 | — |
| 聊天区跟随整屏虚化 | `chatFollow` | 开 | 关 = 聊天区由「磨砂模糊」条控制 | 关 |
| 新会话按钮跟随面板不透明度 | `sessionFollow` | 开 | 关 = 回到宿主原色 | 关 |
| 统一雾（全屏遮罩） | `aquaMask` | 关 | 所有表面共享一种雾色（原 Aqua 实验项） | 关 |
| 统一雾强度 | `aquaMaskAlpha` | 82% | 0–100% | — |

> **两个条的语义（判据 `tools/fog-model-test.mjs`）**：
> 「整屏虚化程度」= 模糊半径（**0 = 完全不虚化**）；
> 「界面透明度」= 整个界面外壳的透明程度（**0% = 完全不透明（正常界面，用宿主自己的表面色）、100% = 完全透明（看到壁纸）**）——
> 它与模糊**互不影响**：模糊 0 时照样按它透出，只是背后壁纸是清晰的。
> 另外：**透明度 = 0 时插件完全不覆盖宿主**（不写背景/不写模糊/不动宿主 token）。
> 两者对**整个界面外壳**生效（左栏/标题栏/右栏/dock 共用同一套表面 token）。

### 5. 界面虚化（blur）

| 面板文案 | 内部键 | 默认 | 程度键 / 默认 | 关 |
|---|---|---|---|---|
| 跟随统一虚化 | `blurFollowUnify` | **开** | 开 = 被接管的项（左栏磨砂/标题栏磨砂/右侧边栏·dock）与统一值一致；**其中任一项你自己调过之后就独立**；关 = 全部独立；重新打开 = 清空独立标记 | — |
| 虚化对话框 | `dialogBlur` | 开 | `dialogAmount` 14px | 关 |
| 虚化设置面板 | `settingsBlur` | 开 | `settingsAmount` 14px | 关 |
| 虚化下载/确认弹窗 | `confirmBlur` | 开 | `confirmAmount` 12px | 关 |
| 虚化弹层 | `popoverBlur` | 开 | `popoverAmount` 10px；另有 `popoverAlpha` 94% 表面不透明度 | 关 |
| 虚化遮罩（全屏背景） | `maskBlur` | 开 | `maskAmount` 8px | 关 |
| 右侧边栏/dock 虚化 | `rightSidebarBlur` | 开 | `rightSidebarBlurAmount` 14px + `rightSidebarAlpha` 45%；跟随统一虚化时两项都被接管 | 关 |

### 6. 其他（other）

| 面板文案 | 内部键 | 默认 | 作用 | 关闭 / 回退 |
|---|---|---|---|---|
| 轻度锐化 | `sharp` | 开 | 提升低清 GIF 观感；卡顿请关 | 关 |
| Deep diving 背景方框 | `thinkBg` | 关 | 开 = 思考状态显示模糊背景方框 | 关 |
| 任务列表磨砂 | `todoBlur` | 关 | todo 卡片背景模糊 | 关 |
| 第三方 UI 圆角兼容 | `roundCompat` | 关 | 兼容第三方插件圆角 | 关 |
| 自适应文字色 + 蓝色清理 | `aquaInk` | 关 | 文字色随遮罩亮度自适应 + 品牌色统一（配 `aquaInkColor`） | 关 |
| 深底文字可读增强 | `aquaTextEnhance` | 关 | 文字双色描边（近似方案） | 关 |
| ≥4K 源自动降 1080p | `resMax`（自动写 1920） | 自动 | 检测到 ≥4K 且宿主转码可用、且你没设过「分辨率上限」时，自动把该壁纸降到 1080p（每张壁纸一次；`?autocap=off` 关闭；设置里可改回） | `?autocap=off` |
| 纯 Scene 壁纸渲染方式 | `sceneRender` | — | ⚠ 有按钮、有写入，**无读取点**（未接线） | — |
| 场景渲染上报（排障） | `sceneReport` | 开 | 壁纸每 10s 把渲染器现场写到 `reports/` | 关 |
| 场景首帧看门狗 | `sceneWatchdog` | 开 | 超时未出画自动回退静态帧；等待时长 `sceneWatchdogSecs` 8s（3–30） | 关 |
| 重试渲染器 / 渲染器调试参数 / 扩展钩子地址 | `sceneDebugParams` / `sceneExtUrl` | 空 | 白名单透传（`ln/eyehack/audit/isolate/parallax/…`）；扩展钩子按 `extbase` 拼进 iframe | 清空 / 一键清空 |
| 一键诊断上报 | — | — | 收集子系统状态 → `POST /api/mpkg-wallpaper/diag`；宿主不可用则下载 JSON | — |
| 诊断开关速查（渲染器） | — | — | 常用渲染器诊断开关 + 「复制」URL 片段（见 §6.2） | — |
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

这些键**存在且参与逻辑**，但设置页里没有对应控件；只能通过备份导入、`localStorage` 手工改写或 URL 参数触达
（`tools/switch-wiring-test.mjs` 有「只影响运行时」的白名单与理由）。

| 键 | 默认 | 说明 |
|---|---|---|
| `clock` / `clock24h` / `clockSec` / `clockDate` / `clockPos` / `clockSize` | 关 / 开 / 关 / 关 / `tr` / 40 | 时钟是**运行时兼容项**：旧配置仍会渲染，设置页已无开关 |
| `bsAlpha` | 关 | better-sidebar 面板跟随主题底色；CSS 有读取点，面板无控件 |
| `bsBottomAvoid` | 关 | 已定案的**故意空操作**（对齐交给 better-sidebar 自己的 ResizeObserver） |
| `newStyle` | 关 | 只改设置页控件外观（JS 选 className），不进 `buildCss` |
| `forceEnabled` | 关 | 冲突检测下手动强开的运行时优先级标记 |
| `opacity` | 82 | 「面板不透明度」滑条已删除（统一虚化下由 `sidebarAlpha` 取代）；值仍被读取 |
| `aquaTintStrength` | 45 | 面板取色的壁纸主色混合比例；运行时读取，无控件 |
| `glassColor` / `glassAlpha` | 空 / 12 | 早期 WebGL 液态玻璃的遗留键：只随备份导出/导入与「恢复默认」走动，**无控件、无读取点** |
| `webInteraction` | `pointer` | 网页壁纸交互档位（`off`/`pointer`/`full`）：**无面板控件**，用 URL `?mpwinteract=…` 或写存档 |
| `sceneRendererUrl` | `http://127.0.0.1:8902/webloader/` | 场景渲染器地址，可覆盖（默认 = 一站式测试台 :8902 直供的 `/webloader/`；旧默认是 `:8899`） |
| `npVolume` | 100 | Now playing 卡片里的**音量电平**（0..100，落到真实元素）；默认档**从不写元素音量**，只有你动过才写 |
| `glassWindow` | — | **已退役删除**：无控件、无读取点，功能已被 `settingsBlur` + `dialogBlur`/`popoverBlur` 覆盖；源码与 zh/en 字典 0 残留 |

### 选择器行为契约（选择文件夹 / 选择文件）

「自定义目录」「可调参数里的目录/文件属性」用的目录选择器**自己持有滚动主权**（历史 bug：滚轮一滚就弹回顶部、
行被重渲染后 `scrollTop` 归零、滚轮串联给宿主设置面板）。当前契约：

| 行为契约 | 说明 |
|---|---|
| **滚动位置保持** | 刷新 / 过滤 / 条目变少 / 500 项大目录 / 宿主重渲染 / **容器节点被重建**后，滚动位置都在原位（不会出现"跳回顶"的一帧） |
| **不抢焦点** | 打开弹窗只把焦点给**列表容器自己**且带 `focus({preventScroll:true})`；行一律 `tabindex="-1"` + `mousedown` 阻止默认聚焦 ⇒ **任何行都不会成为 `document.activeElement`** |
| **每个目录各自记位置** | A 目录滚到 60、B 目录滚到 20，来回切换互不串位 |
| **滚轮不串联** | 列表滑到边界后不会带着背后的设置面板一起滚 |
| **行级增量更新** | 目录刷新只增删差集（行 key = 完整路径，测试断言行节点 uid 不变） |
| **锚点缺失不回 0** | 记住的位置若超出新列表范围 ⇒ **夹到新范围**；记忆值缺失/非法一律当"无锚点" ⇒ 认领当前位置 |

| 按键 | 行为 |
|---|---|
| `↑` / `↓` | 上下移动活动行（不抢焦点、只在按键时做最小位移 `block:"nearest"`） |
| `Home` / `End` | 跳到第一个 / 最后一个目录 |
| `Enter` | 进入活动行对应目录；**未选中任何行时 = 「选择此文件夹」** |
| `Backspace` / `Alt`+`↑` | 上一级目录 |
| `Esc` | 关闭弹窗 |

> 回归：`node tools/dir-picker-test.mjs`（A 组为源码级断言，对旧实现会变红 ⇒ 用例有分辨力；B 组用假 DOM + 迷你 React 跑生产实现的切片）。
> 细节、根因与修法：`docs/DIR-PICKER-SCROLL.md`。

---

## 6. URL 开关速查

### 6.1 插件侧 URL 逃生口（刷新即生效，不改设置）

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
| `?autocap=off` | 关「≥4K 源自动降 1080p」 |
| `?webframe=auto\|sandbox\|compat` | 临时覆盖网页壁纸帧模式（不改设置） |
| `?npvoice=keep\|drop` | 交互期音频分类：保留 / 丢弃（语料实测清单只剩 `BGM.wav`） |
| `?npaudit=0` | 关音频审计（hook `play`/`volume`/`muted`/`new Audio`/`AudioContext`，有界环形 ≤200，可疑转变即上报 `/diag`） |
| `?hiddengate=legacy` | **隐藏闸门整族回旧行为**（后台挂载/冻结/切页时不再拦我们的起播与重试；A/B 与线上救急用。默认档＝页面隐藏时一律不起播、隐藏时停住所有我们的出声面、回到可见按当时策略恢复；详见 [`docs/WALLPAPER-LIFECYCLE.md`](docs/WALLPAPER-LIFECYCLE.md) §6.4） |

### 6.2 渲染器侧诊断开关（纯 Scene 壁纸）

这两个数字口径不同，别混：

- **渲染器开关主表当前 238 条**（读数来自渲染器仓的 `node tests/diag-flag-check.mjs`，它把代码开关与主表**双向对拍**），
  主表在渲染器仓：[`docs/README-DIAGNOSTICS.md`](https://github.com/配套渲染器仓库（见插件主页链接）/blob/main/docs/README-DIAGNOSTICS.md)。
- 插件面板里只放**常用/逃生口那一张小表**（`common:true` 集合，当前 **11** 个），拼在渲染器地址后面用，例如 `http://127.0.0.1:8902/webloader/?id=3719111841&audit=3`：

| 开关 | 用途 | 默认 |
|---|---|---|
| `att=legacy` | 附件锚点走旧自算路径（A/B 对照） | 新路径 |
| `mcc=1` | 强制网格包围盒中心补偿 | 关 |
| `piv=1` / `piv=0` | 子网格 pivot 全开 / 全关 | 只对眼睛组合生效 |
| `align=0` | 复现旧对齐（origin 恒几何中心） | 官方对齐 |
| `parallax=legacy` | 鼠标视差退回旧近似式 | 官方公式 |
| `gyro=1` / `gyro=0` | 移动端姿态源强制开 / 完全不监听 | `auto`（有细指针不启用、触摸设备启用） |
| `audio=1` | 播放场景 sound 层（每层一条流） | 静音 |
| `whitefallback=0` | 缺纹理层改透明 | 白块（与官方一致） |
| `hier=0` | 放弃父链合成，回退绝对定位兜底 | 父链合成 |
| `isolate=<层名>` | 只保留名字含关键词的层可见（逗号分隔） | 全可见 |
| `audit=N` | 首帧逐层审计 N 帧 | 1 |

> 这些是**渲染器**的 URL 参数，不是本插件的设置；插件只负责把它们拼进场景 iframe。面板文案与离线副本必须与渲染器 `web/diag-flags.json` 的 `common` 集合一致，由 `tools/panel-smoke.mjs` 断言。

---

## 7. Now playing 与壁纸声音

这节说明左侧栏那个播放器**挂在哪、显示什么、能控什么**——它控制的是壁纸自己的声音。
（本节按**符号名**引用实现，行号会随版本漂移，以符号为准。）

- **挂载点**：宿主 slot `sidebar.footer.action`（`createSlotAction` 的注册项：`id:"mpw-now-playing"`、`order:60`）。拿不到 slot 时 `resolveAnchor()` 按模式降级：`slot` → `settings-slot` → `settings-area` → `foot`；一条都不成立就**不建任何节点**并打一行 `console.warn`。**锚点晚出现也照样挂上**：找不到落点时盯住文档，宿主 slot 出口渲染出来后自动补挂。
- **让位（默认开的配套）**：`occupantOf()` 逐个看容器子节点，放行三类——我们自己的节点、宿主自有节点、实质空节点；剩下第一个即算「占用者」⇒ 不挂（挂载前）或撤下（挂载后），写 `data-mpw-np-yield="foreign-occupant"` 并打一行可读 warn；占用者走了会自己回来。判据是**双向**的。
- **左侧栏收起即隐藏**：`data-mpw-np-hidden` + CSS `display:none`。判据以**物理宽度优先**（`shouldHide()`：量到 ≥ `NP_COLLAPSE_MAX_W = 96` 就不隐藏），宿主信号只在宽度**量不到**时兜底。宽度不够时整体按 `--mpw-np-fit = clamp(avail/260, 0.5, 1)` 缩放。
- **形态**：一颗胶囊展开成卡片——封面、标题/副标题、进度条 + 时钟、整块点击热区。**展开态四个键**：上一首 / 播放-暂停 / 下一首 / 静音-取消静音；**收起态三个键**（静音键随卡片出现，受几何约束）。
- **数据源**（`npResolveMedia`：**只报我们真的知道的东西**）：

| 当前壁纸 | NP 显示 | 能控什么 |
|---|---|---|
| 视频壁纸（当前**真的在放**的那个 `<video>`） | 真实播放状态 + 时长/进度；明确知道没有音轨时副标题写「该视频没有音轨」 | 播放 / 暂停 / 静音-取消静音（判断不了有没有音轨时**不猜**）；**没有曲目清单 ⇒ 上一首/下一首如实 disabled** |
| 壁纸目录里**真实存在**的音频文件 | 文件名 + 清单序号；进度与时长来自媒体元素 | 我们自己的 `<audio>`：播放 / 暂停 / **上一首·下一首按清单顺序环形切换**（只有一条 ⇒ 两侧键 disabled）/ 静音 |
| 网页壁纸（目录里没有独立音频） | 副标题写「网页壁纸声音」 | **只有静音**这一条通道（`canPlay=false`，不假装能暂停帧内 WebAudio） |
| 无源（静态图 / 清单还没到 / 场景无独立音轨） | 空闲态（曲名 = 未在播放） | 不显示"点了没用"的键；点播放给出面板提示 + console 一行，**不做假动作** |

- **两个控制（NP-4）**：① **音量电平** —— 卡片里的音量条，设置键 `npVolume`（0..100），真的落到元素；默认档**从不写元素音量**，只有你动过才写；② **可拖动进度（seek）** —— 拖进度条即定位。两者都受下面这个开关管辖。
- **「播放/暂停同时控制壁纸」（`npLinkWallpaper`，默认开）**：开 = 传输键与进度条**同时**驱动壁纸自身的播放/进度；关 = 只驱动本插件自己的播放器，壁纸媒体**一个字节都不碰**；壁纸媒体是唯一声源时控件**如实 disabled** 并在副标题说明。
- **做不到的**（明确列出，不做假动作；`docs/NOW-PLAYING-DSH.md` §7.7.7 与 §7.8）：没有系统媒体源时不去猜（系统媒体源见 §8）；web 壁纸帧内那份声音**只有静音**，它自己的播放/暂停做不到；视频壁纸没有上一首/下一首；**静音键只在展开态出现**；心形按钮不渲染；没有波形、没有键盘快捷键；包里（`scene.pkg`）的音轨**只能列清单、不能播**；进度条可拖动，但**联动关掉或没有可定位媒体时如实不可拖**。
- **回退**：把 `npNowPlaying` 关掉（或「恢复所有默认设置」）⇒ 回到零注入（不建 DOM、不装观察者、产物里一行 NP 规则都没有）。回归：`node tools/now-playing-test.mjs` 与 `node tools/np-media-test.mjs`，都在 `tools/check.sh` 第 2 步。
- **归属**：组件为 **Bencho 的 "Now playing"（MIT）逐行移植**（注释原文保留）；侧栏挂载控制器、让位判据、自绘图标、token 映射、数据接入与门禁是本仓自写。登记见 `THIRD-PARTY.md` §6。

---

## 8. 系统媒体会话（MPRIS / SMTC）

这节说明「显示系统正在播放什么」这条链路的**宿主半边**：能力矩阵、诚实不可用路径。

`lib/media-session.js`（MIT，本仓自写，零第三方代码）是「Now playing 显示**系统**正在播放什么」这条链路的**宿主半边**。契约：`createMediaSession({run, platform, env, now, timeoutMs, log})` → `{probe(), snapshot(), control(op,arg), stats(), lastProbe()}`。

**能力矩阵**

| 平台 | 通道 | 适配器（按优先级） | 元数据 / 状态 / 进度 / 封面 | 控制 |
|---|---|---|---|---|
| Linux / FreeBSD / OpenBSD | MPRIS over D-Bus（`org.mpris.MediaPlayer2.*`） | `playerctl` → `dbus-send` | 一次调用取 7 个字段：`status / mpris:length / position / xesam:title / xesam:artist / xesam:album / mpris:artUrl` | `play` `pause` `playpause` `next` `prev` `seek` |
| Windows 10/11 | SMTC（`GlobalSystemMediaTransportControlsSessionManager`） | `smtc`（`powershell.exe -NoProfile -NonInteractive`） | 真 WinRT 调用取属性 / 时间线 / 播放控制 / 缩略图（转 base64 data URL） | 同上（op 与位置作为独立 argv 元素下发） |
| macOS | — | — | ❌ 未实现：`unsupported-platform`，**0 条命令** | ❌ |
| 其它 / 无适配器 | — | `none` | ❌ `not-installed` | ❌ |

- **形状**：`snapshot` 21 个键**恒在**，拿不到就是空/中性值（`duration`/`position` 单位毫秒，拿不到是 `null`，**不编 0**）；`available:true` 时 `title` 非空。
- **没有桌面会话总线时如实显示不可用**：`probe()` 会真的探测（`dbus-send --session ListNames`，必要时退 `busctl --user list`），拿不到就回 `available:false / reason:'no-session-bus'`。
- **绝不抛异常**：`snapshot()` / `control()` 永不 reject；失败全部是返回值（`reason` 落在固定取值集合内）。
- **安全**：命令名与参数**分开传**（argv 数组，从不经过 `sh -c`）；播放器名白名单，不合规 ⇒ `bad-player` + 0 条命令；`op` 白名单 + `seek` 范围 `0..24h`；超时默认 800ms（50–5000ms）；读操作单飞 + 全局串行。
- **零依赖**：只用 `node:child_process`；`package.json` 里没有新增任何依赖。
- **环境变量**：`MPW_MEDIA_ADAPTER`（强指适配器）、`MPW_MEDIA_PLAYER`（钉播放器名）、`MPW_MEDIA_TIMEOUT_MS`。
- **接线现状（如实）**：**已接线** —— 宿主 `GET /api/mpkg-wallpaper/media-session`（21 键快照）/ `POST /api/mpkg-wallpaper/media-control`（六个 op，能力位先判）/ `GET /api/mpkg-wallpaper/media-art`（`file://` 封面代理）；客户端 `npSystemMedia*` 自适应轮询（有系统媒体 2s、本机无会话总线 30s）⇒ 卡片显示**真实系统曲目/封面/进度**，本机无总线时如实 `available:false / no-session-bus`。
- **判据**：`node tools/media-session-test.mjs`（契约/三适配器解析/诚实能力判定/参数化控制/超时/并发去重）与 `node tools/media-session-wiring-test.mjs`（接线面）；细节见 [`docs/MEDIA-SESSION.md`](docs/MEDIA-SESSION.md)。

---

## 9. 诊断与排障

出问题先来这里：一次点击把状态发回本机宿主；只有需要缩小范围时才打开个别诊断开关。

- **一键诊断上报**（「其他」tab）：把磨砂/侧栏/时间线是否被影响、壁纸类型与路径、shim 是否注入、视频解码、表面 token、场景健康打成一个 payload → `POST /api/mpkg-wallpaper/diag`，落在 `~/.dsh/.dsh-mpkg-wallpaper/diag-<epochms>.json`（目录上限 50 个文件 / 32MB；客户端单份上限 512KB）。**宿主不可用时自动改为下载 `mpw-diag-<ISO>.json`**，离线也能把状态发回来。字段表带 `provenance`，读不到就是 `value:null + degraded`（[`docs/DIAGNOSTICS.md`](docs/DIAGNOSTICS.md)）。
- **后台自动上报**：开关是 **`localStorage['mpwdiag']='1'`**（不是 URL 参数——DSH 鉴权 303 会剥掉 query），刷新后在载入 6 秒时上报一次（每会话 ≤6 次）；`window.onerror` 走同一采集器。
- **插件侧 URL 逃生口**：见 §6.1。
- **渲染器侧诊断开关**：见 §6.2。

**宿主路由的来源闸门（P-204）**：三处 ACAO 回显白名单化（`/raw`、场景音频、缩略图上报，外加 `/lg` 静态 JS）：只放 `Origin: null`（沙箱帧）与 `http://127.0.0.1:3080|8899|8902`（含 `localhost`）；非白名单**一个 `Access-Control-Allow-*` 都不发**。非 GET 写请求过闸门：`Sec-Fetch-Site`（有则必须 `same-origin`/`none`）+ `Origin` 白名单；`/scene-thumb-token` 与 `/settings` 连 GET 也过闸。`/custom-dir` 拒敏感目录；`/raw` 的 `file` 有扩展名白名单。回退口（默认关，排障用）：`MPW_CSRF=0`、`MPW_CORS_LEGACY=1`、`MPW_CORS_ORIGINS=a,b`、`MPW_CUSTOM_DIR_ALLOW_ANY=1`；`GET /api/mpkg-wallpaper/security` 只读播报当前生效值。完整规格见 [`docs/SECURITY-ROUTES.md`](docs/SECURITY-ROUTES.md)，判据 `node tools/sec-route-guard-test.mjs`。

**网页帧同源逃逸 + 可控上游（P-205）**：自动降档落点恒为沙箱档（`allow-scripts`，不透明源）；入站消息**同时**校验 `ev.origin` 与"这个帧应有的来源"；`compat` 只能由用户显式设置。设置里的外链只认 http(s) **回环** / "与页面同主机的字面 IP" / **显式白名单**（`sceneUrlWhitelist`）；场景令牌 `st` 只在目标过闸门时下发；非法目标一律拒绝使用（回落默认回环）+ 记账 `window.__mpwSceneUrlGuard` + `console.warn` + `/diag` 信标。判据（都在 `tools/check.sh` 第 5 步）：`node tools/web-frame-origin-guard-test.mjs` 与 `node tools/scene-url-token-guard-test.mjs`。

---

## 10. 兼容性、限制与做不到清单

### 浏览器兼容性（实测参考）

| 浏览器 | 推荐度 | 表现与注意 |
|---|---|---|
| Chrome / Chromium（桌面） | ⭐⭐⭐ 强 | 功能最完整：`backdrop-filter` 与 `color-mix` 实现最佳、`iframe.muted` 生效、muted 自动播放放行 |
| Edge（桌面） | ⭐⭐⭐ 强 | 视频壁纸走**独立 canvas 渲染路径**（规避 Edge 悬浮工具栏）；个别版本仅有首帧静态（非空白/崩溃） |
| Firefox | ⭐⭐ 中 | 功能全支持（`backdrop-filter` 103+、编码不支持自动转码兜底）；有三点减分，见下表后的说明 |
| Android WebView / 移动端 | ⭐⭐ 中偏弱 | autoplay 政策取决于宿主 WebView 配置；`getBattery` 可能缺失（有守卫跳过）；极端组合建议静态图/GIF 或关 blur |

> **Firefox 的三点减分**：① `backdrop-filter` 性能弱于 Chromium（多模糊同开时低端机掉帧）；② `iframe.muted` 不支持 ⇒ 有声 web 壁纸首次可能被自动播放策略拦停首帧；③ `color-mix` 需要 113+（旧版只有外观回退）。
> 源码已为各浏览器做了降级（无 `requestVideoFrameCallback` 回退 rAF、`ResizeObserver`/`getBattery` 有守卫、全部 `play()` 带 `.catch`、`backdrop-filter` 用 `CSS.supports` 检测并降级）。

### 没有 Wallpaper Engine 安装时（缺失 / 非 Windows）

「WE 安装」指 Steam 版 Wallpaper Engine（appid **431960**）。宿主端 `locateWallpaperEngine()` 按这个顺序找：Windows 注册表 → 常见 Steam 目录 → 非 Windows 的 Steam 目录（macOS / Linux / Android / WSL）→ 各库 `steamapps/libraryfolders.vdf` 里含 431960 的库 → 只认 `<库>/steamapps/common/wallpaper_engine/wallpaper32.exe` 存在的那一个。**找不到就返回 `null`**，后续走降级路径：

| 场景 | 真实行为 |
|---|---|
| 没装 WE（或找不到 `wallpaper32.exe`） | `steam-inventory` 返回 **200 `{ok:true, installDir:null, wallpapers:[]}`** —— 不是错误、不抛 500 |
| 点「扫描本地壁纸库」 | 列表空 + 顶部报错条「未检测到壁纸引擎安装」；空列表另有「未发现可用的壁纸」。**扫描本身不报错** |
| 装了 WE 但素材目录都不存在 | 每个根目录单独判存在 ⇒ 清单为空、**且不弹「未检测到安装」**；界面只剩空提示。**未实现**：这种情况没有专用提示 |
| 非 Windows / 移动端 | 同"没装 WE"（注册表分支直接在非 win32 返回 null） |
| WE 原生播放列表 | 只在 `installDir` 存在且 `config.json` 可解析时才有；否则写 `rotSeeded:true` 并**不再重播种** |
| 宿主端整体不可用（方式四没装/端口不通） | 探测 `/ping` 失败 ⇒ 回退**纯浏览器模式**；超过 600MB 的素材无法处理 |
| `ffmpeg` 缺失 | `ffmpeg-check` 返回 **200 `{ok:true, found:false, …}`**；面板显示"未安装"，只在点按后才走下载链，可直读的视频不转码 |

> 一句话：**没有 WE 安装 = 少了"自动发现本地壁纸库"这一条便利通道**，插件照常工作；手动目录、直接导入、URL/本地文件、场景提取与诊断都不依赖 WE，所有降级都是"返回空清单 + 明确文案 + 保留手动通道"，不静默失败、也不报 500。

### 场景（Scene）壁纸适配现状

**结论先说：WE 场景壁纸无法在 Web 端完整还原，这是引擎层面的限制。** 场景由专有引擎渲染——Live2D 式**木偶骨架（.mdl 二进制）**、**shader 特效**、**脚本**；浏览器没有官方渲染器，格式也未公开（RePKG 只逆向过 PKG/TEX，MDL 骨架无公开文档）。

插件提供两条路径：

1. **外部渲染器 iframe（首选）**：本机渲染器（默认 `http://127.0.0.1:8902/webloader/`，旧默认 `:8899`）在线时，场景以 iframe 挂载。渲染器离线/首帧超时则由**看门狗**回退静态帧并在提示条说明，可手动「重新挂载渲染器」。渲染器地址可用 `sceneRendererUrl` 覆盖。
2. **容器内素材提取（兜底，`lib/pkg-extract.js`，MIT，采用自 [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)）**：
   - **静态帧**：解析 PKG（LZ4 解压）+ TEX 纹理解码，按"面积 × 格式权重 × 路径惩罚"选主纹理
   - **图层合成**：解析 `scene.json` 的全部 image 图层，按源坐标/尺寸在 canvas 上合成（最多 24 层）
   - **内嵌视频时段**：`scene.pkg` 与 mpkg 同为 PKG 容器，含内嵌视频纹理的时段按 mpkg 方式解析 → 多时段切换

**无法覆盖的**：MDL 木偶人物（纹理层几乎为空）、shader 波浪/粒子、脚本交互。这些回退**官方预览动图**（preview.gif）。

**格式与上限**（`lib/pkg-extract.js`）：PKG 魔数 `PKGV####`；TEX `TEXV0005` + `TEXI0001`，mipmap 容器 `TEXB0001`–`0004`；可解码像素格式 = RGBA8888 / R8 / RG88 / DXT1 / DXT3 / DXT5（内嵌 JPEG/PNG 直通），其余抛出 `unsupported format`；尺寸上限 16384、mip ≤32、帧数 ≤4096。

> 需要完整动态效果的现实路径：**外部渲染成视频 → 用本插件的视频壁纸功能**。

### 网页壁纸（Web，实验性）

- **类型判定按内容，不只看声明**：`detectWebWallpaperKind()` 返回四态 `web / scene / video / unknown`，`project.json` 的 `general.type` 只是线索——谎报 `web` 但目录里是 `scene.pkg` 的按**场景**处理，谎报 `scene`/`video` 但只有 `index.html` 的按**网页**处理；`application/exe/app` 一律 `unknown/excluded-application`。
- **两条加载模式**（确认弹窗里选，模式记在 URL 里，刷新后照旧）：
  - **沙箱模式（默认，推荐）**：`sandbox="allow-scripts"`（**不透明源**）。宿主在入口 HTML 的 `<head>` 最前注入 **WE API shim**，`?mpwshim=1` 是注入闸门。壁纸脚本**读不到宿主 DOM / `localStorage` / cookie**；帧内 `fetch()` 是跨源（`Origin: null`），宿主只对字面量 `null` 回 CORS 头
  - **兼容模式（同源）**：`allow-scripts allow-same-origin allow-pointer-lock`。Live2D 类的「网页壁纸选项」（分辨率/语言/音量，写同源 `localStorage`）需要它
- **WE API shim**（注入在作者脚本之前）：`wallpaperPropertyListener`、`wallpaperRegisterAudioListener`、`wallpaperRegisterMedia{Properties,Thumbnail,Playback,Timeline,Status}Listener`、`wallpaperRequestRandomFileForProperty`、`wallpaperMediaIntegration`、`wallpaperPluginListener`
- **存储持久化**：帧内 facade（真 `localStorage` 一读就抛时安装）+ 宿主 `POST/GET /api/mpkg-wallpaper/web-store`，按壁纸隔离；上限 64 键 / 单值 4096 字符 / 每壁纸 64KB / 最多 64 张壁纸，落 `~/.dsh-mpkg-wallpaper/web-store.json`
- **风险预检**：`⚠重动画`（目录里有 `.skel/.atlas` 或名字含 spine/live2d，深度 ≤3）与 `🌐外网`（入口 HTML 前 256KB 含 `http(s)://`），只在 `type === "web"` 时显示；也可直接查 `GET /api/mpkg-wallpaper/web-probe?folder=|ltoken=`
- **CSP**：命中阻断型 CSP 时**不注入** shim、回原字节并加 `x-mpw-shim-skipped: csp`（这一处**照抄**上游 `web-rewrite.ts`，MIT，登记在 `THIRD-PARTY.md` §5）；客户端 2.5 秒没收到 ready 则去掉标记**在沙箱档内**重载一次（**不**自动升同源）
- **交互模式**：壁纸层是背景层（不吃指针），点右下角「交互」按钮或 URL `?mpwinteract=1` 后，指针/滚轮/触摸（`full` 档再含键盘与文本输入）会被送进壁纸内的作者脚本；**一定会退出**——60 秒无操作 / 180 秒总时长 / `Esc` / 右上角「退出交互」/ 切换壁纸。⚠ **窗口失焦不会退出**；`?mpwinteract=full` 只改档位、**不自动进入**。交互**不放宽沙箱**、**不读帧内 DOM**
- **作者脚本报错不拖垮插件**：帧内 shim 兜住 listener 异常 / 全局 `error` / 未捕获 Promise，限流上报父页
- **已知限制**：音频频谱通道仍为空（WE 的频谱语义是**系统音频**，拿壁纸自身声音当频谱是语义造假，故不伪造）；`innerHTML` 里拼出来的 `file:///` 不覆盖；绝对系统路径映射不了；被导航到外部的页面拿不到 shim

> 细节（类型判定表、sandbox 逐项理由、shim API 表与控制协议、交互注入方案与安全边界、文件 URL 改写、错误边界、与参考实现的差异清单）：[`docs/WEB-WALLPAPER.md`](docs/WEB-WALLPAPER.md)。
> 回归：`node tools/web-wallpaper-test.mjs` + `node tools/web-interaction-test.mjs`（都在 `tools/check.sh` 第 5 步）。

### 安全说明

- **默认无被动对外网络请求**：插件后台不主动访问外部网络；日常播放只与本机 DSH 宿主（`127.0.0.1`）通信。例外都是**用户显式触发**：检查更新/一键更新访问 GitHub、下载 ffmpeg 访问 GitHub Releases / npm 二进制镜像；**打开设置面板后 0.8s 会自动静默检查一次版本**（只点亮徽标，不弹窗、不下载、不上传）。此外用户手输的网络图片 URL、网页壁纸自身加载的资源也属外部访问。
- **无敏感内容**：`node tools/secret-scan-test.mjs` 扫描全部 tracked 文件（凭据模式 + 本机路径模式）必须 0 命中。
- **数据边界**：所有解析在本机完成；`localStorage` 只存背景与参数；设置与网页帧内存储落在 `~/.dsh-mpkg-wallpaper/`（诊断快照落在 `~/.dsh/.dsh-mpkg-wallpaper/`）。
- **系统媒体会话模块**：命令名与参数分开传（argv 数组，从不经过 `sh -c`），播放器名白名单 + op 白名单 + seek 范围校验，不合规 ⇒ 0 条命令；超时后 `SIGKILL`。

---

## 11. 开发与测试

改完代码怎么自证没坏：**一条命令跑完 12 步门禁**。

```sh
bash tools/check.sh                    # 12 步全量门禁（默认档：键未变且上次真跑为绿 ⇒ 跳过，打印 SKIP-CACHED）
bash tools/check.sh --full             # 忽略缓存，12 步逐条真跑（CI / 发版 / 怀疑缓存时的权威档）
bash tools/check.sh --list             # 只列出 12 步与每步缓存状态 + 当前输入指纹，然后退出
bash tools/check.sh --quick            # 跳过组合矩阵（第 3 步）
node tools/integrity-check.mjs         # 文件齐全、元数据、白名单、无本机路径、客户端自包含、发布包内容
node tools/secret-scan-test.mjs        # 凭据 0 命中、本机绝对路径 0 命中、白名单无腐烂条目
node tools/style-scope-guard.mjs       # 末行口径：RED / REVIEW 必须为 0
node tools/switch-wiring-test.mjs      # 每个开关都必须真的改变产物（或按理由登记为"只影响运行时"）
node tools/panel-smoke.mjs             # 面板渲染 + 语言字典 + 常用开关表与 diag-flags.json 一致
node tools/build-now-playing.mjs       # NP 生成区内联（生成物与源漂移即红）
node tools/build-audio-bus.mjs         # 音频总线生成区内联
node tools/build-bundle.mjs --check    # 宿主端单文件 bundle 与源码对拍
node tools/bundle-equivalence-test.mjs # bundle 构建可复现 + 路由逐字段对拍 + 装载布局 + 变异对照
```

> **断言条数不写死**：各脚本的通过条数会随版本增加，请以**实跑输出的汇总行**为准（例：`✓ 全部通过（pass=… fail=0）`）。
> `tools/check.sh` 的锁与增量缓存只落 `os.tmpdir()`（可用 `MPW_GATE_CACHE` / `MPW_GATE_LOCK` 覆盖），仓库里不写本机绝对路径。

**`tools/check.sh` 的 12 步**：① 语法 ② 面板冒烟 + P-66 面板健壮性/语言回归 + 选择器回归 + 壁纸层可见性 + 持久化 + Now playing（生成区漂移 + 声音接线两套独立判据）③ CSS 组合矩阵（512 全组合 + 600 随机 + 边界）④ 场景看门狗/调试参数 ⑤ 沙箱与场景 token + 网页壁纸 shim + 转码资源 + P-204/P-205 安全闸门 ⑥ 发布完整性自检 ⑦ 音频扫描提速 ⑧ scene 视频索引 ⑨ 真机复刻 A/B（需无头 Firefox）⑩ better-sidebar 适配 ⑪ 单文件 bundle 等价性 ⑫ 样式作用域护栏 + 表面 token 命名空间。

**提交前门禁（秒级 pre-commit）**：

```sh
git config core.hooksPath .githooks    # 装载（只影响本机 clone；git config --unset core.hooksPath 卸载）
git commit --no-verify                 # 单次绕过
MPW_SKIP_PRECOMMIT=1 git commit -m …   # 单次绕过（走脚本内显式口，恒 exit 0）
```

跑 `tools/panel-smoke.mjs` + `tools/switch-wiring-test.mjs`（串行），**不跑** 12 步门禁；暂存区只动了非产物路径时直接跳过；缺 `node`/缺脚本 ⇒ 打印一句就 `exit 0`。细节见 [`docs/PRE-COMMIT.md`](docs/PRE-COMMIT.md)。

---

## 12. 文件结构

```text
dsh-mpkg-wallpaper/
├── package.json      # 版本 + dsh.bundle + dsh.client 声明；files 白名单 = 发布面
├── cordis.patch.yml  # 插件安装声明（dsh plugin add 使用）
├── LICENSE           # MIT
├── THIRD-PARTY.md    # 第三方来历/洁净室记录与许可归属（随包发布）
├── icon.svg
├── README.md / README.en.md
├── lib/
│   ├── index.js            # 宿主端：上传/Range 流式播放、场景提取、音频清单、
│   │                       #   网页壁纸与 shim、web-store、media-audio、设置持久化、
│   │                       #   诊断、更新、ffmpeg、系统媒体会话（MPRIS/SMTC）等路由
│   ├── client.js           # 浏览器端（宿主按 exports["./client"] 单文件下发）：mpkg 解析 + 设置页 +
│   │                       #   背景 DOM + 虚化体系 + 壁纸库 + 时间变化 + 网页设置 + 播放/省电 + NP 挂载
│   │                       #   内含多个**生成区**（勿手改）：MPW-NP-GEN / MPW-AUDIO-BUS / MPW-DIRPICK /
│   │                       #   MPW-DIAG-SUBSYS / MPW-PROPS-MODEL / MPW-THUMB / MPW-WEJSON / MPW-BLOBRETRY
│   ├── audio-bus.js        # 音频总线（由 tools/build-audio-bus.mjs 内联进 client.js 的 MPW-AUDIO-BUS 区）
│   ├── pkg-extract.js      # scene.pkg 静态帧 / 图层合成 / 音轨索引 / 内嵌视频索引（MIT，来自 elysia395）
│   ├── web-wallpaper.js    # 网页壁纸：内容优先类型判定 + WE API shim 源码 + 入口注入 + 跨源策略 + 存储 facade
│   ├── web-interaction.js  # 网页壁纸交互：坐标换算 / 事件整形（含 touch）/ 状态机 / 舞台契约（MIT，自写）
│   ├── media-session.js    # 系统媒体会话宿主侧适配器（MPRIS / SMTC；**已接线**）
│   ├── now-playing.js      # Now playing 组件 + 侧栏挂载控制器（Bencho MIT 逐行移植 + 本仓的锚点/收起/让位判据）
│   ├── now-playing-math.js # Now playing 纯数学（零 DOM）
│   ├── liquid-glass/       # 遗留 WebGL 液态玻璃库（**仓库保留 · 不进发布面**）
│   └── liquid-glass-bundle.js  # 上者的打包产物（**仓库保留 · 不进发布面**）
├── tools/            # 门禁/测试/基准/探针（**不进发布包**）：
│                     #   check.sh（12 步门禁）、pre-commit.sh、integrity-check.mjs、secret-scan-test.mjs、
│                     #   panel-smoke.mjs、switch-wiring-test.mjs、style-scope-guard.mjs、
│                     #   token-namespace-test.mjs、now-playing-test.mjs、np-media-test.mjs、
│                     #   media-session-test.mjs / media-session-wiring-test.mjs、
│                     #   web-wallpaper-test.mjs、web-interaction-test.mjs、
│                     #   build-now-playing.mjs / build-audio-bus.mjs / build-bundle.mjs（生成器与漂移门禁）、
│                     #   bundle-equivalence-test.mjs、gate-cache.mjs、真机探针（需 :3080 + headless Firefox）
├── docs/             # 研发笔记（**不进发布包**）：WEB-WALLPAPER.md / NOW-PLAYING-DSH.md / MEDIA-SESSION.md /
│                     #   DIAGNOSTICS.md / RELEASE.md / WALLPAPER-LIFECYCLE.md / SECURITY-ROUTES.md /
│                     #   STYLE-SCOPE-GUARD.md / TOKEN-NAMESPACE.md / PRE-COMMIT.md / HEADER-FROST.md /
│                     #   TIMELINE-RAIL-TOKEN.md / TRANSCODE-*.md / DIR-PICKER-SCROLL.md / GATE-PERFORMANCE.md
└── dist/             # 构建产物（**不入库、不进包**）：dsh-mpkg-wallpaper.bundle.mjs（方式四用，现生成）
```

> 排除规则：`lib/liquid-glass/**`、`lib/liquid-glass-bundle.js`、`lib/**/*.bak*` 由 `files` 负向模式排除；`tools/`、`docs/`、`dist/`、`package-lock.json` 不在 `files` 白名单里。`tools/integrity-check.mjs` 对"不在发布面"和"仓库内不能少"做**双向**机器断言。
> `lib/now-playing.js` / `lib/now-playing-math.js` / `lib/audio-bus.js` 是**源 + 生成内联**形态：宿主把 `exports["./client"]` 指向的那**一个文件**整体下发，`lib/client.js` 里出现任何相对 `import/require` 线上就会模块解析失败 —— 判据是 `tools/integrity-check.mjs`。代价是必须有漂移门禁，所以生成器与产物对拍常驻在门禁第 2 步与第 11 步。

---

## 13. 许可与归属

- **本包许可：MIT**（`LICENSE`；`package.json` 的 `license` 字段 = `"MIT"`）。第三方来历、洁净室记录、逐项归属与"抄了什么/为什么抄/哪些不是抄的"全部登记在 **`THIRD-PARTY.md`**（**随包发布**，是 MIT 署名义务的载体）。
- **唯一 vendored 的第三方代码**是 `lib/liquid-glass/**`（液态玻璃渲染器库）：**自 P-127 起移出发布面**（`files` 负向模式），**仓库内一个不少**，仍如实登记全部 sha256（`THIRD-PARTY.md` §1.3）。宿主的 `/api/mpkg-wallpaper/lg/*` 托管路由仍是活路径（命中时真的读 `lib/liquid-glass/<file>`），从 npm 安装的副本上按设计返回 404。
- **Now playing 组件**：Bencho 的 "Now playing"（MIT）**逐行移植**（注释原文保留）；侧栏挂载控制器、自绘图标、token 映射与门禁为本仓自写（`THIRD-PARTY.md` §6）。
- **网页壁纸**：`lib/web-wallpaper.js` 的 API 名单与语义**参考** `oneincase/webwallgl`（MIT），**未 vendored**；其中 `hasBlockingCsp` 一处**照抄**（逐行出处见 `THIRD-PARTY.md` §5）。差异清单见 `docs/WEB-WALLPAPER.md` §10。
- **场景提取**：`lib/pkg-extract.js` 采用自 [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（MIT，文件头署名）；音频索引段已依 `docs/AUDIO-TRACK-SPEC.md` 洁净室重写。
- **GPL 边界（永不进插件）**：`MIT 插件 → GPL 渲染器 ✅`；`GPL 渲染器 → MIT 插件 ❌`（本包只出不进）。本包**不得** import / 内嵌渲染器（GPL-3.0-or-later）的任何代码，与渲染器的交互只走进程/HTTP 协议。**若将来引入任何其它第三方代码（含 GPL-3.0 的渲染器侧代码），不得进入本 MIT 包**。机器判据：`tools/web-wallpaper-test.mjs` F1（注释剥离后 grep：无 GPL 派生标识符、无 GPL 许可文本）。
- 参考项目：[dsh-bg-image](https://github.com/lyh9712/dsh-bg-image)（MIT，模板）、[unmpkg](https://github.com/aqnya/unmpkg)（GPL-3.0，仅参考 mpkg 二进制格式）、[repkg](https://github.com/notscuffed/repkg)（MIT，仅研究 .tex 格式）。
- 致谢：[Bil812](https://github.com/Bil812)（[PR #2](https://github.com/XHR666/dsh-mpkg-wallpaper/pull/2) 的取色/自适应文字色/统一遮罩构想 → 已吸收为 Aqua 实验模式，全部可开关、默认关）、[elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（场景提取器与"设置持久化到宿主端文件""Edge canvas 兼容渲染"思路）、[oneincase/webwallgl](https://github.com/oneincase/webwallgl)（网页壁纸沙箱 + WE API shim 的 API 名单与语义参考）、[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 社区（收录与推广）。

> **命名说明**：本插件对接的渲染器产品名为 **WEwebLoader**（渲染器仓的 npm 包名与仓库名保持不变，见该仓 README）。

---

## 14. 反馈 Bug

反馈问题时附上这些材料，一轮就能定位：

- **原始 .mpkg 或 workshop 文件夹**（复现问题所必需）
- 一次「一键诊断上报」的结果（设置页「其他」→ 一键诊断上报；宿主不可用时会自动下载 JSON）
- 浏览器控制台输出（F12 → Console），如有
- 你的 DSH 版本与平台（Windows / Linux / 移动端）

> 更长的设计取舍、根因复盘与逐轮读数在工作区的研发笔记里（`docs/`，**不进发布包**）：样式作用域护栏 `docs/STYLE-SCOPE-GUARD.md`、
  表面 token 命名空间 `docs/TOKEN-NAMESPACE.md`、标题栏磨砂 `docs/HEADER-FROST.md`、右侧时间线条 `docs/TIMELINE-RAIL-TOKEN.md`、
  转码资源与生命周期 `docs/TRANSCODE-RESOURCE.md` / `docs/TRANSCODE-LIFECYCLE.md`、选择器行为契约 `docs/DIR-PICKER-SCROLL.md`、
  发布记录 `docs/RELEASE.md`。

---

## 15. 许可证（双许可）

本包包含**两个独立许可**的部分：

| 部分 | 许可 | 全文 |
|---|---|---|
| 插件本体 `lib/**`（以及图标、README、THIRD-PARTY.md 等） | **MIT** | [`LICENSES/MIT.txt`](LICENSES/MIT.txt) |
| 内置渲染器组件 `renderer/**`（Wallpaper Engine 浏览器渲染器，随包分发、在沙箱 iframe 内运行） | **GPL-3.0-or-later** | [`renderer/LICENSE`](renderer/LICENSE) |

- 渲染器的第三方组件台账见 [`renderer/THIRD-PARTY.md`](renderer/THIRD-PARTY.md)；
- 渲染器与插件的集成边界（**只有 iframe + postMessage 通信，无代码互相复制**）见 [`renderer/PROVENANCE.md`](renderer/PROVENANCE.md)；
- 根 [`LICENSE`](LICENSE) 是上述双许可的说明页；`package.json` 的 `license` 字段为 `SEE LICENSE IN LICENSE`。

再分发提示：`lib/**` 部分按 MIT 履行义务；`renderer/**` 部分按 GPL-3.0-or-later 履行义务（本包已随附其完整源码、许可全文与第三方声明）。

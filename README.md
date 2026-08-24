# dsh-mpkg-wallpaper — DSH 壁纸引擎背景插件

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](README.md) | [English](README.en.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 界面（dsh web）添加背景壁纸的插件：**Wallpaper Engine `.mpkg` 解析、Steam 创意工坊原始目录、视频/网页/图片壁纸、时间变化壁纸的多时段切换、整屏虚化体系、主题色与玻璃外观、本地壁纸库、定时轮换、一键更新**。几乎每一个外观细节都可以调节。

> **一句话版本**：视频/图片/网页壁纸直接播放；**时间变化壁纸（Time Variation）支持多时段自动切换 + 手动锁定时段**；**带设置项的部分网页壁纸（如 Live2D 立绘类，含分辨率/语言/音量）已接入插件设置页，可在「可调参数」折叠区直接修改**；**视频/网页壁纸支持一键暂停播放（调无关设置不重播）+ 省电三档（隐藏/失焦/电池）**；场景（Scene）壁纸提供静态帧提取 + 图层合成两个折中方案。

## 核心能力

**📦 壁纸来源（全部支持）**
- **Wallpaper Engine `.mpkg`**：浏览器内直接解析容器（不上传第三方）；视频类自动播放内嵌 mp4 / 视频纹理；场景类解析容器提取素材；**多时段自动切换**（按系统时间选时段素材）
- **Steam 创意工坊原始目录**：自动发现 WE 安装（读注册表 + libraryfolders.vdf，支持非默认盘），列出 `video / web / scene` 三种类型；也可直接把 **workshop 主目录**（`steamapps/workshop/content/431960`）设为自定义目录——每个子文件夹自动识别为一张壁纸
- **视频壁纸**：`.mp4` 直接播放（自定义目录 / Steam 库 / 本地文件均可）
- **网页壁纸**：HTML 壁纸在沙箱 iframe 中加载（实验性，带**风险预检**：自动标注「⚠重动画」「🌐外网」，见[网页壁纸](#网页壁纸web实验性)）
- **图片 / GIF / URL**：本地图片（png/jpg/webp/gif）或图片链接（含 data:image）直接作背景

**⏰ 时间变化壁纸（Time Variation）**
- 支持 WE 的**时间变化**壁纸（项目里带 `morningtime / daytime / dusktime / nighttime / timevarying` 属性，含多个时段视频纹理）：
  - **自动切换**：按系统时间每 60 秒检查，跨时段自动换到对应素材
  - **手动锁定 / 时段覆盖**：设置页提供「自动 + 清晨 / 白天 / 黄昏 / 夜晚」按钮——点击某个时段即固定为该素材，点击「自动」恢复随时间切换
  - **按需懒加载**：只在当前时段提取视频纹理（单槽峰值约几十 MB），其余时段切换时才读取，**避免一次导入全部时段导致移动端 OOM 崩溃**
  - **不串台**：切换不同时间变化壁纸时清空上一张的时段缓存，避免「点清晨/白天/黄昏却显示上一张壁纸画面」的串台问题
- 适配方式：视频类 mpkg、场景类（scene.pkg 用「mpkg 方式」解析——`scene.pkg` 与 mpkg 是同一 PKG 容器，含内嵌视频纹理的时段可自动切换）

**🌊 整屏虚化（磨砂）体系**
- **统一虚化**：一个条控制整屏壁纸模糊度；侧边栏白雾厚度、聊天区跟随、新会话按钮跟随独立可调
- **界面虚化（各自独立开关+程度）**：对话框（通用居中窗口 + 聊天输入框）、设置面板、下载/确认弹窗、弹层（菜单/下拉/提示）、遮罩（全屏背景）、侧边栏磨砂（弹窗打开时自动摘除）
- **标题栏磨砂 / 侧边栏透出壁纸**：独立控制

**🎨 主题色与玻璃外观（Aqua 实验模式，默认全关）**
- **主题颜色（accent）**：取色盘 + 6 预置，驱动按钮/滑条/选中项/链接/发送键等品牌色（`--dsw-alias-brand-*` 系列 token）
- **统一雾**（全屏遮罩统一雾色，强度独立滑条）、**面板匹配壁纸色**（自动取色 + 强度滑条 + 自定义取色盘）、**自适应文字色 + 蓝色清理**（品牌色统一，带自定义取色盘）、**深底文字可读增强**、**任务列表磨砂**
- 外观 tab 里还有：悬浮卡片等（时钟为运行时兼容项——旧配置仍会显示，但设置页无开关）

**🧩 dsh-better-sidebar 适配（检测到该插件后显示）**
- 已安装 [dsh-better-sidebar](https://github.com/) 时，「外观 / 其他」tab 自动出现**适配分类**：总开关 + 子开关：
  - **悬浮双层修复**（bsFloat）：让悬浮侧边栏的 `_panel` 内层 `pane/tabBar` 背景透明，避免悬浮时出现双重实色矩形
  - **透出程度**（bsReveal + bsRevealAlpha 滑条）：better-sidebar 表面透出壁纸的浓度可调（越高越透）
  - **跟随主题 / Aqua**（bsAlpha / bsAqua）：better-sidebar 面板跟随主题底色 / 跟随统一雾取色
  - **底部面板避让**（bsBottomAvoid）：底部面板实时对齐 DSH 中心列（better-sidebar 自身 ResizeObserver 负责，无需手动偏移）
  - 字体跟随（bsFont）等其余子开关
- 主机端 `/ping` 自动探测 better-sidebar 是否安装；未安装时该分类隐藏

**⏯️ 播放控制与省电**
- **暂停 / 播放按钮**：当前壁纸为视频/网页类时，设置页「壁纸设置」下方出现**暂停/播放**按钮（点击停住画面，再点恢复）。暂停状态**实时同步**（按钮反映视频实际播放状态）；**调整无关设置（静音/亮度/模糊等）不会触发重播**——已修复「video.src 用绝对 URL 判等恒不等 → 每次应用设置都重载媒体源」的根因。
- **省电（遮挡暂停三档）**：「其他」tab 提供三档独立开关：
  - **页面隐藏时暂停**（`visibilitychange`）
  - **窗口失焦时暂停**（`blur/focus`）
  - **电池供电时暂停**（`getBattery`，API 不存在则静默跳过）
  - 任一档触发即暂停壁纸、全部恢复才继续；省电暂停与用户手动暂停互不干扰（都尊重同一套门控）

**🧊 液态玻璃（CSS 实验，第 8 个 tab，默认全关）**
- 基于 CSS `backdrop-filter` 的半透明 + 模糊 + 边缘高光（**不再是 WebGL 折射版**——WebGL 液态玻璃已在 v3.6.0 移除，见下）。分四个开关：
  - **lgTest（测试模式）**：只保留壁纸 + 悬浮 + 布局，不覆盖任何 DSH token（否则背景读半透明会让聊天框透明无模糊）
  - **lgComposer / lgSidebar / lgHeader**：分别给聊天气泡区、侧边栏、标题栏加液态玻璃叠加层（侧边栏因设置弹窗渲染层级限制，只能做半透明 + 边缘高光，**不能加 backdrop-filter**，否则会把设置弹窗压缩进侧边栏——历史踩坑）
- **历史说明**：早期版本用的是 WebGL 真折射（`lib/liquid-glass/` 库 + `liquid-glass-bundle.js` 107KB）；因不稳定且体积大，v3.6.0 已删掉 WebGL 运行时，改用纯 CSS 版。`lib/liquid-glass/*.js`、`liquid-glass-bundle.js`、`tools/liquid-demo/` 等**仍留在包里但无运行时引用**，属遗留死文件（后续可清）。

**🎬 镜头与画面**
- 镜头缩放（10–2000%）与平移、画面亮度（50–150%）、轻度锐化、Deep diving 背景框

**🎛️ 壁纸设置（tab）**
- **当前壁纸直接相关**的都集中在这里：静音（网页壁纸）、镜像翻转（水平/垂直）、视频倍速（0.5–2x）、可调参数（mpkg 只读 / 网页壁纸可改）、**解码帧率上限**（24/30/48/60，ffmpeg 抽帧）、**分辨率上限**（720p/1080p/2K，ffmpeg 缩放降占用）、ffmpeg 状态与下载/卸载

**🚀 大文件混合模式（hybrid，默认开）**
- mpkg 流式上传到 DSH 宿主 → 磁盘存储 → HTTP Range 流式播放，**>600MB 大文件也支持**，内存占用极低

**🖼️ 本地壁纸库**
- **Steam 自动发现** + **自定义目录**（任意文件夹 + 跨平台目录选择器；mpkg 文件与 workshop 文件夹混合放置都能识别；图片/视频/`scene.pkg`/`.mov` 均可）
- **WE 原生播放列表导入**：Steam 扫描时自动解析 Wallpaper Engine 的 `config.json`（`general.playlists`）为**轮播列表**，项映射到本插件的 `steam|`/`custom|` key
- **壁纸切换与轮换**：上一个/下一个一键切换、定时自动轮换（间隔可调）；轮换列表勾选后滚动保持不跳顶，未命名列表自动加序号（`未命名列表 N`）不重名

**🛡️ 安全与共存**
- **冲突检测**：检测到其他壁纸/主题插件自动关闭本功能
- **安全边界**：.exe/application 壁纸完全排除（防病毒注入）；自定义目录只读媒体文件；宿主路由有路径穿越校验；网页壁纸 iframe 沙箱隔离

**🔄 更新**
- 「检查更新」按**版本号**对比（semver），本地未推送改动不误报；**推荐先到插件市场更新**（semver 检测与市场一致）；「一键更新」从 GitHub 拉最新代码写回，重启生效

**💾 备份与恢复 / 设置持久化**
- 「其他」tab 提供**备份与恢复**：导出外观类设置（外观 / 统一虚化 / 界面虚化 / Aqua / 其他）为**可分享的 JSON 文件**，导入即还原——不含当前壁纸与扫描目录
- **设置持久化到宿主端文件**：设置除浏览器 localStorage 外加存 `~/.dsh-mpkg-wallpaper/settings.json`，**换端口 / 清浏览器数据不丢失**（参考 elysia395 v0.4.0 的做法）

## ⚡ 性能与稳定性

- **mpkg 只读头部**（不再整文件载入）：容器解析只读前 2MB 头（openSync+readSync），834MB 大 mpkg 冷启动也接近秒开——修掉了早期「读整个文件再切片」造成的 9 秒加载
- **重启自愈**：自定义目录壁纸重启后按**文件名 token** 自动匹配重建（media 404 重试耗尽后按 mpkgKey 重新解析），重启后壁纸不再空白
- **防重入锁**：`applyFromStorage` 与 Aqua 主题监听均带防重入标志 + 去抖，杜绝「overrideTokens → theme/change → 重入」死循环（深色 + 统一雾场景曾实测卡死主线程）
- **场景缓存按体积限流**：图层缓存 128MB 字节预算 + 条数上限双兜底；场景 pkg 只在缓存未命中时读整文件（stat 优先）
- **监听/定时器只注册一次**：storage 监听、60s 时段检查、内联样式 watcher 等均去重，反复 apply/RTC 重连不累积
- **懒加载防 OOM**：时间变化壁纸只提取当前时段；hybrid 大文件流式播放内存占用极低
- **弱设备降级**：对高负载合成（全屏 backdrop-filter + 流媒体视频叠加）做了整体节流优化；不同 WebView 的极端组合问题仍建议用 Edge / 桌面浏览器获得最佳体验

**🌐 浏览器兼容性（实测参考）**
| 浏览器 | 推荐度 | 表现与注意 |
|---|---|---|
| Chrome / Chromium（桌面） | ⭐⭐⭐ 强 | 功能最完整：`backdrop-filter` 与 `color-mix` 实现最佳、`iframe.muted` 生效、muted 自动播放放行 |
| Edge（桌面） | ⭐⭐⭐ 强 | 视频壁纸走**独立 canvas 渲染路径**（规避 Edge 悬浮工具栏）；暂停/恢复/重播均已修复（CSS 首帧 + src 判等）。个别版本仅有首帧静态（非空白/崩溃） |
| Firefox | ⭐⭐ 中 | 功能全支持（backdrop-filter 103+、编码不支持自动转码兜底）；三点减分：backdrop-filter 性能弱于 Chromium（多模糊同开低端机掉帧）、`iframe.muted` 不支持（**有声 web 壁纸首次可能被自动播放策略拦截停首帧**，错误被 iframe 隔离不影响主界面）、`color-mix` 需 113+（旧版仅外观回退） |
| Android WebView / 移动端 | ⭐⭐ 中偏弱 | autoplay 政策取决于宿主 App 的 WebView 配置（muted 通常放行但 Firefox 系/部分 WebView 会拦截，此时视频停首帧）；`getBattery` 可能缺失（有守卫跳过）；极端组合建议用静态图/GIF 或关 blur |

> 注：源码已为各浏览器做了降级（无 `requestVideoFrameCallback` 时回退 rAF、`ResizeObserver`/`getBattery` 有守卫、全部 `play()` 带 `.catch`、`backdrop-filter` 用 `CSS.supports` 检测并降级为不透明）。**未发现会导致整页白屏/卡死/崩溃的浏览器高濒点**。Firefox 的「有声 web 壁纸自动播放被拦截」是唯一待实测的中等项，建议首选 Chrome/Edge 获得完整体验。

## 支持类型与现状

| 类型 | Web 端表现 | 说明 |
|---|---|---|
| **mpkg（视频类）** | ✅ 完整 | 内嵌 mp4 / 视频纹理直接播放 |
| **mpkg（场景类）** | 🟡 折中 | 静态帧提取 / 图层合成 / 预览动图（见下）；**含视频纹理时段的可自动切换** |
| **时间变化壁纸** | ✅ 完整 | 多时段自动切换 + 手动锁定，懒加载防 OOM |
| **视频（mp4/webm）** | ✅ 完整 | 直接播放 |
| **网页（HTML）** | 🟡 实验性 | iframe 沙箱加载；**带设置项的部分网页壁纸已接入插件可改（下）**；**带可交互功能的暂未适配** |
| **场景原始目录（scene.pkg）** | 🟡 折中 | 同 mpkg 场景类 |
| **Application（exe）** | ❌ 排除 | 安全考虑，绝不读取/执行 |

## 可调参数与网页壁纸的设置接入

- **mpkg 壁纸**：项目自带的**可调参数**在「可调参数」折叠区**只读展示**（浏览器显示的是预渲染素材，修改需在壁纸引擎 App 中生效），供对照。
- **网页壁纸（部分已接入，Live2D 立绘类）**：部分网页壁纸（Live2D 立绘，通常含 `loadJson.json` 的 `SettingModel`）自带设置项，现在**已经接入插件设置页**——在**同一个「可调参数」折叠区**里可直接修改：
  - **分辨率 2k / 4k / 8k**（重载生效）
  - **语言**（按壁纸实际提供：中文 / 日本語 / English / Tiếng Việt / Русский 等）
  - **背景音乐与语音音量**（实时生效，不重载）
  - **显示触摸区域框 / 文本框**等开关
  - 修改写入壁纸 iframe 的同源 localStorage（key = 骨架名），改完重载该壁纸生效
- **隐藏壁纸自带设置面板**：这类网页壁纸在壁纸表面右上角自带「设置」按钮 + 面板，且无法交互——插件在 iframe 加载后**自动隐藏**它（防挡住画面），设置通过插件页操作。
- **部分带可交互功能的壁纸暂未适配**：依赖外网 SDK / 特殊交互逻辑的网页壁纸（如部分米哈游事件页、需要登录或点击交互的壁纸），其内置设置项尚未接入，仍按原样加载——这类壁纸可正常显示，但**插件内的可调参数不可用**。

> 这类可改网页壁纸的按钮（分辨率/语言/音量等）只在识别到对应壁纸的 `loadJson.json` 后出现；普通图片/视频/无设置项的网页壁纸不显示。

## 场景壁纸（Scene）适配现状

**结论先说：WE 场景壁纸无法在 Web 端完整还原，这是引擎层面的限制，不是插件偷懒。** 原因：场景由专有引擎渲染——Live2D 式**木偶骨架（.mdl 二进制）**、**shader 特效**（水波/粒子）、**脚本**（音乐播放器 UI 等）。浏览器没有官方渲染器，格式也未公开（RePKG 只逆向过 PKG/TEX，MDL 骨架无公开文档；开源方案 [we-layerd](https://github.com/Aromatic05/we-layerd) 打包了官方渲染器但仅限 Linux Wayland 桌面）。

插件为此提供了两个**折中方案**（按场景内容自动选择）：

1. **静态帧提取**：解析 `scene.pkg`（PKG 容器 + LZ4 解压 + TEX 纹理解码），从场景图选取主纹理输出**高清静态图**（摄影/插画类场景可达原图画质，实测 7680×4320）
2. **图层合成**：解析 `scene.json` 的全部 image 图层（背景 + 主体 + 分层角色部件），按源文件坐标/尺寸在 canvas 上**精确合成完整画面**（平铺图层类场景可完整还原构图；时间变化场景按当前时段选帧）
3. **时间变化的 mpkg 方式**：`scene.pkg` 与 mpkg 是同一 PKG 容器，含内嵌视频纹理的时段可**按 mpkg 方式解析** → 多时段自动切换（同上述时间变化壁纸）

**无法覆盖的**：MDL 木偶人物（人物的身体由骨架拼装，纹理层几乎为空）、shader 波浪/粒子特效、脚本交互。这些场景回退**官方预览动图**（preview.gif，作者生成的动画预览）。

> 如果你需要场景壁纸的完整动态效果，现实路径：外部渲染成视频 → 用本插件的**视频壁纸**功能（Windows 用 WE 官方版录屏、Linux 用 we-layerd 录屏、移动端用壁纸引擎 App 录屏）。

## 网页壁纸（Web，实验性）

- HTML 壁纸在**沙箱 iframe** 中全屏加载（`allow-scripts` 隔离；有静音开关，默认开）；**webUrl 持久化**——刷新 / 路由切换 / RTC 重连后自动恢复，不会丢配置（卡住时手动刷新页面即可恢复）
- **风险预检**：扫描时自动分类，列表与确认框标注：
  - **⚠重动画**：Spine/L2D 骨骼动画壁纸，低性能设备可能卡住界面
  - **🌐外网**：依赖外网 SDK/CDN（如米哈游事件页），加载可能失败
- 实测：webm 视频类网页壁纸（轻量）正常；Spine 骨骼动画类视设备性能而定；**带 `loadJson.json` 设置项的 Live2D 立绘类已接入插件可改**（见上文）

## 设置分组（顶部 Tab，共 8 个）

- **背景来源**：总开关、hybrid、mpkg 文件、图片/视频文件、自定义目录（可指 workshop 主目录）、本地壁纸库（Steam 扫描）、壁纸切换/轮换、**时间变化壁纸的时段锁定**
- **壁纸设置**：静音、镜像翻转（水平/垂直）、视频倍速、可调参数（mpkg 只读 / 网页壁纸可改）、解码帧率上限、分辨率上限、ffmpeg 状态
- **外观**：主题颜色、悬浮、磨砂模糊、镜头缩放/位置、亮度、**透出壁纸**（侧边栏/标题栏透出、标题栏磨砂程度、锐化）
- **统一虚化**：整屏虚化 + 侧边栏/标题栏白雾、聊天区跟随、新会话跟随
- **界面虚化**：对话框/设置面板/弹窗/弹层/遮罩/侧边栏磨砂各自独立
- **Aqua**：统一雾/面板取色/自适应文字等实验开关
- **液态玻璃**：lgTest / lgComposer / lgSidebar / lgHeader（CSS 版；附独立演示页，见上方「液态玻璃」小节）
- **其他**：省电三档（隐藏/失焦/电池）、新样式/锐化/圆角兼容、更新检查/热更新、**备份与恢复**、恢复所有默认设置、前往反馈；安装 better-sidebar 时此处出现**适配分类**（时钟为运行时兼容项，无设置开关）

## 安装

插件已发布到 npm（`dsh-mpkg-wallpaper`）。任选一种：

### 方式一：dsh plugin add（推荐，市场可识别）

```bash
dsh plugin --profile web add dsh-mpkg-wallpaper
# 重启 dsh web 后浏览器 Ctrl+F5 生效
```

### 方式二：pnpm 手动安装

```bash
pnpm --dir $DSH_HOME/profiles/<profile> add dsh-mpkg-wallpaper
# 重启 dsh web，浏览器 Ctrl+F5 生效
```

### 方式三：GitHub 克隆（开发者 / 离线）

```bash
git clone https://github.com/XHR666/dsh-mpkg-wallpaper.git $DSH_HOME/profiles/node_modules/dsh-mpkg-wallpaper
# 然后在 profile 的 cordis.patch.yml 注册：
#   - insert:
#       - id: dsh-mpkg-wallpaper
#         name: dsh-mpkg-wallpaper
# 重启后生效
```

> 注：方式三不写入依赖表，市场不显示「已安装」（仅影响显示，不影响功能）。

卸载：`dsh plugin --profile web remove dsh-mpkg-wallpaper`。

## 限制

- **场景壁纸无法完整动态还原**（见[场景壁纸适配现状](#场景壁纸scene适配现状)）；mpkg 可调参数为只读展示，修改需在壁纸引擎 App 中生效
- **网页壁纸为实验性**：重动画/外网依赖可能卡顿或加载失败（有预检标注与刷新恢复机制）；**自带设置项的部分网页壁纸已接入插件可改，带可交互功能的壁纸暂未适配**
- **超大素材**（纯浏览器模式）：独立视频 >600MB、视频纹理 >250MB、图片 >200MB 无法处理；**hybrid 模式**无此限制
- 场景静态帧/图层合成的**首次提取耗时**（几秒，8K 纹理更久）；之后走缓存秒开

<!-- ## 截图演示

<!-- ![侧边栏收起 · 新会话界面](screenshots/dhsw1.jpg) -->

<!-- *动态壁纸铺满整个界面。此状态下侧边栏收起，聊天框位于屏幕中央并带有磨砂模糊效果；侧边栏呈全透明状态，壁纸完整透出，画面干净通透。* -->

<!-- ![侧边栏展开](screenshots/dshw2.jpg) -->

<!-- *通过「面板不透明度」与「统一虚化」滑条调节后的效果（图为调节后）：大部分界面区域的不透明度均可调节，侧边栏半透明，壁纸在后方隐约透出。* -->

<!-- ![设置页](screenshots/dshw3.jpg) -->

<!-- *壁纸引擎背景的设置界面。截图之外，外观几乎全部可调：统一虚化（独立分组）、界面虚化（对话框/设置面板/弹窗/弹层/遮罩/侧边栏磨砂）、镜头缩放与平移、壁纸翻转、主题颜色、侧边栏/标题栏透出壁纸、标题栏磨砂程度、轻度锐化，以及场景壁纸的图层合成与时间帧切换。* -->

<!-- 截图中的壁纸来自 B 站 UP 主【-夜莺Night】的壁纸作品：[作者主页](https://b23.tv/86CyaFw) -->

-->
## 反馈 Bug

反馈问题时请附带：
- **原始 .mpkg 或 workshop 文件夹**（复现问题所必需）
- 浏览器控制台输出（F12 → Console），如有
- 你的 DSH 版本与平台（Windows / Linux / 移动端）

## 安全说明

- **默认无被动对外网络请求**：插件后台**不主动**访问任何外部网络；日常壁纸播放仅与**本机 DSH 宿主**（127.0.0.1）HTTP 通信。唯一的例外是**用户显式触发的功能**：检查更新 / 一键更新访问 GitHub（`raw.githubusercontent.com`、`api.github.com`）、下载 ffmpeg 访问 GitHub Releases / npm 二进制镜像（`registry.npmmirror.com`）——均在用户点按后发起，不自动发生。此外用户手动输入的网络图片 URL、网页壁纸自身加载的资源也属外部访问。
- **无敏感内容**：源码不含路径、密钥、令牌、个人信息
- **开源依赖**：仅 DSH 自带 react + 官方 slots/locale 接口；scene.pkg 提取器采用 [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（MIT，文件头已署名）
- 参考项目：[dsh-bg-image](https://github.com/lyh9712/dsh-bg-image)（MIT，模板）、[unmpkg](https://github.com/aqnya/unmpkg)（GPL-3.0，仅参考 mpkg 二进制格式）、[repkg](https://github.com/notscuffed/repkg)（GPL，仅研究 .tex 格式）
- 数据边界：所有解析在本机完成；localStorage 只存背景与参数；设置另存宿主端 `~/.dsh-mpkg-wallpaper/settings.json`

## 文件结构

```
dsh-mpkg-wallpaper/
├── package.json      # dsh.bundle + dsh.client 声明
├── cordis.patch.yml  # 插件安装声明（dsh plugin add 使用）
├── LICENSE           # MIT 许可证
├── lib/
│   ├── index.js      # 宿主端：上传/流式播放 + Steam 发现 + 自定义目录 + 场景提取路由 + 设置持久化
│   ├── client.js     # 浏览器端：mpkg 解析 + 设置页 + 背景 DOM + 虚化体系 + 壁纸库 + 时间变化/网页设置 + 播放控制/省电
│   ├── pkg-extract.js# scene.pkg 静态帧/图层提取（PKG+LZ4+TEX，MIT，来自 elysia395）
│   ├── liquid-glass/ # 液态玻璃 WebGL 库（**遗留，无运行时引用**，v3.6.0 已改 CSS 版）
│   └── liquid-glass-bundle.js # 液态玻璃打包产物（107KB，**无引用死文件**，随包冗余）
├── tools/            # mpkg/tex/mdl 逆向解析 + lg 构建/内联脚本 + liquid-demo 演示页（供开发者）
├── screenshots/      # 效果截图
├── README.md         # 本文件（中文）
└── README.en.md      # 英文说明
```
> 注：`lib/liquid-glass/`、`lib/liquid-glass-bundle.js` 因 `files: ["lib"]` 仍会打进 npm 包，但**客户端不再引用**（WebGL 已在 v3.6.0 移除，改用 CSS 版）。

## 致谢

- [Bil812](https://github.com/Bil812) — 在 [PR #2](https://github.com/XHR666/dsh-mpkg-wallpaper/pull/2) 提出壁纸取色、自适应文字色、全屏统一遮罩等方案并维护 fork；其中思路已吸收为「Aqua 实验」模式（可开关，默认关）
- [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) — scene.pkg 静态帧提取器（MIT），本插件 `lib/pkg-extract.js` 采用自该项目；其「设置持久化到宿主端文件」「Edge canvas 兼容渲染」思路也已借鉴
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 社区 — 收录与推广

## 渲染可行性研究

- 完整场景（含 Live2D 木偶）只能由专有渲染器完成：壁纸引擎 App 的原生库（内嵌 Chromium + 专有 puppet 渲染）；开源方案 [we-layerd](https://github.com/Aromatic05/we-layerd)（Rust）打包了官方渲染器，但**仅限 Linux Wayland** 桌面
- 浏览器端没有成熟的 WE 场景渲染器（pixeltris/wallpaper-engine-web 已消失）——**与操作系统无关，任何浏览器都无法直接渲染 Live2D 场景**；官方渲染器 .so 为闭源二进制，无源码无法编译成 WASM
- 本插件的可行路径：**静态帧提取 + 图层合成 + （时间变化的）mpkg 方式时段切换**（见[场景壁纸适配现状](#场景壁纸scene适配现状)）；需要完整动态时用「外部渲染成视频 → 视频壁纸」方案

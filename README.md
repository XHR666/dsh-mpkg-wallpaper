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
- 已安装 dsh-better-sidebar 时，「其他」tab 自动出现**适配分类**（**只挂在「其他」tab，不在「外观」**）：总开关 + 子开关：
  - **悬浮双层修复**（bsFloat）：悬浮面板 = 14px 圆角外壳（`overflow:hidden` 统一裁掉内层直角/激活胶囊）
    + 内层 `pane/tabBar/terminalWrap` 背景透明（避免「圆角里套直角矩形 / 两层透明度不同」）
    + **零外边距**（面板 left/right 由 better-sidebar 自己的 ResizeObserver 对齐中心列，加 margin 会偏移 8px、
    折叠态还会在底部留 3.6px 残影）+ 把宿主的 resize strip 挪进面板内（原 `top:-4px`，加圆角裁切后会被切掉一半）
  - **透出程度**（bsReveal + bsRevealAlpha 滑条）：better-sidebar 表面透出壁纸的浓度可调（越高越透）
  - **跟随主题 / Aqua**（bsAlpha / bsAqua）：better-sidebar 面板跟随主题底色 / 跟随统一雾取色
  - **底部面板避让**（bsBottomAvoid）：底部面板实时对齐 DSH 中心列（better-sidebar 自身 ResizeObserver 负责，无需手动偏移）
  - 字体跟随（bsFont）等其余子开关
- 主机端 `/ping` 自动探测 better-sidebar 是否安装；未安装时该分类隐藏
- **按版本适配**：host 把已装的 better-sidebar 版本（如 `0.19.1`）一并返回，客户端写
  `body[data-mpw-bs-version]`，版本专属规则用 `[data-mpw-bs-version^="…"]` 门控（例如 0.16+ 的浮窗透出；
  0.19 起浮窗已被上游删除，该规则自然不生效）；面板级规则同时挂 0.19 的稳定属性锚点
  `[data-dsh-bottom-panel]` / `[data-dsh-pane]`，类名哈希再换也不失配。
  **2026-09-17 修掉了两个「看起来在适配、实际没适配」的真因**（`/ping` 版本恒 `null`；版本探测只在
  打开设置页时才跑）——判据、真机证据与复现命令见 [`docs/BETTER-SIDEBAR-COMPAT.md`](docs/BETTER-SIDEBAR-COMPAT.md)，
  0.19.1 的 DOM 契约见 [`docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md`](docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md)。
  回归：`node tools/better-sidebar-compat-test.mjs`（**41 断言**，含「改回旧写法必须变红」的变异用例、
  已装版本的锚点金丝雀，以及底部面板悬浮适配的 13 条几何纪律断言（F 段），已接入 `tools/check.sh` 第 10 步）。
  底部面板悬浮适配的真机 computed 证据：`node tools/bs-bottom-panel-probe.mjs --label before|after`
  → `tools/probe-out/bs-bottom-*.json`（判据与 before/after 数字见 docs/BETTER-SIDEBAR-COMPAT.md §8）。

**⏯️ 播放控制与省电**
- **暂停 / 播放按钮**：当前壁纸为视频/网页类时，设置页「壁纸设置」下方出现**暂停/播放**按钮（点击停住画面，再点恢复）。暂停状态**实时同步**（按钮反映视频实际播放状态）；**调整无关设置（静音/亮度/模糊等）不会触发重播**——已修复「video.src 用绝对 URL 判等恒不等 → 每次应用设置都重载媒体源」的根因。
- **省电（遮挡暂停三档）**：「其他」tab 提供三档独立开关：
  - **页面隐藏时暂停**（`visibilitychange`）
  - **窗口失焦时暂停**（`blur/focus`）
  - **电池供电时暂停**（`getBattery`，API 不存在则静默跳过）
  - 任一档触发即暂停壁纸、全部恢复才继续；省电暂停与用户手动暂停互不干扰（都尊重同一套门控）

**🧊 液态玻璃（⚠️ 实验中，默认全关，建议不要启用）**
> ⚠️ **注意事项**：液态玻璃目前仍是**实验性功能**，效果不定且可能存在布局/性能副作用。**不建议日常启用**——默认全关。如需体验请先备份设置，启用后若出现异常，回到「其他」tab「恢复所有默认设置」即可。
- 基于 CSS `backdrop-filter` 的半透明 + 模糊 + 边缘高光（**不再是 WebGL 折射版**——WebGL 液态玻璃已在 v3.6.0 移除，见下）。分四个开关：
  - **lgTest（测试模式）**：只保留壁纸 + 悬浮 + 布局，不覆盖任何 DSH token（否则背景读半透明会让聊天框透明无模糊）
  - **lgComposer / lgSidebar / lgHeader**：分别给聊天气泡区、侧边栏、标题栏加液态玻璃叠加层（侧边栏因设置弹窗渲染层级限制，只能做半透明 + 边缘高光，**不能加 backdrop-filter**，否则会把设置弹窗压缩进侧边栏——历史踩坑）
- **历史说明**：早期版本用的是 WebGL 真折射（`lib/liquid-glass/` 库 + `liquid-glass-bundle.js` 107KB）；因不稳定且体积大，v3.6.0 已删掉 WebGL 运行时，改用纯 CSS 版。`lib/liquid-glass/*.js`、`liquid-glass-bundle.js` 仍在仓库并**随包发布**（`files: ["lib"]`），但**客户端已无任何引用**；宿主端仍保留 `/api/mpkg-wallpaper/lg` 静态托管路由（当前无调用方）。`tools/liquid-demo/` 只留在仓库、**不进发布包**（`files` 白名单不含 `tools/`）。以上均属遗留死文件（后续可清）。

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
- **音频清单不必等整包（2026-09-15，用户第 1 条反馈）**：`scene.pkg` 的**目录表在文件开头**，
  所以"这个包里有哪几条音频"只读目录表 + 仅候选条目各 16 字节魔数就够（整条音轨字节永不进内存）。
  两个新入口：`/custom-scene-audio?folder=` / `/library-scene-audio?ltoken=` 直接返回
  `{count,tracks:[{path,size,mime,refs}],stats}`（hina 22.5MB 包实测 **2.3ms / 读 107KB**；缓存命中 0.5ms），
  以及 `/raw` 现在支持 **Range/206**（此前永远 200 + 整包 → 渲染器想只取目录表也拿不到）。
  实测（`tools/audio-scan-bench.mjs`，11 个真包 / 每个 3 次取中位数）：整包读 1.7–379ms ⇒ 索引读 1.3–6.9ms（冷）/0.4–0.9ms（热），
  清单与**本仓库规格** `docs/AUDIO-TRACK-SPEC.md` 的参考实现**逐项一致**（11/11 包，含 FLAC/OggS/ID3/ftyp 与 scene.json 层引用）。
  音轨判定/收集段于 2026-09-16 按该规格洁净室重写（来历与处置见 `THIRD-PARTY.md`）。
- **场景内嵌视频探测改成"索引先行"（2026-09-15，用户第 1 条反馈 ⑥c）**：`ensureSceneVideo` 原先在**"使用壁纸"的关键路径**上
  `readFileSync` 整包、再把每个 `.tex` 的 mipmap 全部解压（客户端为此给这一步挂了 4s 超时）。现在只读**目录表** +
  仅候选条目的**前缀**（`.tex` 只走头部与首 mipmap 记录、再读载荷前 12 字节判 `ftyp`，mip0 为 LZ4 时只解压第一个 sequence；
  独立视频条目优先且只读那几条；已确认 2 条内嵌即停），任何不确定一律回退整条读。**选择结果、落盘缓存文件名（hash 公式）
  与文件内容 sha256 与改前逐项一致**。实测 11 个真包合计 **2894ms → 532ms（冷）/ 7ms（热）**；"无内嵌视频"的 7 个包
  **1772ms → 18ms**、凯尔希 771ms → 4ms；语料 213 个 `.tex` 的前缀判定零误判。计时台 `tools/scene-video-bench.mjs`，
  门禁 `tools/scene-video-test.mjs`（26 断言）。
  ⚠ **路径归属**：这条改的是 **DSH 插件宿主**路径（`/custom-scene-video-check`）；`:8899` 渲染器顶栏 🔊 音频面板
  **不经过插件**，它的体感改善来自渲染器自身排期（详见 `docs/AUDIO-SCAN-FAST.md` §0）。
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
| **网页（HTML）** | 🟡 实验性 | **沙箱 iframe + 在作者脚本之前注入 WE API shim**（属性/音频/媒体/slideshow 回调可用）；**带设置项的部分网页壁纸已接入插件可改（下）**；**带可交互功能的暂未适配** |
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

- HTML 壁纸在**沙箱 iframe** 中全屏加载；**webUrl 持久化**——刷新 / 路由切换 / RTC 重连后自动恢复，不会丢配置（卡住时手动刷新页面即可恢复）
- **两条加载模式**（确认弹窗里选，模式记在 webUrl 里，刷新后照旧）：
  - **沙箱模式（默认，推荐）**：宿主在入口 HTML 的 `<head>` 最前注入 **WE API shim**（`window.wallpaperPropertyListener`、
    `wallpaperRegisterAudioListener`、`wallpaperRegisterMedia*Listener`、`wallpaperRequestRandomFileForProperty`…），
    因此依赖 WE API 的网页壁纸能真正跑起来；iframe 的 `sandbox` **只要 `allow-scripts`**（不透明源）
    ⇒ 壁纸脚本**无法访问 DSH 界面与本地存储**。代价：父页也读不到帧内 DOM，静音/倍速/暂停改由 shim 在帧内执行。
  - **兼容模式（同源）**：等价于改动前的裸 iframe（`allow-scripts allow-same-origin allow-pointer-lock`）。
    Live2D 类壁纸的「网页壁纸选项」（分辨率/语言/音量，写 iframe 同源 `localStorage`）需要它。
- **属性/媒体接线**：挂载时把壁纸 `project.json` 的 `general.properties` 全量默认值（叠加你在插件里改过的
  `propEdits`）下发给 shim；目录里的媒体文件作为 slideshow 的文件池（`__mpw-list.json`）。
  静音/倍速/暂停经 postMessage 下达到帧内。
- **类型判定按内容，不只看声明**：`project.json` 的 `general.type` 只是线索——
  谎报 `web` 但目录里是 `scene.pkg` 的包按**场景**处理，谎报 `scene`/`video` 但只有 `index.html` 的按**网页**处理
  （四态：web / scene / video / unknown，`application/exe` 一律排除）。
- **风险预检**：扫描时自动分类，列表与确认框标注：
  - **⚠重动画**：Spine/L2D 骨骼动画壁纸，低性能设备可能卡住界面（这类建议用「兼容模式」）
  - **🌐外网**：依赖外网 SDK/CDN（如米哈游事件页），加载可能失败
- **作者脚本报错不会拖垮插件**：帧内 shim 兜住 listener 异常 / 全局 `error` / 未捕获 Promise，
  限流上报父页（`console.warn` + `/diag`），不影响界面与其它功能
- **交互操作（鼠标 / 滚轮 / 键盘）**：壁纸层是背景层（不吃指针），所以交互走**交互模式**——
  点右下角「交互」小按钮（或 URL 加 `?mpwinteract=1`，`full` 档含键盘）后，指针/滚轮/键盘会被送进壁纸内的作者脚本：
  - **两档**：`pointer`（缺省：鼠标移动/点击/滚轮，**不注入键盘**）与 `full`（+ 键盘与文本输入）；
    存储字段 `webInteraction`（`off|pointer|full`；**设置页当前没有对应控件**、也不在导入白名单里，只能用 URL 参数或手工写存档）+ URL `?mpwinteract=off|pointer|full|1` 都认。
  - **一定会退出**：60 秒无操作 / 180 秒总时长 / `Esc` / 右上角「退出交互」/ 切换壁纸 / 窗口失焦，
    六条路径任意一条都会关掉——不会出现"界面被壁纸吃掉、点不动"的情况。
  - **不改沙箱**：交互**不**放宽 `sandbox`（仍只要 `allow-scripts`，不透明源），也不读帧内 DOM；
    键盘注入下 `Ctrl/Cmd+R/W/T/N/Q/L/P`、`F5/F11/F12`、`Backspace`、`Tab` 会被拦下（不会刷掉你的 DSH 页面），
    其余按键一律放行。**CSS `:hover`/`:active` 不会被合成事件点亮**（浏览器 hit-test 机制所限，非 bug）。
  - 细节与安全边界逐条：`docs/WEB-WALLPAPER.md` §11；回归：`node tools/web-interaction-test.mjs`。
- 实测：webm 视频类网页壁纸（轻量）正常；Spine 骨骼动画类视设备性能而定；**带 `loadJson.json` 设置项的 Live2D 立绘类已接入插件可改**（见上文）

> 细节（类型判定表、sandbox 逐项理由、shim API 表与控制协议、交互注入方案与安全边界、文件 URL 改写、
> 错误边界、已知限制、与参考实现的差异清单）：[`docs/WEB-WALLPAPER.md`](docs/WEB-WALLPAPER.md)。
> 回归：`node tools/web-wallpaper-test.mjs` + `node tools/web-interaction-test.mjs`
> （都已并入 `bash tools/check.sh` 第 5 步，全部断言绿）。

## 设置分组（顶部 Tab，共 7 个）

- **背景来源**：总开关、hybrid、mpkg 文件、图片/视频文件、自定义目录（可指 workshop 主目录）、本地壁纸库（Steam 扫描）、壁纸切换/轮换、**时间变化壁纸的时段锁定**
- **壁纸设置**：静音、镜像翻转（水平/垂直）、视频倍速、可调参数（mpkg 只读 / 网页壁纸可改）、解码帧率上限、分辨率上限、ffmpeg 状态
- **外观**：主题颜色、悬浮、磨砂模糊、镜头缩放/位置、亮度、**透出壁纸**（侧边栏/标题栏透出、标题栏磨砂程度、锐化）
- **统一虚化**：整屏虚化 + 侧边栏/标题栏白雾、聊天区跟随、新会话跟随
- **界面虚化**：对话框/设置面板/弹窗/弹层/遮罩/侧边栏磨砂各自独立
- **液态玻璃**：lgTest / lgComposer / lgSidebar / lgHeader（CSS 版，**实验中，建议不启用**；附独立演示页，见上方「液态玻璃」小节）；同 tab 内还有 **Aqua 实验小节**（统一雾/面板取色/自适应文字等）
- **其他**：省电三档（隐藏/失焦/电池）、新样式/锐化/圆角兼容、更新检查/热更新、**备份与恢复**、恢复所有默认设置、前往反馈；安装 better-sidebar 时此处出现**适配分类**（时钟为运行时兼容项，无设置开关）

## P-66 面板健壮性修复（2026-09-15）

> 背景：用户当次报的 9 条界面问题经确认属于 **webwallgl 测试台（:8901）**，与 DSH 插件面板无关；
> 按此口径，本轮**只保留两个与那个界面无关、可独立复现的插件真 bug 修复**，其余界面改动已全部回退
> （回退后 `lib/client.js` 与同步副本逐字节一致）。回归：`node tools/panel-fixes-test.mjs`（已并入 `tools/check.sh` 第 2 步）。

| 真 bug | 根因 | 修法 | 复现/断言 |
| --- | --- | --- | --- |
| **渲染错误边界失效，真因被吞** | `MpkgSectionImpl` 的外层 `catch (err)` 里用 `h(...)`，而 `h` 是**外层 `try` 块内的 `const`**（块作用域不可见）→ 边界自身抛 `h is not defined`，用户看到的是「壁纸引擎设置区渲染异常：h is not defined」，**真实错误信息丢失**（诊断被误导） | 该 catch 内改用 `react.createElement` | `node tools/panel-fixes-test.mjs --client <修复前副本>` → 红（显示 `h is not defined`）；对当前代码 → 绿（显示真实错误 `boom-body`） |
| **zh/en 字典键集合不一致** | `en` 缺 18 个键（`glass.title/desc`、`glassWindow*`、`glass.accent*`、`glass.color*`、`glass.alpha`、`glass.reset`、`flipX/Y*`、`themeColor*`、`rightSidebarBlur.overridden`）→ 英文界面直接显示 **key 原文**；`clock.*` 10 个键只存在于 `en` → 中文界面反而显示英文；另有两处硬编码中文（`"当前状态: "`、`"（已重挂）"`） | 只增不删地把两套字典补到**键集合完全一致**（条数以 `node tools/panel-fixes-test.mjs` 的实跑输出为准，避免每加一个键就过时）；两处硬编码中文改走 `t()`（中文可见文案保持不变） | 同一测试：键集合一致 / 静态 `t("k")` 键两套齐全 / 英文渲染零中文 / 中文渲染零键名残留 |

## 2026-09-16 两个真机 bug 根治（标题栏磨砂 / 右侧时间线条）

| bug | 根因（判据） | 修法 | 回退开关 | 回归 |
| --- | --- | --- | --- | --- |
| **标题栏磨砂"一直没有"** | `syncHeaderFrost()` 第一行调用 `normalizeSection(...)`，而该函数当时定义在**另一个函数的函数体内** ⇒ 每次调用抛 `ReferenceError`，又被函数自己的 `catch {}` 吞掉 ⇒ 磨砂层从未注入、诊断 `reason` 恒为空（真机 diag 实锤 `injected:false` / `reason:""`） | 归一化函数**提升到模块作用域**；异常改为写进 `hdrFrostState.reason`（不再静默）；"真实磨砂元素 + header 半透明底"成对出现，半透明底色走我们自己的 `--mpw-hdr-frost-bg`；`wanted=false` 时**清理**而不是留一个空层（空层会抑制伪元素兜底，反而彻底没磨砂） | `?hdrfrost=legacy`（旧门控）、`?hdrfrost=off`（彻底关）、`?hdrblur=pseudo\|element`（对照） | `node tools/frost-rail-test.mjs` |
| **壁纸模式下右侧时间线（轮次导航条）变透明** | DSH 的 `TurnNavigator rail` 条 = `.eGxaPq_mark::before`，颜色 token 是 `--dsw-alias-border-l4`（`#00000029`/`#fff3`，16%/20% alpha）与 `--dsw-alias-label-*`。插件 ①用 `var(--mpw-aqua-ink, inherit)` 与自引用 fallback 覆盖 `--dsw-alias-label-*`（DSH 把它们定义在 `body`、html 上没有）⇒ body 上成为 **guaranteed-invalid** ⇒ 激活/preview 条 `background` 变 unset = 透明；②裸 `html body { --dsw-specific-sidebar-fill: transparent }` **全局**改宿主 token，并把聊天区表面透明化 ⇒ 16% 淡条画在壁纸上 = 看不见 | token 覆盖**收窄**到白名单容器；aqua/文字色覆盖加 `data-mpw-*` 门控并**去掉 inherit/自引用**；给条补一个按主题计算的、**我们命名空间**的对比色（只作用于白名单 `.eGxaPq_*` 节点，不碰宿主 token、不用 `!important`） | `?railink=off`（关对比补偿）、`?sbfill=wide`（恢复旧的全局侧栏底色覆盖） | `node tools/frost-rail-test.mjs` |

> 细节与诊断字段表：[`docs/HEADER-FROST.md`](docs/HEADER-FROST.md)、[`docs/TIMELINE-RAIL-TOKEN.md`](docs/TIMELINE-RAIL-TOKEN.md)。

## 样式作用域护栏：为什么"这类 bug 不会再复发"（2026-09-17，MASTER-TODO §5 第 2 项）

上面两个 bug 的共同机制是**选择器作用域没人管**：改样式的人在本地看不出"这条规则会命中宿主界面"。
门禁第 12 步把它变成会变红的机器判据（`node tools/style-scope-guard.mjs`）：

* **拿真实产物**：不重写 `buildCss`，用 `tools/_stub.mjs` 在 Node 里跑 `lib/client.js`，调用插件自己暴露的
  `__mpwBuildCss(patch)`，按源码里的 `boolFields`/`numFields` 自动枚举 **600+ 组设置**（当前 613：默认段 /
  每个布尔开关单独开 / 核心 9 开关全 512 组合 / bsCompat 家族 / 数值 0 与 100 / 无壁纸 / lgTest），
  再对生成出来的 CSS 逐条解析（含 `@media`/`@supports`）。
* **判据**：每条规则的选择器必须命中我们自己的标记（`.mpw*` / `[data-mpw*]` / `#mpw-*`），或命中**已登记**的
  宿主/第三方作用域——`bsCompat` 那句故意打第三方 DOM 的 `[data-dsh-better-sidebar] …` 也在其列，
  **必须登记 reason + `docs/*.md:行号` 指针**（指针运行时校验，漂了直接红），不是"默默容忍"。
  裸元素选择器（`button{…}`）、裸 `*`、`:root` 上覆盖宿主 token、宿主 token 被设成 transparent/inherit、
  未登记 token 的 `!important`、未门控碰宿主轮次导航条、`[data-dsh-panel-host]`、顶栏描边透明化 ⇒ **判红**。
* **自证有分辨力**：`node tools/style-scope-guard.mjs --selftest` 把 `lib/client.js` 复制到临时目录注入
  15 条变异（含一条"我们自己的标记必须仍然放行"的阴性对照），逐条断言必须 RED/REVIEW/PASS。
* 判据、允许清单账本与"怎么加一条登记项"：[`docs/STYLE-SCOPE-GUARD.md`](docs/STYLE-SCOPE-GUARD.md)。

## 表面 token 命名空间：顶栏 / 侧栏 / 面板 / 时间线条 读同一套 `--mpw-*`（2026-09-18，MASTER-TODO §5 第 1 项 / P0-3）

需求原文是「四处视觉一致性用**同一套 token 命名空间**（`--mpw-*`），**永不覆盖宿主 token**
⇒ 从结构上消灭"我们弄坏宿主新功能"这类 bug」。第 12 步的第二个判据把它机器化
（`node tools/token-namespace-test.mjs`）：

* **一个来源**：宿主 token 只在 `emitSurfaceTokens()` 里被消费成 `--mpw-surface-*`，产物里唯一那一块
  `body{…}` 是全部表面取值的定义点；四个表面的规则**只写** `var(--mpw-surface-*)`。
* **为什么是 `body` 而不是 `:root`**：DSH 把 `--dsw-static-*` / `--dsw-alias-*` 定义在 **`body`**（`html` 上没有）。
  自定义属性里的 `var()` 在**声明所在元素**上求值 ⇒ 写 `:root` 会变成 guaranteed-invalid 并**继承给所有后代**
  （消费者全部 `unset`=透明）。这正是历史上"右侧时间线条变透明"的同一机制，判据里有专门一条断言 + 变异盯着。
* **宿主 token 覆盖只剩一处**：`buildSidebarFillCss()`（`--dsw-specific-sidebar-fill`，只在侧栏白名单容器、
  只在「侧栏透出」开关对应档位）。登记表（`HOST_OVERRIDE_REGISTRY`）逐条要求 token + 选择器 + 值形态 +
  **生效条件**：产物里 39 处覆盖声明必须全部登记命中，且**功能关闭的组合里一次都不许出现**。
* **等价性证据**：以 `git HEAD` 的 `lib/client.js` 为 before，606 组设置 × 亮/暗 × 默认/门控两态比对四表面
  **生效值**（极小层叠模型 + `var()` 递归代换）⇒ 25 428 个键逐键相等 —— 这是重构，不是重设计。
* 清单（哪枚 token 归哪个表面 / 哪枚宿主 token 被消费 / 登记表与理由 / 已知偏差 / 怎么加新 token）：
  [`docs/TOKEN-NAMESPACE.md`](docs/TOKEN-NAMESPACE.md)。

## 开关接线审计：不许再有"开关能点、没有效果"（2026-09-18）

**真事故**：「配色」(accent) 与「深底文字可读增强」(aquaTextEnhance) 两段 CSS 被一起包在
`if (aquaOn(section))` 里 ⇒ **只开这两个开关时规则根本不生成**：界面上能点、没有任何效果、控制台也不报错
（两段自己的注释都写着"不依赖 Aqua"，与实现矛盾 —— 靠读代码很难发现）。已修，并加了通用判据
`node tools/switch-wiring-test.mjs`（门禁第 2 步）：

* 每个布尔开关都必须在"默认档 / 富上下文 / 其它全开"三个上下文之一里**改变 `buildCss` 产物**；
  只影响运行时的开关必须逐条登记 `reason`（如 `mute`/`rotate`/省电三档/时钟文案…）。
* 非布尔功能（`accent`/`aquaTextEnhance` 设值必须改变产物）；`themeColor` 属"CSS 常驻 + 运行时属性门控"，
  判据改为断言门控规则确实在产物里。
* **已证实失效**的开关进 `KNOWN_DEAD` 并在每次运行时显式列出（双向断言：修好了必须从表里删）。
  本轮据此修掉了第 1 条：**`lgCss`（纯 CSS/SVG 液态玻璃）整块从未执行** —— 块内引用 `bdSupported`，
  而该 const 声明在它之后 ⇒ 同一函数作用域 TDZ `ReferenceError`，被外层
  `catch { /* 液态玻璃失败不得影响其它样式 */ }` 吞掉（catch 原样保留，现在只在真的失败时才起作用）。
  判据是**双向**的：`lgCss:true` 必须产出液态玻璃块（`mix-blend-mode: screen` + `url(#mpw-lg-warp)`）、
  `lgCss:false` 必须没有、两档不许逐字节相同；变异（把声明挪回块后复现 TDZ）必须让这三条全红。
  第 2 条也修了：**`sessionFollow`（新会话按钮跟随面板不透明度）**——设置页有开关 + 文案，但全仓无人读
  `section.sessionFollow`；按**用户可见文案**实现（开 = 跟随那条透明度，关 = **回到宿主原色**），默认档不变，
  判据在 `tools/switch-wiring-test.mjs` 的 A4 段（默认档 + 统一虚化档各 3 条双向断言；变异「把读取删掉」必红）。
  第 3 条 `glassWindow` 仍登记未改（只有文案没有实现），详见
  [`docs/TOKEN-NAMESPACE.md`](docs/TOKEN-NAMESPACE.md) §3b。
  另外：液态玻璃首次真正启用后加了 **`?lgcss=off` 一键回退**（已登记进渲染器仓诊断主表，
  `node tests/diag-flag-check.mjs` 报 149==149）。
* 分辨力自证：把 `accent` / `aquaTextEnhance` 的门控改回被 `aquaOn` 包住 ⇒ 必须变红（两条变异）。

## 视频壁纸转码：判定是"误判" + 资源上限（2026-09-17，第 1 条）

> 用户原话：「我现在并没有使用视频转码，我用的是 **video 类的 mpkg**，然后**解码帧率无上限**，
> **分辨率也是原始分辨率**，什么都没调。你看一下这是不是 bug.」
> 实测：`ffmpeg -threads 1 -filter_threads 1 … -i ~/.dsh-mpkg-wallpaper/transcodes/src_1789….bin`
> **常驻、RSS ≈ 690MB** —— 插件在后台转用户**正在播放**的壁纸。

**判定：这次转码是误判（bug）**。判据：那条 `src_*.bin` 是 `h264 High L5.2 + aac / MP4`
（`ffprobe` 实读，浏览器必可直读），而 `settings.json` 里 `fpsCap=0 / resMax=0`
（用户没开转码）⇒ 触发者是客户端 `video.error`（`code 3/4`）后的**自动降级**
`/transcode?fps=24`——`code 3/4` 只表示"这一帧解不出来"，**不等于"浏览器不支持该编码"**。

**修法**：新增**可播性闸门**（`/probe` 只读元数据、不起 ffmpeg；判据表 = 编码/容器白名单 +
MP4 里 h264+opus、HEVC Main10 这类确定性缺口；探测不出来一律不改行为）——
可直读就**直读原片**，只有真吃不下才转码。顺带修掉三个真 bug：旧 `direct-spec` 直读判据
**不看编码**（HEVC 会被直读→黑屏）、字节上限淘汰**从最新开始删**（刚转好的产物被自己删掉
⇒ 缓存永久 miss）、**取消后仍换编码器重试**（切壁纸时又拉起新 ffmpeg）。
资源上限集中一处：产物 12 个 / **512MB**、并发 **1**、排队 30s、单任务 15min、
**转码默认降采样到 1920 宽**（实测 4K 656MB → 1080p 275MB）、**内存准入 1024MB**
（可用内存不足就拒绝转码而非把整机拖进 swap）、启动清理一次并打日志；
三种状态（直读/转码中/已缓存）写进日志与 `window.__mpwWallpaperState`，不再静默占内存。

> 细节、判据表、内存实测与"实测排除的做法"：[`docs/TRANSCODE-RESOURCE.md`](docs/TRANSCODE-RESOURCE.md)；
> 回退开关 `?mpwtranscode=legacy`（回到旧行为）/ `aggressive`（连用户设的上限也先探测）；
> 回归：`node tools/transcode-limit-test.mjs`（43 断言，已接入 `tools/check.sh` 第 5/12 步）。

## 选择文件夹 / 选择文件：行为契约与快捷键（2026-09-17，第13条）

> 用户原话：「在选择文件夹的这个功能里面，鼠标上下滑动的时候，画面有时候会自动弹跳到最顶上，
> 包括有时候会自动锁定到最顶上……这个 bug 你一直没有修好。」

**根因（判据式，详见 [`docs/DIR-PICKER-SCROLL.md`](docs/DIR-PICKER-SCROLL.md)）**：
旧实现里那段"事后补偿滚动位置"的代码是**死代码**——`dirScrollRef.current` 只被写成
`{anchorIdx, anchorOff}` 而**从不写 `ratio`**，于是 `if (ratio === void 0 || ratio === null) return;`
恒真早退，其后的锚点补偿与按比例恢复**一行都没执行过**；同时容器没有 `overscroll-behavior: contain`
（滚轮到边界会串联给宿主设置面板），且没有任何机制在 React 重建列表节点后把用户的 `scrollTop` 补回来
（新节点天然 `scrollTop = 0`）。三者叠加 = 用户看到的"自动弹跳 / 锁定在最顶"。

**修法（无新增第三方依赖）**：选择器改为**自己持有滚动主权**——容器按路径记忆用户的 `scrollTop`
（滚动事件只写 ref、不 setState），在 `useLayoutEffect` 里**绘制前同步写回**（幂等，永远不与用户滚动打架，
时间窗 hack 全部删除）；滚动容器统一带 `overscroll-behavior: contain` + `overflow-anchor: none`；
行 key 改为"完整路径 + 目录名"（增量更新而非整表重建）；弹窗元素加稳定 key；
**全程没有任何 `focus()`/`autoFocus`**。

| 行为契约 | 说明 |
|---|---|
| **滚动位置保持** | 刷新 / 过滤 / 条目变少 / 500 项大目录 / 宿主重渲染 / **容器节点被重建**后，滚动位置都在原位（不会出现"跳回顶"的一帧） |
| **不抢焦点** | 打开弹窗只把焦点给**列表容器自己**且带 `focus({preventScroll:true})`（不会把容器滚进视野 ⇒ 不产生跳顶）；行一律 `tabindex="-1"` + `mousedown` 阻止默认聚焦 ⇒ **任何行都不会成为 `document.activeElement`**（活动行只改高亮与 `aria-activedescendant`）；重渲染不再抢焦点 |
| **每个目录各自记位置** | A 目录滚到 60、B 目录滚到 20，来回切换互不串位 |
| **滚轮不串联** | 列表滑到边界后不会带着背后的设置面板一起滚 |
| **行级增量更新** | 目录刷新只增删差集（行 key = 完整路径，测试断言行节点 uid 不变），**不做全量重建** |
| **锚点缺失不回 0** | 记住的位置若超出新列表范围 ⇒ **夹到新范围**（绝不回 0）；记忆值缺失/非法（`null`/`""`/`NaN`）一律当"无锚点"⇒ 认领当前位置 |

**快捷键**（弹窗内有可见提示；打开弹窗后列表容器已就绪，**直接按即可**）：

| 按键 | 行为 |
|---|---|
| `↑` / `↓` | 上下移动活动行（不会抢焦点、只在按键时做最小位移 `block:"nearest"`） |
| `Home` / `End` | 跳到第一个 / 最后一个目录 |
| `Enter` | 进入活动行对应目录；**未选中任何行时 = 「选择此文件夹」** |
| `Backspace` / `Alt`+`↑` | 上一级目录 |
| `Esc` | 关闭弹窗 |

**回归门禁**：`node tools/dir-picker-test.mjs`（**57 断言**；A 组 10 条源码级断言对 `git show HEAD:lib/client.js`
旧实现会**变红 9 条**，证明用例有分辨力；B 组用假 DOM + 迷你 React **跑生产实现的切片**）。
行为契约与测试台（8901/8902）逐条对齐：`docs/DIR-PICKER-SCROLL.md` §5 ↔ `vendor-ref/ww-pages/PATCH-NOTES.md` §10.5。

> 排查用开关（URL 参数，刷新即生效，不改设置）：`?hdrfrost=legacy|off`、`?hdrblur=pseudo|element`、`?railink=off`、`?sbfill=wide`。
> 修完请刷新一次页面，并按一次「诊断/上报」——`diag-*.json` 的 `headerFrost` 段能直接看出磨砂卡在哪一环
> （`hostHasHeader` / `injected` / `px` / `computed.headerBg` / `computed.frostElBackdrop` / `reason`）。

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
git clone https://github.com/XHR666/dsh-mpkg-wallpaper.git $DSH_HOME/profiles/<profile>/node_modules/dsh-mpkg-wallpaper
# 然后在 profile 的 cordis.patch.yml 注册：
#   - insert:
#       - id: dsh-mpkg-wallpaper
#         name: dsh-mpkg-wallpaper
# 重启后生效
```

> 注：方式三不写入依赖表，市场不显示「已安装」（仅影响显示，不影响功能）。

卸载（方式一/二/三）：`dsh plugin --profile web remove dsh-mpkg-wallpaper`。

### 方式四：单文件 bundle（离线 / 拷文件即装；**只装宿主端**）

不想让 DSH 解析包、也没有 npm/pnpm 网络时，可以把宿主端**内联成一个自包含 ESM 文件**再登记：

```bash
cd /path/to/dsh-mpkg-wallpaper
node tools/build-bundle.mjs          # 产物：dist/dsh-mpkg-wallpaper.bundle.mjs（约 342KB，sha256 见下方输出）
node tools/build-bundle.mjs --check  # 与源码对拍：导出面 / 39 条路由 / ping JSON 形状（20 条断言）
node tools/bundle-equivalence-test.mjs   # 更全的等价性门禁：同一套路由断言分别打源码与 bundle（38 条）
```

把 `dist/dsh-mpkg-wallpaper.bundle.mjs` 拷到任意目录（例如 `~/.dsh/plugins/`），
在 profile 的 `cordis.patch.yml` 里按**绝对路径**登记，然后重开 `dsh web`：

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- insert:
    - id: dsh-mpkg-wallpaper
      name: /绝对路径/dsh-mpkg-wallpaper.bundle.mjs   # ← 指向那个 .mjs 文件本身
```

**这条路装载了什么 / 没装载什么**（都是代码事实，不是猜测）：

| 项 | 方式四的行为 | 依据 |
| --- | --- | --- |
| 宿主端（上传/流式播放/Range、场景提取、音频清单、设置持久化、诊断上报等 39 条路由） | **完整**（`lib/index.js` + `pkg-extract.js` + `web-wallpaper.js` 全部内联，外部依赖只有 node 内建） | `node tools/build-bundle.mjs --check`：路由表 39 条逐项相等 |
| `/api/mpkg-wallpaper/ping` | `{ok:true, version, betterSidebar, betterSidebarVersion}` 键集合与源码一致 | 同上（`--check` 第③节） |
| **客户端半（设置面板 / 壁纸层 / 磨砂）** | **不装载**。单文件里只有宿主端导出面（`apply`/`inject`/`__mpwTest`） | 客户端半由 DSH 客户端模块系统按**包**发现：扫描宿主 Loader 条目里声明了 `dsh.client` 的包并解析其 `exports["./client"]`（`@deepseek-ai/dsh-client-modules/lib/index.js:66-70,153-165,650-658`）；裸 `.mjs` 没有 package.json ⇒ 没有 `dsh.client` 声明 |
| `GET /api/mpkg-wallpaper/lg/*`（遗留 WebGL 托管路由，客户端已不调用） | bundle 旁边没有 `liquid-glass/` 时 **404**；放一份 `cp -r lib/liquid-glass <bundle 目录>/` 即与源码逐字节一致 | 该路由以 `import.meta.url` 定位同目录 `liquid-glass/`（`lib/index.js:3304`）；`--check` 两种布局都断言过 |
| `ping.version` | bundle 的**上一级目录**没有 `package.json` 时返回 `null`（只影响版本号显示） | 同上是 `new URL('../package.json', import.meta.url)`（`lib/index.js:1622`）；带伴生 `package.json` 时与源码一致 |
| 「检查更新 / 一键更新」 | `update-check` 在无伴生 `package.json` 时返回 500；`update-apply` 会往 **bundle 同级/上级目录**写文件 ⇒ **不建议在方式四下使用一键更新** | `lib/index.js:1801/1812/1847-1849` |
| 卸载 | 删掉那个 `.mjs` 与 `cordis.patch.yml` 里那一行即可 | — |

> 结论：**方式四是"宿主端能力"的降级装载**（离线/应急/给非 DSH 宿主复用路由时很好用），
> 想要完整界面请用方式一/二/三。产物**不入库**（`dist/` 在 `.gitignore` 里：它是 `lib/*.js` 的纯派生物，
> 两次构建 sha256 逐字节相同，见 `tools/bundle-equivalence-test.mjs` 第②节；发布时现生成即可）。

## 无 WE 安装时的降级行为（Wallpaper Engine 缺失 / 非 Windows）

「WE 安装」指 Steam 版 Wallpaper Engine（appid **431960**）。宿主端用 `locateWallpaperEngine()`
（`lib/index.js:303-327`）按这个顺序找：Windows 注册表 `HKCU\Software\Valve\Steam\SteamPath` →
常见 Steam 目录（`C:\Program Files (x86)\Steam`、`D:\Steam`…）→ 非 Windows 的 Steam 目录
（macOS `~/Library/Application Support/Steam`、Linux/Android `~/.local/share/Steam`、WSL `/mnt/c/...`）→
各库的 `steamapps/libraryfolders.vdf` 里含 431960 的库 → 只认 `<库>/steamapps/common/wallpaper_engine/wallpaper32.exe`
存在的那一个。**找不到就返回 `null`**，后续全部走下面的降级路径（本机 Linux 就是这一路）：

| 场景 | 真实行为（含代码位置） |
| --- | --- |
| 没装 WE（或找不到 `wallpaper32.exe`） | `GET /api/mpkg-wallpaper/steam-inventory` 返回 **200 `{ok:true, installDir:null, wallpapers:[]}`**（不是错误、不抛 500）—— `lib/index.js:2967-2968` |
| 客户端点「扫描本地壁纸库」 | 列表保持空 + 顶部报错条 **「未检测到壁纸引擎安装（需 Windows + Steam 版 Wallpaper Engine）」**（`lib/client.js:8781` 判 `!d.installDir`，文案在 `lib/client.js:11555`）；空列表另有提示「未发现可用的壁纸（或不是 Windows 环境）」（`lib/client.js:10419/11553`）。**扫描本身不会报错**，只是没有结果 |
| 装了 WE 但 `projects/myprojects`、`projects/defaultprojects`、`steamapps/workshop/content/431960` 都不存在 | 每个根目录单独判存在（`scan()` 开头 `if (!existsSync(root)) return`，`lib/index.js:2976-2977`）⇒ 清单为空、**且不弹「未检测到安装」**（因为 `installDir` 非空）；界面只剩「未发现可用的壁纸（或不是 Windows 环境）」/轮播区空提示。**未实现**：这里没有"WE 装了但素材目录缺失"的**专用**提示（现有文案把它和"非 Windows"混在一起），排查时只能看 `steam-inventory` 的 `installDir`/`wallpapers` |
| 非 Windows / 移动端 | 同"没装 WE"：`installDir=null`（注册表分支 `process.platform !== 'win32'` 直接返回 null，`lib/index.js:282-284`），Steam 目录探测串都是纯字符串、`existsSync` 自然为 false，无副作用 |
| WE 原生播放列表（`config.json` → `general.playlists`） | 只在 `installDir` 存在且 `config.json` 可解析时才有；否则 `playlists` 缺失 ⇒ 客户端首次扫描后会写 `rotSeeded:true` 并**不再重播种**轮播列表（`lib/client.js:8782-8793`），避免每次扫描都覆盖用户自定义轮播 |
| **没装 WE 时仍然可用的**（降级不是"功能全废"） | ① 手动选目录：`/list-dirs` + `/custom-dir` 逐级浏览任意盘/目录，选中的目录当壁纸源；② 直接导入 `.mpkg`（hybrid 模式上传到宿主流式播放，无 600MB 上限）；③ 网页/视频类壁纸走 URL 或本地文件；④ 场景提取、音频清单、设置持久化、诊断上报全都不依赖 WE 安装 |
| 宿主端整体不可用（方式四没装/端口不通） | 客户端探测 `/ping` 失败 ⇒ 回退**纯浏览器模式**：状态行「宿主端不可用（已回退纯浏览器模式，600MB 上限）」（`lib/client.js:10203/11603`），壁纸库按钮报「宿主端不可用，无法扫描本地壁纸库」（`lib/client.js:8774/11554`）；超过 600MB 的素材在纯浏览器模式无法处理（见「限制」） |
| `ffmpeg` 缺失（视频转码相关，与 WE 安装无关） | `GET /api/mpkg-wallpaper/ffmpeg-check` 返回 **200 `{ok:true, found:false, source:null, path:null, version:null}`**（`lib/index.js:3089-3090`），客户端显示"未装"并只在用户点按后才走下载链；可直读的视频不做转码 |

> 一句话：**没有 WE 安装 = 少了"自动发现本地壁纸库"这一条便利通道**，插件本身照常工作；
> 所有降级都是"返回空清单 + 明确文案 + 保留手动目录/上传通道"，不会静默失败、也不会报 500。

## 限制

- **场景壁纸无法完整动态还原**（见[场景壁纸适配现状](#场景壁纸scene适配现状)）；mpkg 可调参数为只读展示，修改需在壁纸引擎 App 中生效
- **网页壁纸为实验性**：重动画/外网依赖可能卡顿或加载失败（有预检标注与刷新恢复机制）；
  沙箱模式（默认）下壁纸脚本**无法访问 DSH 界面与本地存储**，但 Live2D 类的「网页壁纸选项」需改用兼容模式；
  音频频谱通道已打通但插件暂无频谱数据源；**可交互壁纸需先开「交互模式」**（见上文；默认不接管你的鼠标/键盘）
- **超大素材**（纯浏览器模式）：独立视频 >600MB、视频纹理 >250MB、图片 >200MB 无法处理；**hybrid 模式**无此限制
- 场景静态帧/图层合成的**首次提取耗时**（几秒，8K 纹理更久）；之后走缓存秒开

<!-- ## 截图演示

<!-- 截图引用已移除（见下方说明） -->

<!-- *动态壁纸铺满整个界面。此状态下侧边栏收起，聊天框位于屏幕中央并带有磨砂模糊效果；侧边栏呈全透明状态，壁纸完整透出，画面干净通透。* -->

<!-- 截图引用已移除（见下方说明） -->

<!-- *通过「面板不透明度」与「统一虚化」滑条调节后的效果（图为调节后）：大部分界面区域的不透明度均可调节，侧边栏半透明，壁纸在后方隐约透出。* -->

<!-- 截图引用已移除（见下方说明） -->

<!-- *壁纸引擎背景的设置界面。截图之外，外观几乎全部可调：统一虚化（独立分组）、界面虚化（对话框/设置面板/弹窗/弹层/遮罩/侧边栏磨砂）、镜头缩放与平移、壁纸翻转、主题颜色、侧边栏/标题栏透出壁纸、标题栏磨砂程度、轻度锐化，以及场景壁纸的图层合成与时间帧切换。* -->

<!-- 截图中的壁纸来自 B 站 UP 主【-夜莺Night】的壁纸作品：[作者主页](https://b23.tv/86CyaFw) -->

-->
## 反馈 Bug

反馈问题时请附带：
- **原始 .mpkg 或 workshop 文件夹**（复现问题所必需）
- 浏览器控制台输出（F12 → Console），如有
- 你的 DSH 版本与平台（Windows / Linux / 移动端）

## 安全说明

- **默认无被动对外网络请求**：插件后台**不主动**访问任何外部网络；日常壁纸播放仅与**本机 DSH 宿主**（127.0.0.1）HTTP 通信。唯一的例外是**用户显式触发的功能**：检查更新 / 一键更新访问 GitHub（`raw.githubusercontent.com`、`api.github.com`）、下载 ffmpeg 访问 GitHub Releases / npm 二进制镜像（`registry.npmmirror.com`）——「一键更新」「下载 ffmpeg」都由用户点按发起；**打开设置面板后 0.8s 会自动静默检查一次版本**（只点亮「有新版本」徽标，不弹窗、不下载、不上传任何本地信息）。此外用户手动输入的网络图片 URL、网页壁纸自身加载的资源也属外部访问。
- **无敏感内容**：源码不含路径、密钥、令牌、个人信息
- **开源依赖**：仅 DSH 自带 react + 官方 slots/locale 接口；scene.pkg 提取器采用 [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（MIT，文件头已署名）
- **网页壁纸沙箱**：默认模式下壁纸 iframe 是**不透明源**（`sandbox="allow-scripts"`，无 `allow-same-origin`），
  作者脚本**读不到宿主 DOM / `localStorage` / cookie**，也摘不掉自己的 sandbox；帧与父页只走 `postMessage`
  （op 白名单 + 只认父窗口来源）。壁纸资源的跨源读取**只对 `Origin: null`（沙箱帧）**放行；普通网站拿不到 CORS 头。
  作者脚本抛错在帧内兜住并限流上报（`console.warn` + `/diag`），不影响插件。
- **网页壁纸交互模式**：交互事件只从插件建的**交互舞台**发出（舞台默认 `display:none`，未开交互时一个事件都不注入），
  且开启才给宿主页面打 `data-mpw-interact="on"`（此时宿主界面整体让位，右上角常驻退出按钮）；
  60s 无操作 / 180s 总时长 / `Esc` / 切壁纸都会自动退出。交互**不放宽沙箱**（不加 `allow-same-origin`、不加
  `allow-pointer-lock`），也**不读帧内 DOM**（父页实现块里不出现 `contentDocument`）。
- 参考项目：[dsh-bg-image](https://github.com/lyh9712/dsh-bg-image)（MIT，模板）、[unmpkg](https://github.com/aqnya/unmpkg)（GPL-3.0，仅参考 mpkg 二进制格式）、[repkg](https://github.com/notscuffed/repkg)（**MIT**，仅研究 .tex 格式；早前此处误记为 GPL，已于 2026-09-17 更正 —— 依据 = 上游 `LICENSE` 原文 + 项目所有者确认，见 `../docs/COPYING-RULES.md` §6/§9.10）
- 数据边界：所有解析在本机完成；localStorage 只存背景与参数；设置另存宿主端 `~/.dsh-mpkg-wallpaper/settings.json`

## 文件结构

```
dsh-mpkg-wallpaper/
├── package.json      # dsh.bundle + dsh.client 声明
├── cordis.patch.yml  # 插件安装声明（dsh plugin add 使用）
├── LICENSE           # MIT 许可证
├── lib/
│   ├── index.js      # 宿主端：上传/流式播放 + Steam 发现 + 自定义目录 + 场景提取路由 + 设置持久化
│   ├── web-wallpaper.js # 网页壁纸：内容优先类型判定 + WE API shim 源码 + 入口 HTML 注入 + 跨源策略 + 帧内交互合成（MIT，自写）
│   ├── web-interaction.js # 网页壁纸交互（第 11 条）：坐标换算/事件整形/交互模式状态机/舞台契约（MIT，自写；语义参照 webwallgl）
│   ├── client.js     # 浏览器端：mpkg 解析 + 设置页 + 背景 DOM + 虚化体系 + 壁纸库 + 时间变化/网页设置 + 播放控制/省电
│   ├── pkg-extract.js# scene.pkg 静态帧/图层提取（PKG+LZ4+TEX，MIT，来自 elysia395）
│   ├── liquid-glass/ # 液态玻璃 WebGL 库（**遗留**：客户端无引用，宿主仍托管 `/lg` 路由，v3.6.0 已改 CSS 版）
│   ├── liquid-glass-bundle.js # 液态玻璃打包产物（107KB，**客户端无引用**，随包冗余）
│   └── THIRD-PARTY.md # 第三方来历/洁净室记录与许可归属（**随包发布**，MIT 侧署名）
├── tools/            # 门禁/测试/基准脚本 + lg 构建/内联脚本 + liquid-demo 演示页（供开发者）
│                     # 音频扫描：audio-scan-bench.mjs（耗时表）/ audio-scan-test.mjs（规格断言 · 不整包解压 · 缓存）
│                     #           scene-audio-route-test.mjs（/raw Range + 探测路由 + 安全）
│                     # 网页壁纸：web-wallpaper-test.mjs（类型判定/sandbox/注入顺序/shim API 差异/抛错兜底/无 GPL/帧内交互 E13）
│                     #           web-interaction-test.mjs（坐标/事件整形/开关状态机/沙箱边界/舞台契约/两侧源码对拍）
│                     # 单文件装载：build-bundle.mjs（把 lib/index.js + 相对依赖内联成一个 ESM；`--check` 与源码对拍）
│                     #           bundle-equivalence-test.mjs（门禁第 11 步：同一套路由断言打源码与 bundle + 变异对照）
│                     # 样式作用域：style-scope-guard.mjs（门禁第 12 步：注入的每条 CSS 规则都必须命中 .mpw*/[data-mpw*]，
│                     #           宿主/第三方作用域必须登记在允许清单里（带 reason + docs 指针）；裸元素/:root 覆盖判红）
│                     # 注：研究期的 Python 工具（unmpkg/tex2png/mdl_explorer/xref）
│                     #     **已删除（GPL 血缘存疑，2026-09-16）**，见 `../docs/COPYING-RULES.md` §6
├── dist/             # 构建产物（**不入库**，.gitignore 忽略）：dsh-mpkg-wallpaper.bundle.mjs（方式四用，现生成）
├── docs/             # 研发笔记（不进发布包）：WEB-WALLPAPER.md（网页壁纸规格/沙箱/API 表/限制）、RELEASE.md（发布前置与命令）、
│                     #   STYLE-SCOPE-GUARD.md（样式作用域护栏：允许什么/什么判红/怎么加允许清单/怎么复现）等
├── screenshots/      # （已移出仓库，见文末说明）
├── README.md         # 本文件（中文）
└── README.en.md      # 英文说明
```
> 注：`lib/liquid-glass/`、`lib/liquid-glass-bundle.js` 因 `files: ["lib"]` 仍会打进 npm 包，但**客户端不再引用**（WebGL 已在 v3.6.0 移除，改用 CSS 版）；宿主仍保留 `/api/mpkg-wallpaper/lg` 托管路由（无调用方）。本地备份 `lib/client.js.bak-*` 已被 `files` 负向模式（`!lib/**/*.bak*`）排除，**不进发布包**，由 `tools/integrity-check.mjs` 第 ⑨ 节机器断言把关。
> `dist/` 为什么**不入库**：它是 `lib/*.js` 的纯派生物（内联产物），与被跟踪源码逐字节重复；两次构建 sha256 逐字节相同（`tools/bundle-equivalence-test.mjs` 第②节机器断言），入库只会制造"改了 lib 忘了重跑 bundle"的漂移。对照：`lib/liquid-glass-bundle.js` **入库**是因为它是**运行期输入**（被 `tools/inline-lg-bundle.mjs` 写进 `lib/client.js` 的模板常量），不是发布派生物。`dist/` 也不在 `files` 白名单 ⇒ npm 包不夹带。

## 致谢

> **命名说明（2026-09-19）**：本插件对接的渲染器产品现名 **WEwebLoader**；上游项目名仍是 **WebWallGL**（`oneincase/webwallgl`，MIT），归属与许可不因此改变。

- [Bil812](https://github.com/Bil812) — 在 [PR #2](https://github.com/XHR666/dsh-mpkg-wallpaper/pull/2) 提出壁纸取色、自适应文字色、全屏统一遮罩等方案并维护 fork；其中思路已吸收为「Aqua 实验」模式（可开关，默认关）
- [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) — scene.pkg 静态帧提取器（MIT），本插件 `lib/pkg-extract.js` 采用自该项目；其「设置持久化到宿主端文件」「Edge canvas 兼容渲染」思路也已借鉴
- [oneincase/webwallgl](https://github.com/oneincase/webwallgl) — 网页壁纸的 sandbox iframe + WE API shim 方案（MIT）：本插件 `lib/web-wallpaper.js` 的 **API 名单与语义参考**了该项目（**未复制代码**，差异清单见 `docs/WEB-WALLPAPER.md` §10；台账见 `../docs/COPYING-RULES.md` §4）
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 社区 — 收录与推广

## 渲染可行性研究

- 完整场景（含 Live2D 木偶）只能由专有渲染器完成：壁纸引擎 App 的原生库（内嵌 Chromium + 专有 puppet 渲染）；开源方案 [we-layerd](https://github.com/Aromatic05/we-layerd)（Rust）打包了官方渲染器，但**仅限 Linux Wayland** 桌面
- 浏览器端没有成熟的 WE 场景渲染器（pixeltris/wallpaper-engine-web 已消失）——**与操作系统无关，任何浏览器都无法直接渲染 Live2D 场景**；官方渲染器 .so 为闭源二进制，无源码无法编译成 WASM
- 本插件的可行路径：**静态帧提取 + 图层合成 + （时间变化的）mpkg 方式时段切换**（见[场景壁纸适配现状](#场景壁纸scene适配现状)）；需要完整动态时用「外部渲染成视频 → 视频壁纸」方案

> 实机截图已移出仓库（含个人界面内容，发布前不外发）：`../Delete/plugin-screenshots/`。需要展示时可自行脱敏后放到 `docs/media/`。

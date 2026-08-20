# dsh-mpkg-wallpaper — DSH 壁纸引擎背景插件

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](README.md) | [English](README.en.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 界面（dsh web）添加背景壁纸的插件：**Wallpaper Engine `.mpkg` 解析、Steam 创意工坊原始目录、视频/网页/图片壁纸、整屏虚化体系、主题色与玻璃外观、本地壁纸库、定时轮换、一键更新**，几乎每一个外观细节都可以调节。

> **场景（Scene）壁纸的现状**：Wallpaper Engine 的场景壁纸（Live2D 木偶 + shader + 粒子）由专有引擎渲染，**Web 端目前无法完整适配**（详见[场景壁纸适配现状](#场景壁纸scene适配现状)）。插件提供**静态帧提取 + 图层合成**两个折中方案，其余回退官方预览动图。

## 核心能力

**📦 壁纸来源（全部支持）**
- **Wallpaper Engine `.mpkg`**：浏览器内直接解析容器（不上传第三方）；视频类自动播放内嵌 mp4 / 视频纹理；场景类解析容器提取素材；**多时段自动切换**（按系统时间选素材）；**可调参数（只读展示）**供对照壁纸引擎 App
- **Steam 创意工坊原始目录**：自动发现 WE 安装（读注册表 + libraryfolders.vdf，支持非默认盘），列出 `video / web / scene` 三种类型；也可直接把 **workshop 主目录**（`steamapps/workshop/content/431960`）设为自定义目录——每个子文件夹自动识别为一张壁纸
- **视频壁纸**：`.mp4` 直接播放（自定义目录 / Steam 库 / 本地文件均可）
- **网页壁纸**：HTML 壁纸在沙箱 iframe 中加载（实验性，带**风险预检**：自动标注「⚠重动画」「🌐外网」，见[网页壁纸](#网页壁纸web实验性)）
- **图片 / GIF / URL**：本地图片（png/jpg/webp/gif）或图片链接（含 data:image）直接作背景

**🌊 整屏虚化（磨砂）体系**
- **统一虚化**：一个条控制整屏壁纸模糊度；侧边栏白雾厚度、聊天区跟随、新会话按钮跟随独立可调
- **界面虚化（各自独立开关+程度）**：对话框（通用居中窗口 + 聊天输入框）、设置面板、下载/确认弹窗、弹层（菜单/下拉/提示）、遮罩（全屏背景）、侧边栏磨砂（弹窗打开时自动摘除）
- **标题栏磨砂 / 侧边栏透出壁纸**：独立控制

**🎨 主题色与玻璃外观（Aqua 实验模式，默认全关）**
- **主题颜色（accent）**：取色盘 + 6 预置，驱动按钮/滑条/选中项/链接/发送键等品牌色（`--dsw-alias-brand-*` 系列 token）
- **统一雾**（全屏遮罩统一雾色，强度独立滑条）、**面板匹配壁纸色**（自动取色 + 强度滑条 + 自定义取色盘）、**自适应文字色 + 蓝色清理**（品牌色统一，带自定义取色盘）、**深底文字可读增强**、**任务列表磨砂**
- 外观 tab 里还有：壁纸镜像翻转（flipX/flipY）、悬浮卡片、时钟等

**🎬 镜头与画面**
- 镜头缩放（10–2000%）与平移、画面亮度（50–150%）、轻度锐化、壁纸镜像翻转、Deep diving 背景框

**🚀 大文件混合模式（hybrid，默认开）**
- mpkg 流式上传到 DSH 宿主 → 磁盘存储 → HTTP Range 流式播放，**>600MB 大文件也支持**，内存占用极低

**🖼️ 本地壁纸库**
- **Steam 自动发现** + **自定义目录**（任意文件夹 + 跨平台目录选择器；mpkg 文件与 workshop 文件夹混合放置都能识别）
- **壁纸切换与轮换**：上一个/下一个一键切换、定时自动轮换（间隔可调）

**🛡️ 安全与共存**
- **冲突检测**：检测到其他壁纸/主题插件自动关闭本功能
- **安全边界**：.exe/application 壁纸完全排除（防病毒注入）；自定义目录只读媒体文件；宿主路由有路径穿越校验；网页壁纸 iframe 沙箱隔离

**🔄 更新**
- 「检查更新」按**版本号**对比（semver），本地未推送改动不误报；「一键更新」从 GitHub 拉最新代码写回，重启生效

## 支持类型与现状

| 类型 | Web 端表现 | 说明 |
|---|---|---|
| **mpkg（视频类）** | ✅ 完整 | 内嵌 mp4 / 视频纹理直接播放 |
| **mpkg（场景类）** | 🟡 折中 | 静态帧提取 / 图层合成 / 预览动图（见下） |
| **视频（mp4/webm）** | ✅ 完整 | 直接播放 |
| **网页（HTML）** | 🟡 实验性 | iframe 沙箱加载；重动画壁纸在低性能设备可能卡顿 |
| **场景原始目录（scene.pkg）** | 🟡 折中 | 同 mpkg 场景类 |
| **Application（exe）** | ❌ 排除 | 安全考虑，绝不读取/执行 |

## 场景壁纸（Scene）适配现状

**结论先说：WE 场景壁纸无法在 Web 端完整还原，这是引擎层面的限制，不是插件偷懒。** 原因：场景由专有引擎渲染——Live2D 式**木偶骨架（.mdl 二进制）**、**shader 特效**（水波/粒子）、**脚本**（音乐播放器 UI 等）。浏览器没有官方渲染器，格式也未公开（RePKG 只逆向过 PKG/TEX，MDL 骨架无公开文档；开源方案 [we-layerd](https://github.com/Aromatic05/we-layerd) 打包了官方渲染器但仅限 Linux Wayland 桌面）。

插件为此提供了两个**折中方案**（按场景内容自动选择）：

1. **静态帧提取**：解析 `scene.pkg`（PKG 容器 + LZ4 解压 + TEX 纹理解码），从场景图选取主纹理输出**高清静态图**（摄影/插画类场景可达原图画质，实测 7680×4320）
2. **图层合成**：解析 `scene.json` 的全部 image 图层（背景 + 主体 + 分层角色部件），按源文件坐标/尺寸在 canvas 上**精确合成完整画面**（平铺图层类场景可完整还原构图；时间变化场景按当前时段选帧）

**无法覆盖的**：MDL 木偶人物（角色的身体由骨架拼装，纹理层几乎为空）、shader 波浪/粒子特效、脚本交互。这些场景回退**官方预览动图**（preview.gif，作者生成的动画预览）。

> 如果你需要场景壁纸的完整动态效果，现实路径：外部渲染成视频 → 用本插件的**视频壁纸**功能（Windows 用 WE 官方版录屏、Linux 用 we-layerd 录屏、移动端用壁纸引擎 App 录屏）。

## 网页壁纸（Web，实验性）

- HTML 壁纸在**沙箱 iframe** 中全屏加载（`allow-scripts` 隔离，刷新后不自动重载——卡住时刷新页面即可恢复）
- **风险预检**：扫描时自动分类，列表与确认框标注：
  - **⚠重动画**：Spine/L2D 骨骼动画壁纸，低性能设备可能卡住界面
  - **🌐外网**：依赖外网 SDK/CDN（如米哈游事件页），加载可能失败
- 实测：webm 视频类网页壁纸（轻量）正常；Spine 骨骼动画类视设备性能而定

## 设置分组（顶部 Tab）

- **来源**：总开关、hybrid、mpkg 文件、图片/视频文件、自定义目录（可指 workshop 主目录）、本地壁纸库（Steam 扫描）、壁纸切换/轮换
- **外观**：主题颜色、翻转、悬浮、磨砂模糊、镜头缩放/位置、亮度
- **统一虚化**：整屏虚化 + 侧边栏/标题栏白雾、聊天区跟随、新会话跟随
- **界面虚化**：对话框/设置面板/弹窗/弹层/遮罩/侧边栏磨砂各自独立
- **透出壁纸**：侧边栏/标题栏透出、标题栏磨砂程度、锐化
- **Aqua**：统一雾/面板取色/自适应文字等实验开关
- **其他**：时钟、更新检查/热更新、恢复默认

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

- **场景壁纸无法完整动态还原**（见[场景壁纸适配现状](#场景壁纸scene适配现状)）；可调参数为只读展示，修改需在壁纸引擎 App 中生效
- **网页壁纸为实验性**：重动画/外网依赖可能卡顿或加载失败（有预检标注与刷新恢复机制）
- **超大素材**（纯浏览器模式）：独立视频 >600MB、视频纹理 >250MB、图片 >200MB 无法处理；**hybrid 模式**无此限制
- 场景静态帧/图层合成的**首次提取耗时**（几秒，8K 纹理更久）；之后走缓存秒开

## 截图演示

![侧边栏收起 · 新会话界面](screenshots/dhsw1.jpg)

*动态壁纸铺满整个界面。此状态下侧边栏收起，聊天框位于屏幕中央并带有磨砂模糊效果；侧边栏呈全透明状态，壁纸完整透出，画面干净通透。*

![侧边栏展开](screenshots/dshw2.jpg)

*通过「面板不透明度」与「统一虚化」滑条调节后的效果（图为调节后）：大部分界面区域的不透明度均可调节，侧边栏半透明，壁纸在后方隐约透出。*

![设置页](screenshots/dshw3.jpg)

*壁纸引擎背景的设置界面。截图之外，外观几乎全部可调：统一虚化（独立分组）、界面虚化（对话框/设置面板/弹窗/弹层/遮罩/侧边栏磨砂）、镜头缩放与平移、壁纸翻转、主题颜色、侧边栏/标题栏透出壁纸、标题栏磨砂程度、轻度锐化，以及场景壁纸的图层合成与时间帧切换。*

截图中的壁纸来自 B 站 UP 主【-夜莺Night】的壁纸作品：[作者主页](https://b23.tv/86CyaFw)

## 官方文档

Wallpaper Engine 官方帮助站 [help.wallpaperengine.io](https://help.wallpaperengine.io)；mpkg/tex/mdl 为专有格式，官方未公开文档（本插件格式知识来自 RePKG / lwe 公开逆向）。

## 反馈 Bug

反馈问题时请附带：
- **原始 .mpkg 或 workshop 文件夹**（复现问题所必需）
- 浏览器控制台输出（F12 → Console），如有
- 你的 DSH 版本与平台（Windows / Linux / 移动端）

## 安全说明

- **无对外网络请求**：插件不访问任何外部网络；唯一网络行为是用户手动输入的图片 URL 与**本机 DSH 宿主**（127.0.0.1）的 HTTP 通信
- **无敏感内容**：源码不含路径、密钥、令牌、个人信息
- **开源依赖**：仅 DSH 自带 react + 官方 slots/locale 接口；scene.pkg 提取器采用 [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（MIT，文件头已署名）
- 参考项目：[dsh-bg-image](https://github.com/lyh9712/dsh-bg-image)（MIT，模板）、[unmpkg](https://github.com/aqnya/unmpkg)（GPL-3.0，仅参考 mpkg 二进制格式）、[repkg](https://github.com/notscuffed/repkg)（GPL，仅研究 .tex 格式）
- 数据边界：所有解析在本机完成；localStorage 只存背景与参数

## 文件结构

```
dsh-mpkg-wallpaper/
├── package.json      # dsh.bundle + dsh.client 声明
├── cordis.patch.yml  # 插件安装声明（dsh plugin add 使用）
├── lib/
│   ├── index.js      # 宿主端：上传/流式播放 + Steam 发现 + 自定义目录 + 场景提取路由
│   ├── client.js     # 浏览器端：mpkg 解析 + 设置页 + 背景 DOM + 虚化体系 + 壁纸库
│   └── pkg-extract.js# scene.pkg 静态帧/图层提取（PKG+LZ4+TEX，MIT，来自 elysia395）
├── tools/            # mpkg/tex/mdl 逆向解析工具（供开发者参考）
├── README.md         # 本文件（中文）
└── README.en.md      # 英文说明
```

## 致谢

- [Bil812](https://github.com/Bil812) — 在 [PR #2](https://github.com/XHR666/dsh-mpkg-wallpaper/pull/2) 提出壁纸取色、自适应文字色、全屏统一遮罩等方案并维护 fork；其中思路已吸收为「Aqua 实验」模式（可开关，默认关）
- [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) — scene.pkg 静态帧提取器（MIT），本插件 `lib/pkg-extract.js` 采用自该项目
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 社区 — 收录与推广

## 渲染可行性研究

- 完整场景（含 Live2D 木偶）只能由专有渲染器完成：壁纸引擎 App 的原生库（内嵌 Chromium + 专有 puppet 渲染）；开源方案 [we-layerd](https://github.com/Aromatic05/we-layerd)（Rust）打包了官方渲染器，但**仅限 Linux Wayland** 桌面
- 浏览器端没有成熟的 WE 场景渲染器（pixeltris/wallpaper-engine-web 已消失）——**与操作系统无关，任何浏览器都无法直接渲染 Live2D 场景**；官方渲染器 .so 为闭源二进制，无源码无法编译成 WASM
- 本插件的可行路径：**静态帧提取 + 图层合成**（见[场景壁纸适配现状](#场景壁纸scene适配现状)）；需要完整动态时用「外部渲染成视频 → 视频壁纸」方案

# dsh-mpkg-wallpaper — DSH 壁纸引擎 mpkg 背景插件

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](README.md) | [English](README.en.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 界面（dsh web）添加背景壁纸的插件，**功能非常丰富**——从 Wallpaper Engine `.mpkg` 解析、多源壁纸、整屏虚化体系，到本地壁纸库与自动轮换，几乎每一个外观细节都可以调节。

一个插件覆盖了壁纸的**导入、解析、播放、轮换、外观调节、本地管理与更新**全链路：动图/视频/多时段素材都能播，虚化/磨砂/悬浮/镜头/亮度每一项都可独立调节，还能扫本地壁纸库、定时轮换、一键检查更新。装一个，界面外观相关的需求基本都齐了。

## 核心能力

**📦 多源背景（mpkg / 视频 / 图片 / URL）**
- **Wallpaper Engine `.mpkg`**：浏览器内直接解析容器（纯客户端，不上传第三方）；视频类壁纸自动播放内嵌 mp4 / 视频纹理；场景类壁纸使用作者生成的 `preview.gif` 动态预览；**多时段自动切换**（按系统当前时间选素材）；**可调参数（只读展示）**供对照壁纸引擎 App
- **图片/GIF 直接导入**：本地图片文件（png/jpg/webp/gif）或**图片链接 URL**（含 data:image）都能作为背景——大文件自动存浏览器存储，GIF 动画可靠循环
- **视频文件**：直接选择 mp4/webm 文件作为视频背景

**🌊 整屏虚化（磨砂）体系**
- **统一虚化（独立分组）**：一个条控制整屏壁纸模糊度（0 = 壁纸清晰，拉高 = 越来越模糊）；侧边栏白雾厚度、聊天区跟随、新会话按钮跟随独立可调；开启时接管侧边栏磨砂与磨砂模糊条（标题栏不接管，按自己的磨砂条，默认透明）
- **界面虚化（独立分组）**：
  - **虚化对话框**：通用居中窗口 + 聊天输入框（背景磨砂，滚动经过输入框的文字变朦胧）
  - **虚化设置面板**：DSH 设置面板独立开关 + 程度
  - **虚化下载/确认弹窗**：本插件的下载确认、冲突检测、错误提示弹窗独立开关 + 程度
  - **虚化弹层 / 虚化遮罩**：菜单/下拉/提示与全屏背景遮罩各管各的
  - **侧边栏磨砂（Aqua 方案）**：侧边栏自身玻璃化（backdrop-filter 模糊其背后的壁纸）；弹窗打开时自动摘除，防弹窗被模糊层困住

**🎬 镜头与外观**
- 镜头缩放（10–2000%）与平移、侧边栏/标题栏透出壁纸开关、轻度锐化、Deep diving 背景框

**🚀 大文件混合模式（hybrid）**
- 开启后 mpkg **流式上传到 DSH 宿主** → 磁盘存储 → HTTP Range 流式播放，**支持 >600MB 的大文件**，内存占用极低
- 关闭则回到纯浏览器模式（600MB 上限）

**🖼️ 本地壁纸库（Windows + 跨平台）**
- **Steam 自动发现**：自动定位壁纸引擎安装（含非默认盘符，读注册表 + libraryfolders.vdf），列出 video/web 壁纸
- **自定义本地壁纸目录**：任意文件夹都能作为壁纸库，内置**跨平台目录选择器**（逐级浏览文件夹）
- **壁纸切换与轮换**：一键「上一个/下一个壁纸」，或定时自动轮换（间隔可调）；轮换范围含自定义目录 + Steam 自动发现的视频壁纸

**🛡️ 安全与共存**
- **冲突检测**：检测到其他壁纸/主题插件自动关闭本功能，避免叠加
- **第三方插件共存**：与 DSH-better-sidebar、dsh-chat-import、dsh-sidebar-qa 等共存无冲突（CSS 只命中 DSH 原生区域，不覆盖插件注入内容）
- **安全边界**：.exe/application 壁纸完全排除（防病毒注入），自定义目录只读图片/视频，宿主路由有路径穿越校验
- 纯客户端解析在浏览器沙箱内完成，恶意 mpkg 无法触达宿主文件系统

**🔄 检查更新与一键热更新**
- 「检查更新」对比**实际代码内容哈希**（README 变更不触发），只认真实功能变化
- 发现新版本 → 「一键更新」：从 GitHub 自动下载最新代码 + 版本号写回本机 → 重启 dsh web 即生效


## 功能与设置分组

- **背景来源**：总开关、大文件混合模式（hybrid）、mpkg 文件、图片链接、本地图片/动图、本地壁纸库（Steam 自动发现 + 自定义目录 + 目录选择器）、壁纸切换与轮换
- **外观**：面板不透明度、磨砂模糊、镜头缩放、镜头位置
- **统一虚化**：整屏虚化开关 + 程度、侧边栏/标题栏白雾厚度、聊天区跟随、新会话按钮跟随
- **界面虚化**：虚化对话框/设置面板/下载确认弹窗（各自独立开关+程度）、虚化弹层、虚化遮罩、侧边栏磨砂（Aqua 方案）、Deep diving 背景框、标题栏磨砂/透出壁纸（磨砂程度独立可调）
- **其他**：侧边栏透出壁纸、轻度锐化、第三方 UI 圆角兼容（默认关）、检查更新/一键热更新、恢复默认


## 支持的输入

- **Wallpaper Engine .mpkg**（PKGM0014 视频类 / PKGM0018 场景类）
- **mp4/webm 视频文件**（直接选择）
- **图片/GIF 文件**（png/jpg/webp/gif，本地文件）与 **图片链接 URL**（含 data:image）
- 大小限制取决于**运行模式**：
  - **混合模式（hybrid，默认开）**：mpkg 流式上传到 DSH 宿主 → 磁盘存储 + HTTP Range 流式播放，**>600MB 的大文件也支持**（大小只受磁盘空间限制），内存占用极低
  - **纯浏览器模式（hybrid 关闭）**：整个文件 **>600MB** 拒绝；独立视频 **>600MB**、视频纹理 **>250MB**、图片/GIF **>200MB** 无法处理（会提示并回退预览图）；浏览器存储配额（IndexedDB）也可能受限
- 导入后显示效果取决于壁纸内容：
  - **视频类壁纸**（内嵌 mp4 / 独立 mp4）：直接播放视频作为背景
  - **场景类壁纸**（Live2D 等）：使用作者生成的 `preview.gif`（浏览器无法渲染 WE 场景）
  - **蓝幕/绿幕抠像层**：回退使用预览图（直接播原片会显示蓝/绿背景）


## 限制

- **场景类壁纸**（Live2D 木偶 + shader + 粒子）：完整动态场景只能在壁纸引擎 App 渲染，浏览器取用的 `preview.gif` 是作者生成的动画预览，全屏可能偏模糊（缩放/锐化可缓解）
- **可调参数为只读展示**：浏览器显示的是预渲染素材，修改参数不会改变画面；如需生效请在壁纸引擎 App 中调整
- **超大素材**（纯浏览器模式）：独立视频 >600MB、视频纹理 >250MB、图片 >200MB 无法处理（会提示并回退预览图）。**混合模式**下大文件走宿主流式播放，无此限制


## 截图演示

![侧边栏收起 · 新会话界面](screenshots/dhsw1.jpg)

*动态壁纸铺满整个界面。此状态下侧边栏收起，聊天框位于屏幕中央并带有磨砂模糊效果；侧边栏呈全透明状态，壁纸完整透出，画面干净通透。*

![侧边栏展开](screenshots/dshw2.jpg)

*通过「面板不透明度」与「统一虚化」滑条调节后的效果（图为调节后）：大部分界面区域的不透明度均可调节，侧边栏半透明，壁纸在后方隐约透出。*

![设置页](screenshots/dshw3.jpg)

*壁纸引擎背景的设置界面。截图之外，外观几乎全部可调：统一虚化（独立分组）、界面虚化（虚化对话框/设置面板/下载确认弹窗各自独立 + 弹层/遮罩 + 侧边栏磨砂）、镜头缩放与平移、侧边栏/标题栏透出壁纸、标题栏磨砂程度、轻度锐化，以及部分壁纸的按时间自动切换。*

截图中的壁纸来自 B 站 UP 主【-夜莺Night】的壁纸作品：[作者主页](https://b23.tv/86CyaFw)


## 使用

设置 → **壁纸引擎背景**：

| 控件 | 说明 |
|---|---|
| 选择 .mpkg 文件 | 自动取 preview.gif（或按时间取素材）作动态背景；也可直接选 mp4/webm |
| 大文件混合模式 | 开：>600MB 也支持（流式上传宿主播放）；关：纯浏览器模式（600MB 上限）|
| 可调参数 | 壁纸自带的参数与当前值（只读展示，供对照壁纸引擎 App） |
| 图片链接 / 本地图片 | 普通图片或 GIF |
| 面板不透明度 | 50–100% |
| 磨砂模糊 | 整张壁纸的模糊程度 0–40px（0=清晰） |
| 统一虚化（独立分组） | 一个条控制整屏壁纸模糊度（0=清晰，拉高=更模糊）；侧边栏/标题栏白雾厚度、聊天区跟随、新会话按钮跟随独立可调；开启时接管下方各项 |
| 对话框/设置面板/确认弹窗/弹层/遮罩虚化 | 各自独立开关+程度条；侧边栏磨砂（Aqua 方案，弹窗打开时自动摘除） |
| 镜头缩放/位置 | 背景画面放大（10–2000%）与平移；缩小可看到画面边缘的组件 |
| 侧边栏/标题栏透出壁纸 | 开关；关闭后对应区域纯色不透明；标题栏磨砂程度独立可调 |
| 本地壁纸库 | Steam 自动发现（Windows）+ 自定义目录（任意文件夹 + 目录选择器）|
| 壁纸切换与轮换 | 「下一个壁纸」一键切换；定时自动轮换（间隔可调）|
| 轻度锐化 | 提升低清观感；GIF 卡顿就关 |


## 安装

插件已发布到 npm（`dsh-mpkg-wallpaper`）。任选一种：

### 方式一：dsh plugin add（推荐，市场可识别）

```bash
dsh plugin --profile web add dsh-mpkg-wallpaper
# 重启 dsh web 后浏览器 Ctrl+F5 生效
```

从 npm 官方仓库安装，会写入 profile 的 `package.json` 依赖表——插件市场自动识别为「已安装」，并可显示下载量、用市场管理更新。

### 方式二：pnpm 手动安装（profile 是 pnpm workspace 时）

```bash
# 在 profile 目录下执行（将 <profile> 换成你的 profile 名，如 web）
pnpm --dir $DSH_HOME/profiles/<profile> add dsh-mpkg-wallpaper
# 重启 dsh web，浏览器 Ctrl+F5 生效
```

同样写入依赖表，市场可识别。若你的环境没有 pnpm，用方式一（`dsh plugin add` 内部就是 pnpm）。

### 方式三：GitHub 克隆（开发者 / 离线场景）

```bash
git clone https://github.com/XHR666/dsh-mpkg-wallpaper.git $DSH_HOME/profiles/node_modules/dsh-mpkg-wallpaper
# 然后在 profile 的 cordis.patch.yml 注册：
#   - insert:
#       - id: dsh-mpkg-wallpaper
#         name: dsh-mpkg-wallpaper
# 重启后生效
```

> 注：方式三是手动放置，**不会**写入依赖表——插件市场不识别为「已安装」（仅影响市场显示，不影响功能）。要市场识别请用方式一/方式二，并移除旧的手动副本（`cordis.patch.yml` 的 insert 行 + 插件目录），避免同一插件被加载两次。

卸载：`dsh plugin --profile web remove dsh-mpkg-wallpaper`。


## 官方文档

Wallpaper Engine 官方帮助站 [help.wallpaperengine.io](https://help.wallpaperengine.io) 有移动端章节（与 Windows 配对等）；mpkg 容器格式为专有格式，官方未公开文档。


## 反馈 Bug

反馈问题时请附带：
- **原始 .mpkg 源文件**（复现问题所必需）
- 浏览器控制台输出（F12 → Console），如有
- 你的 DSH 版本与平台（Windows / Linux / 移动端）


## 安全说明

- **无对外网络请求**：插件不访问任何外部网络；唯一网络行为是：① 用户手动输入的图片 URL 由浏览器加载；② 混合模式下与**本机 DSH 宿主**（127.0.0.1）的 HTTP 通信（上传 mpkg / 流式播放壁纸），不经过任何第三方
- **无敏感内容**：源码不含路径、密钥、令牌、个人信息
- **无第三方闭源代码**：仅依赖 DSH 自带 react + 官方 slots/locale 接口
- 参考项目（均开源）：[dsh-bg-image](https://github.com/lyh9712/dsh-bg-image)（MIT，模板）、[unmpkg](https://github.com/aqnya/unmpkg)（GPL-3.0，仅参考 mpkg 二进制格式）、[repkg](https://github.com/notscuffed/repkg)（GPL，仅研究 .tex 格式）、[astc-encoder](https://github.com/ARM-software/astc-encoder)（Apache-2.0，本地解码实验）
- 数据边界：所有解析在浏览器本地完成；localStorage 只存背景图 data URL 与参数编辑


## 文件结构

```
dsh-mpkg-wallpaper/
├── package.json      # dsh.bundle + dsh.client 声明
├── cordis.patch.yml  # 插件安装声明（dsh plugin add 使用）
├── lib/
│   ├── index.js      # 宿主端：大文件上传/流式播放 + Steam 自动发现 + 自定义目录
│   └── client.js     # 浏览器端：mpkg 解析 + 设置页 + 背景 DOM + 虚化体系 + 壁纸库
├── tools/            # mpkg/tex/mdl 逆向解析工具（供开发者参考）
├── README.md         # 本文件（中文）
└── README.en.md      # 英文说明
```


## GitHub 发布说明

### 可移植性（在他人的设备上也能用）

- 无绝对路径、无本机端口、无环境专属配置；依赖仅 DSH 自带 react + 官方 slots/locale 接口
- **自定义导航图标**：`lib/client.js` 里的 `NAV_ICON` 常量（默认是自绘的"风景画"SVG，无商标）可替换——改成你自己的图标即可（20×20，推荐 SVG data URL 或 base64 PNG）

### 包含的逆向工具（tools/）

| 工具 | 用途 |
|---|---|
| `unmpkg.py` | mpkg 容器解析/提取（PKGM0014/0018） |
| `tex2png.py` | TEXV0005 纹理解码（DXT5/R8 等） |
| `mdl_explorer.py` | .mdl 结构探索（块标签/网格/浮点区段） |
| `xref.py` | wallpaper64.exe 字符串 xref + 反汇编（capstone） |
| `MDL-格式分析笔记.md` | .mdl 格式逆向进展（容器/网格已破解，骨骼=JSON，动画待续） |

### 壁纸格式研究摘要（供其他开发者）

- **mpkg**：PKGM0014（视频类：mp4+gif+json）/ PKGM0018（场景类：scene.json+tex+mdl+shader）
- **tex**：TEXV0005，格式 5=DXT 家族，格式 34=内嵌 MP4 视频纹理（customize 壁纸的 4K 动画直接在里面）
- **mdl**：MDLV00xx 块容器；网格=8 float/顶点；MDLS0003/0004 含 JSON 骨骼姿态；MDLA=动画

## 渲染可行性研究

- 完整场景（含 Live2D 木偶）只能由专有渲染器完成：`壁纸引擎` App 的原生库 `libscenejni.so`（40MB，内嵌 Chromium + 专有 puppet 渲染）；开源方案 [we-layerd](https://github.com/Aromatic05/we-layerd)（Rust）打包了官方渲染器，但**仅限 Linux Wayland** 桌面（GNOME/niri/Hyprland/KDE Plasma），Windows 与 Termux proot 都跑不了
- 浏览器端没有成熟的 WE 场景渲染器（[wallgl](https://github.com/lucaschnabel42/wallgl) 是雏形且不支持木偶；pixeltris/wallpaper-engine-web 已消失）——**与操作系统无关，任何浏览器都无法直接渲染 Live2D 场景**
- **可行路径（跨平台通用）**：外部渲染成视频 → 插件**视频背景**（MP4/WebM 存 IndexedDB，`<video>` 循环播放）：
  - **Windows**：Wallpaper Engine 官方版（Steam，Windows 原生渲染全部场景）或开源 [Lively Wallpaper](https://github.com/rocksdanister/lively)（支持视频/网页壁纸，不解析 WE 场景格式）→ 录屏导出 mp4
  - **Linux 桌面**：we-layerd 渲染 → 录屏
  - **移动端**：壁纸引擎 App 录屏
- 插件在任意平台（Windows/Linux/macOS/移动端）的 dsh web 上功能一致：preview.gif / 内嵌视频纹理 / 多时段切换全部可用


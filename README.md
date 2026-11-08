# dsh-mpkg-wallpaper

**把 Wallpaper Engine 的动态壁纸带进 DeepSeek Harness Web UI。**

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![npm](https://img.shields.io/npm/v/dsh-mpkg-wallpaper)](https://www.npmjs.com/package/dsh-mpkg-wallpaper)
[![license](https://img.shields.io/badge/license-MIT%20%2B%20GPL--3.0--or--later-blue)](#许可证)

[中文](README.md) | [English](README.en.md)

dsh-mpkg-wallpaper 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh web`）的壁纸与界面外观插件：直接解析 Wallpaper Engine 的 `.mpkg`、Steam 创意工坊目录、视频 / 网页 / 场景壁纸，并提供整屏磨砂、透明表面、主题色、**悬浮岛式布局（Floating Island / Floating Cards）**、Now Playing、壁纸库与定时轮换。

> **一句话的差异化**：它不只是给 DSH 换一张背景图，而是把背景、磨砂、透明、悬浮卡片和主题色做成一套可调、可恢复、可诊断的完整外观系统。

---

## 目录

- [亮点：悬浮岛](#亮点悬浮岛)
- [功能一览](#功能一览)
- [安装](#安装)
- [快速开始](#快速开始)
- [壁纸来源与类型](#壁纸来源与类型)
- [外观系统](#外观系统)
- [播放、壁纸库与 Now Playing](#播放壁纸库与-now-playing)
- [设置在哪里](#设置在哪里)
- [安全与隐私](#安全与隐私)
- [兼容性与边界](#兼容性与边界)
- [排障](#排障)
- [开发与门禁](#开发与门禁)
- [文件结构](#文件结构)
- [许可证](#许可证)
- [反馈](#反馈)

---

## 亮点：悬浮岛

**悬浮岛（Island / Floating Cards）** 是这个插件最容易一眼认出的界面能力，对应设置里的 **「外观 → 悬浮效果」**（`float`）。

开启后：

- 左侧边栏、标题栏从“贴边的整块面板”变成**带圆角 + 阴影 + 透出壁纸的悬浮卡片**；
- 壁纸在卡片之间与边缘继续可见，形成类似“玻璃岛浮在桌面上”的层次感；
- 可与整屏磨砂、侧栏透明度、主题色、鼠标光晕叠加；关闭悬浮后其他透明/虚化设置不受影响；
- 悬浮几何、Now Playing 卡片和右侧栏的让位/放大逻辑都有独立判据，窗口缩放后自动重新校准。

> 想要最接近“island”的观感：打开「悬浮效果」，再把「界面统一 → 整屏虚化程度」调低到能透出壁纸纹理的档位，并给侧栏/标题栏设置合适的透明度。

---

## 功能一览

| 能力 | 说明 |
|---|---|
| **Wallpaper Engine `.mpkg`** | 浏览器内直接解析容器：视频类播放内嵌视频，场景类提取静态帧/图层，支持 WE 的时间变化壁纸 |
| **Steam 创意工坊** | 自动发现 Wallpaper Engine 安装与 `steamapps/workshop/content/431960`，按子文件夹识别壁纸 |
| **视频 / 图片 / 网页** | 本地视频、图片、动图、URL，以及沙箱 iframe 中的 HTML 网页壁纸 |
| **悬浮岛** | 左侧边栏 / 标题栏变成圆角悬浮卡片，可叠加磨砂、阴影、透明与主题色 |
| **整屏虚化体系** | 一条统一滑条 + 标题栏/侧栏/右栏/弹窗/菜单/遮罩各自独立的磨砂与透明度 |
| **主题色与玻璃** | 取色盘、品牌色、Aqua 实验外观、CSS 液态玻璃；默认全关，不影响原版 DSH |
| **播放与省电** | 暂停/播放；切页、失焦、电池供电时自动暂停（可配置） |
| **壁纸库与轮换** | 本地目录、WE 播放列表、上一张/下一张、1–120 分钟定时轮换 |
| **Now Playing** | 侧栏播放器：壁纸音轨清单、播放/暂停、音量/进度、系统媒体会话（MPRIS/SMTC） |
| **扫描壁纸页** | 右侧栏网格预览当前目录的壁纸，选中后应用，不打断当前页面 |
| **诊断与错误日志** | 一键采集环境/渲染/设置现场；错误日志按块展示、脱敏导出；不自动上传 |
| **大文件混合模式** | `.mpkg` 流式上传到 DSH 宿主，HTTP Range 播放，>600MB 也不一次性读进内存 |

---

## 安装

要求：已安装并能运行 `dsh web`；Node.js ≥ 20。

### 方式一：`dsh plugin add`（推荐，市场可识别）

```bash
dsh plugin --profile web add dsh-mpkg-wallpaper
# 重启 dsh web，然后浏览器 Ctrl+F5
```

### 方式二：pnpm 手动安装

```bash
pnpm --dir "$DSH_HOME/profiles/web" add dsh-mpkg-wallpaper
# 重启 dsh web，然后浏览器 Ctrl+F5
```

### 方式三：GitHub 克隆（开发者 / 离线）

```bash
git clone https://github.com/XHR666/dsh-mpkg-wallpaper.git \
  "$DSH_HOME/profiles/web/node_modules/dsh-mpkg-wallpaper"
```

然后在 `$DSH_HOME/profiles/web/cordis.patch.yml` 里注册：

```yaml
- insert:
    - id: dsh-mpkg-wallpaper
      name: dsh-mpkg-wallpaper
```

重启 `dsh web` 后生效。此方式不写依赖表，插件市场可能不显示「已安装」，只影响显示，不影响功能。

### 方式四：单文件 bundle（离线 / 应急；只装宿主端）

```bash
node tools/build-bundle.mjs
node tools/build-bundle.mjs --check
node tools/bundle-equivalence-test.mjs
```

把 `dist/dsh-mpkg-wallpaper.bundle.mjs` 放到任意目录，在 `cordis.patch.yml` 里用**绝对路径**登记：

```yaml
- insert:
    - id: dsh-mpkg-wallpaper
      name: /absolute/path/dsh-mpkg-wallpaper.bundle.mjs
```

注意：单文件 bundle 只包含**宿主端**（上传/Range/设置/诊断等路由）；客户端界面（设置面板、壁纸层、悬浮岛、Now Playing）需要完整的 npm 包。单文件模式也不建议使用「一键更新」。

### 更新

```bash
# 方式一 / 二
dsh plugin --profile web update dsh-mpkg-wallpaper

# 方式三
git -C "$DSH_HOME/profiles/web/node_modules/dsh-mpkg-wallpaper" pull

# 方式四
node tools/build-bundle.mjs   # 重新生成并替换 .mjs
```

更新后：重启 `dsh web` → 浏览器 `Ctrl+F5`。

### 卸载与残留数据

```bash
dsh plugin --profile web remove dsh-mpkg-wallpaper
```

可选清理：

- 浏览器 `localStorage['dsh.mpkg-wallpaper.v2']`
- 主数据目录 `$DSH_HOME/.dsh-mpkg-wallpaper/`（`settings.json`、上传的 `.mpkg`、转码缓存、`web-store.json` 等）
- 诊断/缩略图目录 `~/.dsh/.dsh-mpkg-wallpaper/`（`diag-*.json`、`thumbs/`）

> DSH Desktop 的 `desktop` profile 由 Electron 壳独占，不能直接使用 `dsh plugin --profile desktop add`；请通过桌面 App 的插件入口，或把包放进该 profile 的依赖树并保留 `cordis.patch.yml` 挂载行。

---

## 快速开始

1. 安装并重启 `dsh web`，浏览器强制刷新。
2. 打开 **设置 → DSH 壁纸引擎**（左侧栏「设置」里）。
3. 在「背景来源」里任选一种来源：
   - 拖入 `.mpkg`；
   - 选本地图片/视频；
   - 填图片或网页 URL；
   - 选择自定义目录（可直接选 Steam 的 `steamapps/workshop/content/431960`）。
4. 想调整观感，优先看这三处：
   - 「壁纸设置 → 磨砂模糊」；
   - 「界面统一 → 整屏虚化程度」；
   - 「外观 → 悬浮效果」。

出问题先打开 **「其他」→「查看错误日志」** 或点一次 **一键诊断上报**，再带上日志反馈。

---

## 壁纸来源与类型

| 来源 | 支持内容 |
|---|---|
| `.mpkg` 容器 | 视频、场景（静态帧/图层合成）、时间变化素材、内嵌音轨 |
| Steam 创意工坊 | `steamapps/workshop/content/431960` 下的视频 / 网页 / 场景壁纸；支持非默认 Steam 库 |
| 本地目录 | `.mpkg`、workshop 子目录、图片、视频、场景 `scene.pkg` 混放均可识别 |
| 图片 / 动图 | 本地文件或 URL（含 `data:image`） |
| 视频 | `.mp4 / .webm / .mov / .m4v` |
| 网页壁纸 | HTML 在沙箱 iframe 中运行；可配置网页与交互 |
| 场景壁纸 | 由内置 WEwebLoader 渲染器在 iframe 中渲染；支持静态帧兜底与无 WebGL 环境降级 |

### 时间变化壁纸

识别 WE 的 `morningtime / daytime / dusktime / nighttime / timevarying` 属性：

- 按当前系统时间自动选择时段；
- 时段素材按需懒加载，不一次导入全部时段；
- 可手动锁定某个时段，点「自动」恢复；
- 切换壁纸时清空上一张的时段缓存，避免串台。

### 大文件混合模式（hybrid）

默认开启：`.mpkg` 通过 Range 流式上传到 DSH 宿主并落盘，播放时按需读取，**不把整个容器读进内存**。关闭后回到纯浏览器解析模式（受浏览器内存限制）。

---

## 外观系统

### 1. 悬浮岛

- 设置位置：**外观 → 悬浮效果**（默认关）。
- 效果：左侧边栏、标题栏变成圆角悬浮卡片，带阴影并透出壁纸。
- 可与以下设置叠加：侧栏/标题栏透明度、整屏磨砂、主题色、鼠标光晕。
- 不影响原有透明/虚化开关；关闭悬浮即恢复贴边布局。

### 2. 整屏磨砂与透明

- **统一虚化**：一条滑条同时控制壁纸模糊与侧栏/标题栏白雾厚度；聊天区是否跟随、新会话按钮是否跟随可分别设置。
- **独立虚化**：对话框、设置面板、确认弹窗、菜单/弹层、遮罩、左侧边栏磨砂各自有开关和程度。
- **表面透明**：左侧边栏、标题栏、右侧边栏/dock 可独立设置透出壁纸。

### 3. 主题色、Aqua 与玻璃

- 主题颜色与品牌交互色可分别设置；
- Aqua 实验外观（自动取壁纸主色、文字可读增强、任务列表磨砂等）默认全关；
- CSS 液态玻璃可作用于输入框、左侧边栏、标题栏；不需要 WebGL 运行时。

### 4. 鼠标光晕

开启后，指针所在面板内部以指针为中心泛出柔和光晕；关闭后不监听、不写变量。与悬浮效果联动，悬浮关闭时不生效。

---

## 播放、壁纸库与 Now Playing

### 播放与省电

- 视频/网页壁纸支持暂停/播放，状态跟随真实媒体元素；
- 省电策略：切页、窗口失焦、电池供电时自动暂停（可分别开关）；恢复后按之前状态继续；
- 调整外观设置不会让正在播放的壁纸重新开始。

### 壁纸库与轮换

- 从 Steam 创意工坊或自定义目录扫描本地壁纸；
- 可导入 WE 的播放列表作为轮换列表；
- 上一张/下一张一键切换，定时轮换 1–120 分钟；
- 列表勾选后滚动不会跳回顶部。

### Now Playing

- 在左侧栏「设置」上方挂载播放器卡片（默认开）；
- 播放壁纸音轨清单，支持播放/暂停、音量、进度；
- 宿主支持时接入系统媒体会话（MPRIS / SMTC）；
- 宿主同位置已有其他插件元素时自动让位。

### 扫描壁纸页

右侧栏的「扫描壁纸」使用网格缩略图展示当前目录，可选中并应用；详情区显示名称、容器内文件与类型。预览图与真实壁纸分离，避免列表加载卡顿。

---

## 设置在哪里

设置入口：**左侧栏「设置」→「DSH 壁纸引擎」**，共 7 个 tab：

| Tab | 主要内容 |
|---|---|
| 背景来源 | 总开关、hybrid、当前壁纸、文件/目录/URL 选择 |
| 壁纸设置 | 磨砂、镜头缩放/位移、翻转、亮度、播放速度、暂停与刷新 |
| 外观 | **悬浮效果**、鼠标光晕、主题色、圆角、灰字、液态玻璃 |
| 界面统一 | 整屏虚化程度、聊天区/新会话按钮是否跟随 |
| 界面虚化 | 对话框/设置/弹层/遮罩/侧栏的独立磨砂 |
| 其他 | 省电、Now Playing、壁纸库/轮换、备份恢复、错误日志、诊断 |
| 测试项 | 渲染器来源、诊断参数、兼容性开关等开发者选项 |

另有无面板控件的进阶项（URL 开关、渲染器诊断、环境变量），见 [docs/](docs/) 内的专项说明。

---

## 安全与隐私

- 壁纸解析、转码与存储都在本机完成；**不自动上传**任何内容。
- 网页壁纸默认运行在沙箱 iframe 中；父页与子帧只通过 `postMessage` 通信，并对来源/操作做白名单校验。
- 图片/网页 URL 只接受允许的协议与目标；场景渲染器地址只接受回环/同主机/显式白名单，拒绝时如实回落并记录。
- 自定义目录拒绝路径穿越、绝对路径和敏感目录；`/raw` 只提供已登记容器条目。
- 系统媒体会话命令以 argv 数组传递，不经过 shell。
- 一键诊断与错误日志只写入本机；导出时支持「脱敏日志」与「完整日志」两种模式。

---

## 兼容性与边界

- **浏览器**：Chrome / Edge（推荐）、Firefox；无 WebGL 2 的环境会降级为静态帧并给出明确提示。
- **DSH Mobile**：移动外壳下对侧栏抽屉、模糊强度与慢链路首帧做了适配；桌面行为保持不变。
- **DSH Desktop**：支持通过桌面 profile 安装；宿主页面若为 `file://`，客户端会按 DSH 口径解析 `http://dsh.internal`。
- **Windows**：可自动发现 Wallpaper Engine 安装与 Steam 库；非 Windows 可手动指定创意工坊目录。
- **做不到的**：不把 `.exe` / 非媒体文件当壁纸；不保证所有 WE 场景特效完全一致；网页壁纸的交互能力受浏览器沙箱限制；不自动下载 Wallpaper Engine 的付费素材。

---

## 排障

1. **没看到壁纸**：确认总开关开启、已选来源；重启 `dsh web` 后 `Ctrl+F5`；检查浏览器控制台。
2. **场景壁纸黑屏/静态帧**：打开「测试项 → 渲染器来源」确认使用内置渲染器；无 WebGL 环境会显示静态帧提示。
3. **悬浮岛不生效**：确认「外观 → 悬浮效果」已开；窄窗口/移动端布局可能自动切换，宽度恢复后重新校准。
4. **手机端侧栏透明**：先在手机 App 内完全退出再重新打开（刷新客户端 bundle），仍异常请附上设备/DSH Mobile 版本。
5. **导出日志**：错误日志弹窗里每条错误右侧提供「导出脱敏日志 / 导出完整日志」；底部可清除或关闭。

更多专项排障：`docs/` 下的 DIAGNOSTICS、WALLPAPER-LIFECYCLE、WEB-WALLPAPER、NOW-PLAYING-DSH 等文档。

---

## 开发与门禁

```bash
# 快速自检
node tools/integrity-check.mjs
node tools/secret-scan-test.mjs
node tools/style-scope-guard.mjs

# 全量 12 步门禁（部分步骤需要 headless Firefox / 本机 :3080）
bash tools/check.sh
```

生成物说明：

- `lib/client.js` 是宿主下发的客户端单文件；`lib/now-playing.js`、`lib/now-playing-math.js`、`lib/audio-bus.js` 由构建脚本内联进生成区，禁止手改生成区；
- `renderer/**` 是内置场景渲染器（GPL-3.0-or-later）；插件只通过 iframe + postMessage 调用，不 import 其源码；
- `dist/`、`tools/`、`docs/` 不进入 npm 发布包。

---

## 文件结构

```text
dsh-mpkg-wallpaper/
├── package.json          # npm 元数据 + dsh 插件声明 + files 发布白名单
├── cordis.patch.yml      # dsh 安装声明
├── LICENSE               # MIT（插件本体）
├── LICENSE-render        # GPLv3（renderer/**）
├── NOTICE                # 双许可范围/归属/修改声明
├── LICENSES/             # MIT.txt、GPL-3.0-or-later.txt
├── lib/                  # 宿主端 + 客户端（client.js 为单文件下发）
├── renderer/             # 内置 WEwebLoader 场景渲染器（GPL-3.0-or-later）
├── tools/                # 门禁/测试/构建脚本（不随包发布）
├── docs/                 # 研发与运维文档（不随包发布）
└── dist/                 # 单文件 bundle 构建产物（不提交）
```

---

## 许可证

本仓库包含两个独立许可的部分：

| 部分 | 许可证 | 全文 |
|---|---|---|
| 插件本体 `lib/**`、图标、README、NOTICE、THIRD-PARTY 等 | **MIT** | [`LICENSE`](LICENSE)、[`LICENSES/MIT.txt`](LICENSES/MIT.txt) |
| 内置渲染器 `renderer/**` | **GPL-3.0-or-later** | [`LICENSE-render`](LICENSE-render)、[`renderer/LICENSE`](renderer/LICENSE)、[`LICENSES/GPL-3.0-or-later.txt`](LICENSES/GPL-3.0-or-later.txt) |

两部分的目录边界、再分发提示与 GPLv3 §5a 修改声明见 [`NOTICE`](NOTICE)。第三方组件与归属见 [`THIRD-PARTY.md`](THIRD-PARTY.md) 与 [`renderer/THIRD-PARTY.md`](renderer/THIRD-PARTY.md)。

`package.json` 的 `license` 字段为 `SEE LICENSE IN NOTICE`。

---

## 反馈

反馈时请附上：

1. 原始 `.mpkg` 或创意工坊目录（能复现问题即可）；
2. 一次「其他 → 一键诊断上报」的结果；
3. 浏览器控制台报错；
4. DSH 版本、操作系统、浏览器/客户端环境。

仓库：<https://github.com/XHR666/dsh-mpkg-wallpaper>
npm：<https://www.npmjs.com/package/dsh-mpkg-wallpaper>

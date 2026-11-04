# WEwebLoader (浏览器端Wallpaper Engine壁纸渲染器)

**[中文](README-PUBLIC.md)** | [English](README-PUBLIC.en.md)

在浏览器里**实时渲染 Wallpaper Engine 的场景壁纸**（`scene.pkg` / 本项目的 `.mpkg` 容器 / workshop 源目录），
不需要 Wallpaper Engine、不需要 Windows、不需要 GPU 专用驱动 —— 一个本地 Node 静态服务器 + 支持 WebGL2 的浏览器即可。

> ⚠ **主 README 是 `README.md`**（GitHub 首页展示），其中含**免责声明**（中英）与完整的
> **「参考与致谢 / References & Credits」**章节。本文件是**给下载者看的入口文档**（保留为发布面必需文件锚点，
> `publish-check.mjs` 要求其在位），**§1–§6 与主 README 同源 —— 改一处请同步另一处**。
> 项目内部的开发/诊断文档见 `docs/RENDERER-ARCHITECTURE.md`、
> `README-DIAGNOSTICS.md`、`TESTING.md`、`PATCHES.md`；第三方代码与许可的法律文本见 `THIRD-PARTY.md`。

---

## 1. 快速开始（两条路，任选）

### A. 用自带服务器（推荐，功能最全）
```bash
node server/we-scene-demo-server.mjs          # 默认监听 0.0.0.0:8899
# 浏览器打开 http://127.0.0.1:8899/
```
自带服务器提供：包/目录读取、`/report` 上报落盘、`/weassist` WE 资产兜底、CORS（供 iframe 嵌入）等。
端口可用环境变量覆盖：`PORT=9000 node server/we-scene-demo-server.mjs`。
首屏：本机有语料就渲染默认包；**没有语料**（本仓库不分发真实壁纸）时页面会明确提示并自动渲染自带的合成样例
（也可直接打开 `http://127.0.0.1:8899/?id=sample-synthetic`）。

### B. 任意静态服务器（只读模式）
```bash
python3 -m http.server 8899            # 或 npx serve -l 8899
# 浏览器打开 http://127.0.0.1:8899/demo.html?id=<包id>   （需要自带包文件时用方案 A）
```
静态模式下渲染器仍可打开，但依赖服务器端点的功能（包代理、`/report`、WE 资产兜底）不可用。

---

## 2. 加载一张壁纸

| 方式 | URL | 说明 |
|---|---|---|
| 内置样例 | `?id=sample-synthetic` | 仓库**唯一**自带的场景：程序化生成的合成样例（无第三方素材），见 `samples/` |
| 打开首页 `http://127.0.0.1:8899/` | 无 `?id=` | 默认包 id 是作者的测试壁纸（**不随仓库分发**）：本机没有该语料时页面会**明确提示**并自动改渲染上面的合成样例 |
| 本地包文件 | `?pkgpath=/绝对路径/scene.pkg` | 服务器白名单内的路径（白名单用 `MPW_ALLOW_DIRS` 覆盖，冒号分隔；仓库自带 `samples/` 已在默认白名单里） |
| 远程包 URL | `?pkgurl=https://…/scene.pkg` | 服务器**代理抓取**（绕 CORS） |
| **workshop 源目录** | `?pkgurl=http://127.0.0.1:8899/pkgdir?d=/绝对目录` | 服务器**即时把目录打包成容器**再喂给渲染器；`/pkgdir?scan=1` 可列出可打包目录 |
| 包 id | `?id=<目录名>` | 在 `MPW_SCENE_ROOT`（见下表）与 `<repo>/samples` 两档里按目录名匹配；**真实壁纸要你自己提供语料** |

`?ln=<N>` 逐层调试、`?time=`/`?hour=` 固定时段、`?showui` 显示被隐藏的 UI 层等调试开关见 `README-DIAGNOSTICS.md`。

---

## 3. 内置样例（`samples/`）——**本仓库不分发任何真实壁纸**

| 目录 | 内容 |
|---|---|
| `samples/sample-synthetic/` | 合成样例包：`scene.pkg`（≈33KB）+ `project.json`。5 层：渐变背景、组合容器、动画纯色条、随动+缩放循环的圆点、绑定属性的文字标签 |
| `samples/sample-synthetic-src/` | 同一场景的**松散源文件**（`scene.json`、`models/`、`materials/`）。把它打包出来的结果与上面的 `scene.pkg` **逐字节相同** ⇒ 同时是"目录源"夹具 |
| `tools/make-sample.mjs` | 生成器：`node tools/make-sample.mjs`（确定性，同参数同 sha256）；`--prod-verify` 会用生产解析器逐条校验 |

样例**不含任何第三方素材或音频**（纹理全部由脚本程序化生成）。
`samples/wallpapers/` 曾随仓库分发 4 个真实 Steam 工坊壁纸（198MB）——**因版权已整体删除**（记录见 `PATCHES.md` P-87）；
真实壁纸请放在仓库**外**，用 `MPW_SCENE_ROOT` / `?pkgpath=` / `?pkgurl=` 指向你自己的副本（细节见 `samples/README.md`）。

---

## 4. 环境变量（都有默认值；缺省时按脚本位置推导）

| 变量 | 默认 | 用途 |
|---|---|---|
| `PORT` | `8899` | 监听端口 |
| `MPW_ROOT` | **本仓库的父目录**（按脚本位置推导，不再写死作者机路径） | 其它路径的基准 |
| `MPW_SCENE_ROOT` | 存在的第一个：`$MPW_ROOT/allwallpaper/dd` → `<repo>/samples`；都不存在则是一个**明确不存在**的占位路径（启动日志会写明，`?id=` 一律 404） | `?id=` 的包目录根 |
| `MPW_REPORTS_DIR` | `$MPW_ROOT/reports` | `/report` 上报落盘目录（只保留最新 60 份） |
| `MPW_WE_ASSETS` | 自动探测本机 Steam/WE 安装目录 | WE 官方资产兜底（着色器/粒子预设/材质）；**不随仓库分发**，找不到就跳过 |
| `MPW_ALLOW_DIRS` | 若干本地目录 + `<repo>/samples` | `?pkgpath=`/`/pkgdir` 的路径白名单（冒号分隔） |
| `MPW_PKG_EXTRACT` | 同目录 `pkg-extract.mjs`，否则插件仓库路径 | 包解析器（公开副本请把 `pkg-extract.mjs` 放在服务器同目录） |

---

## 5. 许可与第三方

- **本项目自有代码：GNU GPL 第 3 版或更新版本（`GPL-3.0-or-later`）**，全文见仓库 `LICENSE`
  （上半部分 = GNU GPL v3 条款原文，未改动；末尾附版权声明与 "either version 3 … or (at your option)
  any later version" 措辞）。SPDX 标识：`GPL-3.0-or-later`。
- **本仓库不含任何 WE（Wallpaper Engine）素材**：不分发 `scene.pkg`/`.mpkg`、贴图、官方着色器头、
  音频、视频或任何工坊作品；自带样例只有程序化生成的 `samples/sample-synthetic*`。真实壁纸请自备语料（见 §2/§3）。
- **本渲染器 import 了 MIT 许可的插件 `dsh-mpkg-wallpaper`**（包解析器 `lib/pkg-extract.js`）。
  该插件**保持 MIT**；借用在 MIT → GPL 的允许方向上，**插件的 MIT 声明随之保留**，
  不得被本仓库的 GPL 覆盖或删除（规则见 `docs/COPYING-RULES.md`）。
- **命名说明（2026-09-18）**：本项目有两个名称：**WEwebLoader**；npm 包名与仓库名仍是 `wallpaper-engine-web-loader`。
  上游项目名仍是 **WebWallGL**（`oneincase/webwallgl`，MIT），**归属与许可不因此改变**（下一条即上游登记）。
- `webwallgl`（**MIT © oneincase**）：本仓库**不 vendored 它的任何文件**（仓库外的 `vendor-ref/webwallgl`
  只是上游研读副本）；但 **P-90 把它的 FXAA 片元着色器（`FXAA_FRAG`，上游 452–489 行）逐字移植了进来**
  —— 落在 `core/we-scene-bundle.js` 的 `FXAA_FS` 常量，归一化后 38/38 行 GLSL 一致；**MIT 声明已保留**
  （源码内来源注释 + `THIRD-PARTY.md` §6 全文 + `docs/COPYING-RULES.md` §4 台账 #6）。
  质量档位 `?q`/`?aa`/`?pp` 与 `setQuality` 为自研（上游 `quality.ts` **未复制**，仅对齐档位含义）。
- **移植自 [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（MIT © 2026 elysia395，渲染器作者 YV3507）** 的部分：`elysia/**` 与 `core/attach-transform.mjs` —— 完整署名与 MIT 全文见 `THIRD-PARTY.md` 与 `elysia/LICENSE`。
- 内置的 `@shaderfrog/glsl-parser`（ISC, Andrew Ray）：上游未附许可文件，本项目在 `elysia/vendor/@shaderfrog/glsl-parser/LICENSE` 中补齐。
- **字体**（OFL-1.1 / Apache-2.0 / CC-BY-4.0，位于 `assets/fonts/`）：逐文件的来源、版权行、
  上游 URL、下载日期、字节数与 sha256、以及随附的许可全文清单，见 `THIRD-PARTY.md` §4
  与 `assets/fonts/licenses/`。
- **壁纸包（`scene.pkg`/`.mpkg`）与其中的美术、音乐版权归各自作者**（多数来自 Steam 创意工坊）。仓库自带的样例为程序化生成；请勿把他人作品再分发。
- 换 GPL 的决定与落地记录见 `PATCHES.md` P-89；本文件不是法律意见。

## 6. 已知限制

- 需要 WebGL2；无 GPU 时会退回 CPU 路径（功能受限、明显更慢）。
- 复杂的蒙皮/粒子/效果链仍在持续完善，问题清单与进展见 `known-issues.json` 与 `PATCHES.md`。
- 音频不会随仓库分发：载入含音频的包时，由页面**在你本地现场解析**播放/导出（详见渲染器顶栏音频面板）。

## 7. 参考与致谢 / References & Credits

**逐个列出所有参考过的上游项目**（项目名 + 仓库 URL + 许可 + **具体参考了什么** + 是否复制过代码）见
**主 README `README.md` §7**；第三方许可全文与"参考/行为对照登记表"见 `THIRD-PARTY.md`
（§1–§7 为复制/分发项，**§8 为参考对照登记表**，§9 为 HLSL→GLSL 转译器 vendoring，§10 为仅行为对照的本机副本）；
复制/借鉴台账见 `docs/COPYING-RULES.md`。

两条**必须一并阅读**的例外（详见 `README.md` §7.4 与 `THIRD-PARTY.md` §8）：

- `Aromatic05/wallpaper-engine-renderer`（**GPL-2.0-only**，为 `catsout/wallpaper-scene-renderer` 的 fork）：
  本仓库自己的审计曾判定有 **2 处点状同源**（alpha 归一化、alignment 偏移，约 2 个函数 / ~11 行，
  **无逐字复制**）；GPL-2.0-only 与本仓库 GPL-3.0-or-later **双向不兼容** ⇒
  **已于 2026-09-16 按书面规格洁净室重写**：规格 `docs/IMAGE-ALPHA-ALIGN-SPEC.md`、
  符合性测试 `clean-room-alpha-align-test.mjs`（**1008 pass / 0 fail**，含与改前 `Object.is` 逐位对拍），
  旧实现已删除；连同 2 处弱形态（公式级注释、命名级注释）一并清理。
  登记留痕：`PATCHES.md` **P-95**；`docs/WER-REF-LICENSE-AUDIT.md` §3.4 已加"✅ 事后追加"。
  **仍未结案**：法律定性（审计 §7 **U-1 / U-5**，需律师意见）。
  编号已统一为 **P-95**（源码注释/测试/架构文档/THIRD-PARTY 全改；`PATCHES.md` 的 P-91 是"分发形态"另一件事），
  `core/we-scene-bundle.js` 里最后一处上游表达式括注也已删除。
- `notscuffed/repkg`：许可**已定案 = MIT**（`Copyright (c) 2019 notscuffed`）——依据 = 上游 `LICENSE` 原文
  （<https://raw.githubusercontent.com/notscuffed/repkg/master/LICENSE>，2026-09-17 复核 = MIT 全文）+ **项目所有者确认**。
  既有文档里记成 GPL 的那一侧**系本仓库早期误记，已全部作废更正**（逐处清单见 `docs/LICENSE-COMPAT-REVIEW.md` §10，
  规则修订见 `docs/COPYING-RULES.md` §6 + §9.10）。`core/we-scene-bundle.js` 里"逐行对齐 RePKG 的 LibSquish 移植实现"
  这一表述**即使成立也属 MIT → GPL-3.0-or-later 的允许方向**，只需按 `docs/COPYING-RULES.md` §4 登记并保留 MIT 声明；
  **本仓库当前未 vendored 任何 RePKG 代码**（工作区无检出副本），故无需新增声明。
- **无许可 / 许可不兼容的上游**（例：`Aromatic05/we-layerd` —— 无 LICENSE = 保留所有权利；`Aromatic05/wallpaper-engine-renderer`、
  `catsout/…`、`waywallen/open-wallpaper-engine` —— GPL-2.0-only，与本仓库双向不兼容）：处置**不是**"看着办"，而是
  `docs/COPYING-RULES.md` **§9 的 L1–L5 阶梯** —— L1 洁净室重写 → L2 查上游元数据（`Cargo.toml`/`package.json`/`go.mod`
  + **上游自己的打包元数据**）→ L3 自写等价实现（含**增量重写**）→ L4 换**许可兼容**的类似项目 → L5 **隔离块**
  （单独文件/目录 + 界面或配置一键禁用 + 可整体删除且不影响其余功能 + README 公开写明"此块因上游许可不明，
  作者要求即删"）。**L5 是最后手段，且"不偷偷删除"**：任何删除都在 `PATCHES.md`/`CHANGELOG` 公开留痕。
  **本仓库当前没有任何 L5 块**；`we-layerd` 的 L2 查证与判定见 `docs/COPYING-RULES.md` §9.8，GPL-2.0-only 的已合规处置
  （P-95 洁净室）见 §9.9。
- `oneincase/webwallgl`（**MIT**）：**逐字复制**了 FXAA 片元着色器（`FXAA_FS`），并**逐字节 vendored**
  了 HLSL→GLSL 转译器（`vendor/hlsl2glsl/`，P-93）；另外 `demo/**` 是它的**静态构建产物补丁版再分发**，
  MIT 声明分别保留在 `core/we-scene-bundle.js` 注释 / `vendor/hlsl2glsl/LICENSE` / `demo/LICENSE-webwallgl-MIT.txt`。

另：`NixaXI/AnisPaper` 仅在许可兼容性研究中被评估，**未参考其代码**，故不作为致谢项列出。

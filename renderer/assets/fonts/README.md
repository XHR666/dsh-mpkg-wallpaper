# assets/fonts — 随仓库分发的字体（P-86）

本目录是渲染器的**第二级字体来源**（四级链：包内 → **仓库自带** → 本机 WE → `sans-serif`）。
`server/we-scene-demo-server.mjs` 把本目录挂在 `/assets/fonts/<文件名>` 下（含 `licenses/` 子目录）。

> **一句话纪律**：本目录里**没有**任何一个文件是从 Wallpaper Engine 安装目录
> （`<WE>/assets/fonts/`）复制来的。每个文件都能追溯到作者/上游的下载 URL，
> 逐个文件的许可、版权行、上游 URL、获取日期与 sha256 见上级目录的 `THIRD-PARTY.md` §4。

## 目录内容

| 仓库里的文件 | 许可 | 上游来源（唯一取件口） |
|---|---|---|
| `Blackout 2 AM.ttf` | OFL-1.1（RFN `Blackout`） | `https://github.com/theleagueof/blackout` |
| `monof55.ttf` | OFL-1.1（作者邮件确认；见 `licenses/monofur-author-OFL-email.txt`） | Debian `fonts-monofur` 1.0 上游 tarball（`https://deb.debian.org/debian/pool/main/f/fonts-monofur/`） |
| `NotoSans-Regular.ttf` | OFL-1.1 | `https://github.com/notofonts/noto-fonts` |
| `RobotoMono-Regular.ttf` | OFL-1.1（上游现行版；**不是** Apache-2.0） | `https://github.com/googlefonts/RobotoMono` |
| `Segment7Standard.otf` | OFL-1.1（RFN `Segment7`） | `https://fontlibrary.org/en/font/segment7` |
| `spincycle_3d_ot.otf` | 作者 freeware 条款（可商用、可再分发；见下 §Spin Cycle） | `https://www.bvfonts.com/fonts/details.php?id=44` |
| `Twemoji.Mozilla.ttf` | 美术 CC-BY-4.0 / 代码 Apache-2.0 | `https://github.com/mozilla/twemoji-colr`（release v0.7.0） |

许可全文/归属声明全部在 `licenses/`（`OFL-*.txt`、`Apache-2.0.txt`、
`CC-BY-4.0-Twemoji-attribution.txt`）。

## WE 引用名 → 仓库文件名（映射表）

工坊壁纸的 `scene.json` 里写的是 WE 内置字体的**文件名**（例如时钟层的
`fonts/Monofur-PK7og.ttf`）。我们按上游取件，因此**保留上游文件名**；名字与 WE 引用名不同的两个，
在 `demo.html` 的 `REPO_FONT_ALIASES` 常量里显式对应（其余为同名恒等）：

| 壁纸里的 `fonts/<名>` | 本目录的实际文件 | 为什么不同名 |
|---|---|---|
| `Monofur-PK7og.ttf` | `monof55.ttf` | Debian/作者上游发布名就是 `monof55.ttf`（Regular）；不重命名上游文件 |
| `TwemojiMozilla.ttf` | `Twemoji.Mozilla.ttf` | Mozilla 上游发布名带点号 |
| `Blackout 2 AM.ttf` / `NotoSans-Regular.ttf` / `RobotoMono-Regular.ttf` / `Segment7Standard.otf` / `spincycle_3d_ot.otf` | 同名 | — |

映射只在**取 URL 时**生效（`repoFontUrl()`），字体族名仍由文件自己的 sfnt `name` 表决定
（例如 `monof55.ttf` 的族名是 `monofur`），渲染器给每个字体注册的 CSS 族名是
`mpw-<hash>`，与文件名无关。

## Spin Cycle 3D：作者条款与回链（**显著位置，请勿删除**）

`spincycle_3d_ot.otf` 由作者 **Jess Latham**（旧名 Blue Vinyl Fonts / BV Fonts）免费发布。
**官方站点：<https://www.bvfonts.com/>** —— 字体页 <https://www.bvfonts.com/fonts/details.php?id=44>，
条款 <https://www.bvfonts.com/tou.php>，FAQ <https://www.bvfonts.com/faq.php>。
请到作者站点下载最新版；作者原话：*"It's always a good idea to download the latest version from
bvfonts.com, archive sites don't always update their files."*

本仓库遵守的条件（逐条对照见 `THIRD-PARTY.md` §4.6）：

1. **允许**个人与商业使用、允许再分发（`All free fonts at bvfonts.com are freeware. You may use
   them in personal or commercial work.`）。
2. **不得**放进 CD-ROM / 合集光盘或任何"字体合集"形态的产物 —— 本目录**不是**字体合集：
   它只带渲染器真正会用到的那几个字体，且整个仓库是免费、GPL-3.0-or-later 许可的源码仓库，不售卖。
3. **不得**转售、重新包装销售、**不得重编译** —— 我们原样分发作者 zip 里的
   `Open Type/spincycle_3d_ot.otf`（未改名、未转格式、未重编译、未修改一个字节，sha256 见 `THIRD-PARTY.md`）。
4. **回链**作者站点：本文件（字体所在目录的说明文件）、`THIRD-PARTY.md`、
   以及 `demo.html` 的字体来源日志/注释里都指向 <https://www.bvfonts.com/>。

作者保留随时改条款的权利；条款原文快照（含抓取日期与页面 sha256）在
`licenses/spincycle-bvfonts-TOU.txt`，随字体一起分发的原始说明在
`licenses/spincycle-bvfonts-README.txt`。

## 本目录**未**包含的字体（P-127 重新核过：缺哪些 / 影响面 / 能不能补）

WE `assets/fonts/` 里一共 **15 个字体**，本目录 **7 个**。差集 **8 个**，逐个的许可判据与
语料影响面如下（引用数 = 全语料 98 个 `.pkg`/`.mpkg` 容器里**文本层**的 `font` 属性命中数，
逐条可复算：`node tests/font-gap-audit-test.mjs`，冻结值在同一文件的 `CENSUS`）：

| 未打包的字体 | 许可判据（一句话） | 语料引用 | 结论 |
|---|---|---|---|
| ~~`8bitOperatorPlus8-Regular.ttf`~~ → **已打包为 `PixelOperator8.ttf`** | **CC0-1.0**（公有领域奉献，可自由再分发）—— 该字体现名 **Pixel Operator**（同一作者 Jayvee Enaguas / HarvettFox96，2018-10-04 起改 CC0-1.0），我们从作者 DaFont 发布页取现行版 | **61 层 / 17 个容器**（原为缺口里影响最大的） | **已收口**：`demo.html` 的 `REPO_FONT_ALIASES` 把旧名 `8bitOperatorPlus8-Regular.ttf` 映射到 `PixelOperator8.ttf`；⚠ 两版**字形不完全相同**（现行版 241 字形 ⊃ 旧版 229，作者加了 Esperanto/货币符号并微调）——详见 `THIRD-PARTY.md` §4.7 |
| `Alcubierre.otf` | 未定：文件内 `Copyright (c) 2015 by Ellis Design. All rights reserved.`；回溯作者上游查不到分发授权 | 34 层 / 21 容器 | 不能打包（**未定**不是"可以"） |
| `Atami-Regular.otf` | 未定：`Copyright © 2016 by Andrew Herndon. All rights reserved.`；该作者其它免费件一律带 `Personal Use` | 23 层 / 10 容器 | 不能打包 |
| `CursedTimerUlil-Aznm.ttf` | 未定：东方同人二创，权利链本身不明 | 6 层 / 3 容器 | 不能打包 |
| `Lazer84.ttf` | 免费档只授予**使用**、未授予再分发（文件内 ID0 还是没填写的模板串 `Typeface © (your company)`） | 6 层 / 3 容器 | 不能打包 |
| `opensticks.ttf` | 仅 `Free for commercial use.`（**使用**授权，不是**分发**授权） | 6 层 / 3 容器 | 不能打包 |
| `kust.ttf` | 未定：只有版权串、无任何授权语句 | **0** | **不需要**（语料里没有任何层引用它） |
| `summer85.ttf` | 未定：作者站点已消失 / 域名易主，一手条款取不到 | **0** | **不需要** |

**运行时行为**：这 8 个都**不在**包内（实测：引用它们的层没有一个能从自己的容器里拿到字体），
所以第①级必然落空 → 第②级（本目录）也没有 → **第③级读你本机 WE 安装目录**
（`/weassist/fonts/<basename>`）；装了 WE 的机器上就是真字体，**没装 WE 才落第④级 `sans-serif`**，
且**不抛异常**（日志会写"缺失→回退"；这四级链的回归在 `tests/text-font-fallback-test.mjs`）。
`kust.ttf` / `summer85.ttf` 这两个 0 引用的即使缺也无人受影响。

### 想让缺的字体也生效？把文件放进**本目录**即可

第②级就是本目录：`server/we-scene-demo-server.mjs` 把 `assets/fonts/<文件名>` 直接吐出来，
**不需要改任何代码**（`demo.html` 的 `REPO_FONT_ALIASES` 只处理"文件名与 WE 引用名不同"的两个：
`Monofur-PK7og.ttf`→`monof55.ttf`、`TwemojiMozilla.ttf`→`Twemoji.Mozilla.ttf`）。
自备步骤（**你自己有合法副本**时）：

1. 把字体文件按 **WE 引用名**放进本目录（例：`8bitOperatorPlus8-Regular.ttf`、`Alcubierre.otf`）；
2. 刷新页面 —— 第②级命中，日志里该字体会变成"仓库自带"；
3. 如果你手上的文件名与 WE 引用名不同（例如从上游拿到的发布名不一样），
   在 `demo.html` 的 `REPO_FONT_ALIASES` 里加一条 `'<WE 引用名>': '<你的文件名>'`。

> **只放你有权再分发的副本**。本目录是**随公开仓库分发**的：放进来就等于再分发。
> 上游取件的完整配方（URL 形状、sha256 校验、`THIRD-PARTY.md` 登记格式）见 `THIRD-PARTY.md` §4.8。

背景调研（为什么不能从 WE 目录复制、15 个字体逐个的许可证据）见
`docs/FONT-REDISTRIBUTION-RESEARCH.md`（工作区侧记录）；
本轮的可复算审计（缺口集合 / 影响面 / 可加载性 / 回退链 / `systemfont_*`）见
`tests/font-gap-audit-test.mjs` 与 `docs/PATCHES.md` 的 **P-127**。

# ICONS-NEEDED —— 测试台图标：已用了什么、许可在哪、还缺哪些（待用户定）

> **为什么有这份文件**（用户第 17/18 条）：「实现里若缺图标**不许停工**」——
> 先查仓库既有（`we-scene-demo/docs/SVG-ICONS.md`、`icons/`、`imgs/`），没有再找**许可允许**的开源图标或**自绘最简 SVG**。
> 这份文件就是那一步的台账：已用的逐个登记来源与许可，还缺的列出来**等用户拍板**（不擅自发明语义）。
>
> 落地位置：`demo/bench-patch.js`（**唯一物理真源**，两个台子共用）的 `DIR_ICONS` + `dirIcon()`。
> 许可随仓分发：`demo/LICENSE-lucide-ISC.txt`；借鉴台账：`docs/COPYING-RULES.md` §4。
> **口径**：表里"已落点"= 弹窗 DOM 里真的能查到那个 `<path>`（T30 假 DOM 断言 + 探针 G9 浏览器断言两边都查）。

---

## 1. 已用图标（6 个已落点 + 1 个备用登记；全部内联 SVG，零外部依赖）

| # | 名称 | 用在哪 | 来源 | 许可 | 核对方式 |
|---|---|---|---|---|---|
| 1 | `folder` | 选择器：目录行 / 「打开系统选择器」按钮 | Lucide v0.545.0 `icons/folder.svg` | ISC | `d` 与上游逐字节相同（2026-09-17 实测） |
| 2 | `file` | 选择器：文件行 | Lucide v0.545.0 `icons/file.svg` | ISC | 同上（两条 `d` 均相同） |
| 3 | `house` | 选择器：「回到最上层」 | Lucide v0.545.0 `icons/house.svg` | ISC | 同上 |
| 4 | `check` | 选择器：底部确认按钮（就选这个文件夹/文件） | Lucide v0.545.0 `icons/check.svg` | ISC | 同上 |
| 5 | `x` | 选择器：右上角关闭 | Lucide v0.545.0 `icons/x.svg` | ISC | 同上 |
| 6 | `arrow-up` | 选择器：「上一级」；日志面板收起（结构性老图标） | **仓库既有** `docs/SVG-ICONS.md`（用户提供） | 用户提供（同一套 Lucide/Feather 几何） | 原样取用（`m5 12 7-7 7 7` + `M12 19V5`） |
| 7 | `search` | **备用（工厂 `DIR_ICONS` 里已登记，当前未落点）**：过滤框用的是原生 `<input type="search">`，没有前缀图标。要用时把 `dirIcon('search', 12)` 插进 `.bench-dirbox-tools` 即可 | **仓库既有** `docs/SVG-ICONS.md`（用户提供） | 用户提供 | 原样取用（`m21 21-4.34-4.34` + `circle 11,11,8`）；T30 断言"弹窗里 0 个 circle = 确未落点" |

**用法纪律**（与 `docs/SVG-ICONS.md` 的约定一致，也是本批的落地方式）：
取上游 `<svg>` 的**子元素**，套进本项目的 svg 工厂（`dirIcon()` 用 `createElementNS`），
去掉类名 `lucide lucide-xxx`，保留 `viewBox="0 0 24 24"` / `stroke="currentColor"` / `fill="none"` /
`stroke-width="2"` / `stroke-linecap=round` / `stroke-linejoin=round`，**不引依赖、不用图标字体**。

---

## 2. 来源与许可（一份来源一张卡）

| 来源 | 版本 / 落点 | 许可 | 结论 |
|---|---|---|---|
| **Lucide** | `lucide-static@0.545.0`，`icons/*.svg` | **ISC**（源自 Feather 的部分 MIT） | ✅ 可引入（用户规则允许 MIT/ISC/Apache/CC0）；已随仓附许可全文 `demo/LICENSE-lucide-ISC.txt`，并记 `docs/COPYING-RULES.md` §4 |
| **用户提供的 `SVG-ICONS.md`** | **真实落点是工作区根的 `docs/SVG-ICONS.md`（即 `DSHarea/docs/SVG-ICONS.md`，在渲染器仓库之外）** —— `we-scene-demo/docs/` 下**没有**这份文件（2026-09-17 全树确认；`git log --all -- '*SVG-ICONS.md'` 无记录），别按老路径去扑空 | 用户提供 | ✅ 直接用，不需要再找替代 |
| `icons/`、`imgs/` 目录既有资产 | `demo/icons/pwa-*.png`（PWA 位图）、上游产物 `imgs/*`（收款码，页面已零引用） | 本仓库 / 上游 MIT | ⚠️ 都是**位图**，不是线条图标，不能拿来做按钮图标 |
| GPL-2.0-only 上游（`wer-ref/`、`wallpaper-scene-renderer` 等） | — | GPL-2.0-only | ❌ **禁借**（`docs/COPYING-RULES.md` §2.3）；本批未使用 |

---

## 3. 还缺哪些（**建议由用户定**，不擅自发明语义）

| 位置 | 缺什么 | 现状（降级处理，不停工） | 候选（等用户点头） |
|---|---|---|---|
| 顶栏「时钟开关」（用户点名的第 7 个） | 时钟图标 | 目前**不加图标**，用文字标签；功能不受影响 | `clock` / `alarm-clock` / `timer`（三选一） |
| 工具条动作：重挂载 / 刷新 | 刷新图标 | 文字标签（中英都有） | `refresh-cw`（`docs/SVG-ICONS.md` 已有原始 SVG） |
| 工具条动作：复制输出 / 复制链接 | 复制图标 | 文字标签 | `clipboard-copy`（已有原始 SVG） |
| 诊断警告位（❌/⚠ 文本位） | 警告图标 | 目前是字符 `⚠`/`❌` | `triangle-alert`（已有原始 SVG） |
| 侧栏「使用说明 / 文档」入口 | 文档图标 | 文字标签 | `book-open`（已有原始 SVG） |
| 壁纸库条目类型（scene/web/video） | 类型图标 | 文字徽标 `.bench-kind` | `files` / `images` / `circle-play`（后两个已有原始 SVG） |
| 播放/暂停/下载（媒体与导出） | 三个图标 | 文字标签 | `circle-play` / `circle-pause` / `download`（三个都已有原始 SVG） |

**只缺"用户拍板"这一件事**：上表若用户不指定，就保持**文字标签**（可用性不受影响，绝不会因为缺图标停工）；
指定后按第 4 节落地，并在两张表里各补一行。

---

## 4. 复核命令（改完图标必须能复跑）

```bash
# ① 许可文件与台账在位（Node 断言，不需要浏览器）
node vendor-ref/ww-pages/bench-patch.test.mjs        # T29-E / T29-F 两组
# ② 图标真的出现在弹窗里：内联 svg + stroke=currentColor + 零外部图标 css
node vendor-ref/ww-pages/probes/ff-batch-probe.mjs http://127.0.0.1:8901/WEwebLoader/   # ①P-127 新站点路径（旧名软链仍可用）
# ③ 上游逐字节核对（联网时）：把 demo/bench-patch.js 的 d 值与该地址对齐
#    https://cdn.jsdelivr.net/npm/lucide-static@0.545.0/icons/<name>.svg
```

> 未定项：`docs/SVG-ICONS.md` 的第 7 个图标（时钟开关）**用户尚未指定**——该文件文末自己也记着这条待定。
> 本批按"不许停工"处理：先用文字，等用户给名字或授权按同风格补。

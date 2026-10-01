# 半透明主题适配（TRANSLUCENT-THEME）—— 应用外框 / 输入框 / ≥4K 源

> 一句话：宿主把 `--dsw-alias-bg-base` 调成半透明（自定义 CSS 想让壁纸透出来）之后，**应用外框**仍会不透明地盖住壁纸层、
> **输入框的遮罩渐变**会失效；本插件提供两个**默认安全**的开关来收口，并给 ≥4K 源加一条一次性性能提示。
> 状态与判据索引见 `<工作区>/docs/STATUS-ALL-ITEMS.md`（唯一索引）；本文只是**证据出处**。

## 0. 现象与根因（两个宿主版本都核过）

| # | 现象 | 根因（实测） |
|---|---|---|
| A | 壁纸层健康（`#mpw-bgWrap` fixed/整窗/opacity 1、`#mpw-bgVideo` `readyState 4`、未暂停、无 error；`body/html` 透明）但**整屏看不见壁纸** | 应用外框节点 `[class*="_frame"]` 在壁纸层（`z-index:-1`）之上刷了一层**不透明**底色。宿主版本不同、取色变量不同：**本机 0.1.5-rc.2** = `pI_x6G_frame{background:var(--dsw-alias-bg-base)}`；**报告者 0.2.0-rc.2** 上该节点背景 = `--dsw-specific-sidebar-fill`（`#f9fafb`）。把该节点背景改 `transparent` ⇒ 壁纸立刻出现；改回 ⇒ 又消失（可逆复现） |
| B | 正文从输入框底下透出来糊进输入框 | 宿主 `[class*="composerSeat"]`：`background: linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px, var(--dsw-alias-bg-base) 36px); position: sticky; bottom: 0`（本机 0.1.5-rc.2 与报告者引用**逐字一致**）。遮罩终点跟着 `bg-base` 走 ⇒ 底色 20% 时遮罩也只有 20% |
| C | 4K@30fps 源 + 壁纸层虚化（`blur` 12px、`unifyAmount` 30px）⇒ 明显卡顿 | 解码 + 每帧 backdrop 的代价叠加；把「分辨率上限」降到 1080p（宿主 ffmpeg 转码）+ 关掉两个模糊即恢复。**不是 bug，是默认值/提示问题** |

**为什么必须运行期探测**：宿主类名带**内容哈希**（前缀每次构建都变）；取色变量也随版本变（见上表 A）。
所以本实现**不写死类名、不写死变量**，只按三条实测特征认节点：**不透明 + 铺满视口（≥90%）+ 不在壁纸层内**。

## 1. 两个开关（设置 → 外观 → 透出壁纸）

| 设置项（键） | 默认 | 行为 | 回退 |
|---|---|---|---|
| **半透明主题适配（应用外框）** `themeAssist` | **开（= auto）** | **只有**同时满足「实测到宿主底色半透明」+「当前有壁纸」+「开关开」三条时，才把外框节点内联背景置 `transparent !important`；默认主题（底色不透明）下**一行都不动** | 关掉 ⇒ 逐字还原（见 §2） |
| **输入框磨砂** `composerBlur` | **关** | 去掉 `composerSeat` 那道渐变遮罩（`background:none`），改由输入框**卡片**自己 `backdrop-filter: blur(16px) saturate(1.25)` —— 形状正确（卡片是圆角，矩形色带对不上） | 关掉 ⇒ 属性与样式节点立即摘除 |

> 默认主题下为什么不全开：① 外框那条在宿主不透明时无处可用（自动档已覆盖）；② 输入框那道色带在**默认（不透明）主题**下是有用的遮罩，擅自去掉会让正文在卡片边缘"硬切"。

## 2. 可观测与可还原（排障入口）

```js
window.__mpwThemeAssist
// { mode: 'frame-transparent' | 'host-opaque' | 'no-source' | 'assist-off' | 'assist-no-frame' | 'off',
//   assist, composer, enabled, hasSource, translucent, bgBase, bgBaseAlpha, sidebarFillAlpha,
//   frames,        // 本次被透掉的外框节点数
//   composerOn, at, err? }
```
- 被改过的节点都带 `data-mpw-frame-transparent="1"`，并把**原始内联背景**留档在 `data-mpw-frame-bg-prev`；
- 关开关 / 关插件 / 切到"没有壁纸"⇒ 标记与内联背景**逐字还原**（判据 B3/B6）；
- 幂等：重复 apply 不会覆盖留档（判据 B2）。

## 3. ≥4K 提示（不改变默认值）

视频元数据就绪（`loadedmetadata`）时若 `videoWidth×videoHeight ≥ 3840×2160` **且**（壁纸层 `blur>0` 或统一虚化开着）⇒
弹一条**一次性**提示（同一个会话只提示一次），台账 `window.__mpwPerfNote = {vw, vh, blur, unify, at}`。
文案建议两条可选路径：把「分辨率上限」设为 1080p（走宿主 ffmpeg 转码）或把虚化调 0。
**默认值未改**：4K 直读是用户可能主动想要的；要改默认另议（会改变所有现有用户的转码行为）。

## 4. 判据

- `node tools/theme-assist-test.mjs` —— **23 断言 / 5 组变异自证**（纯 Node + 桩 DOM，不开浏览器）：
  - A 组：alpha 解析（`rgba/rgb/#rrggbb[aa]`，认不出算不透明）、两个默认值、输入框 CSS 的**选择器双写**与作用域、设置行/i18n、台账与还原入口、apply 接线；
  - B 组：三条前提逐条翻转（半透明宿主 / 不透明宿主 / 无壁纸 / `enabled:false`）＋幂等＋逐字还原＋"只命中外框那一个"（小节点与半透明节点都不许碰）；
  - C 组：输入框档三态（关→开→关）的 DOM 快照；
  - D 组：≥4K 的三态（提示一次 / <4K 不提示 / 没虚化不提示）；
  - E 组：把"宿主必须半透明""必须不透明背景""必须铺满视口""还原要清标记""输入框要有条件"五处判断改坏 ⇒ 对应判据必红（真源零改动）。
- 登记：`tools/check.sh`（12 步门禁内，不新增 step）。

## 5. 未验证边界（如实）

1. **本机是 Android + DSH 0.1.5-rc.2（web profile）**，不是报告者的 Windows/macOS + 0.2.0-rc.2 桌面版 ⇒ 三处都只在**桩 DOM** 与宿主 bundle 的**静态规则**上验证，**没有真机复测**；
2. 外框在 0.2.0-rc.2 桌面端的**节点结构**（是否仍是 `[class*="_frame"]` 前缀、是否铺满视口）**未实测** ⇒ 若结构变了，`mode` 会如实变成 `assist-no-frame`（不猜、不乱改）；
3. 输入框卡片的节点前缀 `[class*="_card"]` 同理：找不到就只是"去掉色带、没加上模糊"（仍比原来好，但不是最终形态）；
4. `backdrop-filter` 在 Electron 44（Windows/macOS）上的代价未测（4K 源下可能更贵）；
5. 单显示器/单窗口前提：多窗口/多屏下"铺满视口 ≥90%"的判据可能需要放宽（会先记 `assist-no-frame`，不误改）。

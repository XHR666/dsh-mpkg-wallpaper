# NowPlaying —— Bencho「Now playing」的移植件（`①(P-138)`）

这一段写给下一个人。三件事：**这份东西的许可与出处**、**怎么 build / 怎么挂**、
**哪些是照抄哪些是我们改的**（含删掉的 CSS 与 token 映射表）。

```
demo/now-playing/
  NowPlaying.tsx        组件本体（照抄；注释逐字保留）
  now-playing-math.mjs  纯函数模块：几何常量 / 曲线 / 弹簧换算 / 同心圆角（组件与测试共用一份）
  now-playing.css       样式（照抄 + 删掉不属于它的规则；14 个 token 在 .snd 上本地落地）
  mount.tsx             薄壳：mountNowPlaying(el, opts) —— 只做"挂到某个容器"
  icons.tsx             离线兜底图标（lucide-react 装不下来时才进产物，见「两条路都能 build」）
  index.html            独立演示页（自己一套中性底色 + morph/corner 两个旋钮 + hairline 开关）
  build.mjs             esbuild 打包 → dist/now-playing.js
  package.json          本地依赖（react / react-dom / lucide-react / esbuild）
  dist/now-playing.js   **构建产物，已提交**（页面直接引它，看页面不需要 node_modules）
  README.md             本文件
```

页面（**不需要改任何 server**：8902 的 `/demo/**` 与 `/WEwebLoader/**` 都指向仓库的 `demo/`）：

- `http://127.0.0.1:8902/WEwebLoader/now-playing/index.html`
- `http://127.0.0.1:8902/demo/now-playing/index.html`

---

## 1. 许可与出处

| 东西 | 许可 | 说明 |
| --- | --- | --- |
| `NowPlaying.tsx` / `now-playing.css` / 注释 | MIT（Bencho，`bencho.dev/licence`） | 用户提供的任务书里逐字给出的源码与样式；本目录是它的移植副本 |
| 本仓库这一层（移植、纯函数拆分、演示页、打包脚本、测试） | GPL-3.0-or-later | 与仓库其余部分一致（见仓库根 `LICENSE`） |
| `lucide-react`（图标） | ISC | 依赖，运行时由 npm 装；不进仓库（`node_modules/` 已被根 `.gitignore` 忽略） |
| `icons.tsx`（离线兜底图标） | ISC | 几何数据逐字节取自 `lucide-react@1.47.0`；许可正文仓库里已有：`demo/LICENSE-lucide-ISC.txt`；归属见 `THIRD-PARTY.md` |
| `demo/assets/brand/brand-512.png`（COVER；P-164 前是 `demo/icons/pwa-512.png`） | 本项目自有（仓库所有者提供的品牌图） | 见下文「COVER」 |

**没有出行任何 Bencho 的图片**：原件顶部那句 `COVER was Bencho's own pictures, which are not
licensed to travel` 就是原因，照抄时它连同注释一起留下了。

---

## 2. 怎么 build

```bash
cd demo/now-playing
npm install --no-audit --no-fund react react-dom lucide-react   # 用户明确要求的依赖
npm install --no-audit --no-fund -D esbuild                     # 只用来打包
node build.mjs                                                  # → dist/now-playing.js
```

- 产物是 **ESM、自足**的（React 19 与 react-dom 内联，产物里没有任何裸 import），
  文件头一行生成说明（含 esbuild 版本）。
- `dist/now-playing.js` **是提交进仓库的** —— 只想看页面的人不用装依赖、不用 build。
- 两条路都能 build：
  - 默认优先 `lucide-react`（本机实装 `1.47.0`，只有用到的三个图标进产物）；
  - `node build.mjs --icons=fallback` 强制走 `icons.tsx` 兜底（用来证明兜底那条路也能 build；
    装不上 lucide-react 时 `build.mjs` 自己会回落，并且**打印警告**，不会静默）。
- `node build.mjs --out=/tmp/x.js` 可换产物落点（测试用；默认 `dist/now-playing.js`）。

## 3. 怎么在页面里挂

```html
<link rel="stylesheet" href="./now-playing.css" />
<div id="np-root"></div>
<script type="module">
  import { mountNowPlaying } from "./dist/now-playing.js";
  const app = mountNowPlaying(document.getElementById("np-root"), {
    morph: 50,   // 0..100，形状变化多快（50 = 原件调好的 460ms）
    corner: 16,  // 0..32，封面圆角；盒子的角由它推出来（同心）
    stroke: false, // 盒子的发丝线（取代 Bencho 的全局 [data-stroke="on"]）
  });
  app.update({ corner: 32 }); // 旋钮：从当前值续上，不跳
  // app.unmount();
</script>
```

`dist/now-playing.js` 同时导出 `NowPlaying`（组件本体，React 元素直接用）与
`mountNowPlaying`（薄壳）。**本批只做「独立页 + 组件」，没有往 `demo/index.html`（测试台外壳）里嵌。**

---

## 4. token 映射表（任务书第 4 条）

原件读这 14 个自定义属性却从不定义它们（它们是 Bencho 的设计 token）。本项目**不新增全局变量**
⇒ 14 条全部只定义在组件自己的根上（`.snd` 规则内部，见 `now-playing.css`），
每条映射到本项目**已有的** token；括号里是"页面没有给这些 token"时的兜底值
（与 `demo/assets/bench-HtRiuWm6.css` 的暗色主题同值）。凡是 `-rgb` 结尾的给**三个裸数字**。

| Bencho token | 映射到本项目 | 兜底值 | 谁在读它 |
| --- | --- | --- | --- |
| `--card` | `--editor` | `#1f1f1f` | `.snd-op:focus-visible` / `.snd-like:focus-visible` / `.snd-tap:focus-visible` 的第一圈聚焦环（"周围的地"） |
| `--font-num` | `--mono` | 等宽栈 | 原读者是 `.snd-num`（**音效板**的规则，本组件没有移植）⇒ 只为映射完整而保留 |
| `--font-ui` | `--ui-font` | 系统 UI 栈 | `.snd`、`.snd-clock` |
| `--ink` | `--fg` | `#cccccc` | `.snd-title`、`.snd-run`、`.snd-op[data-lead]` 的实心底、`.snd-like[data-on]` |
| `--ink-3` | `--fg-dim` | `#9d9d9d` | `.snd-op`、`.snd-like` 的静止图标色 |
| `--ink-4` | `--fg-mute` | `#6e6e6e` | `.snd-by`、`.snd-clock` |
| `--ink-rgb` | `--fg` 的三通道拆解 | `204, 204, 204` | `.snd-rail`、三个 `:hover` 的底色。**本项目没有 `-rgb` token** ⇒ 本地给三个裸数字；`--fg` 一改这里要同步（独立页只有一套暗底，所以是常数） |
| `--on-ink` | `--list-active-fg` | `#ffffff` | `.snd-op[data-lead]` 的字/图标色（实心墨底上的字） |
| `--on-slab` | `--fg` | `#cccccc` | 原读者是 `.snd-wake`（**音效板**）⇒ 只为映射完整而保留 |
| `--pane` | `--panel` | `#181818` | `.snd-box` 的玻璃面；用 `color-mix(… 86%, transparent)`，与 `demo/index.html` 的 `color-mix(…86%…)` 同口径 |
| `--pane-edge` | `--border` | `#2b2b2b` | `.snd[data-stroke="on"] .snd-box` 的发丝线 |
| `--slab` | `--input` | `#313131` | 原读者是 `.snd-wake`（**音效板**）⇒ 只为映射完整而保留 |
| `--surface-2` | `--sidebar` | `#181818` | `.snd-art` 的兜底渐变（图片解码前那一帧的地） |
| `--surface-3` | `--input` | `#313131` | 同上，渐变的上位面 |

同一张表在 `../../../tests/now-playing-test.mjs` 的 `TOKEN_MAP` 里有一份**机器可核对**的副本
（测试逐条断言"CSS 里确实是这么落地的"）。

`--font-num` / `--on-slab` / `--slab` 的消费者是被删掉的那两段（`.snd-num`、`.snd-wake`），
所以它们目前**没有读者** —— 保留定义只为"这 14 个 token 一次性给全、将来接回别的块时不会读到空值"。
嫌它们碍事可以删，删了要同步改测试的 `TOKEN_MAP`。

## 5. COVER 怎么处理的（任务书第 5 条）

**指向本仓库自己的图**：`../assets/brand/brand-512.png`（512×512，**仓库所有者提供的品牌图**，随仓库分发、许可干净）。
（P-164 之前这里指的是 `../icons/pwa-512.png` —— 那是**上游 WebWallGL 的图标**，已不再被本组件引用；
2026-09-23 品牌清理又把它与站点根同名图统一改成 `brand-512.png`。）

- 路径**相对页面**写 ⇒ `/demo/now-playing/` 与 `/WEwebLoader/now-playing/` 两个挂载点都成立
  （8902 的两个挂载点都指向 `demo/`，`../assets/brand/` 落到 `demo/assets/brand/`）。
- 为什么不用"漂亮的封面"：本仓库**不分发任何第三方美术资源**（`tests/demo-check.mjs` 的 D3/D5
  有对应闸门），Bencho 的图也不随许可出行。自家图标是唯一既合法又在仓库里的选择。
- 它同时是 `.snd-art` 那层兜底渐变验证不到的**真图**：`.snd-art` 的 `background-image`
  被组件内联样式覆盖成 `url(COVER)`，所以"图片解码前的一帧"看到的是 CSS 里那条渐变。
- 要换成别的图：改 `NowPlaying.tsx` 顶部的 `const COVER`（原注释保留了它的含义）。

## 6. 照抄 / 我们改的

**照抄（一字未改，含全部注释）**

- `NowPlaying.tsx`：组件本体、`Mark`（"画出来的"播放/暂停记号）、`useTween`、`useSpring`、
  `stillness`、全部 JSDoc 式长注释；`now-playing.css`：除下面第 2/3 条以外的每一条规则。
- 注释里出现的 `scripts/cover.sh`、`lab/motion`、`lab/Sound.tsx`、`CLAUDE.md`、Bencho 的
  "wall / bench" 都是**原件的世界**；本仓库没有这些路径，注释按用户要求原样保留
  （它们是"数字为什么是这个值"的论证）。涉及本仓库确实不一致的两处，我们在旁边加了一行
  `①(P-138 移植)` 说明，没有动原文。

**我们改的（四处 + 两处注释旁注）**

1. **导出名** `Sound` → `NowPlaying`（任务书口径）。内部函数名（`Mark` 等）保持原样。
2. **纯数学与几何常量抽到 `now-playing-math.mjs`**：原件里它们就在 `NowPlaying.tsx` 顶部；
   抽出后**注释跟着数字一起搬**（一条没删），只剥掉 TypeScript 标注（`: number` / `as const`）。
   - 组件体里三处内联算式换成调用：`artRadius(cr)` / `boxRadius(cr)`、`swellAt(u)`、`gooAt(t)`；
     算式一字未改，论证注释留在组件原位。
   - 目的：让"同心圆角""swell 两端为 0、峰值在 0.63""QUART(0)=0 / QUART(1)=1"这些关系
     能被 `tests/now-playing-test.mjs` 直接断言 —— 组件与测试读同一份算式，不会漂移。
3. **COVER** 由空串（占位）改成 `../icons/pwa-512.png`，P-164 起改为 `../assets/brand/brand-512.png`（见上一节）。
4. **`stroke` 属性取代 Bencho 的全局 `[data-stroke="on"]`**：本项目没有那个全局属性
   ⇒ 发丝线改成组件自己的可选属性（`<NowPlaying stroke />` 时给根元素写 `data-stroke="on"`），
   CSS 里的选择器随之写成 `.snd[data-stroke="on"] .snd-box`（仍在 `.snd` 子树内）。
   语义没变：盒子自己不常驻边框 —— 原件 `NO BORDER of its own` 的理由继续成立。

**两处旁注（保留原文 + 一行 `①(P-138)` 说明，因为原文与我们的实现不一致）**

- 封面那段"`the sleeve is inlined rather than linked — see scripts/cover.sh`"：原件把封面内联进
  单文件产物；本仓库没有那套内联管线，封面是**相对页面的链接图**。同一处旁注在
  `NowPlaying.tsx` 与 `now-playing.css` 各写了一次（读者在哪一份文件里看到原文，就在哪一份里看到说明）。
- `--font-num` / `--on-slab` / `--slab` 三条 token 的消费者（`.snd-num`、`.snd-wake`）没被移植。

**删掉的 CSS（任务书第 3 条明确要求不抄）**

| 删掉的规则 | 属于谁 | 为什么删 |
| --- | --- | --- |
| `.snd { display:flex; flex-direction:column; gap:10px; width:460px; font-family:… }`（board 那一条，原件里 `.snd` 出现两次） | Bencho 的**音效板 sound board** 外框 | 它给 `.snd` 定 460px 宽 + 纵向 flex；本组件自己内联写 `width:260px`，留着是死规则且会误导。play 的那条 `.snd`（`position/display:grid/place-items/font-family`）保留 |
| `.snd-wake`、`.snd-grid`、`.snd-key`、`.snd-key:hover`、`.snd-key:active`、`.snd-key[data-pitched]`、`.snd-key[data-pitched]:hover`、`.snd-num`、`.snd-name`（+ 它们头上那段 `══ Sound board ══` 注释） | **音效板**（十二个键，`site/sound.ts` 的顺序） | 与本组件无关；`.snd-name` 这类泛名还会打到本项目别的 UI 上（原件注释里就记着这个教训） |
| `/* ══ Sounds (the page) ══ */` 注释 + `.sfx-wall` | **音效墙页面** | 那是页面级 grid，不是组件；`touch-action:none` 之类会改页面行为 |
| `[data-stroke="on"] .snd-box { … }` | 依赖 Bencho 测试台的**全局属性** | 本项目没有 `[data-stroke]` ⇒ 改写成 `.snd[data-stroke="on"] .snd-box`（组件自己的可选属性），**不删功能** |

**保留**：`.snd`（player 那条）、`.snd-box`、`.snd-art`、`.snd-say`、`.snd-title`、`.snd-by`、
`.snd-bar`、`.snd-rail`、`.snd-run`、`.snd-clock`、`.snd-ops`、`.snd-op`、`.snd-like`、`.snd-tap`、
`@keyframes snd-beat`、两条 `@media (prefers-reduced-motion: reduce)`。

**作用域纪律**（有机器判据）：本文件每一条选择器都以 `.snd` 开头或落在 `.snd` 子树内 ——
没有裸标签、没有 `body`、没有 `:root`、没有 `*`；也没有一条"新的全局 token"
（14 条自定义属性只定义在 `.snd` 自己身上，不外泄）。见测试的第 ③/④ 组。

---

## 7. 测试与已知限制

- 门禁：`node tests/now-playing-test.mjs`（秒级、无浏览器、无网络、无 GPU）。
  覆盖：源码完整性（注释块条数对账）、纯函数数字、CSS 作用域与 token 落地、映射表核对、
  产物自足性、**变异自证**（故意改坏两处 ⇒ 断言必须变红）。
- 本机无 GPU（软件渲染、约 1fps）⇒ **外观与动效必须人眼看**，见 README 末尾「需要人眼/真机」一节。
- `node_modules/` 与 `dist/` 的关系：`node_modules/` 被根 `.gitignore` 忽略；`dist/` **入库**。
  没有 lockfile（仓库里没有这个先例），依赖版本以 `package.json` 里的精确版本为准。
- 已知限制（不是 bug，是选择）：
  - `--ink-rgb` 是常量 `204, 204, 204`（拆自默认暗色 `--fg:#cccccc`）。若把本组件放进**浅色**主题，
    要同步改这一条 —— CSS 里没法从 `--fg` 反解出三个通道数。
  - `--pane` 用了 `color-mix()`（本项目 `demo/index.html` 同款写法）；引擎太老时该声明无效
    ⇒ 面板会变透明。目标引擎（现代 Chromium/WebView）没问题，真机上留意。
  - **lucide 版本口径**：本机装的是 `lucide-react@1.47.0`，它的 `play`/`pause` 是**圆角胶囊**路径
    （`M5 5a2 2 0 0 1 …`），而 `Mark` 的注释里那句 "The points are lucide's own … bars at x 6..10
    and 14..18, a triangle from 6.5 to 20" 说的是**旧版** lucide 的直角三角/矩形。（仓库自己内联的
    那 7 个图标登记的是 `lucide-static@0.545.0`，见 `THIRD-PARTY.md`。）我们**照抄了 `Mark` 的数字**
    （用户要求照抄 + 保留注释），所以"播放记号与旁边的跳曲图标是不是一个重量"要用眼睛核一次
    —— 这是本轮唯一一处"照抄可能与新依赖版本不完全对齐"的地方。

## 8. 需要人眼/真机

| 看什么 | 怎么做 | 期望 |
| --- | --- | --- |
| 形状：胶囊 → 卡片 | 打开页面，点一下胶囊/封面 | 宽**不变**（260），高 78→189；封面 40→64 且圆角同心；字随封面变大；右下三个键滑到封面下方居中并变大 |
| 只有一个运动 | 打开过程中盯住封面与四个角 | 没有任何元素"提前到"或迟到；盒子、封面、圆角、字号是一起变的（一件物体在变，不是八个元素在动） |
| 播放记号 | 连点播放/暂停几次 | 暂停 ⇄ 播放是**同一对四边形在变形**（不是两个图标交叉淡入淡出），中间有一点点"软"（横向挤压 + 微倾），停下时形状精确 |
| 关闭时的 gather | 打开后点外面（或点封面）收起 | 收起时整个对象先**缩一下**再落回胶囊；**打开时不该有这个缩**（只在关闭那一次） |
| 同心圆角 | 把 corner 从 0 拖到 32 | 任意位置盒子的角都"抱住"封面的角（45° 不夹紧）；0 时两者一起变方；32 时封面成圆，盒子仍等距 |
| morph 滑杆 | 拖到 0 / 100 | 0（736ms）读起来是"从容"，100（184ms）是"利落"；两端都不像坏掉 |
| 心跳 | 点心形 | 只在**点亮**那一次有一次 1.34 的过冲；取消点亮没有动画 |
| 描边开关 | 勾 hairline | 盒子外面出现 1px 发丝线（这就是被改写的那条规则） |
| 外部点击关闭 | 打开后点页面空白处 | 只有**真实的手**能关掉它（`pointerdown` + `isTrusted`）；脚本合成的指针事件不该关（原件注释里那条"演示会把它关掉"的坑） |
| 降低动效 | 系统开 `prefers-reduced-motion: reduce` 后刷新 | 变化是瞬时的（1ms），没有 tween |
| 触屏 | 手机上点胶囊、点心形 | 命中区与胶囊一致；打开后点标题不会收起（`.snd-tap` 只盖封面 + 文字） |

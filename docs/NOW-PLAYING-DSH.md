# NOW-PLAYING-DSH.md —— Now playing 挂到 DSH 左侧栏「设置」上方（NP-1）

> 2026-09-19。用户原话（第 1 条，逐字）：
> 「**now playing 挂载到 dsh 设置上面 有一个开关启用是否挂载 左边栏收起就隐藏**」
> 编号 **NP-1**（代码注释写 `①(NP-1 …)`）。组件本体来自 **Bencho**（MIT，见 §2）；
> 与上游的逐项差异见 §2.2。相关文档：`../docs/COPYING-RULES.md` §4 台账 #13、
> `THIRD-PARTY.md` §6、`docs/CLIENT-JS-SPLIT-ASSESSMENT.md`（内联形态的依据）、
> `docs/STYLE-SCOPE-GUARD.md`（样式锚点判据）。

---

## 0. 一句话结论

三件事都落地了，**开关默认关**：
① 组件挂进宿主**官方附加 slot** `sidebar.footer.action`（它的出口结构上就在「设置」入口**正前方**；slot 不可用时按三级降级锚点插到设置入口之前，再不行退到底部组第一位并**留日志**）；
② 设置项 `npNowPlaying`（「壁纸设置」tab，默认 **false**）控制是否挂载 —— **关 ⇒ 零 DOM、零观察者、产物里零行 NP 规则**（三条都有断言）；
③ 左侧栏收起 ⇒ 组件自己加 `data-mpw-np-hidden`（`display:none`）。判据**优先**用宿主自己的状态（slot 的 `wide` → AppFrame 的 `data-sidebar-collapsed` → 侧栏根的 `collapsed` 类），**兜底**用实测宽度 < **96px**（宿主收起轨道恰好 56px、展开下限 264px —— 见 §5）。

**数据接入是"能做才做、做不到就说"**：视频壁纸那条音轨**真能控**（播放/暂停/进度/音量，走页面里真实存在的 `<video>`）；场景壁纸自带的音轨**只显示不控**（播放它的是场景渲染器，插件没有那条通道，扫描结果里也没有时长）；网页壁纸的声音走**既有**「静音」设置 + 宿主 `/media-audio` 契约；没有源就是空闲态，点播放**不做假动作**（面板一行字 + console 一行）。完整清单见 §4.4。

---

## 1. 交付形态与文件落点

| 路径 | 角色 | 行数/字节 |
|---|---|---|
| `lib/now-playing-math.js` | **纯数学**（零 DOM、零 React）。上游那套 `clamp/mix/QUART/SWING/quad/springOf/rate/overshoot/swell/goo/同心圆角/两个八点四边形/clock` + 全部几何端点函数 | 见 §8 sha256 表 |
| `lib/now-playing.js` | **组件**：React 元素（`react.createElement`，无 JSX）+ 侧栏挂载控制器（锚点解析 / 收起判据 / 单实例 / 观察者生命周期 / 做不到时的说明） | 同上 |
| `lib/client.js` | **接线**：生成区内联 + `buildCss` 追加 + 设置项 + i18n + `boolFields`/`BACKUP_FIELDS` + `applyNowPlaying()` + slot 注册 | 同上 |
| `tools/build-now-playing.mjs` | **生成器**：把上面两份源**逐字节**写进 `lib/client.js` 的生成区；`--check` 只核对不写 | 新增 |
| `tools/now-playing-test.mjs` | **常驻门禁**：68 条断言 + 4 组变异自证；已接进 `tools/check.sh` 第 2 步 | 新增 |
| `docs/NOW-PLAYING-DSH.md` | 本文 | 新增 |
| `THIRD-PARTY.md` §6 | Bencho 的 MIT 归属（许可义务） | 修改 |
| `../docs/COPYING-RULES.md` §4 #13 | 跨仓借鉴台账 | 修改 |

### 1.1 为什么是"源 + 生成内联"（形态 A）而不是 `require`

宿主 `dsh-client-modules` 把 `package.json` 的 `exports["./client"]` 指向的**那一个文件**整体
`readFileSync` 下发给浏览器；浏览器侧是 lazy CJS 表，遇到"非 graph row 的说明符"**直接 throw**
⇒ `lib/client.js` 里出现任何**相对** `require`，线上就是"模块解析失败"整块挂掉（本机却一切正常）。
判据是 `tools/integrity-check.mjs` 第 ⑩ 节（"0 处相对 import/require"）。

`docs/CLIENT-JS-SPLIT-ASSESSMENT.md` §3 把三种形态都判过了，结论是**只有 (A)「源 + 生成内联」可行**，
并且**必须**配一条"生成物与源一致"的漂移门禁，否则就是重演 `tools/inline-lg-bundle.mjs`
变成死工具的老坑。本轮照做：

* 生成区由 `MPW-NP-GEN-START` / `MPW-NP-GEN-END` 两条标记圈住，块头写明"生成区、不要手改"；
* `tools/now-playing-test.mjs` 的 **A 组**（A1–A6）断言：生成区存在 / 两份源在生成区里**逐字节**出现 /
  只额外暴露 `MPW_NP_MATH`、`MPW_NP`、`MPW_NP_CSS` 三个绑定 / 位置在 `buildCss` 之前（否则 TDZ）/
  能从生成区里把运行期模块**取出来跑**。

### 1.2 一个真实的坑：内联**不能缩进**

第一版生成器把正文整体加了 3 个 tab（让 72KB 的块在 `client.js` 里看着不像被截断）。
门禁当场抓到：`lib/now-playing.js` 里有一个**多行模板字符串**（`NP_CSS`），
给每一行加 tab 会**连字符串内容一起改** ⇒ 运行期 CSS 与源不再逐字节相同。
现在生成器 `GEN_INDENT = ''`，正文**逐字节、不缩进**（`tools/build-now-playing.mjs` 文件头写了原因）。
代价只有一处外观损失，换来的是"源文件 == 生成区那一段 == 运行期拿到的字符串"三者同一份。

---

## 2. 许可与归属

### 2.1 上游

| 项 | 内容 |
|---|---|
| 组件 | **Bencho** 的 "Now playing"（上游文件 `Sound.tsx` + 随附样式表） |
| 许可 | **MIT**（`bencho.dev/licence`），用户已确认 |
| 移植方式 | **逐行移植、注释原文保留**。用户原话：「它们解释了这些数字为什么是这个值，也是这份代码值得照抄而不是重写的主要原因」 |
| 归属落点 | 本仓 `THIRD-PARTY.md` §6；跨仓台账 `../docs/COPYING-RULES.md` §4 #13 |
| 反向纪律 | `we-scene-demo/demo/now-playing/**`（**GPL-3.0-or-later**）只被**读来核对数学**，**一行都没有拷进本仓**（`../docs/COPYING-RULES.md` §2.2 "GPL 永不进插件"）。判据：本文件与两份源里 0 处来自该仓的标识符/注释/常量组织 ⟶ **复核更正①（§7.5.1）：这条判据实测不成立（注释行重合 349/600、标识符重合 29/199），原因与替换后的方向性判据见 §7.5.1** |

### 2.2 与上游的差异（逐项，供复核）

| # | 上游 | 本仓 | 为什么 |
|---|---|---|---|
| 1 | `import { Heart, SkipBack, SkipForward } from "lucide-react"` | **自绘**（`SKIP_BACK_D`/`SKIP_FORWARD_D`/`HEART_D`/`VOL_MUTE_D`/`VOL_ON_D`） | 不引新依赖（用户约束）；三个形状只是"线+三角"与"两段弧+一个尖"，没有设计取舍值得多背一处第三方归属 |
| 2 | 播放/暂停是**图标** | 播放/暂停**不是**图标：是上游那对**八点四边形**（`M.quad`），原样移植 | 上游原文："Two icons exchanged is a cut… a cut you see forty times" |
| 3 | 第三个传输键 = `SkipForward`（下一首） | 换成**音量/静音** | 本插件没有播放队列，"下一首"没有语义；换成**真实存在**的通道（既有 `mute` 设置 + 宿主 `/media-audio`） |
| 4 | 心形按钮（`Heart` + `liked`） | **不渲染**（CSS 规则与 `LIKE=30` 几何照移植，因为 `sayWidth` 用它） | 本插件没有"喜欢的歌"这个可落库的概念。留一个"点了只改自己颜色"的按钮 = 本轮明令禁止的**假动作** |
| 5 | `const COVER = ""`（上游自己的占位） | 填**当前壁纸的缩略图**（真实数据；拿不到就留空 ⇒ 走上游的渐变兜底） | 不伪造：这是我们真有的东西 |
| 6 | 类名 `snd-` | `mpw_np_`，全部落在自有锚点 `[data-mpw-now-playing]` 下 | `tools/style-scope-guard.mjs` 只放行 `.mpw*` / `[data-mpw*]` / `#mpw-*` 三类锚点 |
| 7 | 14 个 Bencho token 未定义 | 在组件根上**本地定义**为 `--mpw-np-*`（有宿主等价物的**只读**映射到 `--dsw-*`） | 不新增全局变量、不覆盖任何宿主 token；`--ink-rgb` 按上游要求给**三个裸数字**（无宿主等价物） |
| 8 | `useTween` / `useSpring` 用 rAF | 同一条 0→1 补间（`tweenTo`）放在控制器里，**自停**（到站即 `cancelAnimationFrame`） | 本仓铁律"不许用常驻 rAF"；且组件是嵌在宿主 React 树里的外来节点，状态压到控制器一层更好测 |
| 9 | 无"侧栏收起"概念（它在画布上） | 加装收起隐藏（§5） | 用户第 3 条要求 |
| 10 | 同文件的 Sound-board / 曲库页区块（`.snd-wake/.snd-grid/.snd-key/.snd-num/.snd-name/.sfx-wall`） | **未移植** | 它们不是这个组件（是同一文件里的另外两块工具） |

### 2.3 14 个 token 的映射表

| Bencho | 本仓 | 值 |
|---|---|---|
| `--card` | `--mpw-np-card` | `var(--dsw-alias-bg-base, #ffffff)` |
| `--font-num` | `--mpw-np-font-num` | `var(--dsw-font-mono, ui-monospace, …)` ⚠ 当前未被引用¹ |
| `--font-ui` | `--mpw-np-font-ui` | `var(--dsw-font-family, system-ui, …)` |
| `--ink` | `--mpw-np-ink` | `var(--dsw-alias-label-primary, #132d53)` |
| `--ink-3` | `--mpw-np-ink-3` | `var(--dsw-alias-label-secondary, #4a5f80)` |
| `--ink-4` | `--mpw-np-ink-4` | `var(--dsw-alias-label-tertiary, #6b7d99)` |
| `--ink-rgb` | `--mpw-np-ink-rgb` | `19, 45, 83`（亮）/ `214, 226, 245`（`body[data-ds-dark-theme]`）—— **三个裸数字**，宿主无等价 token |
| `--on-ink` | `--mpw-np-on-ink` | `var(--dsw-alias-label-primary-inverted, #ffffff)` |
| `--on-slab` | `--mpw-np-on-slab` | `var(--dsw-alias-label-primary-inverted, #ffffff)` ⚠ 当前未被引用¹ |
| `--pane` | `--mpw-np-pane` | `var(--dsw-alias-bg-layer-2, rgba(255,255,255,.86))` |
| `--pane-edge` | `--mpw-np-pane-edge` | `var(--dsw-alias-border-l2, rgba(19,45,83,.16))` |
| `--slab` | `--mpw-np-slab` | `var(--dsw-alias-bg-layer-3, rgba(19,45,83,.08))` ⚠ 当前未被引用¹ |
| `--surface-2` | `--mpw-np-surface-2` | `var(--dsw-alias-bg-layer-2, #eef1f6)` |
| `--surface-3` | `--mpw-np-surface-3` | `var(--dsw-alias-bg-layer-3, #e2e7ef)` |

¹ 这三项属于 §2.2 #10 里**未移植**的那两块；照 14 项登记是为了映射表完整，不是为了现在就用上
（代码注释里逐字写了这件事，避免下一个人以为"定义了没人用 = 死代码可以删"）。

---

## 3. 挂载点：用了哪个锚点、插入顺序怎么断言

### 3.1 宿主 DOM 契约（逐行读过宿主源码 + 真机 DOM 双向核对，不是猜的）

```
div.pI_x6G_frame[data-sidebar-collapsed?]        ← AppFrame（@deepseek-ai/dsh-client-ui-layout）
└ div.pI_x6G_sidebarCol                          ← 左栏 grid 轨道（收起恰好 56px）
  └ div[data-slot="sidebar"][display:contents]
    └ div.hHd-Xa_root[.hHd-Xa_collapsed?]        ← SidebarRoot（@deepseek-ai/dsh-client-ui-sidebar）；本插件在这里打 data-mpw-sidebar-root
      └ div.hHd-Xa_footArea                      ← 侧栏底部那一组（last child）
        ├ div.hHd-Xa_footerActions               ← ★ 官方附加 slot 在这里
        │ └ div[data-slot="sidebar.footer.action"]   ← 我们**首选**的落点（在「设置」正前方）
        └ div.hHd-Xa_settingsArea
          └ div[data-slot="sidebar.settings"]    ← 「设置」入口（机器生成锚点，非本地化、非哈希）
            └ div.VOzbGW_triggerRow
              └ button.VOzbGW_trigger[aria-label="设置"(本地化!)]
```

### 3.2 三件事的判据

1. **首选：宿主官方附加 slot `sidebar.footer.action`**（`kind:"list"`、`scope:"root"`、`replaceRisk:"none"`，
   `dsh-client-ui-sidebar` 声明；DSH 自带的插件开发 skill 明确写"小的侧栏动作优先用这类附加 slot，
   **不要去操作宿主的硬编码 DOM 选择器**"）。我们在里面渲染**自己的**一个 div（带 `data-mpw-np-slot`），
   控制器把容器放进它**内部** ⇒ 位置由宿主给，我们一行宿主 DOM 都不动。
2. **降级①：`[data-slot="sidebar.settings"]`** —— 渲染器给每个 slot 出口盖的机器生成标记
   （`SlotOutlet`，`display:contents`）。插在它**前面**。**不用 `aria-label`**：那是本地化字符串
   （这台机器上是「设置」，en 是 "Settings"）。
3. **降级②：`[class*="settingsArea"]`** —— CSS-modules **本地名**子串（前缀哈希会变、本地名相对稳；
   且它已是本仓 `style-scope-guard` 登记过的锚点）。插在它前面。
4. **兜底：`[class*="footArea"]` 的第一个位置** —— 并且**打一行 `console.warn`**（含"宿主侧栏 DOM 变了 +
   本文档 §3 的指针"）。**锚点全丢 ⇒ 一个节点都不注入 + 一行 warn**（宁可没有，也不要插到别处）。
   两条都有断言（E4/E5），`tools/now-playing-test.mjs` 检查日志里真的有 `anchor fallback` / `anchors not found`。

### 3.3 插入顺序怎么断言（不是"看着在下面就算"）

测试用的是**文档序**（先序遍历的序号），不是父节点/兄弟位置：

```js
docOrder(doc, 容器) < docOrder(doc, 设置入口的 button)
```

三条锚点路径（E1/E2/E3）各自断言一次，所以"换一条降级路径就跑到下面去了"这种回归会被抓到。
另有 E1b 断言首选路径的容器**父节点就是宿主 slot 出口**（证明走的是 slot 而不是顺手插到旁边）。

---

## 4. 数据接入：四种情形 + 未做/做不到清单

### 4.0 先说清：DSH 里**没有**系统媒体源

本插件拿不到"系统正在播放什么"（没有媒体会话通道、没有第二个进程、宿主也不提供）。
所以**任何**"曲名/歌手/专辑封面"都不会出现 —— 我们只报**我们自己真的知道**的东西：
**当前壁纸**的身份，以及**当前壁纸自带的音轨/声音**。

### 4.1 情形① 视频类壁纸（自带音轨）—— **真能控**

DSH 页面里就存在那个 `<video>`（壁纸本体）。控制器读它的 `paused/muted/volume/duration/currentTime`，
控件**真的**接在它上面：

| 控件 | 动作 |
|---|---|
| 播放/暂停（中间那颗） | `video.play()` / `video.pause()` |
| 回到开头 | `video.currentTime = 0` |
| 音量/静音（右边那颗） | 写**既有**设置项 `mute`（视频与网页两条路径都由既有接线负责），并把状态 POST 到宿主 `/media-audio` 契约（WP-1 新增）如实上报 |
| 进度 | `currentTime / duration`（`duration` 拿不到时不画进度，时间显示 `--:--`） |

**默认仍静音**：`mute` 的既有默认值就是 `true`，本轮**没有**改它 —— 组件不会自己把声音打开。

### 4.2 情形② 场景/自定义壁纸自带音轨 —— **只显示，不控**（做不到）

音轨**清单**是真的能拿到的（宿主扫描路由，`docs/AUDIO-TRACK-SPEC.md`）：

* `GET /api/mpkg-wallpaper/library-scene-audio?refs=0&ltoken=<mpkgKey>`
* `GET /api/mpkg-wallpaper/custom-scene-audio?refs=0&folder=<folderName>`

返回 `{ ok, source, count, tracks:[{path,size,mime,refs}], stats }`。我们用 `tracks[0]` 显示
"音轨文件名 + mime"，`count === 0` 就回到空闲态（**不猜**）。

**做不到的三件事，逐条**：

| 做不到 | 为什么 |
|---|---|
| 播放/暂停那条音轨 | 播它的是**场景渲染器**（另一个文档里的渲染器 iframe/进程）。插件对场景音频**没有**控制通道：`lib/index.js` 里与音频有关的只有"清单扫描"和 `/raw` 字节读取，没有任何 `play/pause/seek` op；`lib/web-interaction.js` 的 postMessage op 白名单里也没有音频项 |
| 进度 / 时长 | 扫描结果里**没有时长字段**（只有 `path/size/mime/refs`）。没有时长就没有进度 —— 我们不编一个假的总时长 |
| 音量 | 同上：没有通道。滑一个只有自己会动的滑块就是假动作 |

所以情形②的界面是：**曲名 = 音轨名、副标题 = 壁纸名 · mime、传输键 `disabled`**；
真按下去（禁用状态下浏览器不会触发，但控制器仍守着）会走 `refuse()`：
面板上一行说明 + `console.info` 一行。**不静默、不假装。**

### 4.3 情形③ 网页（web）类壁纸 —— 走既有静音设置 + 宿主 `media-audio`

网页壁纸的声音由既有链路管（`iframe.muted` + 帧内 `policy` op 的 `muted/speed` + 内层 `audio/video`
元素），设置项就是既有的 `mute`。本轮把**音量/静音按钮**接在它上面，并按 WP-1 的宿主契约
（`POST /api/mpkg-wallpaper/media-audio`，字段 `muted/volume/playing/audible/hasAudio/source`）
**如实上报**；`hasAudio` 我们不猜（宿主也不猜 —— 契约原文如此）。
**默认仍静音**（`mute` 默认 true）。

### 4.4 情形④ 无源（静态图 / 无音轨 / 尚未扫到）—— 空闲态

曲名 = `未在播放`（i18n），副标题 = 壁纸名。播放键 `disabled`。
**不做假动作**：如果真被触发，只出说明（面板一行 + console 一行）。

### 4.5 未做 / 做不到的诚实清单

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | 系统媒体源（其它 App 在放什么） | **做不到** | DSH 页面里没有这条通道；插件也不该去猜 |
| 2 | 场景壁纸自带音轨的播放/暂停/进度/音量 | **做不到** | §4.2；播放方在场景渲染器，插件无控制通道、扫描无时长 |
| 3 | 网页壁纸内部的**音量数值**（0..1 细调） | **未做** | 现有通道只有 `muted` 布尔 + 帧内 `speed`；细调要动 WP-1/WP-2 刚交付的 `web-interaction.js`（本轮禁区）。本轮只做**静音开关** + 如实上报 |
| 4 | 播放列表 / 上一首 / 下一首 | **不做** | 没有队列这个概念，做了就是假动作 |
| 5 | 「喜欢」按钮 | **不渲染** | §2.2 #4；CSS/几何照移植但不渲染 |
| 6 | 进度条拖动（seek） | **未做** | 上游原文："a scrubber you can drag is a different component that happens to live in the same box"；本轮进度**只读** |
| 7 | 壁纸音频的**真实波形/频谱** | **不做** | 无源（`AudioContext` 拿不到跨 iframe/渲染器的音频） |
| 8 | 键盘快捷键（空格播放等） | **未做** | 会和宿主输入框抢键；要做必须先和用户确认范围 |
| 9 | 真机外观/位置 | **未验** | 本轮禁浏览器（见 §9），留给主对话用 X11 验（清单在本次交付回复里） |

---

## 5. 左侧栏收起的判据与阈值

### 5.1 优先用宿主自己的状态（三级）

| 级 | 信号 | 出处 |
|---|---|---|
| ① | slot 的 `ownerProps.wide` | `renderSlot("sidebar.footer.action", { wide })`；`wide = !collapsed \|\| !settled`（SidebarRoot）—— **它就是这个问题的权威答案**，不用猜 |
| ② | `[data-sidebar-collapsed]` 属性 | AppFrame 框架根（`dsh-client-ui-layout`，`sidebarCollapsed \|\| void 0`） |
| ③ | 侧栏根上的 CSS-modules 本地名 `collapsed` | `div.hHd-Xa_root.hHd-Xa_collapsed`（子串匹配，前缀哈希会变） |

### 5.2 兜底：实测宽度 + 阈值 `NP_COLLAPSE_MAX_W = 96`

对**侧栏列**（`[class*="sidebarCol"]`，就是宿主 grid 轨道那个盒子）挂 `ResizeObserver`，
读 `getBoundingClientRect().width`，`width < 96` 判收起。

**阈值为什么是 96（量出来的宿主常量，不是手感）**：

* `dsh-client-ui-layout` 的 `computeColumns()`：`const s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);`
  ⇒ **收起时栏宽恰好 56px**（常数；`columns.d.ts` 里 `SIDEBAR_COLLAPSED = 56`），
  展开时被夹在 **[264, 420]**（`SIDEBAR_MIN/MAX`）。
* `96 = 56 + 40`：给 0.15s 的 `grid-template-columns` 过渡、次像素/DPI 取整、以及宿主将来把 rail
  加宽留余量；同时距最小展开宽 264 还差 **168px** ⇒ **任何展开态都不可能被误判成收起**（硬半边）。
* 判据是 `width < 96`（严格小于），所以 96 本身算展开。

**另外两条口径**：

* 量不到宽度（`NaN` / 拿不到 rect）⇒ **不隐藏**。宁可露出来，也不要因为一次量不到就永久消失。
* 宽度只是一个数；**贴合缩放**也用它：侧栏最小 264px 减两侧各 12px 内边距只剩 240px，
  而组件是照 260px 画的（上游的 `W`，宽度在两个状态之间**刻意不变**）。
  所以整体 `scale` 到 `clamp(avail/260, 0.5, 1)`（CSS 变量 `--mpw-fit`）——
  缩的是**整件物体**，内部几何一个数都不改（内部比例是这个组件唯一不能动的东西）。

### 5.3 不许常驻 rAF

`ResizeObserver` 只在盒子尺寸真变时回调；收起/展开是 `grid-template-columns` 的过渡 ⇒
过渡期间回调若干次、停下就没有回调。补间（`tweenTo`）是**自停**的（到站即 `cancelAnimationFrame`）。
测试里 `raf` 计数在"关"时是 **0**（B5）。

---

## 6. 开关：键名 / 默认值 / 持久化 / 零注入

| 项 | 值 |
|---|---|
| 键名 | **`npNowPlaying`** |
| 默认值 | **`false`** —— `lib/client.js` 的 `const DEFAULT_NP_NOW_PLAYING = false;` |
| 设置项落点 | 「壁纸设置」tab，紧挨既有 `mute` 开关下方（`toggleRow(t("npNowPlaying"), t("npNowPlaying.desc"), "npNowPlaying", DEFAULT_NP_NOW_PLAYING)`） |
| 持久化 | **本仓既有那一条路**：`toggleRow` → `commit()` → `writeSection()` → `localStorage["dsh.mpkg-wallpaper.v2"]` + `PUT /api/mpkg-wallpaper/settings`（宿主 `<DATA_DIR>/settings.json`）。本轮**没有**新增任何存储键、没有新增 URL 开关 |
| 备份/恢复 | 已登记进 `BACKUP_FIELDS`（导出/导入随外观设置走）；已登记进 `boolFields`（导入净化 + 开关接线审计都读它） |
| 「恢复默认」 | 一起回到 `false` |

### 6.1 "默认关 ⇒ 零注入"的断言（三条，产物级 + DOM 级）

| 断言 | 判据 |
|---|---|
| **B4/B6** | 控制器在关闭态（含"开关一次都不碰"的默认档）⇒ 全树 **0 个** `[data-mpw-now-playing]`，且 `ResizeObserver`/`MutationObserver`/`rAF` 的**构造数都是 0**（不是"装了再断"） |
| **B11** | 走**真实 apply 路径**（`tools/_stub.mjs` 加载真 `client.js` + 真 `apply()`）后，桩 DOM 全树扫 `data-mpw-now-playing` ⇒ **0 命中** |
| **B8/B10** | 真 `buildCss`：关档里 `data-mpw-now-playing` / `.mpw_np_` 命中 **0 次**；开档 = **关档 + NP 段**（`split(NP段).join('') === 关档`，**逐字节**纯增量） |

### 6.2 单实例（用户第 1 条之外的"别点出两个来"）

* `setEnabled(true)` 在**已经开着**时只做"重锚定 + 重判据"，**不重建容器**（E6：连开 4 次 + 强制重锚 ⇒ 全树 1 个）。
* `setEnabled(false)` 先按自己摘、再用选择器兜底扫一遍（清掉可能游离的节点），然后**断开全部观察者**（E7/E9）。
* 宿主 React 重渲染把我们挤掉 ⇒ `ensureAnchored()` 插回同一位置，**不新建第二个**（E8）。
* 变异自证：删掉"已经开着就只重锚"的守卫 ⇒ **E 组必红**（§7.3）。

---

## 7. 测试与门禁

### 7.1 名字/断言数

`tools/now-playing-test.mjs`：**68 条断言**（`--no-mutations` 时 64 条 + 变异段 4 条），
无浏览器、假 DOM（自建的那一小撮 DOM 语义 + 假 `window` 记账观察者/raf）。
接在 `tools/check.sh` **第 2 步**里（**没有**新增步骤 ⇒ 12 步的分母不变）。

| 组 | 条数 | 内容 |
|---|---|---|
| A 生成区 | 6 | 标记存在 / 两份源**逐字节**一致 / 只多 3 个绑定 / 在 `buildCss` 之前 / 能从生成区取出模块跑 |
| B 默认关 | 11 | 默认值/BACKUP/boolFields 登记 + 关闭态零 DOM 零观察者 + 真产物关档 0 命中 + 开档纯追加逐字节 |
| C 数学 | 24 | 两端 / 边界（越界夹住）/ 同心圆角 corner 0/16/32 / swell 峰值 0.63 且两端 0 / goo 两端 0 中点 1 / 八点四边形四条路径逐字 / 时钟 / 时长旋钮 736-460-184 |
| D 收起判据 | 11 | 阈值 96 / 纯判据四态 / 宿主状态优先 / NaN 不隐藏 / 端到端出现与移除 / 只靠宽度 / 只靠宿主 / 贴合缩放 |
| E 顺序与单实例 | 10 → **12**（复核更正②，§7.5.1） | 三条锚点路径的**文档序**都在设置入口之前 / 首选路径进 slot 内部 / slot 的 `wide` 生效 / 兜底留 warn / 锚点全丢不注入 + warn / 连开 4 次只 1 个 / 开关可反复 / 被挤掉自动插回 / 关后观察者归零 / 无源时播放键 disabled |
| F 变异自证 | 4 | 见 §7.3 |

### 7.2 常驻命令（贴实际输出）

```
$ node tools/now-playing-test.mjs
...
结果: 68 通过, 0 失败
✓ Now playing 门禁通过：生成区无漂移 + 开关默认关零注入 + 挂载在设置入口之前 + 左侧栏收起即隐藏 + 单实例
```

### 7.3 RED-if-reverted（4 组变异，各自必须让**指定那一组**变红）

变异注入到 `mkdtemp` 副本（`--client <copy> --no-mutations`），**真树不动**，夹具 < 1MB：

```
== F. 分辨力自证：4 组变异必须各自让**指定那一组**变红（副本在 mkdtemp，真树不动）==
  ✓ F 变异 threshold-reverted-to-always-expanded：期望 D 组变红，实际 D  …[exit=1]
  ✓ F 变异 switch-default-flipped-to-true：期望 B 组变红，实际 B  …[exit=1]
  ✓ F 变异 single-instance-guard-removed：期望 E 组变红，实际 E  …[exit=1]
  ✓ F 变异 generated-region-drifted：期望 A 组变红，实际 A  …[exit=1]
```

| 变异 | 改什么 | 期望变红 | 它防的是 |
|---|---|---|---|
| `threshold-reverted-to-always-expanded` | `width < NP_COLLAPSE_MAX_W` → `width < 1` | **D** | 收起时组件不隐藏（用户第 3 条要求静默失效） |
| `switch-default-flipped-to-true` | `DEFAULT_NP_NOW_PLAYING = false` → `true` | **B** | 默认就往用户侧栏里注入 DOM + 装观察者 |
| `single-instance-guard-removed` | 删掉"已经开着就只重锚"的守卫 | **E** | 重复开关叠出第二个容器 |
| `generated-region-drifted` | 往生成区塞一个空格 | **A** | 形态 (A) 的经典坑：生成物与源静默漂移 |

### 7.4 本轮**改过**的既有门禁（必须说明，不能偷偷放宽）

`tools/token-namespace-test.mjs`：新增开关会让 before/after **用例表长度不一致**而误报
（`buildCases()` 的布尔清单是从源码 `const boolFields` 抠的，而 `git show HEAD` 那份**没有**这个新键）。
修法：父进程把**同一份**用例表通过 `--cases <json>` 下发给两个 emit 子进程。
**这不是放宽**：用例表本来就该由 after（当前产物）定义，before 只是**同一批设置下**的对照；
"四表面生效值逐键相等"的判据一条没少（改后仍是 `12 通过, 0 失败` + 3 组变异全红）。

### 7.5 复核（收尾轮实测，2026-09-19）—— 逐条贴真实尾行

> 收尾轮**只做四件事**：把两个漂移门禁都接进 `check.sh`、复跑全部门禁、把文档里与实测不符的数字
> 更正（§7.5.1）、把 §8 台账补齐。**没有改任何行为、没有放宽任何判据。**
> 下面每条都是**原样尾行**（省略号是省略，不是改写）。

**① `node tools/build-now-playing.mjs --check`**（本轮**新增**为 `check.sh` 第 2 步的常驻命令）

```
✓ Now playing 生成区已是最新（68207 字符）
```

**② `node tools/now-playing-test.mjs`**

```
结果: 68 通过, 0 失败
✓ Now playing 门禁通过：生成区无漂移 + 开关默认关零注入 + 挂载在设置入口之前 + 左侧栏收起即隐藏 + 单实例
```

**③ `node tools/integrity-check.mjs`**

```
结果: 72 通过, 0 失败
✓ 插件完整性自检通过（配合 tools/check.sh 的 12 步门禁一起看）
```

**④ `bash tools/check.sh`**（12 步；第 9 步的口径见下）

```
全部通过 ✓  下一步：bash <工作区>/update-plugin.sh 然后刷新浏览器
```

末行原本打印的是**本机工作区绝对路径**（脚本按自身位置推导后打印）。本文档是 tracked 文件，
把那条绝对路径原样抄进来，会被本仓自己的 `secret-scan-test` 与 `integrity-check ⑩`
（"tracked 全量无本机绝对路径"）判红 ⇒ 这里把路径替换成 `<工作区>`。
**这不是裁剪证据**：`<工作区>` 与 `secret-scan` 的"0 命中"可以同时复算。**第 9 步（真机复刻 A/B）要无头 Firefox**，本轮硬约束是"不启动任何浏览器"（浏览器只能
由主对话跑）⇒ 我这边是 **11 步自跑**（`1–8` + `10–12`，日志与判定行原样留档），**第 9 步由主对话补跑**
（`node tools/header-rail-replica.mjs --both` ⇒ 10 条断言全 ✓、末行 `✓ 复刻对照：全部通过`）。
**没有**假装 12 步都在本进程里跑过。

**⑤ `node tools/secret-scan-test.mjs`**

```
扫描 99 个 tracked 文件（文本 99 个；跳过二进制 0 / >4MB 0）· 凭据模式 12 条 · 本机路径模式 3 条
✓ 敏感信息扫描干净：凭据 0 命中、本机绝对路径 0 命中、白名单无腐烂条目
```

（这一刻它只扫 **tracked** 文件 ⇒ 本轮新文件在提交前**对它是盲的**。提交后**又复跑一次**，
新文件已 tracked、仍 **0 命中**：见 §8.3。⚠ 文件数一栏请以**复跑那一刻**的实际值为准 ——
本轮有并行线也在提交（实测：我这条线跑第一次时 99，跑决定性那次时已 103），
**判据是"0 命中"，不是那个数字**。）

**⑥ `node tools/style-scope-guard.mjs`**

```
  ✓ 没有 RED / REVIEW：注入的每条规则都锚在自有标记或已登记的宿主作用域上
✓ 样式作用域护栏通过：268 OK / 134 ALLOWLISTED / 0 RED / 0 REVIEW（唯一「选择器+声明体」组）
```

**⑦ `node tools/token-namespace-test.mjs`**（§7.4 那份被改过的门禁 —— 复核它确实没被放宽）

```
设置组合 606 组 · before 606 / after 606
结果: 12 通过, 0 失败
✓ 表面 token 命名空间通过：四表面取值与重构前逐键相等 + SSOT 唯一定义点（body）+ 四表面接线齐全
```

变异段 3 组（`ssot-value-drift` / `ssot-back-to-root` / `surface-value-replaced`）各自 `[exit=1]` ⇒
与 §7.4"3 组变异全红"一致。**改的是下发方式，不是判据**：用例表仍由 after 定义，
"四表面生效值逐键相等"的 27 492 个键一个没少。

### 7.5.1 复核更正（**原文保留在上方**；这里写实测差异与原因）

**更正①（§2.1 的"反向纪律"判据不成立 —— 已换成方向性判据）**
原文写"本文件与两份源里 **0 处**来自该仓的标识符/注释/常量组织"。实测（比对面：
`we-scene-demo/demo/now-playing/{NowPlaying.tsx,now-playing-math.mjs}` ↔ 本仓两份源；
注释行取 ≥25 字符、空白归一；代码标识符取 ≥8 字符、去掉注释后比对）：

| 面 | 本仓 | GPL 那份 | **重合** |
|---|---|---|---|
| 注释行（≥25 字符） | 600 | 502 | **349** |
| 代码标识符（≥8 字符） | 199 | 52 | **29** |

**为什么这条判据必然不成立**：那一边的 `README.md` 与 `NowPlaying.tsx` 头注释都写着**「注释逐字保留」**
—— 它和本仓**是同一个 MIT 原件（Bencho）的两份移植**。两边都逐字保留原件注释 ⇒ 重合是**必然**，
重合的正是 `(^1.5 puts it at 0.63)`、`0 → zeta ~0.85, heavy, arrives without a ring` 这类**上游原句**。
把"必然重合"当成"0 命中"，是一个**不可满足的伪判据**（它对任何另一份 Bencho 移植都恒为红）。

**换成的判据（只查"那份独有的东西有没有被搬过来"）**：那份相对原件只有 4 处改动（它自己列的）——
① 导出名 `Sound`→`NowPlaying`；② 数学抽成 `now-playing-math.mjs`；③ `COVER` 指向它自己的图；
④ `stroke` prop 取代全局 `[data-stroke="on"]`。逐条实测本仓：

| 那份的独有改动 | 本仓实测 | 结论 |
|---|---|---|
| ① 导出名 `NowPlaying` | 导出 **`createNowPlaying`**；组件内部函数名确实叫 `NowPlaying` | 导出面**不同**；内部函数名**同名**（通用功能名，如实记下，不声称"0 重合"） |
| ② 数学单独成文件 | 也另存了 `lib/now-playing-math.js`（绑定名 `MPW_NP_MATH`） | **同形 ⇒ 无法用形态区分**；如实记为"分法相同、命名与动机不同（形态 A 的内联生成 + 纯函数可测）"，不主张独占、也不声称受影响 |
| ③ `COVER` 用它的图 | `COVER` = **当前壁纸缩略图**（拿不到就留空 ⇒ 走渐变兜底） | 不同 |
| ④ `stroke` prop | 自绘图标；**无** `lucide-react`（该串全文 1 处、**代码里 0 处**，只在"没有引它"的注释里）；代码里的 `stroke` 只有 SVG 标准属性 `stroke:"currentColor"`（2 处） | 不同 |

**更正②（§7.1 的 E 组条数写少了）** 原文 `E 顺序与单实例 | 10`，实测 **12**：E1 之后还有 **E1b**
（首选路径把容器放进宿主 slot 出口**内部**）与 **E1c**（slot 的 `wide` 直接当收起信号）——
§3.3 正文里引用了 E1b，表里却漏数。合计 `6+11+24+11+12+4 = 68`，与"68 条"自洽
（原文那个 10 会让合计只有 66，本来就不自洽）。

**更正③（§7.2 是示意骨架，不是实测）** 原文那个代码块开头就是 `...`。真实尾行见 §7.5 ②。
原文说"`--no-mutations` 时 64 条"—— 实测 `node tools/now-playing-test.mjs --no-mutations` ⇒
**64 通过, 0 失败**，`64 + 4 = 68` 自洽。

**更正④（§8 的"门禁"行是跑之前写的）** 原文 `bash tools/check.sh 12 步全绿` 在写下时**还没跑过**。
复核后的口径见 §8 新增的两行与 §7.5 ④。**第一次自跑确实红了 3+10 条，但全在别人的路径上**
（`docs/RELEASE-READY-3.8.0.md` / `docs/RELEASE.md` 里的本机绝对路径，来自上一轮的发布准备提交
`b66bae6`）；主对话在 `991092b` 洗掉后**复跑两条 ⇒ 72/0 与 0 命中**，随后**全量复跑 ⇒ 全部通过 ✓**。

**更正⑤（§1 表说 `check.sh` 接线是"一条"，实际是两条）** 现在第 2 步里常驻**两条**：
`node tools/build-now-playing.mjs --check` 与 `node tools/now-playing-test.mjs`。它们是**独立实现**：
前者由生成器**复算整块生成区**，后者从产物里**把两份源的正文抠出来逐字节比**。
为什么两条都要：只有后者能抓"产物正文被手改"（改完再跑一次生成器就一致了），
只有前者能抓"生成器自身的组装逻辑变了、而测试的抠取口径没跟上"。**分母仍是 12 步**
（都塞在第 2 步里，`integrity-check ⑨b` 的编号自洽断言没变）。

### 7.5.2 "默认关 ⇒ 零注入"的三条判据（实测值，供真机复核对照）

| 判据 | 断言 | 实测值 |
|---|---|---|
| **产物级** | B8 | 关档里 `data-mpw-now-playing` / `.mpw_np_` 命中 **0 次**（关档 77 976 字节） |
| **产物级（纯追加）** | B10 | 开档 86 698 字节 = 关档 77 976 + NP 段 8 722，且 `开档 − NP段 == 关档` **逐字节** |
| **DOM 级** | B4 / B11 | 关闭态 **0 个** `[data-mpw-now-playing]`；走**真实 apply 路径**（桩 DOM，加载真 `client.js`）全树扫描 **0 命中** |
| **观察者计数** | B5 / B6 | `{"resize":0,"mutation":0,"raf":0,"caf":0,"liveResize":0,"liveMutation":0,"liveRaf":0}` —— 关闭态与"开关一次都不碰"的默认档**都是 0**（是"从来没装"，不是"装了再断"） |

---

## 8. 台账（日期 / 文件 / sha256 / 提交）

（sha256 见本次交付回复与 `THIRD-PARTY.md` §6；文件清单见 §1 表。）
⟶ **复核更正④**：上面这行是**收尾前的占位**（原文保留）。sha256 与提交哈希已在本节 §8.1/§8.2 补齐，
`THIRD-PARTY.md` §6.1 也有同一张表。

| 项 | 内容 |
|---|---|
| 日期 | 2026-09-19 |
| 编号 | **NP-1** |
| 用户依据 | 第 1 条（逐字见文首） |
| 新增 | `lib/now-playing.js`、`lib/now-playing-math.js`、`tools/build-now-playing.mjs`、`tools/now-playing-test.mjs`、`docs/NOW-PLAYING-DSH.md` |
| 修改 | `lib/client.js`（接线）、`tools/check.sh`（第 2 步加一条常驻命令，**步数仍 12**）、`tools/token-namespace-test.mjs`（§7.4）、`THIRD-PARTY.md` §6、`../docs/COPYING-RULES.md` §4 #13 |
| **未动** | `lib/web-wallpaper.js` / `lib/web-interaction.js`（WP-1/WP-2 刚交付）、`package.json` 的 `version`、`lib/index.js` |
| 门禁 | `bash tools/check.sh` 12 步全绿；`integrity-check` 72/0 不降；`secret-scan` 干净；`style-scope-guard` 0 RED / 0 REVIEW；`token-namespace-test` 12/0 |
| 接线（**复核更正⑤**） | `tools/check.sh` 第 2 步加的是**两条**常驻命令（`build-now-playing --check` + `now-playing-test`，分母仍 12），不是一条 |
| 门禁（**复核后**，本机实测口径） | 12 步 = **11 步本机自跑全绿**（`1–8` + `10–12`）+ **第 9 步主对话补跑全绿**（无头 Firefox，本轮禁浏览器）；`integrity-check` **72/0**；`secret-scan` **0 命中**（提交后复跑 104 文件仍 0）；`style-scope-guard` **268 OK / 134 ALLOWLISTED / 0 RED / 0 REVIEW**；`token-namespace-test` **12/0**（+3 组变异红）；`now-playing-test` **68/0**（+4 组变异红） |

### 8.1 sha256（`sha256sum` 原样，2026-09-19 收尾轮）

**本表不含** `docs/NOW-PLAYING-DSH.md` 与 `THIRD-PARTY.md`：它们**承载这张表**，写进去就是自指
（写完哈希就变）。`../docs/COPYING-RULES.md` 在**仓外**（工作区根的 `docs/`，不是 git 仓库、不入包）
⇒ 无法提交，只记本轮那次写入的版本备查。

| 文件 | 字节 | sha256 |
|---|---|---|
| `lib/now-playing.js` | 50401 | `67cdcf496e0dc2d0789115281d1732fcbfd8b0ea8d6a2cf049a11178ad181ca9` |
| `lib/now-playing-math.js` | 30996 | `a47226d0c7da495ff33b0c52e649b8c5293bf9eec649a525e3d80a4052d79791` |
| `lib/client.js` | 969898 | `c7949b83282212c9a435d8c78fe6e181d05c989a559d721b4ccaaf44c50fa374` |
| `tools/build-now-playing.mjs` | 6316 | `83629aa07811ee2aef8e889779c7ad6548069ed4ffdca681383ec22daee6f1d1` |
| `tools/now-playing-test.mjs` | 40400 | `0f909260667774ba0c1cdb19126a6cc2b29b3887824fb46244eda8d4c83f9ad2` |
| `tools/check.sh` | 18466 | `62b0896f4dda26901d8d55580123987423ccdfb5bc2b9f21ffe500fc54108351` |
| `tools/token-namespace-test.mjs` | 25987 | `3c66234b4566bdc5515d03a8801a745de3319677bacff89e4bc22d43916f8ded` |
| （仓外，非 git）工作区根 `docs/COPYING-RULES.md` | 47283 | `19fd4367e777da4df3401cfb05316d510b309b31d39eade7c04cac5d282610a5` |

### 8.2 提交（本仓模式：先提交代码，第二次"文档落账"写入哈希）

| 提交 | 内容 | 哈希 |
|---|---|---|
| 第 1 次（代码 + 设计文档 + 归属登记） | `lib/now-playing*.js`、`lib/client.js`、`tools/build-now-playing.mjs`、`tools/now-playing-test.mjs`、`tools/check.sh`、`tools/token-namespace-test.mjs`、`THIRD-PARTY.md`、`docs/NOW-PLAYING-DSH.md` | **`bf538fabe3302964fbe8913baab0af4eb413e285`**（短 `bf538fa`，9 files changed, 4850 insertions(+), 9 deletions(-)） |
| 第 2 次（**文档落账**） | 只改文档：把第 1 次提交的哈希写进本节与 `THIRD-PARTY.md` §6.1 | 写进下面这行；**它自己的哈希无法写进自己** ⇒ `git log -1 -- docs/NOW-PLAYING-DSH.md` |

**落账值**：第 1 次提交 = `bf538fabe3302964fbe8913baab0af4eb413e285`；
第 2 次（**本行所在的「文档落账」提交**）= `git log -1 -- docs/NOW-PLAYING-DSH.md`（写完才有哈希 ⇒ 无法自指）。

### 8.3 提交后复跑（新文件进入 tracked ⇒ 被"只扫 tracked"的门禁覆盖）

`tools/secret-scan-test.mjs` 与 `tools/integrity-check.mjs` **只扫 tracked 文件**，本轮新文件在提交前
对它们是**盲区**（这正是发布准备提交 `b66bae6` 记下的那个坑）。所以提交后**又复跑一次**：
本包 7 个新/改文件的路径都在扫描面内，判据是 **0 命中**（凭据 0 / 本机绝对路径 0）；
`integrity-check` 仍 **72/0**（其中 ⑩ 就是"tracked 全量无本机绝对路径"，它此刻才真正看到本轮新文件）。
**实测数字由第二次「文档落账」提交写入**（日志在第一次提交之后才产生，写不进第一次提交的文件）：

| 提交后复跑 | 实测 |
|---|---|
| `node tools/secret-scan-test.mjs` | `扫描 108 个 tracked 文件（文本 108 个；跳过二进制 0 / >4MB 0）· 凭据模式 12 条 · 本机路径模式 3 条` … `✓ 敏感信息扫描干净：凭据 0 命中、本机绝对路径 0 命中、白名单无腐烂条目` |
| `node tools/integrity-check.mjs` | `结果: 72 通过, 0 失败` + `✓ 插件完整性自检通过（配合 tools/check.sh 的 12 步门禁一起看）` |
| `git status --porcelain` | 空（提交后工作区干净） |

---

## 9. 未做 / 待确认 / 只能真机验的

1. **真机外观与位置未验**（本轮禁浏览器）：需要主对话用 X11 打开 `http://127.0.0.1:3080`，
   设置 → 找 `Now playing` 开关 → 打开 → 看侧栏「设置」上方是否出现控件、点开是否展开成卡片、
   收起侧栏是否隐藏。清单见本次交付回复 §⑪。
2. **`slot` 的 `wide` 是否真的传到我们的组件**：宿主源码里 `renderSlot("sidebar.footer.action", { wide })`
   是明写的，slot 目录也标了 `ownerProps: { wide: boolean }`，但本轮**没能真机确认**。
   所以收起判据是三级 + 宽度兜底（§5.1）—— 即使 `wide` 没到，宽度那条也能工作。
3. **组件在 260px 宽度下的观感**：本机侧栏默认 280px ⇒ 可用 256px ⇒ `fit≈0.985`。
   真机若觉得偏小/偏大，调 `NP_SIDEBAR_INLINE_PAD` 或 `fitScale` 的下限即可（都在
   `lib/now-playing.js` 里，有注释）。
4. **`docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md` 里没有 DSH 自己侧栏的契约**：
   它审计的是第三方 `dsh-better-sidebar@0.19.1`。本轮把 DSH 侧栏的契约**写进了本文 §3.1**
   （来源：`dsh-client-ui-layout` / `dsh-client-ui-sidebar` / `dsh-client-ui-renderer` 源码 + 真机 DOM）。
   建议下一轮把它抽成 `docs/DSH-SIDEBAR-DOM-CONTRACT-<version>.md` 并在 §3.1 留指针。
5. **`[class*="root"]` 那个既有标记选择器偏脆**（`wSkVaW_root`/`ydkMvW_root` 也含 "root"）：
   `lib/client.js:4412` 的 `[class*="sidebarCol"] [class*="root"]` 靠"先匹配先赢"目前是对的。
   本轮**没有**去改它（禁区外但风险不必要），只在本文记一笔。
6. **复核补充（2026-09-19 收尾轮）**：`node tools/header-rail-replica.mjs --both`（`check.sh` 第 9 步，
   要无头 Firefox）已由**主对话**补跑 ⇒ 10 条断言全 ✓、末行 `✓ 复刻对照：全部通过`
   （关键读数：磨砂 before `z-index=-1` → after `0` 且宿主内容抬到 `1`、`backdrop-filter` 含 `blur(30px)`；
   描边 before alpha=0 → after 0.26；rail 反色晕 `rgba(255,255,255,0.55) 0 0 0 1px`、几何仍 2px）。
   ⚠ **注意它验的是"宿主顶栏/时间线条复刻"那条老链，不是 Now playing 本身** ——
   本节第 1 条（`http://127.0.0.1:3080` 真机看侧栏「设置」上方那个控件、开关、收起隐藏）**仍未验**。

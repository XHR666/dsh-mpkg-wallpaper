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
⟶ **①(NP-2) 复核更正（真机 bug，§7.6）**：这一条的**优先级反了**，已改成"**物理宽度优先**（量到 ≥96px 就不隐藏）、宿主状态只在**量不到宽度**时兜底"。真机上出现过"宿主 `wide=false` + 实测 256px 展开"的矛盾组合，旧写法让控件在展开的侧栏里把自己藏了。

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
| `tools/np-sidebar-live-probe.mjs` | **真机探针**（要用 `:3080` + headless Firefox ⇒ **不进常驻门禁**）：L0–L8 + ①(NP-2) 的 L5b/L6b/L6c + 时间线诊断 + `--selftest`（无浏览器判据自证） | 新增 |
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
⟶ **①(NP-2) 复核更正（真机 bug，§7.6）**：这一节的小标题与下表**只在"量不到物理宽度"时成立**。
真机上出现过"宿主 `wide=false` + 实测 256px 展开"的矛盾组合 ⇒ 判据已改成**物理宽度优先**（§7.6.3 三档），
宿主这三级信号降为**兜底**。下表本身（信号从哪来）没有变。

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

### 6.0 复核更正（2026-09-19，NP-3 之后）：**开关默认值已由 `false` 改为 `true`**

本节（§6）与 §0/§6.1 若干处仍写着"默认 **false** / 默认关"——那是 **NP-1 交付时**的口径。
NP-3（提交 `9be7ec5`）按新需求把 `DEFAULT_NP_NOW_PLAYING` 改成 **`true`**（默认挂载），并新增"宿主同一位置已有别的插件注入 ⇒ 自动让位"。
**不变量没变**：把开关**关掉仍是零注入**（本节 §6.1 的三条断言在"显式关"档下依然成立，门禁夹具已按显式关重写）。
读到"默认关"请以本节这条更正为准；其余正文按"不删原文、追加更正"的惯例保留。

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
⟶ ①(NP-2 2026-09-19 真机复核后)：**79 条**（`--no-mutations` 时 **73** 条 + 变异段 **6** 条）——
新增 G 组 9 条（§7.6.5），另在 D/E 组各补 1 条（语义更正后的反面断言）。**没有删任何一条断言**。
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
| **G 真机复核回归** | **9**（①(NP-2) 新增，§7.6.5） | 物理宽度优先三档（256/280/56/NaN）/ 重锚进 slot 那一刻不许翻转 hidden / 异常几何不许粘住 / 补判不占 rAF |

### 7.2 常驻命令（贴实际输出）

```
$ node tools/now-playing-test.mjs
...
结果: 68 通过, 0 失败
✓ Now playing 门禁通过：生成区无漂移 + 开关默认关零注入 + 挂载在设置入口之前 + 左侧栏收起即隐藏 + 单实例
```

### 7.3 RED-if-reverted（4 组变异 → ①(NP-2) 复核后 **6 组**，各自必须让**指定那一组**变红）

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
| **`host-signal-beats-width-restored`**（①(NP-2) 新增） | 把"物理宽度优先"改回旧写法（宿主说收起就收起） | **G** | 真机 bug 复现：256px 展开态被 `wide=false` 写成 hidden（探针 L6 抓到的那条） |
| **`settle-reevaluation-removed`**（①(NP-2) 新增） | 删掉锚点搬动后的一次性补判 | **G** | 搬动那一帧量到的异常几何会**粘住**（真机表现为控件永久消失） |

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

### 7.6 真机复核更正（2026-09-19 · ①(NP-2)）—— 探针抓到一条**真 bug**，已修

> §9 第 1 条写着"真机外观与位置未验"。**主对话把它验了**：真 `:3080` + 自签 Cookie + headless Firefox，
> 走真 GUI 路径（侧栏「设置」→ 设置页「壁纸引擎背景」→ 面板「壁纸设置」tab → 点那一行的开关）。
> 首轮 **8 PASS / 0 FAIL**（开关打开 ⇒ 恰好 1 个节点、文档序在「设置」之前、收起后带 hidden、0 pageerror）。
> **但第二次加载（开关已经是开的）抓到一条真 bug。** 探针已固化进仓：`tools/np-sidebar-live-probe.mjs`
> （**不进**常驻门禁 —— 它要用户 DSH 在跑 + 浏览器；它的判据本身有无浏览器自证：`--selftest`）。

#### 7.6.1 真机时间线（原样读数）

```
t≈800ms : np=false（开关已开，但组件还没挂）
t≈2000ms: np=true  hidden=false anchor=settings-slot inSlot=false colW=256   ← 正常可见
t≈4000ms: np=true  hidden=false anchor=settings-slot inSlot=false colW=256   ← 仍可见
t≈8000ms: np=true  hidden=TRUE  anchor=slot          inSlot=true  colW=256   ← ✗ 一挪进宿主官方 slot 就自己藏了
```

关键三点：**栏宽 256px（展开）**、宿主**没有**收起（`data-mpw-sidebar-root` 不带 collapsed、AppFrame 没有
`data-sidebar-collapsed`）、`hidden` 是在**重锚进 `sidebar.footer.action` 的那一帧**被写上的。
而且写上去之后**没有下一次事件**来纠正它 ⇒ 用户视角就是"刷新后控件自己消失，直到下次状态变化"。

#### 7.6.2 根因（两条同时成立才出这个 bug）

1. **判据的优先级写反了**：原文（§5.1 与代码注释）写"宿主自己的状态**优先**、它是权威；宽度阈值是兜底"
   ⇒ `hostSaysCollapsed()` 只要拿到 `ownerProps.wide=false` 就直接判"收起"，**根本不看** 256px 的实测栏宽。
   而 `wide` 是**派生值**（SidebarRoot 的 `wide = !collapsed || !settled`），在 slot 刚渲染的那一帧可以是
   prelim 的；96px 与 256px 相差 168px，物理宽度在这条带上不会说谎。
2. **决策发生在宿主正在渲染的那一帧，而且错了就粘住**：`data-mpw-np-hidden` 是 JS 一次性写上的属性，
   之后只有 `ResizeObserver`（只在尺寸**变化**时回调）与 `MutationObserver`（只看侧栏根的 childList）
   能再触发 `evaluate()` —— 那一帧之后两者都没有再响 ⇒ 错的决定永久生效。

#### 7.6.3 修法（按模块语义，不是打补丁）

**① 判据改成三档：物理宽度优先，宿主信号降为"量不到宽度时的兜底"**

| 档 | 条件 | 结果 | 为什么 |
|---|---|---|---|
| ① | 量到宽度 **≥ 96px** | **不隐藏**（宿主说收起也不隐藏） | 96 与最小展开宽 264 之间有 **168px 硬余量** ⇒ 这么宽不可能是收起态。**这一条就是真机 bug 的判据** |
| ② | 量到宽度 **< 96px** | 隐藏 | 宽度自己够判（宿主收起恰好 56px），不需要宿主配合 |
| ③ | **量不到**宽度（`NaN` / 元素已脱离文档） | 才看宿主信号（`wide` / `data-sidebar-collapsed` / 根上的 `collapsed` 类）；宿主也没说 ⇒ 不隐藏 | 真量不到时宿主信号比瞎猜强；§5.2 那条"宁可露出来"的口径保留 |

**② 锚点搬动 / slot 生命周期事件之后补一次重判**（`scheduleSettle()`）：
一次性 `setTimeout(…, 0)`、自停、`stopObservers()` 里清掉 —— **不是**常驻 rAF、不改观察者数量、
不占 `liveRaf` 记账（G8 断言 `raf` 计数仍为 0）。它保证"搬动那一帧量到的几何"不会变成终局。
**③ 量宽加一道守卫**：元素已脱离文档时不量（脱离文档的节点恒为 0 宽，而 `0 < 96 ⇒ 隐藏` 是同一类形状的坑）。

#### 7.6.4 因此**改了语义**的既有断言（逐条说明为什么不是放宽）

| 断言 | 原文（§7.5 之前的写法） | 现在 | 为什么这么改 |
|---|---|---|---|
| D3 | "宿主自己的状态**优先**：即使量到很宽，宿主说收起就是收起"（`shouldHide(280,true)===true`） | 宿主信号只在**量不到宽度**时生效（`shouldHide(NaN,true)===true`） | 旧写法就是真机 bug 的形状本身；留着它等于把 bug 固化成期望 |
| D8 | "只靠宿主状态也能隐藏（**280 宽** + collapsed 属性 ⇒ 隐藏）" | "宿主 collapsed 属性 + **量不到宽度** ⇒ 隐藏" | 同上：把"宿主信号有效"这件事移到它真正该生效的档（量不到宽度） |
| D10 | 根上的 `collapsed` 类 + 280 宽 ⇒ 隐藏 | 类 + 量不到宽度 ⇒ 隐藏；量得到 280 宽 ⇒ **不隐藏** | 同上 |
| E1c | "slot 的 `wide` **直接**当收起信号（最权威）" | "slot 的 `wide` 已接线（**量不到宽度**时决定隐藏）" | 接线一条没丢，只是不再是"最权威" |

**没有放宽任何阈值**：`NP_COLLAPSE_MAX_W=96`、宿主常量 56/264、`NaN ⇒ 不隐藏`、单实例、零注入、
文档序、兜底留 warn —— 一条都没动。断言数 **68 → 79**（新增 G 组 9 条 + 既有组 2 条），
变异组 **4 → 6**（新增两组都指向 G 组，见 §7.6.5）。判据的**覆盖面只增不减**。

#### 7.6.5 可复现的无浏览器判据（G 组 + 变异 + 探针 selftest）

| 判据 | 内容 |
|---|---|
| **G1** | 宿主说收起（`wide=false`）+ 实测 **256px** ⇒ **不隐藏**（`shouldHide(256,true)===false`，280 同理） |
| **G2** | 宿主说展开 / 或这版宿主压根没给（`wide=true` / 缺省）+ 256px ⇒ 不隐藏 |
| **G3** | 真的窄了（56px / 95.9px）⇒ 隐藏 —— 宿主说什么都一样 |
| **G4** | 量不到宽度时才轮到宿主信号（`NaN`+收起 ⇒ 隐藏；`NaN`+没说 ⇒ 可见） |
| **G5** | 复刻真机那一帧：先落降级锚点 `[data-slot="sidebar.settings"]` ⇒ slot 出口**后出现** ⇒ `setSlotNode()` + `setHostCollapsed(true)`（= 交下来 `wide=false`）⇒ `ensureAnchored()` 搬进 slot |
| **G6 / G6b** | 搬完 `hidden` **仍是 false**；补判跑完（`settlePending=false`）后**仍然** false |
| **G7** | 搬动那一帧量到**异常几何（0 宽）** ⇒ 隐藏决定**不许粘住**：补判必须纠正回可见（挂载时 hidden=true ⇒ 补判后 false） |
| **G8** | 一次性补判不是常驻 rAF、关掉后无残留（`raf` 计数 0、`live*` 全归零） |
| **变异 ①** | `host-signal-beats-width-restored`：把判据改回旧写法（宿主说收起就收起）⇒ **G 组必红**（复现真机 bug） |
| **变异 ②** | `settle-reevaluation-removed`：删掉搬动后的一次性补判 ⇒ **G 组必红**（异常几何粘住） |
| **探针 selftest** | `node tools/np-sidebar-live-probe.mjs --selftest` ⇒ **4 PASS / 0 FAIL**（合成三条时间线：真机 bug 形状必须被判据抓到、修好的形状 0 违规、真收起 56px 不算违规、开关关着不算违规）—— **不起浏览器、不写设置、不签 Cookie** |

#### 7.6.6 修后**还没验**的（诚实清单）

1. **修好之后真机还没复跑**（⟶ **更正：已复跑，见 §7.6.7** —— `PASS=12 FAIL=0`，时间线里那次重锚 `hidden=0`；
   原文保留在这一行下面）：请主对话跑 `node tools/np-sidebar-live-probe.mjs --out /tmp/np-live`
   ⇒ 要求全 PASS（新增 L5b/L6b/L6c：等 slot 真的渲染出来再断言、时间线任何一拍都不许 hidden、
   之后 1.5s 内不许"自己冒出来"）。探针这轮加了诊断字段（`slotWide` / `frameCollapsed` /
   `rootCollapsed` / 时间线），复跑输出的**时间线**就是这次的"修后读数"。
2. **`wide` 的真机取值**只在探针输出里（我们 slot div 上的 `data-mpw-np-wide`）；本轮的"wide=false"是
   从"重锚那一刻 hidden 被写上"**反推**的 —— 修后复跑会把它变成直接读数（时间线里那一栏）。
3. **过渡期多停留一会儿**：折叠/展开的 0.15s 过渡期间，宽度还没跨过 96px ⇒ 组件会晚一点点才隐藏/出现。
   这是"物理优先"的代价，**没有**给过渡期做特判（特判会引入第二套判据）。
4. 探针**不进**常驻门禁（要用户 DSH + 浏览器）；`--selftest` 是它的无浏览器半边。

#### 7.6.7 修后真机读数（**已复跑**，2026-09-19 当天）

修完 → 提交（`d072858`）→ `bash update-plugin.sh`（同步到 profile 安装副本：**13 个文件 md5 全部一致**，
含 `lib/now-playing.js` / `lib/client.js`）→ 跑探针：

```
$ node tools/np-sidebar-live-probe.mjs --out /tmp/np-live     # 退出码 0
时间线（250ms/拍，只打印变化行，共 15 拍）:
  t≈   36ms  np=1 hidden=0 anchor=settings-slot inSlot=false colW=256 slotWide=n/a frameCollapsed=false rootCollapsed=false
  t≈ 1651ms  np=1 hidden=0 anchor=slot          inSlot=true  colW=256 slotWide=1   frameCollapsed=false rootCollapsed=false
PASS L0 宿主 slot 在位  PASS L1 进插件分区  PASS L2 「壁纸设置」tab  PASS L3 找到那一行
PASS L4 恰好 1 个节点  PASS L5 文档序在「设置」之前（inSlot=true）
PASS L5b 宿主 slot 出口真的渲染出来了（anchor=slot inSlot=true slotWide=1）
PASS L6 重锚进 slot 之后仍然不带 hidden（hidden=0 colW=256 slotWide=1 frameCollapsed=false）
PASS L6b 展开态的任何一拍都不许带 hidden（展开态样本 15 拍 / 违规 0 拍）
PASS L6c 之后 1.5s 内 hidden 不会自己冒出来（3 拍全 hidden=0）
PASS L7 侧栏收起 ⇒ 带 hidden（hidden=1 colW=56 frameCollapsed=true rootCollapsed=true 触发=button「收起侧边栏」）
PASS L8 整轮 0 个 pageerror
── 汇总：PASS=12 FAIL=0   截图 /tmp/np-live/01-mounted.png、/tmp/np-live/02-collapsed.png
```

**修前 vs 修后的同一处对比**：修前"重锚进 slot 那一拍"是 `hidden=TRUE`（§7.6.1 的 t≈8000ms），
修后那一拍是 `hidden=0`，而且 L6b 看的是**整条时间线**（15 拍 0 违规）而不是最后一眼。
**如实记一笔**：这次复跑的 `slotWide` 从 slot 出现那一刻起就是 `1`（上一轮 bug 里的 `wide=false` 是
slot 刚渲染时的 **prelim 值**，这次没复现到）—— 也就是说这次的"修后读数"**没有**在同一份输入上
重演 bug 的那一帧；判据的有效性由**变异自证**兜住（`host-signal-beats-width-restored` ⇒ G 组必红），
而 L6b 看整条时间线这一条能抓住"任何一拍"的翻转。

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

⚠ **这是 ①(NP-1) 收尾轮那一刻的快照，不是 HEAD 的值**：其中 **5 个文件**在 ①(NP-2)（真机复核，§7.6/§8.4）
改过 ⇒ 现在的工作区值与它们**不同**（不是漂移）。要复算本表：`git show bf538fa:<文件> | sha256sum`。
**已逐条复核**：本表 7 行全部等于 `bf538fa` 里对应 blob 的 sha256（7/7）；
§8.4 那张 6 行全部等于 `d072858` 的 blob（6/6）。

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
   ⟶ **①(NP-2) 复核**：这一条**已经验了一半**（主对话用真机探针跑了真 GUI 路径：恰好 1 个节点、
   文档序在「设置」之前、收起后 hidden、0 pageerror）—— 但**抓出一条真 bug 并修了**（§7.6），
   修后**还需要复跑一次探针**才算验完。控件"长什么样/点开成不成卡片"仍然只有截图，没有人眼复核结论。
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
7. **①(NP-2) 复核后的状态（2026-09-19）**：第 1 条已由主对话验了一半（真机探针，见 §7.6），
   并**抓出一条真 bug**（重锚进 slot 那一刻把自己藏了）—— 已修 + 配无浏览器判据。
   **修后真机未复跑**；`slot` 的 `wide` 现在有了直接读数通道（探针时间线里的 `slotWide`）。
   ⟶ **更正：修后已复跑**（§7.6.7，`PASS=12 FAIL=0`）；`slotWide` 实测为 `1`。
   第 2、3 条（`wide` 是否真到、260px 观感）仍然只有"源码 + 截图"，没有人眼结论。

### 8.4 ①(NP-2) 那一轮的落账（2026-09-19 真机复核后）

同 §8.1 的口径：**不含**承载本表的两个文档；`we-scene-demo/docs/PATCHES.md` 的 **P-155** 条目
（插件侧登记）**不在本仓**、且那份文件的工作区里有其它并行线的未提交段落 ⇒ 本条**不提交**它，
只在本表登记"编号与文件"备查。

| 文件 | 字节 | sha256 |
|---|---|---|
| `lib/now-playing.js` | 53248 | `a7862994665ef94f42bef7b5b0aa1335a4234a6273c8f1bbdbb5f0226902fd2a` |
| `lib/client.js` | 972745 | `dbfb3d133165d349e464250cb4683410c953e4a7d5c8154cc448ed9bcc0db5b0` |
| `tools/now-playing-test.mjs` | 48628 | `474238d2eff8a4791f138e1049cbf2d10a609ca6dbb5025a48599f4bd4ddf659` |
| `tools/build-now-playing.mjs` | 6596 | `7ab00750d84b3d31f116fe2082f0e6f07e800730af6c438c3443c79e88fa99d0` |
| `tools/check.sh` | 19149 | `b2b285027c454d86dd6382fadb812357aa5802331a0dcb8cf4a485140544af4d` |
| `tools/np-sidebar-live-probe.mjs`（新增） | 19000 | `bc5650b1723486ba597ce236ab53ce5b896d279c8fa76389ba0a47a64490eb5a` |
| （仓外）`we-scene-demo/docs/PATCHES.md` 的 P-155 条目 | — | 未提交（原因见上） |

**复核**：本表 6 行（含探针）**逐条**等于 `d072858` 里对应 blob 的 sha256（6/6，含
`git show d072858:tools/np-sidebar-live-probe.mjs | sha256sum`）。

| 提交 | 内容 | 哈希 |
|---|---|---|
| 第 1 次（代码 + 门禁 + 探针 + 文档） | `lib/now-playing.js`、`lib/client.js`（生成区重算）、`tools/now-playing-test.mjs`、`tools/build-now-playing.mjs`、`tools/check.sh`、`tools/np-sidebar-live-probe.mjs`、`docs/NOW-PLAYING-DSH.md` | **`d072858a48e9e99f7371c3db23b629d88e86daba`**（短 `d072858`，7 files changed, 667 insertions(+), 49 deletions(-)） |
| 第 2 次（**文档落账**） | 把第 1 次的哈希 + §7.6.7 修后真机读数（12 PASS / 0 FAIL）写进本节 | `git log -1 -- docs/NOW-PLAYING-DSH.md` |

**落账值（①(NP-2)）**：第 1 次提交 = `d072858a48e9e99f7371c3db23b629d88e86daba`（= `d072858`）。
第 2 次（**本行所在的「文档落账」提交**）= `git log -1 -- docs/NOW-PLAYING-DSH.md`。


---

## 7.7 ①(NP-3 2026-09-19)「壁纸声音」这一批真机 bug：根因 / 修法 / 判据 / 诚实清单

> 本节是**追加**（§7.1–§7.6 与 §8 原文一行未删）。所有"真机读数"来自 `tools/np-media-live-probe.mjs`
> （新写的探针，用自签 Cookie + headless Firefox 打开 `:3080`），开跑前/修好后各跑一次：
> **修前 16 PASS / 22 FAIL，修后 45 PASS / 0 FAIL**（截图 4 张，见 §7.7.6）。
> "无浏览器读数"来自 `tools/np-media-test.mjs`（新门禁：**82 通过 / 0 失败**，含 **12 组变异自证**）
> 与 `tools/now-playing-test.mjs`（**83 通过 / 0 失败**，含 7 组变异）。

### 7.7.0 这一批 bug 的**共同形状**（先说结论，后面逐条给证据）

八条现场症状里有六条落在**同一个模式**上：**"我们以为在控 A，其实 A 不是当前那张壁纸的东西"**。

| 层 | 具体错在哪 | 后果（用户视角） |
|---|---|---|
| 媒体源判定 | `#mpw-bgVideo` 这个 `<video>` 在页面加载时就建好了，**任何壁纸类型下都在 DOM 里**（不用视频时 `display:none`、没有 `src`）；旧实现按选择器命中它就当成"当前媒体" | web 壁纸下：播放键控空壳（点了没反应）、静音键读空壳的 `muted`（恒 true）⇒"点播放没用 / 展开看着在播点不动 / 声音控制打不开、一直静音" |
| 音轨清单路由 | 自定义目录的壁纸**不写 `folderName`**（web 壁纸是 `mpkgKey="custom|<folder>"`、视频/场景是 `image="host:?custom=1&folder=…"`）；旧实现只认 `folderName`/`mpkgKey` 两种形态，拼出 `library-scene-audio?ltoken=custom|…` ⇒ 宿主 404 | 目录里那首 `backgroundmuisc.mp3` **从来没接到控件**（清单恒 0 条） |
| apply 路径 | `applyFromStorageInner()` 的 **web 分支提前 `return`**（`:3945`），把共享尾里的 `applyNowPlaying(section)` 整段跳过 | 刷新/切到 web 壁纸后控件**根本不挂**（探针 np=0）；即使挂着也永远不按当前壁纸刷新 |
| CSS 产物 | `buildCss()` 的 `if (!hasImage)` 提前 `return` 忘了拼 `__npCss`（NP 段只在函数末尾那条 return 上） | section 少 `image`/`webUrl` 时（无壁纸、或"只有宿主 settings.json"的半残档）**NP 整份样式丢失**：`.mpw_np_*` 全变 static ⇒ 传输键掉到卡片外面、点不到 |
| 布局量宽 | 贴合缩放量的是"侧栏列"，而 `[class*="sidebarCol"]` 在真机上**不止一处**（右栏/dock 同类名）⇒ 量到 280 而我们的容器只有 256；且 `.mpw_np` 没有确定宽度 ⇒ grid 把 `width:auto` 夹到区域宽（232），`scale()` 的原点量的是被夹过的盒子中心 | 卡片右缘伸出容器可视区 **10.9px**（悬浮效果下更明显）⇒"音乐卡片有一部分被切掉" |
| 标记（播放/暂停那两个四边形） | 形状由**展开进度** `p` 驱动（旧 `tq = 1 - p`），不是播放状态 | 收起态恒画播放三角、展开态恒画暂停双条 —— 两种状态各有一半时间在说谎 |

**三条不是"我们算错"而是"根本没接线"的**：
① `video.muted` 从建 DOM 那刻被写死 `true`，此后**再没有任何代码**按 `mute` 设置给它赋值
（用户当前那张 mp4 实测 `ffprobe`：h264 + **aac 音轨**、20.0s ⇒ 声音一直都在，只是永远静音）；
② 静音键只 `saveSection({mute})`，**不落到任何元素**；
③ 宿主侧栏/ slot 出口晚渲染（NP-2 量到过 ~8s）时旧写法只打一行 warn 就 `return`，**不装观察者、不重试**。

### 7.7.1 逐条：现场 → 根因（文件:行）→ 修法 → 修前/修后真机读数

行号是**取证时**的快照（`lib/client.js` 修前 15437 行 / `lib/now-playing.js` 修前 994 行），改动后会漂移，按函数名定位。

| # | 现场（用户原话的意思） | 根因（文件:行，修前） | 修法 | 修前真机读数 | 修后真机读数 |
|---|---|---|---|---|---|
| 1 | 导入 **video 类 MPKG** 音频无法播放 | ①`lib/client.js:1154` `video.muted = true` 硬编码、全仓无第二处给视频元素赋 `muted`；②NP 的音量键只写设置（`lib/client.js:5291`） | 新增 `applyVideoMute()`（`lib/client.js`，被 `showVideoEl`/`showVideoEdge`/`npApplyMute` 调用）：设置项 `mute` 真正管住视频元素；NP 静音键改成"写设置 **+** 落元素" | 探针 A2 档：`video.muted=true`、设置点了也不变（旧 B3/B4 FAIL） | `A7 mozHasAudio=true` / `A8 canVolume=true` / `B4 点一次 ⇒ 元素 muted=false` |
| 1b | 视频壁纸到底**有没有音轨** | 不是猜的：`ffprobe -show_entries stream=codec_type` 用户那张 `dd/3582362359/Mid-Autumn Hoshino.mp4` ⇒ `0,h264,video` + `1,aac,audio,20.015s`；目录扫描 `custom-scene-audio?folder=3582362359` ⇒ `count:0`（音轨在**容器里**，不在目录里） | 浏览器侧如实显示：`npVideoAudio()` 读 `mozHasAudio`/`audioTracks`，**明确 false** 时副标题写"该视频没有音轨"并把静音键禁用；**判断不了**（null）就不禁用 | — | `A7` 直读 `mozHasAudio=true`；无音轨分支由 `np-media-test` B3/B3b/B3c 三条夹具钉住 |
| 2 | 导入 **web 类壁纸**音频无法播放，**音频文件就在文件目录下面** | `lib/client.js:5229` web 分支直接 `return`（不拉清单）+ `:5257 npFetchTracks` 只认 `folderName`/裸 `mpkgKey` ⇒ `custom\|<folder>` 拼成 library 路由 404 | 新增 `npAudioScope()`（认 `folderName` / `mpkgKey=custom\|` / `custommpkg\|` / `library\|` / `webUrl`/`image` 里的 `folder=`、`ltoken=`）+ `npTrackUrl()`（走宿主 `/raw`，路径只取 basename）；web 壁纸也拉清单 | `E2 np=0`、`E3 audio=null`（修前连控件都没有） | `E3` 出现 `<audio data-mpw-np-audio>`，`src=…/raw?custom=1&folder=3646392375&file=backgroundmuisc.mp3`（`duration=104.05s`）；`E4` 曲名 = `backgroundmuisc.mp3` |
| 2b | 那些音频文件是**给谁播的** | 实测：`grep -c backgroundmuisc 3646392375/index_*.js` = **0**（壁纸自己的脚本一次都没引用它）⇒ 它只是躺在目录里，本来谁都不放 | 由**我们自己的 `<audio>`** 放（不自动播放：浏览器自动播放策略 + "不替用户按播放"） | — | `E6 点播放 ⇒ currentTime 1.81s`（真的推进，`readyState=4`、`error=null`） |
| 3 | 上一首/下一首切换是乱的 | 旧实现**根本没有上一首/下一首**：左边那个键是"回到开头"（`lib/now-playing.js` `onRestart` → `vid.currentTime = 0`），且 `npResolveMedia` 对任何类型都报不出曲目清单 | 传输行改成 **上一首 / 播放暂停 / 下一首 /（卡片里）音量静音**；`npStepTrack(±1)` 按**清单顺序**环形切换 | 修前 `D1` 只有一个可点非播放键（`["取消静音"]`），`F1–F4` 全 FAIL | `F2 下一首 ⇒ 2.wav.ogg`、`F3 上一首 ⇒ 1-1.wav.ogg`、`F4 第 1 条再上一首 ⇒ 环形回 BGM.wav`（清单顺序逐条对） |
| 4 | **小卡片（收起）**状态点播放键没用，默认锁在暂停 | 同一个"空壳 video"根因：web 壁纸下 `play()` 落在没有 `src` 的 `#mpw-bgVideo` 上（浏览器拒播，`paused` 不动） | `npActiveVideo()` 三档判据（有 `src` + 不是 `display:none` + 当前 section 确实是视频类）；web 壁纸改成控**我们自己的 `<audio>`** | 修前 `C1 paused true → true`（点了没动） | `C1 paused true → false`（收起态真的翻转）；web 档 `E6 currentTime` 推进 |
| 5 | **展开模式**下默认在播放状态，无法暂停 | 标记形状由展开进度驱动（`lib/now-playing.js:512-517` 旧 `tq = 1 - p`）⇒ 展开态恒画暂停双条，"看着在播"；点击又落在空壳上 | `PlayMark` 改成由 **`mark`**（播放状态自己的 0→1 自停补间）驱动形状；`p` 只管尺寸/位置；控制器 `tweenMark()` | 修前 `C2/C5` 形状一模一样（`M6.50 4.00L13.25 8.00…` → 同串） | `C2/C5` 两态都能看到形状随状态变（`M6.00 4.00L10.00…` ↔ `M6.50 4.00L13.25…`） |
| 6 | 声音控制**打不开**，一直是静音状态 | ①空壳 video 的 `muted` 恒 true；②静音键只写设置不落元素；③"视频有没有音轨"要等 `loadedmetadata`，插件 apply 那刻 `mozHasAudio` 还是 false 且**没人重解** ⇒ 静音键永久 disabled | `npApplyMute()`（写设置 + 落 video/audio/帧内 + 宿主 `/media-audio` 上报）；新增 `npWatchVideo()` 接 `loadedmetadata/durationchange/play/pause/volumechange/timeupdate` 重解；顺带把视频进度/时长接上 | 修前 `A8 canVolume=false`（键是灰的）、`B3 mute=true`、`B4 元素 muted=true` | `A8 canVolume=true`、`B3 mute=false`、`B4 元素 muted=false`（`frame.muted=false` 同步） |
| 7 | 只有一个"上一首"，点它会把壁纸重载一下 | 旧"回到开头"直接改当前媒体的 `currentTime`（视频壁纸=画面跳回开头，用户读成"重载"）；传输动作原本就不该碰壁纸 | 上一首/下一首只切**我们的播放器**的曲目；判据钉住"iframe 元素身份 + src + 媒体 `loadstart/emptied` + 宿主 `/diag` 的 `mount` 信标"四项全不变 | 修前 `D2` 已 PASS（旧实现确实没改 iframe src），**但用户看到的是视频跳回开头** | `D2`/`E7`/`F5` 三条：点传输键全程 iframe 同一个、src 同、0 个 `loadstart`、0 条 mount 信标 |
| 8 | 开了**悬浮效果**时音乐卡片有一部分被切掉 | ①`buildCss` 的 `!hasImage` 早退漏 `__npCss`（整份样式丢失）；②贴合缩放量错列（280 vs 容器 256）＋`.mpw_np` 无确定宽度（grid 夹成 232，`scale` 原点偏右 14px）；③web 壁纸分支连 `data-mpw-float` 门控都跳过 | ①两条 return 共用 `__npCss`；②`measureAvailWidth()` 量**我们自己的容器** + CSS `width:260px; max-width:none; margin-inline: calc((100% - 260px)/2)`；③web 分支补 `data-mpw-float` | 修前 `G3 越界 right 10.9px`（card `35.03→266.95`，容器可视区 `24→256`） | 修后 `G3 四边都在内`（card `37.03→242.95`＝可用宽 205.92、fit 按容器算） |
| 9 | 新要求：开关**默认开**，但**不抢位** | 默认值是 `false`（`lib/client.js` 的 `DEFAULT_NP_NOW_PLAYING`）；让位逻辑不存在 | 默认改 `true`；新增 `occupantOf()`（放行"我们自己的节点/宿主 slot 出口与自有格子/实质空节点"，其余算占用者）＋ `data-mpw-np-yield` ＋ 一行可读 warn；**挂载前 + 挂载后（MutationObserver，`subtree:true`）都判**；占用者走了再回来 | 修前 `H1 np=0`（默认不挂）、`H3 yield=null` | `H1 np=1`（键被删掉也挂）、`H2/H3` 外来 div ⇒ 撤下 + `yield=foreign-occupant`、`H4` 不重建、`H5` 外来者走了回来、`H6` 挂载前就占用 ⇒ 不挂 |
| 10 | 声音 UI 落点：用**方案 (b)**（复用 NP 控件下半部那条传输出） | — | 不新增设置项：**传输行 = 上一首/播放暂停/下一首 + 卡片里的音量静音**，进度/时长用既有 rail+clock | — | 截图 `01-expanded.png`：曲名/副标题/rail（`0:08 / −3:25`）/四键全在卡片内 |
| — | 附带抓到（不在用户清单里，但同一形状） | `applyFromStorageInner` 的 web 分支早退把 `applyNowPlaying` 与 `data-mpw-float` 门控一起跳过 | 两处都补上（见 §7.7.0 表） | 修前切 web 壁纸后 `np=0`、`float=false` | `E2 np=1`、`G1 float=true` |

### 7.7.2 判据（无浏览器，全部可复现）

```bash
node tools/np-media-test.mjs          # 新增：82 通过 / 0 失败（12 组变异自证），~7s
node tools/now-playing-test.mjs       # 既有：83 通过 / 0 失败（7 组变异）
node tools/np-media-test.mjs --no-mutations   # 主体 70 条
```

* **`tools/np-media-test.mjs`（新，10 组断言 + 12 组变异）**：A 作用域与两条宿主路由（含真机那串
  `custom|3646392375`）/ B 数据源判定（空壳 video 不算源 · 无音轨如实显示 · 清单分支与 `canPrev/canNext`）/
  C 播放与换曲落点（顺序 + 环形 + 单条禁用 + 视频落 video + **全程不碰壁纸**）/ D 静音落点（设置 + video +
  audio + 帧内元素 + "我们在放音时帧内强制静音防叠音"）/ E 让位（挂载前占用 ⇒ 不挂 · 挂载后插入 ⇒ 撤下且
  不重建 · 空 div 与宿主自有格子不误判 · **锚点后出现 ⇒ 自动挂上**）/ F 标记（p 与播放状态解耦 · 传输行
  语义 · disabled 语义 · 补间自停）/ H web 路径不许跳过 apply（NP 与 `data-mpw-float`）/ I 卡片几何
  （`.mpw_np` 宽度 = `math.W` 且溢出均分 · fit 按容器实测宽度）。
* **变异自证 12 组**（改回旧写法 ⇒ 指定那一组必红）：`mark-driven-by-morph-again`(F) ·
  `hidden-shell-video-accepted-again`(B) · `audio-scope-loses-custom-mpkgkey`(A) · `mute-only-writes-setting`(D) ·
  `yield-check-removed`(E) · `anchor-watch-removed`(E) · `web-path-skips-np-apply`(H) ·
  `web-path-skips-float-attr`(H) · `np-card-width-unpinned`(I) · `np-card-centering-removed`(I) ·
  `np-fit-measures-wrong-column`(I) · `prev-next-collapse-to-restart`(C)。
* **改了语义的既有断言（不是放宽）**：`now-playing-test.mjs` 的
  B1（默认值 `false` → **`true`**，按新要求）、B8/B10（夹具改成**显式** `npNowPlaying:false`，因为默认已经是开）、
  B6（改成"控制器造出来没人 `setEnabled` ⇒ 零注入"，与默认值无关）、B11（桩 DOM 无锚点 ⇒ 不注入）、
  D11（贴合缩放改成由**容器**宽度驱动）、F 的 `single-instance-guard-removed`（幂等守卫现在有两处，
  要一起打掉才复现）、`switch-default-flipped-to-true` → `switch-default-flipped-to-false`。
  **断言只增不减**：`now-playing-test` 68 → **83**，另有新文件 82 条；覆盖面只增。
* **新钩子**（生产不引用，测试/真机排障用）：`globalThis.__mpwNpTest`
  （`scope/scanUrl/trackUrl/activeVideo/videoAudio/resolve/transport/audio/load/idx/seedTracks/apply/...`）
  与 `window.__mpwNpCtlSeq`（控制器单例计数：>1 就是"造了两份"的第一现场）。
* **`tools/check.sh`**：新门禁挂在**第 2 步**（`now-playing-test.mjs` 之后），照 MEDIA-SESSION.md §6.4 的同一条
  惯例 —— 追加一行、零重编号。

### 7.7.3 真机探针：`tools/np-media-live-probe.mjs`（新）

用法与副作用（探针头部写全了，这里摘要）：

```bash
node tools/np-media-live-probe.mjs --out /tmp/np-media     # 需要 :3080 + 已同步插件
node tools/np-media-live-probe.mjs --selftest              # 判据自证：8 PASS / 0 FAIL，不起浏览器、不写设置
```

* **会写用户设置，结束时逐字节复原**：为了验"默认开"要把 `npNowPlaying` 这个键**删掉**；为了验
  "web 壁纸目录自带音频"要临时切到 web 壁纸（`3646392375`）；为了验悬浮裁切要临时开 `float`。
  开头快照 localStorage + `<DATA_DIR>/settings.json`，结尾写回并 `R1` 断言 `mpkgKey` 已还原。
* **判据 45 条**：A 挂载与媒体源判定（4）· A2 完整视频壁纸档（4：video 有 src/可见、kind=video、
  `mozHasAudio=true`、canVolume）· B 静音真落元素（4）· C 收起/展开两态播放键真的翻转 `paused`
  且标记形状随状态变（6）· D 传输键不 remount（2，四项证据）· E web 目录音频被列出 + 播放
  （`currentTime` 真的推进）+ 不改 iframe（7）· F 上一首/下一首按清单顺序 + 环形（5）·
  G 悬浮态四边不越界（3，实测 rect）· H 默认开 + 让位夹具（6）· Z 本插件相关 pageerror 0 条 ·
  R 设置复原（1）。
* **两态 + 两张场景截图**：`01-expanded.png`（展开卡片）· `02-collapsed.png`（收起）·
  `03-web-audio.png`（web 壁纸目录音频）· `04-float-expanded.png`（悬浮开启）。
* **判据分辨力自证**（`--selftest`，8 条）：`rectClipped` 的四种越界/次像素边界、`stepIndex` 的顺序与环形、
  `remountViolations` 的四项证据（真 remount 必须全被报出来）。

### 7.7.4 "让位"的夹具判据（新要求第 9 条）

| 夹具 | 期望 | 谁断言 | 实测 |
|---|---|---|---|
| 槽里**先有**一个外来 `<div>` | 我们不挂 | 无浏览器 `E1`（`occupantOf` 挂载前路径）＋ 真机 `H6`（走真实 `setEnabled` 挂载路径） | `E1 nodes=0`；`H6 np=0 yield=foreign-occupant` |
| 挂载后**外来元素插进来** | 我们撤下，且**不重建** | `E6/E6b/E7`（改后两拍仍是 0）＋ 真机 `H2/H3/H4`（等 1.8s 再抽一拍） | `E7 nodes=0`；`H2 np=0`、`H4 np=0`（1.8s 后仍是 0） |
| 外来元素**移走** | 我们回来（让位不是单向的），状态属性清掉 | `E4` ＋ 真机 `H5` | `E4 nodes=1 yield=null`；`H5 np=1 yield=null` |
| 槽里只有**我们自己的** slot div / 宿主自有格子 / 空 div | 不算占用者（不误伤宿主） | `E8`（空 div）· `E9`（`footActions`/`settingsArea`）· `E5`（干净槽） | 三条都 `nodes=1 yield=null` |
| `data-mpw-np-yield` 可查询 | 属性写在**我们自己的 slot div** 上（没有就退回侧栏根） | `E2` ＋ 真机 `H3` | `foreign-occupant` |
| 观察面 | MutationObserver 必须 `subtree:true`（slot 出口在侧栏根**里面**，只看直接孩子永远看不到抢位） | `E7b`（断言 `observe()` 的选项） | `{childList:true, subtree:true}` |

### 7.7.5 门禁尾行（原样）

```
== F. 分辨力自证：7 组变异必须各自让**指定那一组**变红（副本在 mkdtemp，真树不动）==
结果: 83 通过, 0 失败
✓ Now playing 门禁通过：生成区无漂移 + 开关默认开（显式关仍零注入；无壁纸路径也带 NP 段） + 挂载在设置入口之前 + 左侧栏收起即隐藏 + 单实例

== G. 分辨力自证：12 组变异必须各自让**指定那一组**变红（副本在 mkdtemp，真树不动）==
结果: 82 通过, 0 失败
✓ NP 声音接线门禁通过：清单作用域/数据源判定/播放落点/静音落点/让位/标记状态 —— 全部有判据，且各有变异自证
```

真机探针（修后，`--out /tmp/np-media-final`）：

```
── 汇总：PASS=45 FAIL=0  截图 /tmp/np-media-final/01-expanded.png 02-collapsed.png 03-web-audio.png 04-float-expanded.png
```

### 7.7.6 修前/修后真机读数（逐条对照，原样）

| 组 | 修前 | 修后 |
|---|---|---|
| A/A2 | `kind:video`（**空壳**：`src="" display:none muted=true`）；`A8 canVolume=false` | `kind=video`（真壁纸：`src=…/Mid-Autumn%20Hoshino.mp4` `display=""`）；`A7 mozHasAudio=true`、`A8 canVolume=true` |
| B | `B3 mute=true`、`B4 元素 muted=true` | `B3 mute=false`、`B4 元素 muted=false`（frame 同步 false） |
| C | `C1 paused true→true`（没动）、`C2/C5` 形状不变 | `C1 true→false`、`C4 false→true`、`C2/C5` 形状随状态变 |
| D | `D1 ["取消静音"]`（没有上/下一首） | `D1/D1b` 视频档 `["静音"]`（上/下一首如实 disabled）；web 档见 F |
| E | `E2 np=0`、`E3 audio=null`（连控件都没有） | `E2 np=1`、`E3` `<audio>` 就位、`E6 currentTime=1.81s` |
| F | `F1–F4` 全 FAIL（没有清单概念） | `F1–F4` 全 PASS（清单顺序 + 环形） |
| G | `G3 越界 right 10.9px` | `G3 四边都在内`（card `37.03→242.95`） |
| H | `H1 np=0`、`H3 yield=null`、`H6 yield=null` | `H1 np=1`、`H2–H6` 让位夹具全 PASS |
| Z | 22 条 FAIL 里有 2 条是宿主/壁纸自身 pageerror 造成的假红 | 判据收窄到"本插件相关 0 条"，壁纸自身 10 条如实列出（见 §7.7.7 第 3 条） |

截图：`/tmp/np-media-final/01-expanded.png`（展开卡片：曲名/副标题/rail `0:08 −3:25`/四键）·
`02-collapsed.png`（收起：三键）· `03-web-audio.png`（web 壁纸目录音频已接）· `04-float-expanded.png`（悬浮态不裁切）。

### 7.7.7 诚实清单（做不到的 / 只能人眼看的 / 没复现的）

1. **web 壁纸"帧内那份声音"的播放/暂停**：我们只做到**静音**（`mute` 设置 → `frame.muted` + 帧内
   `audio/video` 元素 + shim `policy` op）。真正控帧内那份声音的播放/暂停需要帧内元素可达或 shim 扩展，
   本轮**不做**；界面上这种情况如实写"网页壁纸声音"并 `canPlay=false`（不假装能暂停 WebAudio）。
2. **我们放的音轨 vs 壁纸自己放同一首**：目录里那首若被壁纸自己的脚本也播了，会叠音。已做的防护：
   我们的播放器**在放音时强制静音帧内**（`npAudioOwns()` → `applyWebMute` → `frame.muted=true`）。
   用户现场那个 `backgroundmuisc.mp3` 恰好是**孤儿文件**（壁纸脚本 0 引用），所以观察不到叠音；
   "壁纸自己也播"的组合**没有真机样例可验**（未证）。
3. **宿主/壁纸自身脚本的 pageerror**：探针跑的时候稳定有 10 条（`can't access property "install", t is undefined`、
   `set src ... HTMLScriptElement`、`rawcanvas is null`、`me_ani_loadErr_other`、sandbox 下读 cookie 被拒），
   **修前修后都在**、与本插件无关（判据已收窄到"栈里含 mpkg-wallpaper/mpw"的 0 条）。我没有去修它们
   （不在本任务范围）。
4. **音量是"静音开关"，不是 0..1 细调**：既有通道只有 `mute` 布尔（设置项 + `/media-audio`），本轮未新增
   音量数值通道（要动 `web-interaction.js`/宿主契约，属禁区）。UI 上就是那颗静音/取消静音键。
5. **视频壁纸没有上一首/下一首**（单个媒体，没有曲目清单）：两个侧键**如实 disabled**，不是"点了没反应"。
6. **卡片里的第四个键（音量/静音）只在展开态出现**：收起态传输行是按 **88px 三键行**定位的
   （`now-playing-math.js` 的 `opsX(0)=206`，而 `opsX` 由门禁 C23 钉住），硬塞第四键会溢出右边距。
   所以"取消静音"需要先把卡片展开 —— 这是设计取舍，不是坏键（`B1` 判据断言了展开态确有 4 键）。
7. **只能人眼看的**：卡片外观/动画的观感（形状过弯好不好看、磨砂与背景的对比）、
   悬浮态下与 better-sidebar 底部面板的视觉叠压。截图 4 张可人眼复核，但不构成机器判据。
8. **没能复现的一条**：用户说"点上一首会把**壁纸视频重载**一下"。修前修后的探针读数都显示传输键
   **没有**改 iframe src、没有 `loadstart/emptied`、没有 mount 信标（`D2` 修前就 PASS）。
   最接近的解释是：旧"回到开头"键把**视频壁纸**的 `currentTime` 归零、画面跳回开头，被读成"重载"
   —— 但那发生在视频档，用户当时说的是 web 档，**这一点我没能复现**（如实记在这里）。
9. **半残档（`mpkgKey` 在、`image`/`webUrl` 都没了）**：真机上用户的 section 就是这种形态
   （探针开局读数：`image` 缺失 ⇒ 壁纸层被 `display:none`、NP 拿到"无源"）。我**只修了**"这种情况下
   NP 样式整份丢失"（`!hasImage` 路径漏 `__npCss`）；**壁纸选择字段为什么会丢**不在本任务范围，
   建议单独一条线查（它会让用户"看不到壁纸"）。
10. **`lib/index.js` 一行未动**（媒体会话 `/media-session` 等路由本轮**没有**新增）：本批 bug 全部落在
    壁纸自身的声音上，不需要宿主新路由（详见 docs/MEDIA-SESSION.md §6 的边界）。`/raw` 的
    `content-type: application/octet-stream` 对音频的兼容性实测在 Firefox 下可用（`E3/E6`
    `readyState=4`、`currentTime` 推进）；另做了一次"失败即 blob 兜底重试（带上扫描到的 mime，≤32MB）"
    的保险（`npAudioError`），本机没触发过它。

### 8.5 ①(NP-3) 那一轮的落账（2026-09-19 真机修复后）

**代码 + 门禁 + 探针 + 文档** 一次提交（只提交本线路径，未 `git add -A`）：

| 提交 | 内容 | 哈希 |
|---|---|---|
| **代码**（7 files changed） | `lib/client.js`、`lib/now-playing.js`（生成区重算）、`tools/check.sh`、`tools/now-playing-test.mjs`、`tools/np-media-test.mjs`（新）、`tools/np-media-live-probe.mjs`（新）、`docs/NOW-PLAYING-DSH.md` | **`9be7ec5c754599cdd29b9720000bb8c210053ca3`**（短 `9be7ec5`） |
| **本仓文档落账** | 把上面那个哈希 + §7.7 的修前/修后读数写进本节 | `git log -1 -- docs/NOW-PLAYING-DSH.md` |
| **跨仓台账**（渲染器仓 `we-scene-demo/docs/PATCHES.md`） | P-156（编号 = 提交那一刻的实际最大号 155 + 1；**只追加这一条**，渲染器仓其余路径一行未动） | **`6791197`**（`we-scene-demo` 仓内） |

**sha256（`sha256sum` 原样，2026-09-19 NP-3 提交后）**

| 文件 | 字节 | sha256 | 与提交 `9be7ec5` 的 blob |
|---|---|---|---|
| `lib/client.js` | 1021926 | `94fc7c3dce19594d3dd8927367cb175ce79633d5abf3d3293f763c53182daea2` | 一致 |
| `lib/now-playing.js` | 76104 | `8ef6193a69c0804f47d020c3af7ffb5f571c9047de4d0000d952c5652680d504` | 一致 |
| `tools/check.sh` | 19942 | `67c2bde2161cc057cff8b899b30af8b1312a0d8b7a49e2fa4881bd7fd64c2353` | 一致 |
| `tools/now-playing-test.mjs` | 52754 | `69e8514bb828d3e236e8be254a8cb52e67dee4a6177f3d6164ed134944b76871` | 一致 |
| `tools/np-media-test.mjs` | 54706 | `0160c88f6361a7448f1540250271d4dde315daf8ad4eafab4cfd0451cd459d89` | 一致 |
| `tools/np-media-live-probe.mjs` | 40785 | `36d277294766d18b1385dbcef2615120a7548c743305b0ac075658882d774e44` | 一致 |

**提交后复跑**：`node tools/now-playing-test.mjs`（83/0）· `node tools/np-media-test.mjs`（82/0，12 组变异）·
`node tools/np-media-live-probe.mjs --selftest`（8/0）· 真机 `np-media-live-probe.mjs`（45 PASS / 0 FAIL）·
真机 `np-sidebar-live-probe.mjs`（12 PASS / 0 FAIL）· `bash tools/check.sh`（全部通过，12 步 / 7m20s，
含第 9 步真机复刻的 headless Firefox 与第 11 步 bundle 等价性）。

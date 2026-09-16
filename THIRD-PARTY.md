# Third-Party Notices / 洁净室来历记录

本包（`dsh-mpkg-wallpaper`）的许可：**MIT**（全文见 `LICENSE`；`package.json` 的 `license` 字段 = `"MIT"`）。
本文件记录与本包有关的第三方代码来历、处置与规则；**本文件不是法律意见**。

---

## 1. 音轨模块：曾同源于渲染器 `demo.html`，已于 2026-09-16 洁净室重写

### 1.1 事实（审计结论，见 `../docs/PLUGIN-POLLUTION-AUDIT.md`）

| 项 | 内容 |
|---|---|
| 涉及文件 | `lib/pkg-extract.js` 的"惰性音频索引"段（旧版 295–646 行，共 352 行；其中约 210 行被审计判为**同源改写**） |
| 来源 | 渲染器 `we-scene-demo/demo.html` 的 `MPW-AUDIO-PANEL` 区块（该区块由 P-57 于 **2026-09-14** 加入，当时渲染器仍是 **MIT**） |
| 同源判据 | 判定**顺序**（RIFF→fLaC→OggS→ID3→MPEG 同步→ftyp→ADTS）、两条位掩码（`0xe0` / `0xf6`）、闭包 `tag(o,s)` 形态、行尾注释文字；旧代码注释还自认"与 demo.html 的 `AUDIO_EXT_RE` 逐字一致""逐条同序" |
| 旧标识符 | `PKG_AUDIO_EXT_RE` / `audioMimeFromHead` / `audioMimeFromExt` / `collectPkgAudioTracks`（`lib/pkg-extract.js`）与 `tools/audio-scan-test.mjs` 的 `loadDemoOracle()` |
| 提交状态 | 插件**从未提交**过该段：`git show HEAD:lib/pkg-extract.js` 对上述 5 个标识符命中数为 0（仓库历史干净）⇒ 无历史需要改写 |
| 旧段指纹（供比对） | 抽出 295–646 行：352 行 / md5 `36b4e80e57355de53da5032491acc892`（副本只留在本机 `/tmp`，不入库） |

### 1.2 处置（P-89，2026-09-16）

1. 先写规格 `docs/AUDIO-TRACK-SPEC.md`（后缀表 §1 / 路径规范化 §2 / 容器规则表 R1–R7 §3 /
   收集去重 §4 / 条目头读取 §5 / 返回结构 §6），**只依据公开容器格式事实与该模块的对外契约**。
2. 再**只依据该规格**重写实现并替换旧段，旧段不再保留（工作区替换，无提交历史）。
3. 实现与渲染器那版的差异（洁净室判据，至少这 5 处）：
   - **命名**：`PKG_AUDIO_EXT_RE`/`audioMimeFromHead`/`audioMimeFromExt`/`collectPkgAudioTracks`
     → `AUDIO_SUFFIX_MIME`/`AUDIO_CONTAINER_RULES`/`sniffAudioMime`/`suffixAudioMime`/`enumerateAudioTracks`
     （另有 `canonicalAudioPath`/`looksLikeLz4AudioEntry`/`readU64LE`/`compareTrackByPath`/`collectSoundLayerRefs`）。
   - **分支顺序**：ISO-BMFF(`ftyp`@4) 提到第一位；**ADTS 先于 MPEG 帧同步**（规格 §3.4；
     旧顺序把 `0xFFF1` 误判成 `audio/mpeg`）。
   - **常量组织**：正则 + if 链 → `Map` 后缀表 + 数据驱动的容器规则表（`ascii`/`sync`/`mask` 字段）。
   - **边界与文案**：不再"头短于 12 字节一律返回空"（规格 §3.3）；异常按 §3.5 吞掉；
     注释/错误文案全部按规格重写（无 `tag(o,s)`、无"逐字一致/逐条同序"字样）。
   - **去重与 refs**：层名不再出现 `'undefined'`（规格 §4.4：无 name/id 不记 refs）；
     partial 预扫描同路径只读第一条（规格 §4.3/§5.2）。
4. 测试反向依赖已移除：`tools/audio-scan-test.mjs` 不再读取/切片/执行渲染器 `demo.html`
   （旧版 `loadDemoOracle()` ~40 行已删），改为对规格表格的独立断言（61 条）；
   `tools/audio-scan-bench.mjs` 的"逐字复刻 demo.html"对照实现改成规格字面量参考实现。

### 1.3 保留的第三方归属

- 本包**不 vendor** 任何第三方代码（`lib/liquid-glass/**` 与 `lib/liquid-glass-bundle.js` 是
  外部 MIT 项目 `apple-liquid-glass-webgl` 的副本，其 MIT 声明随文件保留）。
- 若将来引入任何第三方代码（含 GPL-3.0 的渲染器侧代码），**不得**进入本 MIT 包，
  只允许进渲染器并按 `../docs/COPYING-RULES.md` 登记台账。

---

## 2. 网页（web）类壁纸：WE API shim 为本仓库自写，参考实现未被复制（2026-09-16）

| 项 | 内容 |
|---|---|
| 本包新增文件 | `lib/web-wallpaper.js`（内容优先类型判定 + WE API shim 源码 + 入口 HTML 注入 + 跨源策略）、`tools/web-wallpaper-test.mjs` |
| 改动文件 | `lib/index.js`（`/custom-folder`、`/library-web` 注入 shim；`/custom-dir` 扫描改内容优先判定）、`lib/client.js`（沙箱 iframe 挂载 + postMessage 控制通道 + 兜底） |
| 参考（**未复制**） | `oneincase/webwallgl`（MIT，commit `b61e8910ae0a176288aed99ce9a93a13ea07df57`）的 `renderer/src/web-shim.js`、`renderer/src/web.ts`、`renderer/src/web-rewrite.ts`：只对照 **WE API 名单与语义**（web 壁纸 = sandbox iframe + 作者脚本之前注入 shim + 属性/音频/媒体泵） |
| 复制量 | **0 行**。无 vendored 文件、无逐行翻译；实现（属性表缓存 + 微任务重放、暂停与媒体策略、`file:///` URL 改写、postMessage op 白名单、错误预算限流、iframe 沙箱三档）为本仓库自写。差异清单 5 项 + 本实现独有 3 项见 `docs/WEB-WALLPAPER.md` §10 |
| API 名称 | `wallpaperPropertyListener`、`wallpaperRegisterAudioListener`、`wallpaperRegisterMedia*Listener`、`wallpaperRequestRandomFileForProperty`、`wallpaperMediaIntegration`、`wallpaperPluginListener` —— 这些是 WE 的**接口名**（接口本身不受版权保护），语义来自 WE 官方文档与公开行为 |
| 台账 | `../docs/COPYING-RULES.md` §4 第 7 条；**第 11 条（交互注入）追加同一条目**（见 §2.1） |
| 机器断言 | `node tools/web-wallpaper-test.mjs` 的 D4/D5（参考未 vendored、SPDX=MIT、API 名单一致、差异项在文档里可查）、E13（交互合成的帧内行为）与 F1（注释剥离后 grep：无 GPL-2.0-only 项目派生标识符、无 GPL 许可文本） |
| 明确未借用 | `Aromatic05/wallpaper-engine-renderer`、`waywallen/open-wallpaper-engine`、`catsout/wallpaper-scene-renderer`（GPL-2.0-only，一律不借） |

### 2.1 交互注入（2026-09-16，用户第 11 条）——仍属"参照语义、未复制代码"

| 项 | 内容 |
|---|---|
| 本包新增文件 | `lib/web-interaction.js`（父页侧：坐标换算 `clientPointInFrame` / 事件整形 `pointerMsg`·`wheelMsg`·`keyMsg` / 交互模式状态机 `createInteractSession` / 舞台 CSS 契约 / 客户端舞台源码常量）、`tools/web-interaction-test.mjs` |
| 改动文件 | `lib/web-wallpaper.js`（shim 内新增指针/滚轮/键盘合成派发 + 5 个新控制 op）、`lib/client.js`（交互舞台 DOM/CSS + 事件接线 + 开关 + 钩子）、`tools/check.sh`（第 5 步加门禁）、`docs/WEB-WALLPAPER.md`（§11） |
| 参照（**未复制**） | 同一参考仓库 `oneincase/webwallgl`（MIT，commit `b61e8910ae0a176288aed99ce9a93a13ea07df57`）的 `renderer/src/web-shim.js`（其 `__wePushPointer`/`__wePushWheel` 段，第 808–1347 行）与 `renderer/src/web.ts`（其 `webPointerToClient`/`installWebPointerBridge`，第 356–452 行）：只对照**语义契约**——`u/v → client 像素`的换算口径、按 `elementFromPoint` 命中元素派发、`button:-1` 哨兵、click 由 down/up 边缘合成、滚轮两路（`wheel` + legacy `mousewheel`，wheelDelta 反号） |
| 复制量 | **0 行**（无 vendored、无逐行翻译）。本实现与它的**结构性差异**：① 事件进入帧内走 `postMessage`（不透明源）而不是同源 `contentWindow` 直调；② 键盘注入是我们独有（参考只做指针/滚轮）；③ 开关状态机（idle/maxAge/Esc/失焦/卸载六条退出路径）与"舞台 + 宿主让位"的 CSS 契约是我们独有；④ 去重口径按**事件类**区分（move 按位置、button 按掩码），参考是两者合并判断。差异表见 `docs/WEB-WALLPAPER.md` §10 与 §11.5 |
| 机器断言 | `tools/web-interaction-test.mjs`（105+ 条：D 段断言"交互不放宽 sandbox、不读帧内 DOM"，F 段把 `lib/web-interaction.js` 与 `client.js` 内嵌源码在同一事件序列上**逐字段对拍**）；`tools/web-wallpaper-test.mjs` 的 E13（13 组帧内行为断言，含"非父窗口来源被丢弃"） |
| 未借用 | 同 §2：GPL-2.0-only 项目一律不借；本项没有引入任何新第三方代码 |

---

## 3. 单向流动与协议边界（规则摘要，全文见 `../docs/COPYING-RULES.md`）

- **MIT 插件 → GPL 渲染器 ✅**；**GPL 渲染器 → MIT 插件 ❌**（本包只出不进）。
- 本包**不得** import / 内嵌渲染器的任何代码；与渲染器的交互只走**进程 / HTTP 协议**
  （如宿主的 `/raw`、`/custom-scene-audio` 路由）。
- 渲染器 import 本包时，本包的 MIT 声明随之保留（GPL 分发方负责携带）。

---

## 4. 选择器（选择文件夹 / 选择文件）：**仅参考**成熟实现的滚动/键盘契约，未复制代码（2026-09-17，用户第 13 条）

| 项 | 内容 |
|---|---|
| 背景 | 用户点名"长期没修好"的 bug：选择文件夹时鼠标上下滑动，画面会自动跳回/锁定在最顶。根因与修法见 `docs/DIR-PICKER-SCROLL.md`（旧实现的滚动补偿是死代码 + 容器无 `overscroll-behavior` + 节点重建后无人补位置） |
| 本包改动 | `lib/client.js` 的 `MPW-DIRPICK` 块（`useMpwListScroll` 滚动主权钩子 + `MpwDirList` 列表组件）、其余 3 个滚动容器复用同一钩子、`tools/dir-picker-test.mjs`、`tools/check.sh` 第 2 步、`docs/DIR-PICKER-SCROLL.md`、README（中/英）选择器小节 |
| 参考 ①（**未复制**） | `bvaughn/react-window`（**MIT**）：只对照其**滚动偏移契约**——偏移量由容器自己持有、渲染后用 layout effect 同步恢复、程序化滚动不抢用户位置。参考的是行为契约，不是代码 |
| 参考 ②（**未复制**） | `adobe/react-spectrum` 的 `react-aria`（**Apache-2.0**）：只对照其 **listbox 契约**——`role=listbox` + `aria-activedescendant` + 容器持有焦点（而不是聚焦行）+ ↑↓/Home/End 语义。**未使用其任何代码或包** |
| 复制量 | **0 行**。无 vendored 文件、无逐行翻译、**未新增任何 npm 依赖**（原因：客户端插件由宿主 `__ModuleLoader__` 注入，`factory(require)` 只解析宿主导出表里的模块 id，相对路径与传递依赖都不可靠；且本问题只需 ~30 行钩子，引整包是负收益——取舍理由见 `docs/DIR-PICKER-SCROLL.md` §4.2） |
| 差异（洁净室判据） | 命名（`useMpwListScroll`/`MpwDirList`/`mpwDirRowId`）、记忆分桶口径（`dir:<路径>`/`lib`/`rot:<过滤>`）、"写回用户最后一次位置 ⇒ 幂等"的实现、失败兜底（`try/catch` + `useLayoutEffect||useEffect` 回退）、键盘集合（我们多了 `Backspace`/`Alt+↑` = 上一级、未选行时 `Enter` = 选择当前文件夹）均为本仓库自写 |
| 台账 | `../docs/COPYING-RULES.md` §4 第 12、13 条（**仅参考、未复制**） |
| 机器断言 | `node tools/dir-picker-test.mjs`：A 组源码级 7 条 + B 组假 DOM 行为 37 条（44 断言）；**同一套 A 组断言对 `git show HEAD:lib/client.js` 旧实现变红 6/7** ⇒ 用例有分辨力 |
| 明确未借用 | 未引入 chonky / react-aria / react-window 等任何第三方选择器包（理由同上）；未引入 GPL-2.0-only 项目 |

---

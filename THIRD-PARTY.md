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

### 1.3 保留的第三方归属：liquid-glass 渲染器库（**本包唯一 vendored 的第三方代码**）

> ①(2026-09-18，P-122) 本节按逐副本复核结果重写；复核全过程（引用面/身份/判据/反向自证）见
> `docs/LIQUID-GLASS-DEDUP.md`。
> ①(2026-09-19，**P-127**) **发布面变更**：这 10 个文件已用 `files` 负向模式移出发布面 ⇒
> **不再随包分发**（详见 `docs/PUBLISH-SURFACE-LIQUID-GLASS.md`）。下方"发布面/署名"两处口径已同步；
> **仓库内 10 个文件一个不少**，sha256 登记照旧。

| 项 | 内容 |
|---|---|
| 涉及文件 | `lib/liquid-glass/*.js`（9 文件，129 097 B，5830 行）+ 其派生产物 `lib/liquid-glass-bundle.js`（107 420 B，2611 行） |
| 出处 | 外部 MIT 项目 **`apple-liquid-glass-webgl`**。**唯一记录是提交 `d13019d`**（2026-08-24）的说明："复用 apple-liquid-glass-webgl（MIT，零依赖）源码 → lib/liquid-glass/ + vendor/" |
| 许可 | **MIT**（MIT 要求**随副本**携带版权声明与许可正文 —— 见下方"署名义务面"） |
| 发布面 | **不随包发布**（①P-127：`files` 负向模式 `!lib/liquid-glass/**` + `!lib/liquid-glass-bundle.js`；实测发布面 22 文件/1 626 235 B → 12 文件/1 389 781 B，`tools/integrity-check.mjs` 第 ⑨ 节双向断言把关）。**文件仍在仓库内**（旧的"随包发布"登记见 `docs/LIQUID-GLASS-DEDUP.md` §1②、§4 第 6 项，那是 P-127 之前的口径） |
| 运行期引用 | 宿主路由 `GET /api/mpkg-wallpaper/lg/<file>.js` 在命中时 `readFileSync` 读取 `lib/liquid-glass/<file>`（`lib/index.js:3299-3314`）。客户端**无**调用方（`lib/client.js` 无 `liquid-glass` 引用、无动态 import） |
| 副本数 | **1 份**（原 `tools/liquid-demo/vendor/` 的 9 文件与 `lib/liquid-glass/` sha256 两两相同 ⇒ 2026-09-18 已删，演示页改为加载唯一一份） |

**⚠ 更正（复核结论，重要）**：本节原文写"其 MIT 声明随文件保留"——**不成立**。
对这 9 个文件 + bundle 逐个 grep，`MIT License` / `Copyright (c)` / `Copyright ©` /
`SPDX-License-Identifier` / `Permission is hereby granted` / `The above copyright`
命中数**全部为 0**，也没有任何上游 URL（`github`/`http`/`apple-liquid` 命中 0）。
⇒ 保留副本**不带上游署名**；署名义务**只**由本文件 + 提交记录承担。
补法（未做，见 `docs/LIQUID-GLASS-DEDUP.md` §9 第 1 项）：找到上游后把其 LICENSE 正文与版权行
落到本文件或随附文件。

**署名义务面（①2026-09-19，P-127 后的准确口径）**：MIT 的署名要求是"**随副本**携带版权与许可声明"。
①P-127 把这 10 个文件**移出发布面** ⇒ **本包不再分发这些副本** ⇒ **该义务面随之消失**
（`tools/integrity-check.mjs` 第 ⑨ 节逐条断言这 10 个路径**不在** npm 包里）。
**但这不等于可以不管**：

1. 仓库里**仍保留**这 10 个文件（宿主 `/lg` 路由 + 演示页运行期要读）⇒ 本节继续**如实登记**
   出处/许可/sha256，并且**如实写明文件内没有版权行**（不粉饰）；
2. 一旦有人**再分发**它们（fork 后单独打包、再次 vendor 进别的项目、把 `lib/liquid-glass/`
   加回 `files`），**必须先把上游 LICENSE 正文与版权行补到本文件或随附文件**——
   上游 URL/commit/版本号至今**未被证实**（`docs/LIQUID-GLASS-DEDUP.md` §9 第 1 项），
   所以"再分发"这条路目前**走不通**，这也是把版权风险留在仓库内、不随包外发的原因之一。

**sha256 登记（`sha256sum` 实测，2026-09-18；删除副本前对真树取，跑完复核 10/10 未变）**：

```
260e9d6a6960554f8ea508fc103451c9019621b49115fbccad7c22841a73d761  lib/liquid-glass/geometry.js
1accae280917af694e3f9a088dde293d31176e9cfba7f2ba58ac0374a639ce5e  lib/liquid-glass/index.js
632f030e7bafccac4ae7bd059bc90d88ab182cb00b0853546d5ccaad923d8888  lib/liquid-glass/material.js
6037f8129f31d4ccdee45db520df260eac2a56de9e57ae06cda60691581c872f  lib/liquid-glass/renderer.js
e11c8493ec5610842cffffe626515d111c507d9147dde94c06efe3dbcfffd18f  lib/liquid-glass/shaders.js
3029655dbb38a6cce4af7c3e960388822c56cd6663c1cfbdabe7ffcd225ceb8c  lib/liquid-glass/v2-geometry.js
cd8deca3e8ec99945bf02782b4e081cf6c1e1c0e83d685cda1247780dcb03ec5  lib/liquid-glass/v2.js
2100f2b4f211b94f2d83497b9e6976a24db4e6bb169e47e62f3932aa088ace53  lib/liquid-glass/v2-material.js
708e94b1ce273fcc336c58f46d7eb8e9205f70f5b21bf630391459b5ccde1a0a  lib/liquid-glass/v2-shaders.js
db50361cfd3d860602ddc2ff8bd1b6567ff01f471df1eccb60b3bcbfbbb0cd08  lib/liquid-glass-bundle.js
```

- `lib/liquid-glass-bundle.js` 是**派生产物**（`tools/build-lg-bundle.mjs` 拼接上面 7 个 V2 文件，
  去 `import`/改写 `export`）：在副本上重跑该工具，产物 sha256 与上表**逐字节相同** ⇒ 无独立信息，
  但仍**留在仓库**（P-127 起**不进发布面**），保留理由见 `docs/LIQUID-GLASS-DEDUP.md` §6 与
  `docs/PUBLISH-SURFACE-LIQUID-GLASS.md` §3。
- 若将来引入任何**其它**第三方代码（含 GPL-3.0 的渲染器侧代码），**不得**进入本 MIT 包，
  只允许进渲染器并按 `../docs/COPYING-RULES.md` 登记台账。

---

## 2. 网页（web）类壁纸：WE API shim 为本仓库自写，参考实现未被复制（2026-09-16）

| 项 | 内容 |
|---|---|
| 本包新增文件 | `lib/web-wallpaper.js`（内容优先类型判定 + WE API shim 源码 + 入口 HTML 注入 + 跨源策略）、`tools/web-wallpaper-test.mjs` |
| 改动文件 | `lib/index.js`（`/custom-folder`、`/library-web` 注入 shim；`/custom-dir` 扫描改内容优先判定）、`lib/client.js`（沙箱 iframe 挂载 + postMessage 控制通道 + 兜底） |
| 参考（**未复制**） | `oneincase/webwallgl`（MIT，commit `b61e8910ae0a176288aed99ce9a93a13ea07df57`）的 `renderer/src/web-shim.js`、`renderer/src/web.ts`、`renderer/src/web-rewrite.ts`：只对照 **WE API 名单与语义**（web 壁纸 = sandbox iframe + 作者脚本之前注入 shim + 属性/音频/媒体泵） |
| 复制量 | **0 行**。无 vendored 文件、无逐行翻译；实现（属性表缓存 + 微任务重放、暂停与媒体策略、`file:///` URL 改写、postMessage op 白名单、错误预算限流、iframe 沙箱三档）为本仓库自写。差异清单 5 项 + 本实现独有 3 项见 `docs/WEB-WALLPAPER.md` §10。**①(WP-1) 例外：1 个函数逐行照抄 ⇒ 见 §5**（`hasBlockingCsp`，上游 `web-rewrite.ts:26-43`；本轮新增，不改变上列历史结论） |
| API 名称 | `wallpaperPropertyListener`、`wallpaperRegisterAudioListener`、`wallpaperRegisterMedia*Listener`、`wallpaperRequestRandomFileForProperty`、`wallpaperMediaIntegration`、`wallpaperPluginListener` —— 这些是 WE 的**接口名**（接口本身不受版权保护），语义来自 WE 官方文档与公开行为 |
| 台账 | `../docs/COPYING-RULES.md` §4 第 7 条；**第 11 条（交互注入）追加同一条目**（见 §2.1）；**①(WP-1) 第 11 条（照抄 `hasBlockingCsp`，主音量契约对齐为第 12 条）见 §5** |
| 机器断言 | `node tools/web-wallpaper-test.mjs` 的 D4/D5（参考未 vendored、SPDX=MIT、API 名单一致、差异项在文档里可查、`WEB_SHIM_REFERENCE.copied` 登记照抄出处）、E13（交互合成的帧内行为）、F1（注释剥离后 grep：无 GPL-2.0-only 项目派生标识符、无 GPL 许可文本）与 **①(WP-1) H/I/J/K/L 段**（存储 facade / 主音量 / CSP 照抄判定 / 路由端到端 / 真语料计数） |
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

---

## 5. ①(WP-1 2026-09-19) 照抄：`hasBlockingCsp`（web 壁纸 CSP 阻塞判定）——**这段代码是照抄**

> **免责声明（照用户“协议是允许的，你要借鉴多少就自己想吧”的许可，并在本文件如实登记）**：
> **本节的 `hasBlockingCsp` 是逐行照抄上游**，不是“参考语义、自写实现”。上游 MIT ⇒ 允许；
> 本包自身也是 MIT，比上游更宽松。除本函数外，`lib/web-wallpaper.js` 的其余部分仍为本仓库自写
> （见 §2：状态机/时序/URL 改写/控制协议/错误边界；§2.1：交互注入）。

| 项 | 内容 |
|---|---|
| 照抄的文件 | `lib/web-wallpaper.js` 的导出函数 `hasBlockingCsp(html)` |
| 上游项目 | `oneincase/webwallgl`（**MIT**） |
| 上游文件:行 | `renderer/src/web-rewrite.ts:26-43`（`hasBlockingCsp`，含两条正则与 `'unsafe-inline'` / `*` 的放行判定） |
| 上游 commit | `b61e8910ae0a176288aed99ce9a93a13ea07df57`（本机研读副本在仓库外，**未 vendored**：整文件没有进本仓库） |
| 复制量 | 1 个函数（约 18 行；本仓库落点见 `lib/web-wallpaper.js` 的同名导出与调用点 `lib/index.js` 的 `serveWebAsset`） |
| 为什么照抄而不是自写 | 这个判定是**纯字符串规则**（CSP 头里 `script-src` 是否含 `'unsafe-inline'`/`*`），自写只会得到逻辑等价但形状不同的第二份实现 ⇒ 引入"两份规则漂移"的风险；而它足够小、可逐行核对（本仓库测试 J1 有正/负例断言） |
| 许可正文 | MIT（与 `LICENSE` 同文；上游版权行为其作者，本包不主张该函数版权） |
| 落地行为（本仓库自己的部分） | 上游命中 CSP 时是"退回裸 src"；我们命中时**不注入** + 响应头 `x-mpw-shim-skipped: csp` + 由客户端既有 2.5s 兜底接管（`docs/WEB-WALLPAPER.md` §7）——**接入方式是我们写的**，照抄的只有判定本身 |
| 台账 | `../docs/COPYING-RULES.md` §4 第 11 条 |
| 机器断言 | `tools/web-wallpaper-test.mjs` 的 J1（判定正/负例）、K11（路由端到端：CSP 页面逐字节原样 + 留痕头）、D3（`WEB_SHIM_REFERENCE.copied` 登记了 `renderer/src/web-rewrite.ts:26-43`） |
| 未引入 | 没有新增任何 npm 依赖；没有 vendored 任何上游文件；没有引入 GPL-2.0-only 项目的任何代码 |

---

## 6. ①(NP-1 2026-09-19) Now playing 组件：**Bencho（MIT）逐行移植**（含注释原文）

> 用户第 1 条要求「now playing 挂载到 dsh 设置上面 有一个开关启用是否挂载 左边栏收起就隐藏」。
> 组件本体不是本仓库原创：它是 **Bencho** 的 "Now playing"，用户已确认来源与许可（**MIT**，
> `bencho.dev/licence`），并明确要求**连注释一起保留** ——
> 用户原话：「它们解释了这些数字为什么是这个值，也是这份代码值得照抄而不是重写的主要原因」。
> 本节是那次移植的**完整登记**（照 §5 的格式，逐项写清"抄了什么、为什么抄、哪些不是抄的"）。

| 项 | 内容 |
|---|---|
| 移植的文件 | `lib/now-playing-math.js`（纯数学，零 DOM）、`lib/now-playing.js`（组件 + 侧栏挂载控制器） |
| 上游项目 | **Bencho** 的 "Now playing"（上游文件：`Sound.tsx` + 随附样式表；任务书给出的是第 48–967 行 TSX / 969–1344 行 CSS） |
| 上游许可 | **MIT**（`bencho.dev/licence`）。用户已确认；本包自身也是 MIT（比上游不更严） |
| 移植方式 | **逐行移植，注释原文保留**（上游那些"为什么不是弹簧""为什么宽度不变""为什么圆角是关系不是旋钮"的注释全部留在两份源文件里，位置对应到它们解释的那个常量/函数） |
| 复制量 | 数学 + 组件 + 那张样式表的**组件部分**（`.snd *` 那一族，类名改成 `mpw_np_`）。上游同文件里的 Sound-board / 曲库页区块（`.snd-wake/.snd-grid/.snd-key/.snd-num/.snd-name/.sfx-wall`）**未移植**（不是这个组件） |
| 许可正文 | MIT（与 `LICENSE` 同文；上游版权归其作者 Bencho，本包不主张该组件版权） |
| 本仓库自写的部分（**不是抄的**） | ① 侧栏挂载控制器：宿主 slot/锚点三级降级链、单实例守卫、观察者生命周期、**左侧栏收起判据与阈值**（§5，宿主常量 56/264 量出来的）；② 自绘图标（不留 `lucide-react` 依赖）；③ 14 个 Bencho token 到 `--dsw-*` 的**本地映射**；④ 数据接入四情形与"做不到"清单（`docs/NOW-PLAYING-DSH.md` §4）；⑤ 生成区内联工具 + 全套门禁 |
| 与上游的逐项差异 | `docs/NOW-PLAYING-DSH.md` §2.2（10 项，含"心形不渲染""第三键换成音量""播放/暂停不是图标而是那对八点四边形"） |
| ⚠ **反向纪律（本轮重点）** | `we-scene-demo/demo/now-playing/**` 是 **GPL-3.0-or-later**。它**只被读来核对数学**，**一行都没有拷进本包**（`../docs/COPYING-RULES.md` §2.2「GPL 永不进插件」）。核对面：本包两份源里 0 处来自该仓的标识符、注释文字、常量组织顺序 |
| ⚠ **反向纪律 · 复核更正（2026-09-19 收尾，原文保留在上行）** | 上面那句"**0 处**来自该仓的标识符、注释文字"**实测不成立**，已换成**方向性判据**。实测：注释行（≥25 字符、空白归一）本包 600 行里 **349 行**与那份逐字相同；代码标识符（≥8 字符）本包 199 个里 **29 个**相同。**为什么必然重合**：那份自己的 `README.md` 与 `NowPlaying.tsx` 头注释都写「**注释逐字保留**」——它和本包是**同一个 MIT 原件（Bencho）的两份移植**，重合的是 `(^1.5 puts it at 0.63)`、`0 → zeta ~0.85, heavy, arrives without a ring` 这类**上游原句**；把"必然重合"当"0 命中"是不可满足的伪判据。**换成的判据（只查"那份独有的东西有没有被搬过来"）**：它相对原件只有 4 处改动（它自己列的）——① 导出名 `Sound`→`NowPlaying`；② 数学抽成 `now-playing-math.mjs`；③ `COVER` 指向它自己的图；④ `stroke` prop 取代全局 `[data-stroke="on"]`。逐条实测本包：① 导出 **`createNowPlaying`**（组件内部函数名确实叫 `NowPlaying`，通用功能名，**如实记同名**）；③ `COVER`=**当前壁纸缩略图**；④ 自绘图标、**无** `lucide-react`（该串全文 1 处、**代码里 0 处**，只在"没有引它"的注释里），代码里的 `stroke` 只有 SVG 标准属性 `stroke:"currentColor"`（2 处），**不存在**它的 `stroke` prop 设计；② **同形**（都另存了一个数学文件）⇒ 这一条**无法用形态区分**，如实记为"分法相同、命名与动机不同"。逐项见 `docs/NOW-PLAYING-DSH.md` §7.5.1 更正① |
| 台账 | `../docs/COPYING-RULES.md` §4 第 13 条 |
| 机器断言 | `tools/now-playing-test.mjs` 的 A 组（生成区与源**逐字节**一致）、B 组（开关默认关 ⇒ 零注入零观察者 + 产物逐字节纯追加）、C 组（24 条数学值）、D/E 组（收起判据 / 挂载顺序 / 单实例）、F 组（4 组变异自证）。本文件 §6 的存在由 `tools/now-playing-test.mjs` 之外的**人工复核**保证：`THIRD-PARTY.md` 与 `../docs/COPYING-RULES.md` 两处都能查到本节与第 13 条 |
| 未引入 | 没有新增任何 npm 依赖（**没有**装 `lucide-react`）；没有 vendored 任何上游文件（上游是粘贴源码，不是包）；没有引入任何 GPL/无许可项目的代码 |

### 6.1 ①(NP-1) 落账（2026-09-19 收尾轮实测）

`sha256sum` 原样。**本表不含** `THIRD-PARTY.md` 与 `docs/NOW-PLAYING-DSH.md`：
它们**承载这张表**，写进去就是自指（写完哈希就变）。`../docs/COPYING-RULES.md` 在**仓外**
（工作区根的 `docs/`，不是 git 仓库、不入 npm 包）⇒ 无法提交，只记本轮那次写入的版本备查。

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

提交哈希：**`bf538fabe3302964fbe8913baab0af4eb413e285`**（①(NP-1) 代码 + 本文档；本仓模式：先提交代码，
再由**第二次「文档落账」提交**把哈希写进去 —— 本次即那第二次 ⇒ 明细见 `docs/NOW-PLAYING-DSH.md` §8.2；
落账提交**自身**的哈希无法写进自己 ⇒ `git log -1 -- THIRD-PARTY.md`）。

---

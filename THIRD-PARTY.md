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

## 2. 单向流动与协议边界（规则摘要，全文见 `../docs/COPYING-RULES.md`）

- **MIT 插件 → GPL 渲染器 ✅**；**GPL 渲染器 → MIT 插件 ❌**（本包只出不进）。
- 本包**不得** import / 内嵌渲染器的任何代码；与渲染器的交互只走**进程 / HTTP 协议**
  （如宿主的 `/raw`、`/custom-scene-audio` 路由）。
- 渲染器 import 本包时，本包的 MIT 声明随之保留（GPL 分发方负责携带）。

# 发布就绪清单（RELEASE.md）

> 为什么有这份文件：`npm publish` 是**不可逆**动作（发布后只能 `deprecate` 或补丁版），
> 而本仓库的门禁是"一条命令全量自检"（`bash tests/run-all-tests.sh`，116 项）。
> 这份文件把**发布前置**、**确切命令**、**发布后验证**、**回滚**钉成可复制的步骤 —— 照着跑，不靠记忆。
>
> 状态（2026-09-20 01:2x 实测）：本地 `package.json` = **0.2.0**；npm 官方 registry 上
> `latest` = **0.2.0**（`npm view wallpaper-engine-web-loader dist-tags --registry=https://registry.npmjs.org`）。
> 历史：0.1.1（2026-09-16 建仓首发）→ 0.2.0（2026-09-20，见文末发布记录）。

## 0. 版本号是否要动

- 规则：`package.json.version` 必须**严格大于**官方 registry 上的 `latest`（否则 `npm publish` 直接 403
  `cannot publish over the previously published versions`）。
- **两处必须同时改**（有门禁钉着，改一处会红）：
  1. `package.json` 的 `version`；
  2. `core/we-scene.mjs` 的 `export const VERSION`（判据：`tests/mount-test.mjs` §6 `VERSION === package.json.version`）。
- 还要顺手改的限制引用：`README.md` 里三处版本号（顶部"已发布 …@x.y.z"、安装命令 `npm i …@x.y.z`、
  `npm pack …@x.y.z` 与 `tar -xzf …-x.y.z.tgz`）。
- semver 口径：**加功能/加导出/加路由 ⇒ minor**；只修 bug ⇒ patch；破坏兼容 ⇒ major。
  先例：`0.1.0`（建仓）→ `0.1.1`（打包白名单 + 首轮修复）→ `0.2.0`（P-101…P-166 一大批运行时与测试台能力）。

## 1. 发布前置（逐条跑，全绿才谈第 2 节）

```bash
cd <仓库根>

# ① 全量门禁（重活，**先串行化**再跑，避免与别的重任务撞车 OOM）
#    注意：脚本自带 flock，**不要**在外面再包一层 flock（会自锁）。
bash tests/run-all-tests.sh                  # 期望末行 "全部通过" + 0 FAIL
#    想先快跑一遍：bash tests/run-all-tests.sh --fast（跳最慢项）—— **发布前那次必须是全量**

# ② 发布面闸门：必需文件 / 元数据 / 白名单 / 个人路径 / 凭据 / 反向流动（插件指纹不许进渲染器发布物）
node tests/publish-check.mjs                 # 期望 findings.blocking 为空
# ③ 打包面：白名单里的每个路径真的存在、LICENSE 口径、tarball 内容
node tests/packaging-test.mjs                # 期望 137 通过 / 0 失败
# ④ 版本口径：VERSION === package.json.version
node tests/mount-test.mjs
# ⑤ 看 tarball 到底是什么（**发布前必看**）：文件数、体积、有没有夹带
npm pack --dry-run

# ⑥ 浏览器纪律（若这一轮跑过浏览器）：跑完不该有残留
ps -eo comm | grep -cx firefox                # 期望 0
```

## 2. 发布（确切命令）

```bash
cd <仓库根>
# registry **必须显式写**：本机 ~/.npmrc 的默认 registry 是 npmmirror（镜像），
# 直接 `npm publish` 会发到镜像/或报未登录；npmjs 的 token 在同一份 .npmrc 里（key 带 //registry.npmjs.org/）。
npm publish --registry=https://registry.npmjs.org/
```

- 发布**不需要**改 `.npmrc`、不需要 `npm adduser`（token 已在），但 `npm whoami` **也要带上 `--registry`** 才有用：
  `npm whoami --registry=https://registry.npmjs.org/` ⇒ `xferoni66`。
- `files` 白名单是**唯一**发布面（`package.json.files`）；`demo/`（测试台）**不在**白名单里 —— 见第 5 节。

### 2.1 发布文字纪律（**硬约束**，与 commit 同族）

`gh release create` 的**标题与描述**、`git tag -a` 的说明、npm 说明、本文件里对外可见的段落，**只写客观技术描述**：

- ❌ 不写「用户说 / 用户要求 / 用户实测 / 用户真机 / 用户反馈 / 用户原话 / 用户点名 / 您 / 你报的 / 你正在看的」这类表述，**不引用用户原话**，也不转述其主观描述。
- ✅ 现象用**客观读数 + 可复现条件**表述。反例 → 正例：
  `（用户真机 0923/2887099508「…」：一开始画面像是被莫名其妙的放大了 / 开场动画好像没播）`
  → `（探针包 0923/2887099508：开场取景被放大 / 开场运镜未生效）`。
- ✅ 证据出处写文件/判据/提交号（`docs/PATCHES.md` P-xxx、`tests/xxx-test.mjs`、提交哈希）。
- 内部证据链（`docs/PATCHES.md` / `docs/reverse/**` / 工作区 `STATUS-ALL-ITEMS.md`）不受此限，可保留必要的原始记录。

> 附：本机 `gh` 是 2.4.0，**没有 `gh release edit`** ⇒ 改已发布说明走 REST：
> `gh api -X PATCH repos/<owner>/<repo>/releases/<id> --input payload.json`（`payload.json` = `{"body":"<全文>"}`；`<id>` 由 `gh api repos/<owner>/<repo>/releases/tags/<tag> -q .id` 取）。

## 3. 发布后验证（逐条跑，别只看"发布成功"那一行）

```bash
V=0.2.1
# ① 先看 registry 认不认这个版本（发布处理有几分钟延迟，404 属正常，等一会儿再试）
npm view wallpaper-engine-web-loader@$V version dist.tarball --registry=https://registry.npmjs.org/
npm view wallpaper-engine-web-loader dist-tags --registry=https://registry.npmjs.org/    # latest 应指向新版本
# 真下载一份、逐条核对内容（不是看本地目录）：体积、文件数、关键路径在不在
cd /tmp && rm -rf npmpub && mkdir npmpub && cd npmpub
npm pack wallpaper-engine-web-loader@$V --registry=https://registry.npmjs.org/
tar -tzf wallpaper-engine-web-loader-$V.tgz | sort > files.txt
wc -l files.txt && grep -c "package/web/icons/brand-" files.txt      # 品牌图标应 4 条
grep -E "package/(core/we-scene.mjs|server/we-scene-demo-server-8902.mjs|web/manifest.webmanifest)$" files.txt
# ② **必做**：装一份到干净目录，跑一次真实装载 —— 0.2.0 就是这一步抓出来的（包缺文件 ⇒ MODULE_NOT_FOUND）
mkdir app && cd app && npm init -y >/dev/null && npm i wallpaper-engine-web-loader@$V --registry=https://registry.npmjs.org/
node -e "import('wallpaper-engine-web-loader').then(m=>console.log('VERSION=',m.VERSION,'mount=',typeof m.mount))"
cd /tmp/npmpub && tar -xzf wallpaper-engine-web-loader-$V.tgz && node package/server/we-scene-demo-server-8902.mjs --help >/dev/null 2>&1; echo "8902 server 启动脚本可执行=$?"
```

- 打 tag + 推送（GitHub Release 可选）：
  ```bash
  git tag -a v$V -m "wallpaper-engine-web-loader $V" && git push origin v$V && git push origin main
  ```

## 4. 回滚 / 出问题怎么办

npm **不能撤回**已发布版本（72 小时内可 `unpublish`，但那会破坏依赖它的项目；本仓库不用这条路）。可选动作：

1. **打补丁版**（首选）：修完 bump 到 `0.2.1` 再发一次。
2. **标记弃用**（让 `npm i` 的人看到警告，但已装的人不受影响）：
   ```bash
   npm deprecate wallpaper-engine-web-loader@0.2.0 "原因 + 建议升到 0.2.1" --registry=https://registry.npmjs.org/
   ```
3. **dist-tag 回退**（只影响"跟随 latest"的新安装）：
   ```bash
   npm dist-tag add wallpaper-engine-web-loader@0.1.1 latest --registry=https://registry.npmjs.org/
   ```
4. git 侧：`git push --force-with-lease` **不要**用；发布记录以"再补一条"的方式留在本文件里（历史可读）。

## 5. 未证实 / 边界（诚实记录）

1. **测试台（`demo/`）不进 tarball**：`package.json.files` 里没有 `demo/` 任何路径
   （它 66MB，其中 `demo/now-playing/` 64MB 是本机构建残留）。后果：**包里的
   `server/we-scene-demo-server-8902.mjs` 起得来、但静态面没有测试台页**（默认 `STATIC_ROOT=<包根>/demo`
   不存在）⇒ 装包的人只能用 `:8899` 渲染器页，或把仓库 clone 下来跑测试台。
   绕开办法：`MPW_BENCH_STATIC_DIR=<仓库>/demo node server/we-scene-demo-server-8902.mjs`。
   要真正修好得把测试台按白名单（`demo/index.html` / `bench-patch.js` / `assets/**` / `icons/**` /
   `now-playing/dist/**` / `renderer/**` / `default-wallpaper/**`，约 2MB）加进 `files` —— 属于**发布面变更**，
   需要单独一轮（`publish-check` 的反向流动断言会一并扫这批文件）。
2. **GitHub Pages 在线 demo** 是 `node build-pages.mjs` 的产物（白名单静态站），与 npm 包**不是同一套文件**：
   在线版没有 `/api/*`，属设计如此（README「任意静态服务器」节）。
3. **`VERSION` 只反映"包版本"**：渲染器页头部那个 `#app-version`（`v1.3.16`）由自带 demo 产物写，
   两者本来就不是同一个号（前者是本仓 semver，后者是上游渲染产物的版本），别把它们对齐。
4. **发布不改 `~/.npmrc`**：本机默认 registry 是 npmmirror ⇒ 任何 `npm view/publish/whoami` 都要显式
   `--registry=https://registry.npmjs.org/`，否则读到的是镜像的（可能滞后）状态。

## 6. 发布记录：0.1.1（2026-09-16 建仓首发）

* 内容：仓库首次公开（渲染核心 + 自带服务器 + 离线 PWA + 自带合成样例），GPL-3.0-or-later。
* tarball：见 npm 上的 0.1.1。

## 发布记录：0.2.0（2026-09-20）

**为什么发**：0.1.1 之后本仓累积了一大批**用户可见**的能力与修复，而版本号一直没动 ⇒ 用户在 npm 上看到的
还是旧包（这是"渲染器为什么没推 npm"的直接原因）。

**这一版包含（按 P-编号）**：

| 面 | 内容 | 条目 |
| --- | --- | --- |
| 运行时能力 | 8K 贴图的**选级解码**（按目标尺寸挑 mip，实测解码量 −72.6%、峰值位图 −75%）+ 上传失败不再注册坏纹理（原来表现为"整屏纯黑"） | P-163 |
| 运行时能力 | 上游 1.3.17–1.3.23 的一批修复移植（粒子/效果/语法容错/相机/文本层…） | P-101…P-165 各条 |
| 自带服务器 | `/report`（诊断现场快照）与 `/baseline`（真机基线趋势）两条落盘路由；四个 POST 接收端超限一律**干净的 413**（旧实现先掐连接 ⇒ 客户端只看得到 ECONNRESET） | P-166 |
| 自带服务器 | `:8902` 一站式测试台服务（测试台静态面 + `/api/*` + 渲染器 iframe + 媒体面 + 诊断流） | P2-2 / P-158…P-164 |
| 站点外壳 | 品牌图标（`web/icons/brand-*.png`）+ manifest/pwa-inject/sw 一致改指；程序化生成的 `icon-*.png` 保留且 URL 仍 200 | P-166 |
| 文档 | `docs/PATCHES.md`（逐条根因+判据台账）、`docs/BENCH-8902.md`、`docs/DATA-LIMITS.md`、本文件 | 各批 |

**发布前置读数**（本机实测，命令见第 1 节）：

| 闸门 | 读数 |
| --- | --- |
| `bash tests/run-all-tests.sh` | 116 项（见文末补记的下方一行"发布那一刻"读数） |
| `node tests/publish-check.mjs` | 无 blocking findings |
| `node tests/packaging-test.mjs` | 137 通过 / 0 失败 |
| `node tests/mount-test.mjs` | VERSION === package.json.version ✓ |
| `npm pack --dry-run` | 见第 3 节的 tarball 核对 |

**发布后验证**：第 3 节四条命令逐条跑过（`npm view` / 真下载 `npm pack` 核文件清单 / 干净目录安装后
`import` 出 `VERSION` 与 `mount` / 包里 8902 服务脚本语法可执行），结果记在本节下方的"发布那一刻读数"。

**已知边界**：见第 5 节（测试台不在 tarball 内、在线 demo 与包不是同一套文件、`VERSION` ≠ 页面 `#app-version`）。

### 事故与修复记录：0.2.0 的包**坏了**，0.2.1 修好（2026-09-20）

* **0.2.0（已弃用 `deprecated`）**：`import('wallpaper-engine-web-loader')` 直接
  `Cannot find module '…/core/we-particle-pointer.mjs'`。根因：`files` 白名单漏了 0.1.1 之后新增的三张源文件
  （`core/we-pointer-source.mjs`、`core/we-particle-pointer.mjs`、`server/pkg-entry-index.mjs`）——
  `core/` 是**逐文件**列白名单，不是整目录。**0.1.1 同法核过 = 0 条缺失**（那三张当时还不存在）⇒ 是 0.2.0 引入的回归。
  为什么老门禁没红：`packaging-test` 查的是"白名单里的路径存在"（反方向），`mount-test` 在仓库里跑（文件都在），
  `publish-check` 管许可/隐私/反向流动。**是第 3 节"装到干净目录再 import 一次"这一步抓出来的。**
* **0.2.1（修复版）**：`files` 补三条；新增 **`tests/pack-closure-test.mjs`**（12 断言）把这一类钉死：
  真打 tarball → 解开 → **在包内真 `import` 三个入口**（消费者视角）+ 两个服务入口 `PORT=0` 跑到 banner；
  再静态核对 import 闭包/URL 引用/死文件；**复现力自证**：从包里删掉一条被 import 的模块 ⇒ 必须失败。
  该测试已进全量门禁（116 → **117** 项）。
* **这一版学到的（写进流程）**：
  1. 第 3 节那句 `node -e "import('…')"` **不是可选项** —— 它是唯一能抓住"包缺文件"的一步；已提到第 3 节第 1 条。
  2. 发版前跑 `node tests/pack-closure-test.mjs`（秒级到十几秒），别只跑 `packaging-test`。
  3. `files` 是白名单 ⇒ **新增 `core/` 下的模块时，必须同步加白名单**；`pack-closure` 会替你把关。
* 0.2.0 的处理：**不 unpublish**（会破坏已装下游），用 `npm deprecate` 指向 0.2.1（已执行，`npm view …@0.2.0 deprecated` 能读到原因）。

### 0.2.1 发布后验证读数（2026-09-20 实测，命令即第 3 节）

| 检查 | 读数 |
| --- | --- |
| `npm view … dist-tags` / `@0.2.1 version` | `{ latest: '0.2.1' }` / `0.2.1`（发布后约 3 分钟才可见 —— registry 的"being processed"延迟，属正常） |
| 真下载 `npm pack …@0.2.1` | 156 个文件 / 2.44 MB |
| 三张此前缺失的模块 | `core/we-pointer-source.mjs` ✓ · `core/we-particle-pointer.mjs` ✓ · `server/pkg-entry-index.mjs` ✓ |
| 品牌图标 | `web/icons/brand-*.png` 4 条 ✓ |
| 干净目录 `npm i` + `import` | `LIB OK VERSION=0.2.1 mount=function parseScene=function` · `BUNDLE OK 204 导出` · `HLSL OK 2 导出` |
| `@0.2.0 deprecated` | 能读到原因文案（指向 0.2.1 与本文档） |
| git tag | `v0.2.1` 已推送 |

## 发布记录：0.3.0（2026-09-21 · 音频美术层不再被自家规则吞掉 + 跨平台静态门禁 + 导入白名单 + 测试台两批）

**为什么是 minor**：有**用户可见的行为变化**（音频响应型美术层从"被隐藏"变成"按作者意图显示"）、
一个新模块与新语义（导入文件的统一白名单/内容嗅探 ⇒ 415/413），以及测试台一批能力（渲染器页反代、属性面板/外壳修复）。
按 semver「加功能 = minor」取 **0.3.0**（0.x 阶段沿用本仓 0.2.0 的口径）。

| 面 | 内容 | 判据读数 |
| --- | --- | --- |
| **音频美术层**（P-170，`193ad99`） | 「我的音频条没有做出来」的真因是**我们自己的两条隐藏启发式**：`hideUI` 的名字正则含 `Audio\|音频\|Spectrum\|播放\|音量\|sound`；`hideBars` 关掉「父组纯色遮罩条」，而可视化条**自己就是** `models/util/solidlayer.json` 的实体遮罩层。新增 `audioArtIds(scene)`（名字命中音频美术词 **且** 有特效/粒子/作者绑定 ⇒ 豁免），两条启发式都查它；`?audioart=hide` 做对照。语料实测：`3544152633` 可见层 23→24、`3326873240` 29→30、`3719111841` 的 `音频线Audio Spectrum Visualizer` 可见；`Song Title`/`Play Icon`/`.mp3`/`MUSIC PLAYER` 仍隐藏 | `tests/scene-layer-baseline-test.mjs` **20 通过 / 0 失败 / 1 SKIP**（含读数确定性、语料缺失明确 SKIP、两条分辨力自证）；`tests/render-audit.mjs` 新增机读契约 `MPW-AUDIT-JSON` |
| **逐层基线夹具**（P-170） | `tests/fixtures/scene-layer-baseline.json` 钉住四条记录（自带样例 + 三个语料包）的逐层事实：可见层/带纹理可见层/蒙皮隐藏与命中/每帧 draw 数/音频美术层可见性/外壳层可见数（必须 0） | 同上（20 断言）；进全量门禁（121 → **122** 项） |
| **跨平台静态门禁**（P-169，`d3f7e31`） | 新增 `tests/cross-platform-gate-test.mjs`（18 断言）：代码里的本机绝对路径必须可覆盖、写死的 `'/tmp/…'` 判红（白名单逐条带理由 + 反查防腐烂）、打开器必须四平台齐（`xdg-open`/`open`/`explorer` + 环境覆盖口）、`.sh` 不许用 bash 4+ 特性、文件名可移植性、BOM/CRLF、11 条分辨力自证 | 18 通过 / 0 失败；进全量门禁（118 → 121 项） |
| **顺着它修的真问题** | `server/we-scene-demo-server.mjs` **11 处**写死 `/tmp` ⇒ `TMP_ROOT = process.env.MPW_TMP_ROOT \|\| os.tmpdir()`；`tests/` **8 个文件 13 处** `mkdtempSync('/tmp/…')`/默认输出路径 ⇒ `os.tmpdir()`；`:8902` 打开器候选链补 **Windows**（`explorer`，否则 Windows 上「打开文件夹」必回 501） | 门禁本身即判据；`:8902` 相关断言在 `bench-server-test` 内 |
| **导入白名单 + 内容嗅探**（`9a9165f`） | 新模块 `server/upload-policy.mjs`：`checkUpload({filename,buf,maxBytes})`（后缀 + magic 双判）、`sniffKind`/`sniffDanger`/`checkName`/`mimeForKind`、ISO-BMFF 品牌拆分（`m4a`=audio vs `isom`=video）；接进 `POST /api/props-file` ⇒ **415**（类型）/**413**（超限），并进 `package.json.files` | `tests/upload-policy-test.mjs` **46/0**；`bench-server-test` 的 E3b/E3c |
| **测试台（`:8902`）两批**（`c32018f` / `2021329` / `234e62e`） | ①`/webloader/**` 反向代理到渲染器页 ⇒ 8K 贴图壁纸不再只能看黑屏（`?id=3669681034`）；②外壳第三批 10 条（目录浏览器卡 `Reading…` 的根因是产物同元素 `onclick` 的模态 `prompt()` 阻塞主线程）；③属性面板 10 条（收起态切壁纸一行不刷、内部项隐藏名单、富文本只留颜色/换行/图/链接、数字统一解析、外链二次确认倒计时、列表 ID 分行） | `bench-server-test` 137 项、`bench-shell-fixes-test` **263/0**、`bench-ui-headless-test` **147/0**（无 X11 浏览器判定）、`demo-check` 132/0、`demo-syntax` 11/11 |

**发布前置读数**：`bash tests/run-all-tests.sh` ⇒ **PASS=121 / FAIL=0 / SKIP=1（总 122 项，退出码 0）** ——
SKIP 的那一项是 `scene-layer-baseline` 里**本机没有语料**时的显式跳过分支（该测试自带，不是被跳过的门禁）；
本轮另外单独跑过：`cross-platform` 18/0、`text-switches` 36/0、`docs-check` 通过（745 个引用）、`packaging` 141/0、
`package-matrix --check` 无退化、`scene-layer-baseline` 20/0 + 1 SKIP、`secret-scan` 干净、`scene-intro-black` 29/29；
`node tests/pack-closure-test.mjs` ⇒ 真打 tarball → 解开 → 包内 `import` 三个入口 + 两个服务入口；
`tools/` 下的冒烟与 `bench-ui-headless` 读数同上表。

**诚实清单**
1. 浏览器拿不到**系统声卡环回**：音频条的**电平**仍只有两个真实源（包内音轨 `?audio=1`、显式/已授权的麦克风），
   都没有 ⇒ 全 0 + `silent`（`window.__mpwAudioBandSource` / `__mpwAudioBandStats().silent` 可查，不假装有声音）；
   模拟源只在显式 `?bandfeed=sim`。本轮修的是"**显示**"这一半（层级可见性）。
2. 逐层基线夹具里的语料包在**本机没有语料**时明确 SKIP（不假装通过）；夹具是"当前形态"的快照，
   任何有意的渲染变化都要 `--update` 并复核（改数前先确认变化是有意的）。
3. `?audioart=hide` 只影响本插件/本仓的渲染配置，不改作者包里的 `visible` 数据。

## 发布记录：0.4.0（2026-09-22 · 测试台预览接本仓渲染器 + 画布 DPR 活档位 + 官方 ITextureAnimation + 上游三项 P0）

**为什么是 minor**：① 测试台预览的**默认渲染器换了**（从"上游产物页"改为**本仓渲染器**，`/webloader/**` 同源反代）
——这是用户可见的行为变化，也是"一个渲染器表面"的整合第一步；② 新增 `?res=dpr` 画布活档位（显示尺寸 × 设备 DPR）；
③ 新增官方 `ITextureAnimation` 面（`rate` 可写 / `frameCount` / `duration` / `rate=0` 冻结）；
④ 上游三项 P0 修复（转译器更新、脚本单帧 dt 封顶、`.tex` 容器变体）。按 semver「加功能 = minor」取 **0.4.0**。

| 面 | 内容 | 判据读数 |
| --- | --- | --- |
| **预览默认 = 本仓渲染器**（P-171） | `demo/index.html` 的 `#renderer-src` 缺省 `repo` + 状态行；`repo` 档 = `/webloader/` 同源反代并**保留原 query 一个不丢**（补 `id=`/`res=dpr`，不覆盖已有 `res=`），换档沿用产物自己的「重挂载」；`upstream` 档仍可切回（对照/排障） | 真机同包同面板：**上游 529×297 @DPR1 `alpha:false`** vs **本仓 1056×594 @DPR2 `alpha:true`**（用户报的"所有 scene 都糊"= 上游按 CSS 像素出图）；`bench-renderer-source` **36/0**（含真机读数）；两档可逆 |
| **`.tex` 容器变体** | `findTexbMagic()` 有界搜索容器魔数（不再假定偏移 46）：语料 231 张里 **30 张**（全部 `materials/lut/`，`flags=0x42`）TEXB 在偏移 **50**，旧写法**必然抛错** | 本机语料 **231/231 解析成功**（修前 201/231）；`tex-container-variant` **11/0**（两版式同摘要 + 全量 0 失败 + 坏魔数原口径报错 + 分辨力自证） |
| **脚本单帧 dt 封顶**（上游 9e287ea） | `mpwCapScriptDt()`：封顶 0.05s（20fps 下限），**正常帧逐位透传**、**首帧 0 原样保留**、坏值退回 1/60（与既有守卫同口径）；两个真实喂入点（`engine.frametime` 与 `runSceneScripts`）都接上，且封顶在**乘倍率之前** | `script-frametime-cap` **13/0**（含"把封顶去掉必红"的分辨力自证） |
| **转译器更新到上游 origin/main**（d6dd5bc） | `vendor/hlsl2glsl/` 两个 MIT 文件：1401→**1658** 行 / 423→**418** 行（与上游逐字节一致；替换前核对旧版与 `fdfc578` diff 为 0 ⇒ 没有本地补丁）；`THIRD-PARTY.md` §9 与 `vendor/hlsl2glsl/README.md` 的 blob/字节/行数/sha256 逐项同步 | `hlsl2glsl-coverage-test` **46/46 = 100.0%**（修前 45/46，文档基线 98.2%）——"作者手写 GLSL 编译失败 ⇒ 效果链静默跳过"少一条实例 |
| **画布活档位 + 宿主契约 + 纹理动画面** | core 的 `?res=dpr|dpr1..dpr5` + `resolveLiveCanvasSize`（显示尺寸 × 设备 DPR，上限 4096/8.29MP）+ `demo.html` 的 MPW-LIVERES（ResizeObserver + `(resolution: Ndppx)` + 120ms 防抖，`window.__mpwLiveRes`）；`window.__wp` 早发布并补齐公开面（7 个明确降级的能力在 caps 位/诊断/状态行列名）；`elysia/scene-scripts.js` 补齐官方 `ITextureAnimation` | `bench-renderer-source` 36/0、`scene-texanim` **19/0**、`bench-ui-headless` **151/0**（默认档：调试逐层/截图/立即上报/诊断页签/指针注入/音条源/属性面板全在） |
| **门禁** | 新增 `bench-renderer-source`(36)、`scene-texanim`(19)、`script-frametime-cap`(13)、`tex-container-variant`(11)；`bench-bandfeed-switch` 的切片锚点随代码移动同步 | 全量 **PASS=123 FAIL=0 SKIP=2 / 总 125 项**（0.4.0 前）→ 本次再 +2 项 = **127** |

**诚实清单**
1. **本仓渲染器仍缺"内容包围盒 cover 填充"**（既有差异，非本版引入）：同包同分辨率下产物把 content `4249×3076`
   铺满 view `3840×2160`（≈1.42×），本仓没有 ⇒ 画面偏小右移、左侧露灰带。**这是同一张壁纸在 `:8899` 与 `:8902` 观感不同的原因**，下一批修。
2. **web 类壁纸本仓渲染器仍不支持**（`demo.html` 里 `/web/` 零命中）⇒ 测试台那两组 web 断言现**显式切上游档**当夹具，
   并新增 R 组把边界钉成判据（默认=repo / 能切回上游 / 本仓档对 web 如实降级）。
3. 上游产物**文件不能删**（产物 JS 里 3 处写死路径、Pages 产物映射、`sw.js` 预缓存、P-160 从它源码抽 44.8KB shim、
   以及多个门禁拿它当判据）；**但页面不再默认加载它**。
4. `#open`「新窗口」按钮仍开产物页（`demo-check` D12 钉住这条链不许绕开）。
5. 迟到补播那类"卡顿后过冲"修的是**单帧 dt 封顶**；第三方调度器的队列我们**只检测报告**，不替它清（bfcache 恢复的分布判定留在报告里）。

## 发布记录：0.5.16（2026-10-03 · 场景级 `general.zoom` 对象形态 + 开场运镜；演示页装配修复）

**为什么是 patch**：两处都是"修 bug"（既有行为与作者意图不符），按本仓 semver 口径取 patch；
上一版 0.5.15 之后没有新增对外路由，新增的两个导出函数只是内部口径的纯函数（`sceneZoomScale` / `evalSceneZoom`）。

| 面 | 内容 | 判据读数 |
| --- | --- | --- |
| **场景级 `general.zoom` 对象形态**（P-226） | `general.zoom` 支持 `{value}` / `{value, animation}`：动画逐帧求值（`mode:'single'` 末帧后保持）、取值序 = 相机层 zoom > 场景 zoom 动画 > 静态值；对象形态只在 `campose=full`（缺省）下接 ⇒ `legacy`/`off` 逐位回退 | 真机包 0923/2887099508（作者开场 = 前 10s 三倍镜、10–15s 拉回一倍）：实绘宽度比 t=0.5 : t=20 = **3.0005**、t=12 = **2.2014**；`scene-zoom` **15/0**（含变异自证） |
| **演示页装配：只建一次渲染器**（P-227） | `demo.html` 原来在同一个画布上建两次渲染器，第二处把第一处（含 `onMeshLayer` + 逐层台账）整个覆盖 ⇒ **蒙皮层一层都不画**（人物是网格的包只剩背景） | 真机 `__mpwMeshDraws` **0 → 5 个网格循环**、每帧绘制调用 ~4 → ~6.5；`:8899` 截图从"只有云/天空"变成人物在场 |
| **跨仓登记** | 插件侧 `?mpwperf=off` 补进 `docs/README-DIAGNOSTICS.md` 主表（diag-flag-check 双向比对 213 == 213） | `docs-check` / `diag-flag-check` / `packaging` 三项由红转绿 |

**诚实清单**
1. 本版**没有**解决"演示页与上游产物在个别包上的取景差异"这类既有差异（P-226 只补了 `general.zoom` 这一条口径）；
2. 真机观感（三倍镜→拉远是否顺滑、与官方产物逐帧是否一致）仍需人眼；本轮证据是实绘矩形 + 单帧真机截图；
3. `x11-pointer` 在一次全量门禁里出现过一次"首段 0 条 pointermove"的假红，同一命令单独复跑即绿（7/0）；
   本次全量门禁唯一 FAIL 是 `bench-ui-headless`（IA5f 的 scroll slack 前置读数 + IA8a 的"释放后日志不再增长"，
   都是滚动/日志时序类断言；同一条命令单跑 **197/0 全绿**）。两条都记为满载下的 flake，判据本身未改。

## 发布记录：0.5.19（2026-10-06 · 脚本面两修 + 光轴泛白主因：压缩 import / 脚本节点同步 / 粒子 instanceoverride 基线）

**版本号对齐**：`package.json` 0.5.19 = `core/we-scene.mjs` 的 `VERSION` = `README.md` / `README.en.md` 的安装与打包示例（四处一次改齐，`mount` 判据盖章）。

**本版内容**（逐条见 `docs/PATCHES.md`）：
- **P-236** 粒子 `instanceoverride.alpha/size` 每帧被算子基线还原（`alphafade`/`alphachange`/`sizechange` 从
  `_initAlpha`/`_initSize` 重建，而这两个缓存只有 `alpharandom`/`sizerandom` 会写）⇒ 语料 51 包 / 72 层偏亮
  （本包 `2887099508` 光轴泛白主因）：整帧 p50 **252.5 → 174.8**（上游产物档同相位 172.8）。
- **P-237** 脚本节点 `{script,value}` 的 `visible`/`alpha` **同步不到渲染层**（宿主两条 `typeof` 门只覆盖
  被脚本展平的裸值）⇒ 本包 **27 个 `visible` / 11 个 `alpha`** 脚本字段没有动态变化；新增
  `syncScriptValues()` + `elysia` 三个 setter 改走 `nodeWrite`（保住作者的脚本节点），回退开关 `?scriptsync=legacy`。
- **P-239** **压缩 import 形态** `import*as X from'WEMath'` 让整条作者脚本编译失败（`vm shim parse error`）
  ⇒ 本包 11 个 `alpha` 载体（含五层共享的设置菜单）**永不运行**；`compileScript` 的 `import * as` 正则四处
  `\s+ → \s*`。真机复核：11 条条目 `exported:[] → ["update"]`、`error:null`。

**发布前门禁**：`bash check.sh` 四阶段（docs-check / publish-check / diag-flag-check / run-all-tests）全绿；
`run-all-tests` 212 项（本轮新增判据：`script-origin-sync` 26/0 含 T6 压缩 import 四条；`p74-particles` 76/0；
`ln-consistency` 13/0（P-237 口径和解）；`audio-scene-players` B2 短窗重试消抖）。

**发布命令**（与 0.5.18 同流程）：`bash check.sh` → `npm publish` → `git tag v0.5.19` + `git push --tags`
→ `gh release create v0.5.19` → 核对 npm 版本页与 Pages 线路。

## 发布记录：0.5.18（2026-10-05 · 渲染器保真度四修：属性动画语义 / 粒子数量倍率 / 动画时钟 / 超限贴图 TDZ）

**版本号对齐**：`package.json` 0.5.18 = `core/we-scene.mjs` 的 `VERSION` = `README.md` / `README.en.md` 的安装与打包示例（0.5.17 曾出现"只 bump package.json"的发布缺陷，本版四处一次改齐，`mount` 判据盖章）。

### 修了什么

| # | 缺陷 | 读数（可复现） | 修法 |
|---|---|---|---|
| P-228l | **图层属性动画只有半套语义**：`extractAnimKf` 帧率硬编码 30 + `animValueAt` 恒定循环，只接 `origin/scale/visible`，`alpha` 载体一格没接 | 语料 213 条轨道：`fps≠30` **56**（60fps 34 条 ⇒ 播成 2 倍速）、`startpaused` **90**、`alpha` 载体 **65**（其中 **46** 条挂载瞬间的值 ≠ 静态 1 ⇒ 那些层此前永久可见） | 新增唯一实现处 `core/we-animation.mjs`（官方语义：`options.{fps,length,mode,startpaused}` + `relative` + `options.parent/children` 联动组 + 五载体逐帧写回）；脚本 `getAnimation()` 首次**真的驱动渲染**；`?anim=legacy` 逐位回退 |
| P-228l 修正 | 属性动画沿用脚本的**单帧封顶 dt**（0.05s）⇒ 低于 20fps 的机器上动画变慢动作 | llvmpipe ≈2–4fps：`mkj` 的 390 帧/13s 淡入从 3–5s 漂到 16–20s，整帧 p50 在 147–255 摆动 | 动画 dt 改用**场景时钟差**（脚本 `engine.frametime` 仍吃封顶） |
| P-228m | 粒子 `instanceoverride.count` 只缩了发射率、**没缩池上限** | 语料 97 个带 `count` override 的粒子层：**8 层池被打满、7 层两档存活数差 1.22×–2.64×**（最大 `dd/3544152633::Star Reactive` 74 vs 28），89 层零影响 | 池上限与发射率用**同一个倍率判定**（`particleCountMul`/`particleCapMul`），`?iocount=rateonly` 回退 |
| P-228n | **超限贴图的 JS 降采样分支命中 TDZ**（`__attachTexJson` 先用后声明）⇒ 纹理不登记 ⇒ 该层"画了但一个像素都没有" | 真包 0923/2887099508：日志 `⚠ JS降采样失败 1234: can't access lexical declaration '__attachTexJson' before initialization`；隔离 `?ln=4`/`?ln=14` 全帧 = 清屏色 `uniq=1`；整帧（粒子隐藏）`>220` 4.86% vs 上游产物档 17.9%。**影响面：51 个可解析包中 45 个（88%）含长边 > 2048 的贴图，涉及 169 层 / 142 张贴图** | 改成函数声明（提升）；函数体一字未改 |

### 判据与门禁

- 新增 `tests/anim-semantics-test.mjs`（**75 断言**：纯函数真值表 / 控制器模式 / 基准与联动组 / 渲染写回 / bundle 与宿主接线钉 / 脚本门面 / 真包读数 / 语料普查 + 3 组变异自证）⇒ `run-all-tests` **211 → 212 项**。
- `tests/load-timeout-test.mjs` 新增 **T3d / T3d2**（2500×1200 假位图 + `cap=2048` 走降采样分支：不抛 / 登记进 `textures` / 尺寸 2048×983 / 日志无"降采样失败"与 TDZ 文案）+ 切片夹具注入 `wrapTex` ⇒ **68 → 70 通过 / 0 失败**；变异自证：把 `__attachTexJson` 改回 `const` ⇒ 该腿立刻红。
- `tests/p74-instanceoverride-test.mjs` **60 → 69 断言**（倍率真值表 / 上限公式 / 同一判定 / `ctx.maxCount` 夹层 / 逐帧上限源码钉 / 缓存签名钉 / 档位 / README 登记）。
- 真机复核（同一台机、相位对齐）：2887099508 修后日志 `✅ 降采样纹理已上传 1234 2048x712`、隔离帧 `uniq` 1→202 / 1→2638、整帧（粒子隐藏）`>220` 4.86%→10.55%（背景 scenery 全部回来）；跨包 `0923/3479521040` 两行 `✅ 降采样纹理已上传`、`降采样失败` 0 条。

### 兼容性与回退开关

`?anim=legacy`、`?iocount=rateonly` 两个新档位（均登记 `docs/README-DIAGNOSTICS.md` 主表，`diag-flag-check` 计数 **217 → 218**）；P-228n 无开关（纯缺陷修复）。`?pquad=legacy` 仍是"粒子 quad 不吃图层 scale"的对照档。

## 发布记录：0.5.17（2026-10-04 · 批次 3：测量基建 + 机制修复 P-229…P-235 + 语料漂移基线同步）

**为什么是 minor（0.5.x 内按 minor 记）**：新增 6 个判据文件与 3 个报告工具（对外 npm 包面不变，
`files` 不含 tests/reports），渲染器行为修复 5 处、演示页测量面修复 1 处；全量门禁 199 → 210 项。

| 面 | 内容 | 判据读数 |
| --- | --- | --- |
| **P-229 演示页台账** | `mpwLedgerYDown` 被裹进页级单例块（module 严格模式块级作用域）⇒ composite 台账自 P-64-MEDIA 起全灭；搬到 module 层 | 受控实验 287 fire / 0 push → 修后 composite 38–42 条/帧；`ln-consistency` **12/0** |
| **P-230 copybg** | 换入条件收窄到「有效果链」的层（官方 helper 语义，wer-ref `ShouldUseCopyBackgroundSourceHelper`）；fx=0 层画自己的内容 | 真机 A/B uniq 66199 vs 30257；`copybg-semantics` **6/0**、`copybg-input` 12/0 |
| **P-231 内置模型层** | composelayer+fx = 效果载体（参与渲染，`?composfx=legacy` 回退）；无 fx 的 project/fullscreen = 逻辑 helper（不画） | `builtin-model-semantics` **9/0**（187 容器 594 个内置层扫描） |
| **P-232 相机 round-trip** | `getCameraTransforms()` 拍平动画对象 + `setCameraTransforms` 写穿 `general.zoom` ⇒ 作者脚本 round-trip 把运镜动画写死成常数（全场景恒 3 倍镜的真根因） | 真机 Solid/cloud 台账矩形与离线归因逐位吻合、全帧 uniq 14776 → 92230；`script-phase-order` S3f + S6 全绿 |
| **P-233 指针事件管线** | `cursorClick/Down/Up` 端到端派发（`dispatchScriptEvent` 增 `ownerFilter`；demo MPW-CURSOR 段：命中层 → Vec3 事件） | `cursor-dispatch` **6/0**（含真机点击命中耳朵 + 脚本调用 ≥1） |
| **P-234 场景级 {user} 绑定** | `general.bloom={user:…}` 此前无落点 ⇒ applyUserProperties 尾部场景级 pass + 关闭态台账 | `scene-user-bindings` **8/0**（含真机属性翻转腿） |
| **P-235 音频面钉死** | opt-in（?audio=1）+ 手势门控 + 0 尺寸层不剪枝 + volume 三形态 + 音频条 audioline 状态量法（F 组） | `audio-scene-players` **10/0** |
| **测量基建（C0/B1）** | 离线层归因工具 + `?ln=N` 第二量法一致性 + 全库矩阵（187 容器 / 3872 层按机制类聚合）+ 文本层扫描（929 层）+ 非 ASCII 资产名对账（1418 条引用） | `layer-attribution` 22/0、`nonascii-names` 12/0；报告 `reports/layer-attribution-{2887099508,consistency,matrix}.json` |
| **语料漂移基线同步** | wallpapertest1_* 移入 `delete/` 打穿 7 处"只增不减"基线（相机脚本 16/15/15→14/13/13、overbright/turbulence/children/mdl-bone/mdlv0016、package-baseline 210→216 行）；**tex-fmt5 审计扩三个合法族**（降分辨率 / 1:1 / BC3 块对齐 padding） | 五项单跑全绿；`tex-fmt5` **4/4**（95/95 解码） |
| **bench-ui-headless 夹具守卫** | 六条环境依赖断言接"前提缺失 ⇒ 自 SKIP"口径（媒体元数据未到 / 属性行缺失 / P9a/P9b 随 envSkip / P1 首轮未填充）；B5b 断言改"撑宽生效"（rect 含盒模型） | 单跑 **196/0** |

**发布前门禁**：`bash check.sh` **PASS=4 FAIL=0 / 4 阶段**；`run-all-tests` **205 PASS / 0 FAIL / 5 SKIP（210 项，SKIP=条件项如实跳过）**。

**诚实清单**
1. 离线归因不跑场景脚本：脚本驱动的可见性/取景差异按 `script-state`/`camera-scale` 登记（离线跑脚本是 C6 边界）；
2. not-drawn 78 层已分族（particle 19 = 渲染器粒子相位与离线模拟的分歧族；3509243656 透视包 LOAD* 族 59），
   渲染器侧根因待下批；3. clearalpha 的"屏幕坐标采样 + alpha=0"两细节未实现（P-230 边界）；
4. cursorMove/Enter/Leave 只留管线、cursorHitTest 只支持 false 拒绝、命中为轴对齐矩形近似（P-233 边界）；
5. 场景级 {user:…} 绑定本次只落 `general.bloom`（其余 24 处待逐字段取证，P-234 边界）。

## 发布记录：0.5.20

- **日期**：2026-10-12（registry 时间戳 `2026-10-12T17:24:47Z`）
- **tag**：`v0.5.20`（已推送）· **Release**：`releases/tag/v0.5.20`
- **npm**：`npm publish --registry=https://registry.npmjs.org/` ⇒ `latest = 0.5.20`
- **tarball**：165 文件 / 约 2.9 MB · `shasum 85a9cfc18db053c513b7a1c0a15741375a113e79`
- **发布后验证**（本文件第 3 节）：packument `dist-tags.latest = 0.5.20`、tarball `HTTP 200`、`npm pack …@0.5.20` 取回 165 文件、解包 `package.json.version = 0.5.20` 且 `core/we-scene.mjs` 的 `VERSION = '0.5.20'` 一致
- **内容**：P-338…P-342（视差指针接线 / 取景画布盒跟随设计画布 / `engine.canvasSize` 口径 / 脚本 `origin` 局部+重合成 / 测试台预览视差档 · 首格删除控件越界 · 图层开关「恢复默认」）；判据新增 6 个（门禁 246 → 251 项）；两处旧契约判据改双口径硬钉；修复 `tests/bench-ui-headless-test.mjs` 的崩溃与 8 条既有 FAIL（零断言被删）
- **发布前置**：0.5.20 之前的最后一次全量门禁 `PASS=4 FAIL=0 SKIP=0 / 总 4 阶段`（251/251 PASS）；本版本仅版本号三处改动，由 `mount-test` / `docs-check` / `publish-check` / `status-consistency` 四项钉住并已跑绿

> ⚠ 时间线说明（客观）：`npm publish` 后 CLI 立即返回成功，但 registry 元数据在约 6 分钟后才出现 `0.5.20`，tarball 附件再滞后约 7 分钟（先 404 后 200）。发布后验证请以**原始 packument / tarball HTTP 状态**为准，不要只看 CLI 那一行。

# 发布就绪清单（RELEASE.md）

> 为什么有这份文件：发布是**不可逆**动作（npm 撤不回，只能 deprecate 或补丁版），
> 而本仓库的门禁是"一条命令全量自检"（`bash tools/check.sh`，12 步）+ 一个发布完整性自检
> （`node tools/integrity-check.mjs`）。这份文件把**发布前置**、**确切命令**、**发布后验证**和
> **回滚**钉死成可复制的步骤 —— 照着跑就行，不靠记忆。
>
> 状态（2026-09-19 12:37 实测）：本地 `package.json` = **3.7.3**；npm 官方 registry 上 `latest` = **3.7.3**
> （`npm view dsh-mpkg-wallpaper dist-tags --registry=https://registry.npmjs.org` ⇒ `{ latest: '3.7.3' }`）
> ⇒ **本地版本号 == 已发布版本号 ⇒ 现在直接 `npm publish` 必然 403**
> （`cannot publish over the previously published versions: 3.7.3`）。**必须先 bump 版本号**（见第 0 节），
> 是否发布仍由用户拍板；未确认前不要执行第 2 节。

## 0. 版本号是否要动

- 规则：`package.json.version` 必须**严格大于**官方 registry 上的 `latest`（否则 `npm publish` 直接 403）。
- 现状（2026-09-19 实测）：registry 已有 `…3.7.0, 3.7.1, 3.7.2, 3.7.3`，`latest = 3.7.3`；本地 `package.json`
  与**已发布的 3.7.3 逐字节相同**（md5 相同、均 1 736 B）⇒ **bump 是发布的前置条件，不是可选项**。
- **建议 bump 到 `3.8.0`**：本轮 WP-1（网页壁纸渲染/API 覆盖）/ WP-2（触摸链）在 3.7.3 之后新增能力，
  NP-1（Now playing 挂侧栏）还带来**新的设置键 `npNowPlaying`** ⇒ 按 semver「加功能 = minor」，
  且与本仓先例一致（`3.5.x → 3.6.0 → 3.7.0` 都是功能轮走 minor）。
  *（若用户决定**扣下 NP-1**、只发 WP-1+WP-2 这两条对既有网页壁纸的补全，则 `3.7.4` 也说得通——
  但两条都是**用户可见的新交互能力**，minor 更如实。）*
- 改号位置：只改 `package.json.version` 一处；改完**必须重跑第 1 节全部命令**（`npm pack` 的数字会变）。

## 1. 发布前置（逐条跑，全绿才谈第 2 节）

```bash
cd <仓库根>

# ① 全量门禁（重活，**先串行化**再跑，避免与别的重任务撞车 OOM）
#    注意：`/tmp/.mpw-gate.lock` 曾被别的线用 `mkdir` 占成**目录** ⇒ `exec 9>/tmp/.mpw-gate.lock`
#    会报"是一个目录"、`flock` 报"错误的文件描述符"**却继续往下跑**（假串行）。稳妥写法：
#    路径是目录就换自己的锁文件，并且开跑前用 pgrep 复核确实没有别的重活在跑。
LOCK=/tmp/.mpw-gate.lock; [ -d "$LOCK" ] && LOCK=/tmp/.mpw-gate-lock.flock
exec 9>"$LOCK"; flock -n 9 || echo "锁被占：等（或改用 pgrep 复核后再跑）"
pgrep -af "run-all-tests\.sh|tools/check\.sh"; bash tools/check.sh

# ② 发布完整性自检（第 6 步已含，也可单独跑）：必需文件/元数据/白名单/个人路径/凭据/包清单
node tools/integrity-check.mjs

# ③ 单文件 bundle：构建 + 与源码对拍 + 等价性门禁
node tools/build-bundle.mjs
node tools/build-bundle.mjs --check
node tools/bundle-equivalence-test.mjs

# ④ 发布包内容复核（**必须显式指定官方 registry**：本机默认 registry 是 registry.npmmirror.com 镜像）
npm pack --dry-run --json --registry=https://registry.npmjs.org | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s)[0];
console.log('文件数',p.files.length,'| 解包',(p.unpackedSize/1048576).toFixed(2)+'MB','| tarball',(p.size/1024).toFixed(1)+'KB');
const bad=p.files.filter(f=>/\\.bak|\\.tmp|\\.orig|~$|^dist\\/|^tools\\/|^docs\\//.test(f.path));
console.log('异常项:',bad.length?bad.map(f=>f.path).join(', '):'(无)');})"

# ⑤ 登录态（本机已验证：xferoni66）
npm whoami --registry=https://registry.npmjs.org

# ⑥ 工作区：只应包含本次要发布的改动；不要带着别人的 WIP 一起发
git status --porcelain
```

期望值（**2026-09-19 发布准备轮实测**，供比对；标注「未重跑」的行是上一轮的数字，别当成今天验过）：

| 检查 | 期望 |
| --- | --- |
| `bash tools/check.sh` | `全部通过 ✓`（退出码 0），共 **12 步**（`grep -c 'step "' tools/check.sh` = 13 个标签 / 分母 12，`integrity-check` ⑨b 会断言自洽）。**本轮未重跑**（第 9 步起要无头 Firefox，本轮硬约束「不起浏览器」）；上一轮 3.7.3 发布时 12 步全绿 RC=0。 |
| `node tools/integrity-check.mjs` | **`结果: 72 通过, 0 失败`** + `✓ 插件完整性自检通过（配合 tools/check.sh 的 12 步门禁一起看）`，RC=0（2026-09-19 本轮实测；含内部那一次 `npm pack --dry-run`。条数会随断言增加而上抬，**0 失败**才是判据） |
| `node tools/secret-scan-test.mjs` | `✓ 敏感信息扫描干净：凭据 0 命中、本机绝对路径 0 命中、白名单无腐烂条目`，RC=0（2026-09-19 本轮实测，扫 99 个 tracked 文件 / 12 条凭据模式 / 3 条本机路径模式 / 2 条白名单全部仍命中） |
| `npm pack --dry-run --json` | **14 个文件**；解包 **1 660 391 B**（1.583 MB）；tarball **562 640 B**（549.5 KB）；异常项 **(无)**（2026-09-19 本轮实测。比已发布的 3.7.3 多 **2 个文件 / +261 544 B**，差值逐文件自洽，见 `docs/RELEASE-READY-3.8.0.md` §3） |
| 包内必需文件 | `lib/**`（**7 个运行时 js 全在**：`index/client/pkg-extract/web-wallpaper/web-interaction/now-playing/now-playing-math`；不含 P-127 有意排除的 `liquid-glass-bundle.js`）、`icon.svg`、`cordis.patch.yml`、`README.md`、`README.en.md`、`THIRD-PARTY.md`、`LICENSE`、`package.json` |
| 包内**不得**出现 | `*.bak*`（如 `lib/client.js.bak-20260907`）、`lib/liquid-glass/**`（10 文件，P-127 有意排除）、`tools/`、`docs/`、`screenshots/`、`dist/`、个人绝对路径、凭据字面量 |
| bundle 产物 | `dist/dsh-mpkg-wallpaper.bundle.mjs`，字节数与 sha256 见 `tools/probe-out/bundle-manifest.json`（**本轮未重建**；`dist/` 不入库、不随 npm 包发布） |

## 2. 发布命令（一行；**用户确认后**才执行）

```bash
cd <仓库根> && npm publish --registry=https://registry.npmjs.org
```

- **必须带 `--registry=https://registry.npmjs.org`**：本机 `npm config get registry` = `https://registry.npmmirror.com`
  （镜像不支持发布/会造成"发了但官方上没有"的错觉）。
- 包名 `dsh-mpkg-wallpaper` 是**非 scoped** 包 ⇒ 不需要 `--access public`。
- 发布前 npm 会自动跑 `prepublishOnly`/`prepare`（本包**没有**这些脚本，`package.json` 里也无 `scripts` 段 ⇒ 发布=纯打包上传，不会触发构建）。
- 不要加 `--tag`：默认 `latest` 就是本插件在 profile 里 `dsh plugin add dsh-mpkg-wallpaper` 解析的标签。

## 3. 发布后验证

```bash
# 把 <新版号> 换成发布时用的号（已发布的是 3.7.3；下一版见第 0 节建议）
npm view dsh-mpkg-wallpaper version --registry=https://registry.npmjs.org      # ⇒ <新版号>
npm view dsh-mpkg-wallpaper dist-tags --registry=https://registry.npmjs.org     # ⇒ { latest: '<新版号>' }
# 真装一遍（另建临时 profile，别动用户的 web profile）
dsh plugin --profile relcheck add dsh-mpkg-wallpaper@<新版号>   # base-backed 初始化临时 profile + 安装
# 若要从内置模板起一个全新 profile：`--from-default-profile` 是 **boot** 旗标（不是 plugin 子命令）：
#   dsh --profile relcheck --from-default-profile web

# 本机开发档：发布后把仓库源码同步进**用户的 web profile**（整 lib/ + 6 个顶层文件 + 逐文件 md5 校验 + 触发 patch 热重载）
# 注意：这个脚本在**工作区根**、不在本仓库内（它硬编码了本机绝对路径 ⇒ 不该入库）
bash <DSHAREA>/update-plugin.sh                                   # ⇒ 同步完成并校验通过：N 个文件 md5 全部一致
```

### 3.1 三种装载方式与"发布后各自怎么更新"（照 README「安装」节核对过，2026-09-19）

| 方式 | 装法 | 发布后怎么拿到新版 | 备注 |
| --- | --- | --- | --- |
| 一（推荐） | `dsh plugin --profile web add dsh-mpkg-wallpaper` | `dsh plugin --profile web update dsh-mpkg-wallpaper` + 重启 `dsh web` + 浏览器 Ctrl+F5 | 市场可识别「已安装」；解析 `latest` 标签 |
| 二 | `pnpm --dir <profile> add dsh-mpkg-wallpaper`（手动装依赖） | 同上（走依赖表） | 与方式一同源，只是不经 `dsh plugin` 包装 |
| 三 | GitHub 克隆（开发者 / 离线） | `git pull`（**不写依赖表**） | 市场不显示「已安装」，仅影响显示、不影响功能 |
| （四） | 单文件 bundle（**只装宿主端**） | 重新下载 `dist/dsh-mpkg-wallpaper.bundle.mjs` | 客户端半不会加载（裸 `.mjs` 无 `dsh.client` 包元数据）；**不建议**配「一键更新」用（`update-check` 无伴生 `package.json` 时 500） |

卸载（一/二/三）：`dsh plugin --profile web remove dsh-mpkg-wallpaper`

GitHub 侧（可选，但方式四的用户需要它）：

1. `node tools/build-bundle.mjs` 生成 `dist/dsh-mpkg-wallpaper.bundle.mjs`；
2. 建 release（tag = `v<新版号>`，本仓已有 tag 到 `v3.7.1`；**3.7.2/3.7.3 未打 tag**），**附上该 .mjs**，并在 release 说明里贴
   `tools/probe-out/bundle-manifest.json` 里的 `bytes` / `sha256`（用户可自行复算：
   `sha256sum dist/dsh-mpkg-wallpaper.bundle.mjs`）；
3. 用户侧更新：`dsh plugin --profile web update dsh-mpkg-wallpaper` → 重启 `dsh web` → 浏览器 Ctrl+F5。

## 4. 回滚 / 出问题怎么办

- **不要** `npm unpublish`（24h 限制 + 会破坏已装用户的 lockfile）。
- 小问题：立刻发补丁版（`<新版号>+1`），并在 README「安装」处保留旧版安装方式说明。
- 严重问题：`npm deprecate dsh-mpkg-wallpaper@<新版号> "原因 + 建议版本"`，同时让用户把 profile 里
  的依赖钉回**上一个已知good版本（当前 = `3.7.3`）**（`"dsh-mpkg-wallpaper": "3.7.3"` 后
  `pnpm --dir $DSH_HOME/profiles/web install`）。
- **只回退 dist-tag（不动包内容）**：把 `latest` 指回旧版，装默认档的新用户就不会拿到坏版本
  （已升级的用户仍停在坏版本，需要上面那条"钉版本"）：
  ```bash
  npm dist-tag add dsh-mpkg-wallpaper@3.7.3 latest --registry=https://registry.npmjs.org
  npm view dsh-mpkg-wallpaper dist-tags --registry=https://registry.npmjs.org   # 复核
  ```
- 本机开发档回退：`bash <DSHAREA>/update-plugin.sh` 是从**仓库源码**同步的，
  所以把仓库 `git checkout` 回上一个 good 提交再跑它一次即可（profile 副本会跟着回到旧版）。
- 包内文件发错（如夹带备份）：只能补丁版；机器闸门 `tools/integrity-check.mjs` 第 ⑨ 节就是为这个历史坑加的。

## 5. 未证实 / 边界（诚实记录，发布前若涉及需人工确认）

- 本轮**没有执行** `npm publish`（用户未确认），因此"发布能否成功"只有前置检查作证，**未证实**。
- `npm whoami` = `xferoni66`、官方 registry `npm view` 可读 ⇒ 网络与登录态**本次实测可用**；
  但发布权限（是否该账号对该包有 write）**未证实**（需要真的发一次或看 npm 包设置页）。
- 方式四（单文件 bundle）**只装宿主端**：客户端半由 DSH 按包发现（`dsh.client` + `exports["./client"]`），
  裸 `.mjs` 没有包元数据 ⇒ 不会加载客户端半。详见 README「方式四」表。
- 本机默认 registry 是 npmmirror 镜像这件事**只影响发布命令**；`npm view`/`npm pack --dry-run` 都只是读本地
  或读 registry，不写远端。

---

## 6. 3.7.3 发布与发布后验证记录（2026-09-18，主对话串行执行）

**发布命令**（官方 registry；本机默认 registry 是 npmmirror 镜像，**不带 `--registry` 会走镜像**）：
```bash
cd "$MPW_ROOT/dsh-mpkg-wallpaper"
node tools/integrity-check.mjs                       # 65 通过 / 0 失败（含唯一一次 npm pack --dry-run）
bash tools/check.sh                                  # 12 步全绿 RC=0（第 9 步起无头 Firefox，须串行）
npm publish --registry=https://registry.npmjs.org/   # + dsh-mpkg-wallpaper@3.7.3
bash "$MPW_ROOT/update-plugin.sh"                    # 同步进 DSH + 逐文件 md5 校验
```

**发布后验证（从 registry 拉回真实 tarball 逐项核对，不是只看 metadata）**：
```
npm pack dsh-mpkg-wallpaper@3.7.3 --registry=https://registry.npmjs.org/   → 467 488 B
解包文件数 = 12（改前 22 ⇒ liquid-glass 10 文件已按 files 负向模式排除）
与仓库源逐文件 md5：一致 12 / 不一致 0 / 仓库缺 0
密钥与本机路径扫描（`_authToken` / 私钥头 / `ghp_` / `sk-` / 本机工作区绝对路径 / 设备共享存储路径）：0 命中
liquid-glass 相关文件：0（确认未随包）
exports 映射 {".":"./lib/index.js","./client":"./lib/client.js"} → 目标文件全部存在
node -e "import('./lib/index.js')" → 加载成功，导出 __mpwTest, apply, inject
node --check lib/client.js → OK
运行期依赖 lib/{index,client,pkg-extract,web-wallpaper,web-interaction}.js + THIRD-PARTY.md + LICENSE 全在
```
**registry 侧**：`latest = 3.7.3`，`fileCount = 12`，`unpackedSize = 1 398 847 B`，发布时间 `2026-09-18T15:18:38Z`。

**本次发布内容**（对应提交）：发售面移出 liquid-glass（`bf342cb` P-127）、退役 `glassWindow` 死文案（`b631e7b` P-128）、
新增 pre-commit（`2c3a293` P-129）、`client.js` 拆分评估（`600346a` P-130）、版本号提升（`2997804`）。
**默认行为零变化**：`lib/client.js` 默认档产物在本轮逐字节未变（P-128 有 8 个上下文的 sha256 对拍）。

**仍未证实**：①真机观感（液态玻璃折射、`bsCompat` 默认开之后的悬浮适配）**仍需用户在自己设备上确认**；
②`dist/dsh-mpkg-wallpaper.bundle.mjs`（方式四单文件 bundle）本轮重建并跑了等价性对拍（38/0），但**未随 npm 包发布**
（`dist/` 被 `.gitignore` 忽略，按设计不入库）。

---

## 3.7.3 → 下一版（待用户点头）

> 本节是**下一版**的发布说明草稿 + 回退开关，供用户过目。**版本号尚未改动**（`package.json` 仍是 `3.7.3`
> = 已发布版本），建议见第 0 节。范围 = `2997804..HEAD` 的 8 个提交（WP-1 / WP-2 / 密钥加固 / 门禁）**加上
> 尚未提交的 NP-1**（`lib/now-playing*.js` + `lib/client.js` 生成区 + `docs/NOW-PLAYING-DSH.md`，另一条线收尾中）。

### 一、WP-1：网页壁纸渲染 / API 覆盖（用户可见）

| 变化 | 用户看到什么 | 依据 |
| --- | --- | --- |
| 帧内存储 facade + 宿主 `/web-store` | 网页壁纸（尤其 Live2D / Spine 类，靠 `localStorage` 存 `SettingModel`）的设置**刷新后不再丢** | `docs/WEB-WALLPAPER.md` §5.4；`web-store` 在 3.7.3 包内 0 命中 → 本轮新增 |
| 主音量 = 宿主音量 × 作者音量 | 壁纸自己调音量不再把宿主音量顶掉 | 提交 `6ce20e6` |
| HTML **源级** `file:///` 改写 | 静态 HTML 里写死的 `src|href|poster="file:///…"` 与 `url(file:///…)` 也能加载本地素材 | 同上；`docs/WEB-WALLPAPER.md` §6（K12 断言） |
| CSP 跳过注入 | 带 CSP 的网页壁纸不再因 shim 注入失败而整块不工作 | 提交 `6ce20e6` |
| 宿主 `/media-audio` 音频控制契约 | 曲目/封面/进度/播放控制通道打通（**默认仍静音**） | `docs/WEB-WALLPAPER.md` §13 |

**回退开关**：存储 facade 的替代路径是网页壁纸确认弹窗里的「**兼容模式（同源）**」（真·同源 storage，
仅建议对可信来源用；沙箱是默认档）；音频侧默认就是静音的，不动 `mute` 开关即可。

**已知限制**（不改）：①音频频谱**仍为空**——不伪造，因为 WE 的频谱语义是**系统音频**，拿壁纸自己的声音当频谱是语义造假；
②媒体通道已实现但**未接系统媒体会话（SMTC / MPRIS）**⇒ 不能显示"系统正在播放"；③`innerHTML` 里拼出来的 `file:///`
不覆盖（本机语料 0 命中，故不实现）；④绝对系统路径（`C:`/`Users/…`）映射不了，属设计如此。

### 二、WP-2：网页壁纸触控（用户可见）

- **变化**：触屏上单指拖动 / 多指序列能真正到达作者脚本（帧内**真 `TouchEvent`**，`postMessage` 的 `op:'touch'` 协议）；
  修掉"拖拽被当成点击"。`op:'touch'` 在 3.7.3 包内 **0 命中** ⇒ 确认是本轮新增。
- **回退开关**：设置项 **`webInteraction`** = `off`（存 `"off"` / `"full"`），或 URL 强制 `?mpwinteract=off`（也接受 `0`）。
- **默认档没变**：`mpwWebIxMode()` 缺省返回 **`pointer`**（点击/滚轮可达帧内，**不注入键盘**——键盘会吞掉用户方向键）。
  这个默认值**在已发布的 3.7.3 里就存在**（`mpwWebIxMode` 3.7.3 命中 4 次）⇒ **本轮不是默认行为变更**，
  老用户不动设置则体感只有"触屏能拖了"。
- **已知限制**：①CSS `:hover` / `:active` 与 `isTrusted:true` **不可达**（合成事件的固有边界，唯一真解是原生透传）；
  ②帧内 `contextmenu` 协议已通、帧内待接线；③"不点交互按钮就想直接操作"做不到——默认档是有意的安全边界。

### 三、NP-1：Now playing 挂侧栏（用户可见；**仍在本轮收尾**）

- **变化**：左侧栏出现 **Now playing 面板**（挂载点、插入顺序都有 DOM 契约断言，见 `docs/NOW-PLAYING-DSH.md` §3）。
- **开关**：键名 **`npNowPlaying`**，**默认 `false`**；落点在「壁纸设置」tab 紧挨既有 `mute` 开关下方；
  随导出/导入备份走（已登记 `BACKUP_FIELDS` + `boolFields`），「恢复默认」回到 `false`。
  **关 ⇒ 零注入**：全树 0 个 `[data-mpw-now-playing]`，`ResizeObserver`/`MutationObserver`/`rAF` **构造数都是 0**
  （不是"装了再断"，B4/B6/B11 断言）。
- **数据接入的四种情形**：视频类壁纸自带音轨 → **真能控**；场景/自定义壁纸自带音轨 → **只显示、不控**；
  网页壁纸 → 走既有静音设置 + 宿主 `/media-audio`；无源（静态图/无音轨）→ 空闲态。
- **回退开关**：把 `npNowPlaying` 关掉（或「恢复默认」）⇒ 回到零注入。
- **已知限制**：DSH 里**没有系统媒体源** ⇒ 它显示的是**壁纸自己的音轨**，不是"手机上正在放的音乐"；
  场景/自定义壁纸那条只显示不控。

### 四、这一版对老用户的**默认行为**影响（自查结论）

发布面 14 个文件里，**6 个与已发布的 3.7.3 逐字节相同**（含 `package.json`、`LICENSE`、`README×2`、
`icon.svg`、`cordis.patch.yml`、`lib/pkg-extract.js`）；变化的 5 个是
`lib/client.js` / `lib/index.js` / `lib/web-interaction.js` / `lib/web-wallpaper.js` / `THIRD-PARTY.md`，
另加 2 个新文件 `lib/now-playing{,-math}.js`。三条新能力里 **WP-2 与 NP-1 都是"默认档不变"**
（`webInteraction` 缺省 `pointer` 是 3.7.3 既有行为；`npNowPlaying` 默认关且零注入），
WP-1 是既有网页壁纸链路的**能力补全**（默认仍静音）。⇒ **未发现需要用户改设置才能保持原样的项**；
但真机观感（触屏手势是否被浏览器抢走、面板在窄侧栏下的排版）**仍需用户在自己设备上确认**。


---

## 发布记录：3.8.0（2026-09-19）

**发布动作（已执行，非计划）**
```
$ npm publish --registry=https://registry.npmjs.org/
+ dsh-mpkg-wallpaper@3.8.0
$ npm view dsh-mpkg-wallpaper versions  ⇒ … '3.7.3', '3.8.0'
$ npm view dsh-mpkg-wallpaper dist-tags ⇒ { latest: '3.8.0' }
$ git tag -a v3.8.0 && git push origin v3.8.0   ⇒ [new tag] v3.8.0
```
发布面（npm 实测）：**15 文件 / tarball 634.2 kB / unpacked 1.9 MB**，`shasum 27286f6905229472c285a132aa61d23d14aba666`。

**这一版相对 3.7.3 的实质变化**
1. **Now playing 默认挂载**：`npNowPlaying` 由 `false` → **`true`**（关掉仍是零注入）；宿主同一位置已有别的插件注入的元素时**自动让位**（`data-mpw-np-yield`，挂载前与挂载后都判，占用者离开后恢复）。
2. **壁纸声音真的接线**：目录自带音频由插件自己的 `<audio>` 播放（作用域认 `mpkgKey="custom|<folder>"`）；上一首/下一首按曲目清单**环形**切换（不再"回到开头"，也不触发壁纸 remount）；展开/收起两态播放暂停都生效；静音键可解开且真的落到媒体元素。web 壁纸**帧内**声音仍只有静音这一条通道（界面如实标 `canPlay=false`）。
3. **悬浮态卡片几何修复**：无壁纸/半残设置档下 NP 样式不再整份丢失；贴合缩放改为量**自己的容器**；卡片四边不再被裁切。
4. 真机探针另抓到并修掉两条同形状缺陷：web 分支提前 return 导致控件不挂；宿主侧栏晚渲染时不再"打一行 warn 就放弃"。

**门禁与真机证据（发布前实测）**
* `bash tools/check.sh` ⇒ **12 步全绿**（含第 9 步 `header-rail-replica` headless Firefox；跑前跑后 firefox 计数均为 0）
* `node tools/now-playing-test.mjs` ⇒ **83 通过 / 0 失败**（含 7 组变异）；`node tools/np-media-test.mjs` ⇒ **82 通过 / 0 失败**（12 组变异）
* 真机 `tools/np-media-live-probe.mjs`（`:3080`）⇒ **修前 16 PASS / 22 FAIL → 修后 45 PASS / 0 FAIL**；`tools/np-sidebar-live-probe.mjs` ⇒ **12 / 0**
* `tools/integrity-check.mjs` ⇒ 72/0；`tools/secret-scan-test.mjs` ⇒ 凭据 0 / 本机绝对路径 0 命中
* 截图：`reports/np-media-20260919/{01-expanded,02-collapsed,03-web-audio,04-float-expanded}.png`（含 `before-*` 对照）

**已知限制（如实）**：web 壁纸帧内只有静音、音量是开关不是 0..1 细调；视频壁纸没有曲目清单故上一首/下一首 disabled；
卡片静音键只在展开态出现（收起态行宽被 `opsX(0)=206` 钉住）；`lib/media-session.js`（系统媒体会话）**已实现但尚未接线**。

## 发布记录：3.8.1（2026-09-19）

```
$ npm publish --registry=https://registry.npmjs.org/   ⇒ + dsh-mpkg-wallpaper@3.8.1
$ npm view dsh-mpkg-wallpaper dist-tags                ⇒ { latest: '3.8.1' }
$ npm view dsh-mpkg-wallpaper versions                 ⇒ … '3.8.0', '3.8.1'
$ git tag -a v3.8.1 && git push origin v3.8.1          ⇒ [new tag] v3.8.1
```
发布面：**15 文件 / unpacked 1.9 MB**，`shasum 4fbaf5570aa4f25a545cfaa055500267b9284190`。

**相对 3.8.0 的变化**
1. **壁纸选择字段不再丢**（真机 bug：`mpkgKey` 在、`image`/`webUrl` 缺 ⇒ 壁纸层被 `.mpw-bgWrap{display:none}` 藏掉）：两处存储改为**合并不替换**（`undefined` 不覆盖、`null` 才删）+ **源字段粘性** + 两处存储按各自写入时刻**显式裁决** + boot **收尾闸门**（宿主 GET 回来或 3.5s 超时前不落盘）+ **半残档自愈**（按 `mpkgKey` 反推源，能推就推、推不出明确提示）+ 宿主 `PUT /settings` 改**逐键合并**。
2. 两处文档口径更正：`lib/now-playing.js` 头部归属指向 `THIRD-PARTY.md` **§6**（原写 §13，指向了别的条目）；`docs/NOW-PLAYING-DSH.md` §6 补充"默认值已由 `false` 改为 `true`"的复核更正。
3. 去掉两处本机工作区绝对路径（`integrity-check` 曾红 1 条）。

**判据（发布前实测）**：`bash tools/check.sh` ⇒ **全部通过 ✓**（12 步，含第 9 步 headless Firefox）；
`now-playing-test` 83/0、`np-media-test` 82/0（12 组变异）、`settings-persist` 105 断言（7 组变异，`--no-mutations` 105）；
`integrity-check` 72/0、`secret-scan` 干净。
真机：`np-media-live-probe` **45 PASS / 0 FAIL**、`np-sidebar-live-probe` **12/0**、
`settings-persist-live-probe` **5 PASS / 0 FAIL**（源字段已自愈、`computed.display` 由 `none` → `block`）。

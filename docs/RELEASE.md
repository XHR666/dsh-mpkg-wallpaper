# 发布就绪清单（RELEASE.md）

> 为什么有这份文件：发布是**不可逆**动作（npm 撤不回，只能 deprecate 或补丁版），
> 而本仓库的门禁是"一条命令全量自检"（`bash tools/check.sh`，12 步）+ 一个发布完整性自检
> （`node tools/integrity-check.mjs`）。这份文件把**发布前置**、**确切命令**、**发布后验证**和
> **回滚**钉死成可复制的步骤 —— 照着跑就行，不靠记忆。
>
> 状态（2026-09-23 12:50 +0800 实测）：本地 `package.json` = **3.13.3**（= 仓库 HEAD `784e2d5`）；
> npm 官方 registry 上 `latest` = **3.13.3**（`npm view dsh-mpkg-wallpaper dist-tags --registry=https://registry.npmjs.org/`
> ⇒ `{ latest: '3.13.3' }`）。发布时间（registry `time` 字段实测）：`3.13.2` = `2026-09-22T20:13:24.727Z`、
> **`3.13.3` = `2026-09-23T04:50:11.553Z`**（= 2026-09-23 04:13:24 / 12:50:11 +0800）。
> **本地版本号 == 已发布版本号 ⇒ 现在直接 `npm publish` 必然 403** ⇒ 下次发版**必须先 bump**（见第 0 节）。
> 本轮已部署：工作区根的 `update-plugin.sh`（`bash update-plugin.sh`）⇒ 15 个文件 md5 全部一致（刷新页面即生效，无需重启 dsh）。
> 历史：3.9.0 → 3.9.1 → 3.10.0 → 3.10.1 → 3.11.0 → 3.12.0 → 3.13.0 → 3.13.1 → 3.13.2 → **3.13.3**。
> **tag 缺口（实测）**：本仓 tag 最新仍为 `v3.12.0`；`v3.13.0` / `v3.13.1` / `v3.13.2` / `v3.13.3`
> 本地与远端都没有 ⇒ 待打 tag 的目标提交与命令见文末「待打 tag」节（**只给命令，本轮未执行任何写 git 的操作**）。
>
> 下面两段是**历史状态记录（已过期）**，保留以便对照当时的判断过程：
>
> 状态（2026-09-20 05:0x 实测）：本地 `package.json` = **3.10.1**；npm 官方 registry 上 `latest` = **3.10.0**
> ⇒ 本地 > 已发布 ⇒ 可以直接发（发包前**必须**重跑第 1 节全部命令）。历史：3.8.0 → 3.8.1 → 3.8.2 → **3.9.0**。
>
> 状态（2026-09-19 12:37 实测）：本地 `package.json` = **3.7.3**；npm 官方 registry 上 `latest` = **3.7.3**
> （`npm view dsh-mpkg-wallpaper dist-tags --registry=https://registry.npmjs.org` ⇒ `{ latest: '3.7.3' }`）
> ⇒ **本地版本号 == 已发布版本号 ⇒ 现在直接 `npm publish` 必然 403**
> （`cannot publish over the previously published versions: 3.7.3`）。**必须先 bump 版本号**（见第 0 节），
> 是否发布仍由用户拍板；未确认前不要执行第 2 节。

## 0. 版本号是否要动

> ⚠ 本节下面的「现状」是 **2026-09-19 的实测**（历史快照，保留推理过程）；**当前状态以文件顶部那段为准**
> （本地 = registry = `3.13.1` ⇒ 要发新版**必须先 bump**）。

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
# 把 <新版号> 换成发布时用的号（已发布的是 3.13.1；下一版必须先 bump，见第 0 节）
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
2. 建 release（tag = `v<新版号>`；**实测**：本仓 tag 共 21 个、最新 `v3.12.0`，**`v3.13.0`/`v3.13.1` 未打 tag**
   —— 补齐的目标提交与命令见文末「待打 tag」节），**附上该 .mjs**，并在 release 说明里贴
   `tools/probe-out/bundle-manifest.json` 里的 `bytes` / `sha256`（用户可自行复算：
   `sha256sum dist/dsh-mpkg-wallpaper.bundle.mjs`）；
3. 用户侧更新：`dsh plugin --profile web update dsh-mpkg-wallpaper` → 重启 `dsh web` → 浏览器 Ctrl+F5。

## 4. 回滚 / 出问题怎么办

- **不要** `npm unpublish`（24h 限制 + 会破坏已装用户的 lockfile）。
- 小问题：立刻发补丁版（`<新版号>+1`），并在 README「安装」处保留旧版安装方式说明。
- 严重问题：`npm deprecate dsh-mpkg-wallpaper@<新版号> "原因 + 建议版本"`，同时让用户把 profile 里
  的依赖钉回**上一个已知good版本（2026-09-22 实测 = `3.13.1`）**（`"dsh-mpkg-wallpaper": "3.13.1"` 后
  `pnpm --dir $DSH_HOME/profiles/web install`）。
- **只回退 dist-tag（不动包内容）**：把 `latest` 指回旧版，装默认档的新用户就不会拿到坏版本
  （已升级的用户仍停在坏版本，需要上面那条"钉版本"）：
  ```bash
  npm dist-tag add dsh-mpkg-wallpaper@3.13.1 latest --registry=https://registry.npmjs.org
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

## 发布记录：3.8.2（2026-09-19 夜）

```
$ npm publish --registry=https://registry.npmjs.org/  ⇒ + dsh-mpkg-wallpaper@3.8.2
$ npm view dsh-mpkg-wallpaper dist-tags               ⇒ { latest: '3.8.2' }
$ git tag -a v3.8.2 && git push origin v3.8.2          ⇒ [new tag] v3.8.2
```

**这一版修的是"音乐组件在 DSH 里不可用"的一整批真机缺陷（NP-4）**
1. **起播顺序**：原先 `showVideoEl` 先按设置**取消静音**再 `play()` ⇒ 那是一次**有声自动播放** ⇒ `NotAllowedError`，且被 `.catch(()=>{})` 吞掉。
   改成 muted 起播 → 拿到播放权 → **同步**恢复设置值；被拒不再静默（`window.__mpwNpPlayBlocked`）+ 一次性 muted 重试 + 首次用户手势后重试。
2. **被浏览器策略停住**：muted 起播的 promise **成功 resolve**，但取消静音那一刻浏览器**直接把元素停住**（不 reject、也不调用 `pause()`，任何 promise/包装都看不见）。
   现在用 `pause` 事件识别"被停住" ⇒ 退回 muted 保画面 + 记 `window.__mpwNpSoundBlocked`。
   **可交付口径（写进文档与判据）：用户手势之后必定出声**；"页面从未被交互时自动出声"在当前浏览器策略下做不到，不当判据。
3. **真实音量**：新增 `npVolume`（0..100，默认 100）+ 卡片可拖音量条，落到 `<video>` / 我们的 `<audio>` / web 帧既有 shim 的 `policy.volume`；**默认档一个元素都不碰**。
4. **进度可拖动**：命中带（`[data-mpw-np-scrub]`，轨道上下各补 9px）修掉"偏移被加两遍"的真 bug（原来命中带落在卡片外、事件被同行宿主元素接走）。
5. **新增联动开关 `npLinkWallpaper`**（Now playing 之下、仅在 NP 打开时渲染；默认 **true** = 与改动前逐字节同行为；关掉后播放键一个字节都不碰壁纸）。
6. **音轨清单四类来源**：目录 / 子目录（改走 `/custom-folder/<folder>/<逐段编码>`，旧写法取基名会 404）/ 包内（`source=pkg`，**无字节通道 ⇒ 只列清单、如实 disabled**）/ 视频容器内音轨；用户那张 video 档如实 `1/1` + 上一首/下一首 disabled。
7. **悬浮态卡片放大**：借"容器到最近裁切祖先内边距盒"之间的宿主内边距（`bleedFor`，上限 12px，只写我们自己容器的内联样式）⇒ 真机 **205.92 → 230.1px**，`cardClippedBy.violations=[]`（放大且不裁切）。

**判据**：`bash tools/check.sh` ⇒ **全部通过 ✓（12 步）**；`np-control-test` **62/0 + 13 组变异各自必红**、`now-playing-test` 85/0、
`np-media-test` 87/0、`web-wallpaper-test` 400/0（语料指纹刷新见 `76f384e`）；真机 `np-media-live-probe` **43 PASS/2 FAIL → 71 PASS/0 FAIL**，
`np-sidebar-live-probe` 12/0、`settings-persist-live-probe` 5/0（发布后由主对话独立复跑，同一读数）。

**已知边界**：包内音频（`scene.pkg` 内音轨）**无字节通道**（要补需宿主新增一条路由）；web 帧内只有静音这一条通道；
`?scriptstore=persist` 缺省仍不持久化（`docs/README-DIAGNOSTICS.md`）。


## 发布记录：3.9.0（2026-09-20）

**为什么发**：3.8.2 之后落地了一整轮**用户点名的真机批次**，其中既有用户可见的新能力（卡片暂停持久化、音频审计、
交互音分类、`?npvoice`），也有**默认档变化**（`powPauseHidden` 关 → 开）。按 semver「加功能 = minor」取 **3.9.0**。

**这一版包含**（逐条根因/真机读数见 `docs/WALLPAPER-LIFECYCLE.md`）：

| 面 | 内容 |
| --- | --- |
| 六条真机 bug | ⑥ 设置面板被困左栏（`backdrop-filter` 包含块）、② 清空被粘性护栏带回 / 残留 `webUrl` 抢先武装 / web 档预览空白 / 源不可用被当素材、① 预览候选链、③ 沙箱档策略降级（shim `probeCaps`）、④ 卡片暂停压住帧内音频、⑤ 切页静音 |
| 音频语义 | A 交互音分类（`mpwClassifyWebAudio` + `?npvoice=keep\|drop`，缺省 auto）、B 联动关 = **只控声音**、C 切页"又响一下"的唯一闸门（`mpwHiddenAudioBlock()`） |
| NP-5 | 卡片播放/暂停**意图持久化**（键 `npPaused`，唯一写入口只在用户显式操作时写；刷新/换档继续成立） |
| 审计 | `mpwInstallAudioAudit()`：hook `play`/`volume`/`muted`/`new Audio`/`AudioContext`，有界环形 ≤200，可疑转变即 POST `/diag`（`?npaudit=0` 关） |
| 宿主超限语义 | 两个 POST 接收端（`/diag`、`/custom-scene-thumb`）超限从 `req.destroy()` 改成 **413 + JSON 说明**（旧行为客户端只看到 ECONNRESET）；新增门禁 `tools/host-body-limit-test.mjs`（真 HTTP + 变异自证） |

**发布前置读数**（本机实测，命令见第 1 节）：

| 闸门 | 读数 |
| --- | --- |
| `bash tools/check.sh` | **12/12 全绿**（`9939ac3` 与 `a8f377e` 两轮都跑过，末行"全部通过 ✓"） |
| `node tools/wallpaper-lifecycle-test.mjs` | **172 通过 / 0 失败**（含 **21 组**变异自证） |
| `node tools/host-body-limit-test.mjs` | **10 通过 / 0 失败**（含变异自证） |
| `node tools/integrity-check.mjs` | **72 通过 / 0 失败** |
| `node tools/secret-scan-test.mjs` | 干净（凭据 0 / 本机绝对路径 0 / 白名单无腐烂） |
| 真机探针 | `wallpaper-lifecycle-live-probe` **31 PASS / 0 FAIL / 1 SKIP**；`np-pause-persist-live-probe` **11 PASS / 0 FAIL** |
| `npm pack --dry-run` | **15 个文件** / unpacked **2 088 240 B** / tarball **708 939 B**（与 3.8.2 比：文件数不变，字节 +10 053） |

**发布后验证（2026-09-20 实测读数）**：

| 检查 | 读数 |
| --- | --- |
| `npm view … dist-tags` / `@3.9.0 version license` | `{ latest: '3.9.0' }` / `3.9.0` / `MIT`（发布后约 2 分钟可见） |
| 真下载 `npm pack dsh-mpkg-wallpaper@3.9.0` | **15 个文件**：`lib/` 8 个运行时 + `cordis.patch.yml`、`icon.svg`、`package.json`、`README.md`、`README.en.md`、`THIRD-PARTY.md`、`LICENSE` |
| 包内 `package.json` | `version 3.9.0` / `files` 12 条 / `dsh.{icon,bundle,client}` 齐 |
| 包内敏感面 | `lib/client.js` 里**三条本机路径前缀各 0 命中**（工作区前缀 / 设备共享存储前缀 / Termux 私有目录前缀；判据即 `tools/secret-scan-test.mjs` 的三条正则） |
| profile 同步 | `bash update-plugin.sh` ⇒ **13 个文件 md5 全部一致**（含 `lib/` 子目录；无需重启 dsh，刷新页面即可） |
| 真机复跑（同步后的 3.9.0） | `tools/np-pause-persist-live-probe.mjs --watch 25` ⇒ 见下方"3.9.0 发布后真机复跑" |
| git tag | `v3.9.0` 已推送（`ef48cb3`） |

**3.9.0 发布后真机复跑**：点卡片暂停 → 真刷新 → 25s×500ms 采样 ⇒ 每一拍 `npPaused=true` 且载体 `paused=true`、
卡片保持暂停态、`play()` 钩子 0 次调用；再点播放 ⇒ 恢复；整轮 0 pageerror（探针汇总行见 CI/终端输出，
时间线与截图落 `/tmp/np-live/np-pause-persist-{timeline.json,after-reload.png}`）。

**这一版对老用户的默认行为影响（自查）**：
1. **`powPauseHidden` 关 → 开**：只迁移**从没设过**这个键的存量档（`powPauseHiddenUserSet` 标记与 `bsCompat` 同口径）；
   显式关过的用户在 3.4.x 之后的档里带标记，不会被迁移；迁移后用户仍可显式关掉，此后不再迁移。
2. `npPaused` 是**新键**（默认 `false` = 播放）⇒ 老用户升级后行为与升级前一致（不会突然变暂停）。
3. 超限语义变化只影响**病态载荷**（>8MB 的 diag / >3MB 的首帧）：从"连接被掐"变成"413 + 说明"，正常档逐字节不变。

**已知边界**：服务端改动**要等 dsh 进程重启**才生效（ESM 模块缓存，`cordis.patch.yml` 的热重载只重载客户端）——
截至 3.10.0 累计四处：①`lib/index.js` 的文档类 404 用 HTML；②三条 scene 路由 404 化；③`lib/web-wallpaper.js` 的
`probeCaps`；④**本版的三条媒体会话路由**（`/media-session`、`/media-control`、`/media-art`）。
**真机实测（2026-09-20 03:5x，3.10.0 已同步但 dsh 未重启）**：客户端侧新代码已在跑
（`window.__mpwSystemMedia = {available:false, reason:"fetch:HTTP 404"}`，连续失败即降速 ⇒ 不刷屏），
而宿主那三条路由在真进程里仍是 **404**（旧模块）⇒ **重启 dsh 后**才会变成 200 并如实回 `available:false / no-session-bus`。
宿主侧代码本身的正确性由 `tools/media-session-wiring-test.mjs`（真 HTTP + 真进程内注册）24/0 覆盖。
本机 headless Firefox 无 WebGL，沙箱档"画面是否正确"只能人眼；NP-5 的"点暂停 → 刷新 → 30s 采样"已由真机探针覆盖（11 PASS/0 FAIL）。


## 发布记录：3.9.1（2026-09-20）

**为什么发**：3.9.0 之后补了一轮**审计能力**（用户点名「静音状态下还是突然冒出来的声音，必须彻查出来」的研究产物）——
不发的话用户刷新拿到的还是旧审计，下一次"响"仍然抓不到来源。

| 面 | 内容 |
| --- | --- |
| 审计扩容 | `mpwAuditPatchWin(win)`：钩子可装进**任意窗口**并对同源子帧递归安装（每秒重扫，上限 60 次）；新增 **WebAudio 出声钩子**（`AudioBufferSourceNode`/`OscillatorNode`/`ConstantSourceNode` 的 `start()`、`audioctx-resume`） |
| 记录扩容 | 每条带 `win{top,url,foreign}`（跨源帧如实标 `foreign`）与 `el.owner`（`ours` / `whale-widget` / `frame` / `other`） |
| 新判据 | `trigger:"mute-on-but-audible"` —— **静音设置开着却可听**立刻 POST `/diag`（旧判据只有泛化的 `audible-playback`，指认不了"静音却出声"这个组合） |
| 新工具 | `tools/audio-source-hunt-live-probe.mjs`（真机守候 + `--whale` 因果判定 + `--selftest` 7 条判据分辨力自证） |
| 新文档 | `docs/AUDIO-SOURCES.md` —— 声音归属排查：证据链、复现命令、三种消音做法、诚实边界 |

**结论（用户第 1 问的答复）**：那段声音 = **第三方 `dsh-whale-widget` 的 UI 音效**
（`new Audio('/dsh-whale/sound/{press,release}.mp3')`，`pointerdown` **捕获阶段**触发、`vol=1`、不读我们的 `mute`），
本插件自己的元素在 300s / 945 拍守候里**一次都没可听**。详见 `docs/AUDIO-SOURCES.md`。

**发布前置读数**：`bash tools/check.sh` ⇒ **全部通过 ✓（12/12）**；`tools/wallpaper-lifecycle-test.mjs` ⇒ **177 通过 / 0 失败**
（P6/P6b–P6f 六条新断言钉住审计扩容与"静音却可听"判据）；`node tools/integrity-check.mjs` ⇒ 72/0；
`node tools/secret-scan-test.mjs` ⇒ 干净（本批曾被它抓到一次：`docs/RELEASE.md` 里**照抄了**那三条本机路径前缀，
已改成"三条前缀各 0 命中"的措辞 —— 门禁是对的，文档不该带操作环境字面量）。

**发布后验证**：`npm view … dist-tags` ⇒ `latest=3.9.1`；tarball 仍 **15 个文件**；`update-plugin.sh` ⇒ 13 文件 md5 一致；
真机复跑 `tools/audio-source-hunt-live-probe.mjs --sec 20 --whale` ⇒ **7 PASS / 0 FAIL**（H5/H6 抓到鲸鱼那两条记录）。


## 发布记录：3.10.0（2026-09-20 · MEDIA-1 **接线**）

**为什么是 minor**：这不是修 bug，而是把**早就实现却没接线**的系统媒体会话接上 —— 用户可见的新能力
（NP 卡片显示**真实系统曲目/封面/进度**，卡片按钮控系统播放器），按 semver「加功能 = minor」取 **3.10.0**。

| 面 | 内容 |
| --- | --- |
| 宿主三条路由 | `GET /media-session`（**21 键原样透传**；`?describe=1` 才附带模块自述）、`POST /media-control`（只认 `CONTROL_OPS` 六项；坏 op/坏 seek ⇒ 400；非 POST ⇒ 405 + `Allow`）、`GET /media-art?player=`（`file://` 封面代理：**只服务当前快照里那个 player 的 artUrl**，非 file ⇒ 409、不存在 ⇒ 404、过大 ⇒ 413，按 magic 判 MIME） |
| 客户端补充路径 | `npSystemMedia{Start,Stop,Tick,Refresh,Apply,Control}`：**不动**同步的 `npResolveMedia`（壁纸自己那条语义），异步补系统媒体；`available:false` ⇒ **不接管**（本机常态）；封面走代理；毫秒→秒换算；传输动作改道且有**能力位闸**（`canNext/canPrev`） |
| 资源纪律 | **自适应单链轮询**：有系统媒体 2s、不可用/失败 30s；页面不可见不发请求只续期；定时器统一 `unref`（否则桩 DOM 门禁"跑完了却不结束"—— 实测踩到 `now-playing-test` 卡 600s） |
| 判据 | 新增 `tools/media-session-wiring-test.mjs`：**24 断言 + 3 组变异自证**（op 白名单 / 封面只认快照里的 player / `available:false` 不许接管），已进 `tools/check.sh` 第 2 步 |
| 本机诚实降级 | 没有 D-Bus 会话总线 ⇒ `available:false / reason:"no-session-bus"`、其余字段中性值（不编数据）；客户端据此**保持显示壁纸自己的标题/预览** |

**发布前置读数**：`bash tools/check.sh` ⇒ **全部通过 ✓（12/12）**（含新接线门禁与重建后的单文件 bundle 对拍 19/0）；
`tools/media-session-test.mjs` 95/0、`tools/media-session-wiring-test.mjs` 24/0、`tools/np-media-test.mjs` **91/0**、
`tools/np-control-test.mjs` **81/0**、`tools/now-playing-test.mjs` **85/0**、`tools/wallpaper-lifecycle-test.mjs` **177/0**；
`node tools/integrity-check.mjs` ⇒ 72/0；`node tools/secret-scan-test.mjs` ⇒ 干净。


## 发布记录：3.10.1（2026-09-20 · 声音溯源补网：WebAudio + 窗口清单）

**为什么发**：用户澄清「别人插件的音效**必须我去交互他才会出现，并不会自己出现**」⇒ 3.9.1 那条
"鲸鱼 UI 音效"只解释了"交互时响"，**解释不了"什么都没动却响"**。不需要交互就能出声、而我们的 `muted`
又管不到的，只剩 **WebAudio**（Live2D 角色语音 / 壁纸自己用 `AudioContext` 播的声）——它不碰任何标签，
旧判据 `audible`（`!paused && !muted && volume>0`）**永远抓不到它**。

| 补的东西 | 判据/形状 |
| --- | --- |
| 新 trigger **`webaudio-on-muted`** | `webaudio-start`（`AudioBufferSourceNode`/`OscillatorNode`/`ConstantSourceNode` 的 `start()`）或 `audioctx-resume`，**且** `np.mute === true` ⇒ 立刻 POST `/diag`（节流 5s） |
| `__mpwAudioAudit.frames()` | 窗口清单：`{depth,url,media,looksLive2D,top}`（Live2D 判定 = 有 canvas 且文档里出现 `live2d|model3.json|loadJson.json`） |
| 记录仍带 | `who`（栈前 3 帧）、`win{top,url,foreign}`、`bufferSec`、`ctxState`、当时 `np.mute` |

**判据读数**：`tools/wallpaper-lifecycle-test.mjs` ⇒ **179 通过 / 0 失败**（新增 P6g/P6h 两条钉住新 trigger
与窗口清单）；`bash tools/check.sh` ⇒ **全部通过 ✓（12/12）**；`integrity-check` 72/0；`secret-scan` 干净；
`docs/AUDIO-SOURCES.md` 新增 §5b 写清"适用范围收窄 + 下一次怎么定位（命中即自动落 `diag-*.json`）+ 仍抓不到的三类"。


## 发布记录：3.11.0（2026-09-21 · 音乐卡片 seek 真机 P0 + 音频格式路由 + 预览框几何 + 网页帧三档 + 风险预检接口）

**为什么是 minor**：既有**用户可见的新能力**（网页帧三档 `webFrameMode`、网页壁纸风险预检接口与面板提示、更多音频格式真的能放），
也有一个**真机 P0 修复**（音乐卡片进度条 seek 落错元素）。按 semver「加功能 = minor」取 **3.11.0**。

| 面 | 内容 | 判据读数 |
| --- | --- | --- |
| **P0 音乐卡片 seek**（真机：卡片总时长 `−3:22`、点轨道 90% 视频只从 11.53 → 12.69） | 根因两条：① `npActiveVideo` 把 `display:none` 当成"这不是壁纸媒体"⇒ 容器档换档窗口里卡片掉进曲目分支、绑到上一张壁纸残留的**游离 `<audio>`**（213s BGM）；② `npTransport("seek")` 是两段独立 if（视频 seek 完还会顺手 seek 那个 audio），而 `npSyncAudio` 的 `timeupdate` **无条件**把 audio 的时钟写进同一根进度条 ⇒ 两个元素轮流写、谁最后触发谁说了算。改法：新增 **`npMediaTarget(section)` = 卡片唯一媒体目标** `{el,kind:'video'\|'audio'\|'none'}`（数据源/时长/进度/seek/静音/上报全走它；`npActiveVideo` 判据改"src 非空 + 视频档 + 非 web 档"；残留 audio 只在**真有曲目清单**时才认），`npSyncVideo`/`npSyncAudio` 各自只在"主人是自己"时写进度，seek 单所有者 | `tools/np-control-test.mjs` **101 通过 / 0 失败**（T 组 9 条 + 其余全量）；**2 条变异自证**：恢复 `display` 一票否决 ⇒ T 组红 6 条；恢复"顺手也 seek 游离 audio" ⇒ T 组红 1 条 |
| 音频格式（用户第 10 条） | 根因在**路由层**而非扫描表：`/raw` 对非 mpkg/pkg/json 一律 `application/octet-stream`、`/custom-media` 无音频分支、`/custom-dir` 白名单无音频后缀；另 `AUDIO_MAGIC_MIME` 的 ISO-BMFF 分支常量写成 `66427970`（ASCII `fByp`，ftyp 实际在偏移 4）且整体被 `n>=12` 包住。改法：唯一表 `AUDIO_SUFFIX_MIME`（8 项，与渲染器 `server/upload-policy.mjs` **同一份名单**）+ 新入口 `audioMimeFor(path, head)`（magic 优先 / 后缀兜底 / ID3 前缀的 `.flac` 例外），四条路由改查表 | `tools/audio-scan-test.mjs` **79/0**；`tools/scene-audio-route-test.mjs` **37/0**（实测 content-type：`/raw` 与 `/custom-folder` 的 `.flac` 都是 `audio/flac`，Range 206 同值；`/custom-media` 的 `.m4a` = `audio/mp4`） |
| 预览框「半张图 + 白块 mp4」（第 12 条） | `.mpw_wallThumb` 是 flex 行，媒体与类型占位是**兄弟** ⇒ 占位一露把图压到 3/4、`cover` 再裁一块。改为媒体 `position:absolute;inset:0;object-fit:contain`、占位同层铺满居中、显隐收口 `mpwThumbFail/mpwThumbOk`（同框可见 ≤1、三条失败路径同形），候选链 = 扫描到的 `preview.*` → 容器 preview → 目录约定名 → 视频首帧 → 图片 | `tools/thumb-chain-test.mjs` **26/0**（真 CSS 产物几何 + **旧 CSS 对照**：并排 + 裁切、白块占框 ≈32% = 真机那块白） |
| 换目录预览失败（第 13 条） | 缩略图 URL 缓存键 = 原 URL + **目录身份**（`mpwd=`）+ **严格单调纪元时间戳**（`mpwt=`），React key 同源 ⇒ 换目录换新节点、旧的内联 display/失败标记不可能粘住、候选链从 0 重走、失败不缓存 | thumb-chain B5/B6 + `tools/wallpaper-lifecycle-test.mjs` **184/0** |
| Web 帧三档（第 9 条） | 判定表唯一在 `lib/web-wallpaper.js`（`webFramePlan/webFrameSandboxAttr/webFrameStatus`），客户端镜像并由门禁**逐档对拍**；`section.webFrameMode`（默认 `auto`）+ `?webframe=` 回退口；`auto` 才允许"策略挡住 ⇒ 一次性降级兼容"，`sandbox` 强制隔离**不**自动降级（原因进状态），`compat` 不带 shim 标记；状态 `window.__mpwWebFrame{...}` + `#mpw-bgWrap[data-mpw-webframe-mode\|-reason\|-attr\|-degraded]` | `tools/web-wallpaper-test.mjs` **429/0** |
| 风险预检接口（第 11 条） | 判定收敛到模块级 `probeWebWallpaper`（两处扫描 + 新路由共用，源码级判据"递归只允许一份定义"）；`GET /api/mpkg-wallpaper/web-probe?folder=\|ltoken=` ⇒ `{ok,target,probe{heavy,external,heavyHits[≤8],externalRefs[≤8],htmlFile,scannedBytes,reasons[],limits}}`，400/403/404/200 四态，回环地址（localhost/127.0.0.1/::1）不算外网；条目级已有 `webHeavy/webExternal` + `webProbe`；选中时给**一次性、非阻塞**提示（面板 hint 行 + `localStorage.mpwWebRiskSeen`），状态 `window.__mpwWebRisk` + `#mpw-bgWrap[data-mpw-web-heavy\|-external\|-risk]` | `tools/web-probe-test.mjs` **26/0** + web-wallpaper B7i/B7j；形状契约 `docs/WEB-WALLPAPER.md` §3.4 |
| 卡片细节三条（第 17 / 19 / 20 条） | ①收起态描述行与切歌键实测 `p≈0.06–0.45` 真的相交 ⇒ `lib/now-playing-math.js` 新增 `transportRow/sayRect/sayRowBandsMeet`，纵向相交时 `sayWidth` 收口到传输键左缘前 8px；②曲目档 prev/next **只改下标**（环形），视频档 no-op 且壁纸媒体 `{t,paused,src,plays,pauses}` 前后逐字段相同；③video 档 `kind:'video'`/`trackCount=1`/`byline` 带 `1/1`/`canVolume` 取 `mozHasAudio\|audioTracks`（判不出给 `null` 不禁用）/`POST /media-audio` 的 `source='video'` | np-control-test **101/0**（T/U/V 组全枚举：**101/101 不相交**、旧公式对照 27 个采样重叠；V 组逐字段比对） |

**发布前置读数**：`bash tools/check.sh` ⇒ **全部通过 ✓（12/12）**；`node tools/integrity-check.mjs` ⇒ **72/0**；
`node tools/secret-scan-test.mjs` ⇒ 干净（126 tracked 文件 / 凭据 0 / 本机绝对路径 0 / 白名单无腐烂）；
`tools/wallpaper-lifecycle-test.mjs` **184/0**、`tools/np-media-test.mjs` **91/0**、`tools/np-control-test.mjs` **101/0**、
`tools/thumb-chain-test.mjs` **26/0**、`tools/web-wallpaper-test.mjs` **429/0**、`tools/web-probe-test.mjs` **26/0**、
`tools/audio-scan-test.mjs` **79/0**、`tools/scene-audio-route-test.mjs` **37/0**、
`tools/np-seek-live-probe.mjs --selftest` ⇒ **PASS=8 / FAIL=0**（纯判据，未起浏览器、未写设置）。

**诚实清单（本轮）**
1. **P0 的真机那一次还没跑**：宿主（`:3080`）读的是 profile 安装副本，`update-plugin.sh` 同步 + 宿主重载之后才作数；
   在此之前 `tools/np-seek-live-probe.mjs` 的 P0 会**直接红**并把"STALE INSTALL / 旧代码"打在读数里（不假装通过）。
2. **`.wea` 故意不加**（来历不明、浏览器不解码，加了只会"列出来放不响"）；`.wma` 同理，除非有人明确要。
3. `/custom-media`、`/library-media` 只做**后缀兜底**（读头会拖慢视频首帧）；带字节双判的是 `/raw` 与 `/custom-folder`。
4. `tools/token-namespace-test.mjs` 的 before 基线取自 `git show HEAD:lib/client.js` ⇒ 本次提交后它退化为"自比"
   （末尾的变异自证仍有分辨力）；下一轮把 before 钉到固定 rev（`tools/dir-picker-test.mjs` 已有先例）。

**发布后验证（真机 `:3080`，2026-09-21）**：宿主副本用工作区 `update-plugin.sh` 整目录同步（13 文件 md5 一致，
顶层 6 文件在内）后，`node tools/np-seek-live-probe.mjs` ⇒ **PASS=11 / FAIL=0**：
`__mpwNpTest.mediaTarget` 在位且 `kind=video`、卡片 `total=20 == round(video.duration=20.015)`、
点轨道 90% ⇒ `currentTime/duration=0.895`、50% ⇒ `0.519`、游离 `<audio>` 未被带着跳、
`__mpwNpOps` 最近一次 seek 落点 `video.seek=10.01`、拖动后 2.5 秒位置只前进（10.396 → 12.958，未回到开头）。
**探针自身也修了两处假红来源**（这一轮跑出来的）：
① 卡片收起时整张被"换形状"命中区 `button.mpw_np_tap` 盖住 ⇒ 第一次点击的语义是展开而非 seek，
   旧探针把这种"根本没点到轨道"报成"比例算错"；现在先 `elementFromPoint` 判命中带、命中失败时先点一次展开，
   并打出"谁盖在上面"，另加 P2a/P3a"这一次点击**真的**推入了 `video.seek=` 落点"的分辨判据；
② `__mpwNpOps` 是**有界环形**（>32 条 shift）⇒ "落了几个 seek"不能用窗口内计数（上一次拖动就把窗口填满、差值恒 0），
   改判"日志是否前进"（长度/队首时间戳/最近落点三者任一变化）。

## 发布记录：3.12.0（2026-09-21 · WSL 盘符枚举 + 插件侧跨平台静态门禁）

**为什么是 minor**：这是**平台能力的新增**（WSL 上 Steam 装在 D:/E:/… 盘时，安装目录发现从"永远扫不到"变成能扫到），
外加一条新的常驻门禁；按 semver「加功能 = minor」取 **3.12.0**。

| 面 | 内容 | 判据读数 |
| --- | --- | --- |
| **WSL 安装目录候选** | `lib/index.js` 新增 `steamProbeDirs(env)`：`{platform, release, homedir, exists, procVersion}` 全部可注入（默认取 `process.platform` / `os.release()` / `os.homedir()`），返回去重后的字符串数组；`locateWallpaperEngine()` 改为 `probes.push(...steamProbeDirs())`，注册表那条路与 `libraryfolders.vdf` / `wallpaper32.exe` 判定逻辑一字未动 | 我独立复算：WSL 入参 **100 条**（含 `/mnt/d/SteamLibrary`、`/mnt/z/Steam`，仍含 `/mnt/c` 两条）、普通 linux **8 条且 `/mnt/d…z` 为 0**、win32 7 条 / darwin 8 条（含 macOS 根、无 linux 根泄漏）；四组均无重复；同参两次逐项相同；传一个会抛的 `exists` 也不影响返回 |
| **平台分支不动原有行为** | Windows 仍走注册表优先 + `STEAM_PROBE_DIRS`；macOS `~/Library/Application Support/Steam`、Linux/Android `~/.local/share/Steam`；两条 `/mnt/c/...` 作为历史遗留候选**不分平台**保留 ⇒ win32/darwin/linux/android 的候选集合与改动前**逐字节相同** | 门禁逐项断言"与改前历史表达式逐字节相同" |
| **插件侧跨平台静态门禁** | 新增 `tools/cross-platform-test.mjs`（**63 断言 / 1.2s**，无浏览器无网络；只扫 `git ls-files`，没有 git ⇒ 打印 SKIP 并 exit 0 不假装通过）：WSL 分支可判 + 三平台各自成根 + 纯函数纪律 + `/tmp` 字面量与五类宿主绝对路径"同行可覆盖"（存量 25 处逐条带理由的账本，**每条反查必须仍命中**）+ shell 可移植（9 种 bash 4+ 写法、shebang 与语法匹配）+ 文件名可移植 + BOM/CRLF + G 段合成反例必红 | **63 通过 / 0 失败**；两处**变异自证**：删掉盘符枚举 ⇒ exit=1（对照组 0）、把路径写死 ⇒ exit=1（对照组 0） |
| **顺带修 4 处** | `tools/_stub.mjs` / `tools/panel-smoke.mjs` 的默认设置文件路径由写死作者家目录改为 `os.homedir()` 推导（本机取值一字未变）；`tools/bundle-equivalence-test.mjs` 的"少一个导出"变异原来逐名写死导出面（新增导出后必假红）⇒ 改成从产物实际导出面去掉最后一个名字；README 中/英各一行指针与 WSL 描述同步 | `bash tools/check.sh` **12 步全绿**（新门禁在第 6 步内）、`tools/integrity-check.mjs` **72/0**、`tools/secret-scan-test.mjs` 干净 |

**诚实清单（本轮）**
1. 本机不是 WSL：WSL 分支只用**注入入参**断言（这正是把它做成纯函数的原因）；"真机 WSL 上 `/mnt/d` 确实存在并扫到 D 盘 Steam"
   **没有**在真 WSL 上跑过；`/proc/version` 兜底那条路也只喂了注入字符串/函数。
2. `locateWallpaperEngine()` 用上纯函数这件事是**源码级**断言（`probes.push(...steamProbeDirs())` + 旧常量消失 + 注册表在前），
   没有"假 WSL 树 → 扫到 wallpaper32.exe"的端到端用例（造 `/mnt/d` 要写宿主根目录，不适合由门禁做）。
3. 口径两处：注释行对 `/tmp` 与宿主路径都排除；"同行可覆盖"对两类统一适用，因此 `process.env.MPW_COOKIE || '/tmp/…'` 这类
   写法自动放行、未进账本（若要 `/tmp` 更严，收紧一处判断并补账本即可）。
4. 账本是**存量豁免**（25 条）而不是放行名单：条目必须仍命中否则判红，但它只保证"这一行还在且仍被该判据命中"，不保证语义永远成立。
5. 新门禁**没有**加进 `tools/pre-commit.sh`（该脚本只跑 panel-smoke + switch-wiring，且本机 `core.hooksPath` 未设置 ⇒ hook 未生效）。

## 发布记录：3.13.0（2026-09-21 · 缩略图单一事实源 + 卡片时间轴 + 壁纸层"有源无画"补画）

**为什么是 minor**：三条**用户可见**的行为修复（缩略图不再白块/白边、卡片时长与游标不再按常量画、
壁纸层"白了"能自己回来）+ 两条新的真机探针与两组常驻门禁；按 semver「加功能 = minor」取 **3.13.0**。

### 逐面读数（真机 `:3080`，同一条探针修前/修后各跑一次）

| 症状 | 真机读数（修前） | 根因 | 修法 | 真机读数（修后） |
| --- | --- | --- | --- | --- |
| ① 暂停键旁边的预览图：点一次「扫描该目录」变白块（中间写着 `mp4`），再点一次又好了 | `tools/scan-switch-live-probe.mjs --group thumb`：扫描 #1/#2/#3 后「当前壁纸预览」的稳定态 = `VIDEO`/`IMG(空白)`/`VIDEO`（**每次翻面**）；全时间线 **2501 拍**出现"媒体可见但没画出来" | 三个根因叠加：**(a)** `<img>` 的 `onLoad` 挂的是 `mpwThumbOk`，而 React 交下来的是**事件对象** ⇒ `parentElement` 为 undefined ⇒ **图的 onLoad 从来没有生效过**；**(b)** `<video>` 的 `onLoadedMetadata` 无条件 `mpwThumbOk` ⇒ 与图抢镜头，"谁最后跑谁说了算"；**(c)** 每次扫描无条件推进缓存纪元 ⇒ 11 张缩略图**全部重挂载 + 重发请求**（宿主串行解析容器，`/custom-mpkg-preview` 逐个 **199ms → 5597 → … → 11846ms** 递增） | 状态机收口成**单一事实源**：显隐由 `mpwThumbSync` 从"真的画出来了（img: `complete+naturalWidth`；video: `readyState≥2+videoWidth`）+ 候选优先级（图 > 视频首帧）"推导；事件只触发不写显隐；`mpwThumbOk/Next` 入参**既认元素也认事件**；媒体一律"先藏着"、出画才显示；缓存纪元改成**内容签名**（同一份清单重复扫描 ⇒ 键不动、节点不动、请求 0 次） | 扫描 #1/#2/#3 稳定态**完全一致**（`IMG:/custom-mpkg-preview?…mpkg` ×3）；"可见但没画" **0 拍**；扫描后列表出画 **10/10**（修前 0/10）；`PASS=10 FAIL=0` |
| ② 扫描出来的壁纸预览：左右各约 1/5 被切成白块 | 几何读数：容器自带预览是 **192×192**（`nat=192x192`），框是 `74×42`/`96×54`，`object-fit:contain` ⇒ 左右各留 **21.6% / 21.9%** ≈ 用户说的"各约 1/5"；留边露的是框底色（浅色主题实测 `background: color(srgb 0.976,0.980,0.984 / 0.63)`） | 上一轮为"不裁切"改的 `contain` 是对的，但**留白没有任何兜底** ⇒ 露框底色 | 留边交给**同一张图**的模糊铺满层：`mpwThumbSync` 选主人时把 `--mpw-thumb-cover` 写成该元素的 `currentSrc/src`，CSS `::before{background-size:cover;filter:blur(6px)}` 铺满；视频档只在"画幅与框不一致"时把当前帧画进 32×18 画布当底色（画不出就如实退化成留边） | 每个出画框 `cover=set`（11/11）；像素口径 `white=false`（左右竖条不再是与底色一致的纯色块）；`object-fit` 仍是 `contain` ⇒ **不裁切**（T5 绿） |
| ③ 扫描 + 切档之后背景壁纸"白色的、什么都没有"，点一下 Now Playing 进度条又出来了 | **无头环境未复现**（修前/修后都是切档后 3s 内 `rs=4/vw=3456`，像素贡献 37/255）。但抓到了**机制**：扫描那一刻 10 张缩略图把宿主占满（`/custom-mpkg-preview` 5.6s→11.8s 串行），壁纸自己的媒体请求排在其后；救回来的路径是 NP 那条 `showVideoEl + prime(played)`（`__mpwNpOps` 留痕）。旧兜底 `mpwBgArmedNow` 只判"**有没有 src**" ⇒ "有 src、但一直没画面"这一档**永远不会被补** | 兜底判据缺一档 + 扫描把宿主占满 | ① 去掉无谓请求（容器不给 `<video>` 候选、同内容不重发）⇒ 扫描后宿主不再饱和；② 补画校验分两档：快判 1.2s（没有 src ⇒ 补挂，既有行为）与**慢判 12s**（有 src 但 `readyState<2 / videoWidth=0` ⇒ **强制重挂一次**，同签名只做一次）；转码档、用户暂停、省电暂停、页面在后台**豁免**（不打断它们） | 切档后 3s 内 `painted=true`（B1 绿）；`heal=0`（这次没轮到它）；新增门禁 PART 5 七条（含"退化回只看 src 必红"的对照） |
| ④ 音频时长读成 3 分 30 多秒；点音频条只跳到整条的一半 | `tools/np-axis-live-probe.mjs`（视频档，媒体 = `#mpw-bgVideo` **100.053s**）：`aria-valuemax=100` ✅ 但卡片写 `0:04 −3:28`（= 214−5.8）、进度条只画 **2.50%**（应 5.84%）；拖到 90% 媒体确实到 **89.5%** 而**游标只画到 41.8%**（= 90/214）⇒ 用户原话"点一下只跳到一半" | **显示轴是常量**：`lib/now-playing-math.js` 的 `runPct/remain` 无条件用上游演示常量 `TOTAL = 214`（3.11.0 修的是**数据目标** `npMediaTarget`，所以数据面一直绿） | `axisOf(total)` + `runPct(at,total)` / `remain(at,total)`：夹取、进度条填充、"−剩余"三处共用**控制器送进来的 `media.total`**（= 媒体元素自己的 duration）；`now-playing.js` 用 `M.axisOf(known ? media.total : null)`；`NowPlaying` 从工厂返回值导出，供无浏览器门禁直接对**产出的元素树**断言 | 视频档 **5 PASS / 0 FAIL**：`−1:39`（期望 99.3s）、填充 0.52%、拖 90% 后游标 **89.5%**；曲目档（`backgroundmuisc.mp3`）**6 PASS / 0 FAIL**，且 **ffprobe = 104.088s vs 元素 104.052s**（差 0.036s）⇒ 证明是"**显示错**"不是"元素时长真的错" |

### 门禁读数
* 新增/改写：`tools/thumb-chain-test.mjs` **39 通过 / 0 失败**（B 组新增容器候选、内容签名、优先级不抢镜头、`--mpw-thumb-cover` 同源；C 组改成"显隐只有 mpwThumbSync 里的 3 处写入、事件入口只许收起"）；
  `tools/np-control-test.mjs` 新增 **X 组**（显示面：填充/剩余/常量轴对照/演示档零回归/源码级必须带时间轴）；
  `tools/bgwrap-visible-test.mjs` 新增 **PART 5**（"有 src 无画面"两档校验 + 有界 + 转码豁免 + 分辨力对照）。
* 两条真机探针的 `--selftest`（20 与 9 条纯判据）**常驻 check.sh 第 2 步**：探针本身不进门禁，但"判据还有没有分辨力"必须常驻。
* `bash tools/check.sh` ⇒ **12 步全绿**（EXIT=0，零 `✗`；其中 thumb-chain **39/0**、np-control **91/0**、bgwrap **30/0**、lifecycle **186/0**、
  settings-persist 112/0、css-matrix 429/0、style-scope 285 OK/0 RED、token-namespace 12/0、bundle 对照 38/0）；
  `node tools/integrity-check.mjs` ⇒ **72/0**；`node tools/secret-scan-test.mjs` ⇒ 凭据 0 / 本机绝对路径 0 命中。

### 诚实清单（本轮）
1. **症状③没有无头复现**：修前/修后都在 3s 内出画。判据是"切档 20s 内必须真的在画"，**不是**"复现了用户那次白屏"；
   兜底那档（慢判 12s 强制重挂）只有**桩级**证据（PART 5 七条），真机上这一轮它一次都没触发（`heal=0`）。
2. 探针会**改用户的设置**（缩略图组要扫描、切档组要切档）：现在同时复原 localStorage 与宿主 `/settings`，
   并且 `--mode track` 还会把宿主进程内存里的"当前自定义目录"POST 回去；本轮开发过程中曾把宿主那份留在
   探针的目录上，已用 `POST /settings` + `POST /custom-dir` 复原为用户的 `小鸟游星野` 档（复核读数见提交记录）。
3. "白边"的**像素**口径受主题影响：无头这次是深色主题，左右竖条量到的是深色框底色（不是白）。
   几何口径（21.6% 留边）+ `cover=set` 是跨主题成立的判据；"浅色主题下就是白条"来自修前的 token 实测。
4. 视频档的底色层只在"画幅与框不一致"时才画（`<video>` 不能当 `background-image`）；一致时 `contain` 本来就铺满，
   不一致且画不出帧（跨源/被拒）时**如实退化成留边**，不伪造底色。
5. `loading="lazy"` 被去掉（元素"先藏着"时 Firefox 的惰性加载永不发请求 —— 真机读数 0 次 `/custom-mpkg-preview`）；
   代价是列表项变多时预览请求更早发出（每项一次小请求，已无容器字节那种大请求）。

---

## 发布动作与发布后验证补记：3.13.0（补记于 2026-09-22；内容面见上一节）

3.13.0 那一节的**内容**（改了什么、逐面真机读数、门禁读数）在上面；这里补的是**发布动作本身**：
版本号、提交哈希、npm 实测、发布时间。

**版本号提交**（`git log -S'"version": "3.13.0"' --oneline --all -- package.json` ⇒ `776b67b`）：

```
$ git log -1 --format='%H%n%ci%n%s' 776b67b
776b67b4ee26913f32059565272474fce24c6040
2026-09-22 01:19:58 +0800
fix(thumb/np/bg): 缩略图显隐单一事实源 + 卡片时间轴改用媒体时长 + 壁纸层"有源无画"补画（3.13.0）
$ git show 776b67b^:package.json | grep '"version"'    # 父提交
  "version": "3.12.0",
$ git show 776b67b:package.json | grep '"version"'
  "version": "3.13.0",
```

| 项 | 实测（命令 ⇒ 输出） |
| --- | --- |
| 发布时间（registry `time`） | `npm view dsh-mpkg-wallpaper time --registry=https://registry.npmjs.org/` ⇒ `'3.13.0': '2026-09-21T17:46:36.317Z'`（= **2026-09-22 01:46:36 +0800**，比版本号提交晚 **26 分 38 秒**）；`npm view … versions` ⇒ `… '3.12.0', '3.13.0', '3.13.1'` |
| 发布面 | `npm view dsh-mpkg-wallpaper@3.13.0 dist --registry=https://registry.npmjs.org/` ⇒ `fileCount: 16`、`unpackedSize: 2237392`、`shasum: 0b6e4074c7f57b3f602904e6bc8ae7194d7d247a` |
| **发布内容对应哪个提交**（不看 metadata，逐文件对拍） | `npm pack dsh-mpkg-wallpaper@3.13.0 --registry=https://registry.npmjs.org/` ⇒ `dsh-mpkg-wallpaper-3.13.0.tgz`（765 614 B，sha256 `91c298d1b9eb6d530090206ed6c01b372a30f4bde7047f00290892c47fe57ec8`）；解包 16 个文件与 **`f9e7210`（发布面与 `97e06b4`、`5325385` 相同）** 的 tree **16/16 逐字节相同**；与 `776b67b` 的 tree 差 **1 个文件**（`lib/audio-bus.js`，它在 `5325385` 才落盘） |
| 结论 | 3.13.0 的**版本号**由 `776b67b` 定，但**发布动作发生在它之后**（发布面 = `f9e7210` 时刻的树，`package.json` 仍是 `3.13.0`）⇒ 打 tag 时要在"版本号提交"与"可复现发布内容的提交"之间**明确选一个**（见文末） |
| tag | **未打**：本地 `git tag -l 'v3.13*'` 无输出、远端 `git ls-remote --tags origin 'v3.13*'` 无输出 |

## 发布记录：3.13.1（2026-09-22 · 帧内总线级静音接线 + 场景帧活档位分辨率）

**为什么是 patch**：3.13.0 之后落的 6 个提交里，两条是**用户可见的修复**（① Web 帧内"静音设置开着却还在响"的
总线级静音接线；② 场景帧此前**一个分辨率参数都不发** ⇒ 窗口物理像素超过 1920×1080 时画布被 CSS 放大出图、
任何场景包都糊），其余是配套探针与门禁 ⇒ 按 semver「修复 = patch」取 **3.13.1**。

| 提交 | 时间（+0800） | 一句话 |
| --- | --- | --- |
| `5325385` | 2026-09-22 01:22:23 | `feat(audio): 总线级静音内核 lib/audio-bus.js + 离线门禁（37/0），先落盘待接线` |
| `97e06b4` | 2026-09-22 01:25:28 | `test(live-probe): np-axis 探针补 --check-volume（共享面：音量拖完刷新不重置）并把 npVolume/npPaused 纳入复原校验` |
| `f9e7210` | 2026-09-22 01:46:56 | `chore(gate): 把 audio-bus-test 登记进 tools/check.sh（复用既有步骤，不新增 step 编号）` |
| `c1263a5` | 2026-09-22 02:41:07 | `feat(audio): 总线级静音接线进单文件产物（生成器 + 漂移门禁 + 接线门禁）` |
| `9133c0e` | 2026-09-22 02:56:50 | `fix(audio): 帧内总线模式提升为 1（真机探针抓到"帧里根本没静音"）+ 自上报真机探针` |
| `7e2f3ed` | 2026-09-22 11:41:54 | `fix(scene): 场景帧显式请求渲染器活档位分辨率（常规 &res=dpr / 低内存 &res=auto）` |

**相对 3.13.0 的发布面变化**（`git diff --stat f9e7210 7e2f3ed -- lib package.json`）：
`lib/client.js` **+523**、`lib/audio-bus.js` 8 行、`package.json` 版本号 1 行 —— **共 3 个文件**
（其余改动都在 `tools/`，不进发布面）。

**版本号提交与发布时间（实测）**

```
$ git log -1 --format='%ci' 7e2f3ed
2026-09-22 11:41:54 +0800
$ git show 7e2f3ed^:package.json | grep '"version"'   # 父提交
  "version": "3.13.0",
$ git show 7e2f3ed:package.json | grep '"version"'
  "version": "3.13.1",
$ npm view dsh-mpkg-wallpaper dist-tags --registry=https://registry.npmjs.org/
{ latest: '3.13.1' }
$ npm view dsh-mpkg-wallpaper version --registry=https://registry.npmjs.org/
3.13.1
$ npm view dsh-mpkg-wallpaper time --registry=https://registry.npmjs.org/ | grep 3.13
  '3.13.0': '2026-09-21T17:46:36.317Z',
  '3.13.1': '2026-09-22T03:43:51.328Z',      # = 2026-09-22 11:43:51 +0800（提交之后 1 分 57 秒）
$ npm view dsh-mpkg-wallpaper@3.13.1 dist --registry=https://registry.npmjs.org/
{ shasum: 'ed162e36c77bc5202839e1a290eab7f95fb00cfc', fileCount: 16, unpackedSize: 2268181, integrity: 'sha512-MwWINB4U…' }
```

**发布内容逐文件核对（不看 metadata）**：`npm pack dsh-mpkg-wallpaper@3.13.1 --registry=https://registry.npmjs.org/`
⇒ `dsh-mpkg-wallpaper-3.13.1.tgz`（776 385 B，sha256 `438fb2f1e5fa49d35b9313ffd8df81facb49429615d35d8ec2f4c2ff5dfa7c27`）；
解包 16 个文件与 **`7e2f3ed` 的 tree 逐文件 16/16 逐字节相同（0 个不同）** ⇒ **3.13.1 的发布内容 == HEAD `7e2f3ed`**，
提交与发布一一对应（复算脚本：对每个文件比 `git hash-object <解包文件>` 与 `git rev-parse 7e2f3ed:<路径>`）。

**版本钉住的读数（把 `7e2f3ed` 的 tree 导出到临时目录再跑，与工作区解耦）**：
`git archive 7e2f3ed | tar -x -C /tmp/…` 后 `node tools/audio-bus-test.mjs` ⇒ **39 通过 / 0 失败**
（3.13.0 发布面对应的 `f9e7210` tree 同法 ⇒ **37 通过 / 0 失败**，与 `5325385` 提交信息里的 37/0 一致）。

**诚实清单（本轮）**
1. `v3.13.0` / `v3.13.1` **都没有 tag**（本地与 GitHub 远端都无）—— 本文只给命令，**没有执行** `git tag`/`git push`。
2. **`bash tools/check.sh`（12 步，含无头 Firefox）与真机探针本轮未跑**（硬约束：不起浏览器、不跑全量套件）；
   上面只有**离线**门禁读数。
3. **发布后"用户侧真的装到 3.13.1"未核验**：本轮没跑 `dsh plugin update` / `update-plugin.sh`，也没起浏览器。
4. 测"工作区可发"旁证时（`node tools/integrity-check.mjs` ⇒ 72/0、`node tools/secret-scan-test.mjs` ⇒ 干净、
   `tools/audio-bus-test.mjs` ⇒ 60/0），工作区**已被另一条并行线的未提交改动覆盖**
   （`git status --porcelain` ⇒ `M lib/audio-bus.js`、`M lib/client.js`、`M lib/pkg-extract.js`、`M tools/audio-bus-test.mjs`）
   ⇒ 这三条**不代表 3.13.1 已发布内容**，只作"仓库当下可发"的旁证；本文里凡是钉 3.13.1 的读数一律用上面的
   `git archive 7e2f3ed` 干净树。

## 待打 tag：`v3.13.0` / `v3.13.1`（**命令已列，尚未执行**）

**实测缺口（2026-09-22 22:1x）**：

```
$ git tag -l 'v3.13*'                       # 无输出
$ git tag --points-at HEAD                  # 无输出（HEAD = 7e2f3ed）
$ git tag -l | wc -l                        # 21（最新 v3.12.0）
$ git ls-remote --tags origin 'v3.13*'      # 无输出（exit 0，远端也无）
$ git ls-remote --tags origin 'v3.12*'      # 对照：d18a363… refs/tags/v3.12.0 / 7e4d5d9… refs/tags/v3.12.0^{}
```

本仓 tag 先例：**annotated tag 指向「版本号提交」**（`v3.12.0` → `7e4d5d9` = `chore(release): 3.12.0 …`）。

**建议命令（由主对话统一执行；本文档不执行任何写 git 的操作）：**

```bash
cd <仓库根>
git tag -a v3.13.0 776b67b4ee26913f32059565272474fce24c6040 -m "3.13.0"
git tag -a v3.13.1 7e2f3eda94790699e70af9ebaccd217c5ca9eaa0 -m "3.13.1"
git push origin v3.13.0 v3.13.1
git tag -l 'v3.13*'; git tag --points-at HEAD    # 复核：v3.13.0 / v3.13.1，且 HEAD 上是 v3.13.1
```

| tag | 目标提交 | 理由 / 注意 |
| --- | --- | --- |
| `v3.13.0` | `776b67b4ee26913f32059565272474fce24c6040` | 版本号提交（`3.12.0` → `3.13.0`），与 `v3.12.0` → `7e4d5d9` 的先例一致。**注意**：该 tree **不含** `lib/audio-bus.js` ⇒ 这个 tag **不能逐字节复现已发布的 3.13.0 tarball**；若要求"tag 能复现发布内容"，改指 **`f9e7210`**（发布面与 `97e06b4`/`5325385` 相同，取三者中最晚、最贴近发布时刻的 `f9e7210`） |
| `v3.13.1` | `7e2f3eda94790699e70af9ebaccd217c5ca9eaa0` | = HEAD；已发布 tarball 与该 tree **16/16 逐字节相同**（本文档已复算）⇒ 无歧义 |

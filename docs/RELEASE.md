# 发布就绪清单（RELEASE.md）

> 为什么有这份文件：发布是**不可逆**动作（npm 撤不回，只能 deprecate 或补丁版），
> 而本仓库的门禁是"一条命令全量自检"（`bash tools/check.sh`，12 步）+ 一个发布完整性自检
> （`node tools/integrity-check.mjs`）。这份文件把**发布前置**、**确切命令**、**发布后验证**和
> **回滚**钉死成可复制的步骤 —— 照着跑就行，不靠记忆。
>
> 状态（2026-09-17）：本地 `package.json` = **3.7.2**；npm 官方 registry 上 `latest` = **3.7.1**
> （`npm view dsh-mpkg-wallpaper dist-tags --registry=https://registry.npmjs.org` ⇒ `{"latest":"3.7.1"}`）
> ⇒ 3.7.2 是一次**待发布**的版本。**是否发布由用户拍板；未确认前不要执行第 2 节。**

## 0. 版本号是否要动

- 规则：`package.json.version` 必须**严格大于**官方 registry 上的 `latest`（否则 `npm publish` 直接 403）。
- 现状：`3.7.2 > 3.7.1` ⇒ **保持不变**（无任何证据要求改号；本轮只加了工具/文档/测试，未改运行时行为）。
- 若在发布前又改了 `lib/*.js`：那属于行为变更 ⇒ 视改动性质决定 3.7.3 或 3.8.0，并**重跑第 1 节全部命令**
  （含 bundle 产物哈希，见第 3 节）。

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

期望值（2026-09-17 实测，供比对）：

| 检查 | 期望 |
| --- | --- |
| `bash tools/check.sh` | `全部通过 ✓`（退出码 0）。步数以当时 `grep -c 'step "' tools/check.sh` 为准：本项交付时 11 步（**第 11 步 = 单文件 bundle 等价性**），随后"样式作用域护栏"那条线把门禁扩到 12 步（第 12 步）。**2026-09-17 本轮 12 步实测：第 1–11 步全绿；第 12 步因 `docs/STYLE-SCOPE-GUARD.md` 账本指针失配而红（该线 WIP，与本项无关）** |
| `node tools/integrity-check.mjs` | `结果: 61 通过, 0 失败` + `✓ 插件完整性自检通过（配合 tools/check.sh 的 N 步门禁一起看）`（N 自动取自 check.sh，当前 12） |
| `npm pack --dry-run --json` | **22 个文件**；解包 **1.48MB**；tarball **491.8KB**；异常项 **(无)**（2026-09-17 本轮实测；`lib/client.js` 仍在被另一条线改，字节数会随客户端改动漂移，**文件数与异常项判据不变**） |
| 包内必需文件 | `lib/**`（15 个运行时 js 全在）、`icon.svg`、`cordis.patch.yml`、`README.md`、`README.en.md`、`THIRD-PARTY.md`、`LICENSE`、`package.json` |
| 包内**不得**出现 | `*.bak*`（如 `lib/client.js.bak-20260907`）、`tools/`、`docs/`、`screenshots/`、`dist/`、个人绝对路径、凭据字面量 |
| bundle 产物 | `dist/dsh-mpkg-wallpaper.bundle.mjs`，字节数与 sha256 见 `tools/probe-out/bundle-manifest.json` |

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
npm view dsh-mpkg-wallpaper version --registry=https://registry.npmjs.org      # ⇒ 3.7.2
npm view dsh-mpkg-wallpaper dist-tags --registry=https://registry.npmjs.org     # ⇒ {"latest":"3.7.2"}
# 真装一遍（另建临时 profile，别动用户的 web profile）
dsh plugin --profile relcheck add dsh-mpkg-wallpaper@3.7.2   # base-backed 初始化临时 profile + 安装
# 若要从内置模板起一个全新 profile：`--from-default-profile` 是 **boot** 旗标（不是 plugin 子命令）：
#   dsh --profile relcheck --from-default-profile web
```

GitHub 侧（可选，但方式四的用户需要它）：

1. `node tools/build-bundle.mjs` 生成 `dist/dsh-mpkg-wallpaper.bundle.mjs`；
2. 建 release（tag = `v3.7.2`），**附上该 .mjs**，并在 release 说明里贴
   `tools/probe-out/bundle-manifest.json` 里的 `bytes` / `sha256`（用户可自行复算：
   `sha256sum dist/dsh-mpkg-wallpaper.bundle.mjs`）；
3. 用户侧更新：`dsh plugin --profile web update dsh-mpkg-wallpaper` → 重启 `dsh web` → 浏览器 Ctrl+F5。

## 4. 回滚 / 出问题怎么办

- **不要** `npm unpublish`（24h 限制 + 会破坏已装用户的 lockfile）。
- 小问题：立刻发补丁版（3.7.3），并在 README「安装」处保留旧版安装方式说明。
- 严重问题：`npm deprecate dsh-mpkg-wallpaper@3.7.2 "原因 + 建议版本"`，同时让用户把 profile 里
  的依赖钉回 `3.7.1`（`"dsh-mpkg-wallpaper": "3.7.1"` 后 `pnpm --dir $DSH_HOME/profiles/web install`）。
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

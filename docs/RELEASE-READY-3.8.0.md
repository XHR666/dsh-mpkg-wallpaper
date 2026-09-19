# 发布就绪：`3.7.3 → 3.8.0`（一条命令就能发；**发布动作未执行**）

> 本轮（2026-09-19）只做**仓库内的发布准备与验证**：没有 `npm publish`、没有 `npm login`、
> 没有打 tag、没有 push。下面是"一条命令就能发"的全部前置证据、逐条命令、回滚方式和**诚实清单**。
>
> 命名说明：任务书给的示例文件名是 `RELEASE-READY-3.7.4.md`，同时授权"名字按你判断的下一版号"。
> **判断 = `3.8.0`**（理由见 §1），故本文件叫 `RELEASE-READY-3.8.0.md`。

---

## 0. 要用户确认的那一句

> **「3.7.3 已经在 npm 上了（`latest = 3.7.3`，本地版本号和它逐字节相同），所以现在直接发必然 403 ——
> 我建议把版本号改成 `3.8.0` 再发；你点头我就改 `package.json.version` 并执行
> `npm publish --registry=https://registry.npmjs.org/`，你不同意就一直不动。」**

**我没有改 `package.json.version`**（按硬约束"版本号先不要动"）。这是"一条命令就能发"目前**唯一的缺口**。

---

## 1. 版本号：必须 bump（这是阻塞项，不是建议项）

实测（2026-09-19，官方 registry）：

```bash
npm view dsh-mpkg-wallpaper dist-tags --registry=https://registry.npmjs.org   # ⇒ { latest: '3.7.3' }
npm view dsh-mpkg-wallpaper versions  --registry=https://registry.npmjs.org   # ⇒ … 3.7.0, 3.7.1, 3.7.2, 3.7.3
npm whoami --registry=https://registry.npmjs.org                              # ⇒ xferoni66
```

- **任务书的前提「线上 3.7.1」已过期**：线上 `latest` 是 **3.7.3**（`docs/RELEASE.md` §6 记录了
  2026-09-18 那次发布；本轮拉回真实 tarball 复核过，见 §3）。
- 本地 `package.json` 与**已发布**的 3.7.3 里的那份**逐字节相同**（均 1 736 B，md5 相同）
  ⇒ 版本号没动过 ⇒ `npm publish` 会被 registry 拒绝
  （`cannot publish over the previously published versions: 3.7.3`）。
- **建议 `3.8.0`（一行判据）**：本轮 WP-1（网页壁纸渲染/API 覆盖）+ WP-2（触摸链）在 3.7.3 之后新增能力，
  NP-1（Now playing 挂侧栏）还带来**新的设置键 `npNowPlaying`** ⇒ 按 semver「加功能 = minor」，
  且与本仓先例一致（`3.5.x → 3.6.0 → 3.7.0` 功能轮都走 minor）；
  *（若用户扣下 NP-1、只发 WP-1+WP-2，`3.7.4` 也说得通，但这两条同样是用户可见的新交互能力，minor 更如实。）*
- 登录态**本轮实测可用**（`xferoni66`）；但"该账号对这个包有没有 write 权限"**仍未证实**（见 §7）。
- `package.json` **没有 `scripts` 段**（实测 `scripts: (absent)`）⇒ 发布是纯打包上传，不会触发构建。

---

## 2. 发布前一分钟清单（逐条命令，按顺序）

```bash
cd <DSHAREA>/dsh-mpkg-wallpaper

# ① 改号（唯一需要人工的一步；改完 npm 包的数字会变，必须重跑 ②③）
#    把 package.json 的 "version": "3.7.3" 改成 "3.8.0"

# ② 两个秒级自检（无浏览器、无网络、只读；实测 72 通过 / 0 失败 + 扫描干净）
node tools/integrity-check.mjs      # 含内部那一次 npm pack --dry-run
node tools/secret-scan-test.mjs     # tracked 全量凭据 + 本机路径

# ③ 发布面复核（必须比对"文件数 + 异常项"，不要只看体积）
npm pack --dry-run --json --registry=https://registry.npmjs.org | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s)[0];
console.log('文件数',p.files.length,'| 解包',p.unpackedSize+'B','| tarball',p.size+'B');
console.log('版本',p.version);
const bad=p.files.filter(f=>/\.bak|\.tmp|\.orig|~$|^dist\/|^tools\/|^docs\/|liquid-glass/.test(f.path));
console.log('异常项:',bad.length?bad.map(f=>f.path).join(', '):'(无)');})"

# ④ 工作区：确认只带自己这一版的东西，别把别人的 WIP 发出去
git status --porcelain

# ⑤ 全量门禁（**重活，必须串行**；第 9 步起起无头 Firefox）
LOCK=/tmp/.mpw-gate.lock; [ -d "$LOCK" ] && LOCK=/tmp/.mpw-gate-lock.flock
exec 9>"$LOCK"; flock -n 9 || echo "锁被占：等"
pgrep -af "run-all-tests\.sh|tools/check\.sh"; bash tools/check.sh   # 期望：12 步全绿 RC=0

# ⑥ 发布（用户点头后才执行；**必须带 --registry**，本机默认是 npmmirror 镜像）
npm publish --registry=https://registry.npmjs.org/

# ⑦ 发布后：把 registry 上的真实 tarball 拉回来逐文件核对（不要只看 metadata）
mkdir -p /tmp/relcheck && (cd /tmp/relcheck && npm pack dsh-mpkg-wallpaper@3.8.0 --registry=https://registry.npmjs.org/)

# ⑧ 同步进本机 profile（脚本在工作区根、不在本仓库；整 lib/ + 6 顶层文件 + 逐文件 md5 校验 + patch 热重载）
bash <DSHAREA>/update-plugin.sh

# ⑨ 用户侧更新（方式一）：dsh plugin --profile web update dsh-mpkg-wallpaper → 重启 dsh web → 浏览器 Ctrl+F5
```

**本轮已跑到哪一步**：② ③ ④ 已跑（§4 §5）；**⑤⑥⑦⑧⑨ 未跑**（⑤ 要浏览器、⑥ 用户未点头、⑦⑧ 依赖 ⑥）。

---

## 3. 发布面证据（2026-09-19 实测 `npm pack --dry-run --json`）

```
文件数 14 | 解包 1660391 B = 1.583MB | tarball 562640 B = 549.5KB
异常项: (无)
```

| # | 字节 | 路径 |
| --- | --- | --- |
| 1 | 1 088 | `LICENSE` |
| 2 | 70 028 | `README.en.md` |
| 3 | 69 048 | `README.md` |
| 4 | 22 445 | `THIRD-PARTY.md` |
| 5 | 453 | `cordis.patch.yml` |
| 6 | 1 145 | `icon.svg` |
| 7 | **969 898** | `lib/client.js` |
| 8 | 209 865 | `lib/index.js` |
| 9 | **30 996** | `lib/now-playing-math.js` ← 本轮新增 |
| 10 | **50 401** | `lib/now-playing.js` ← 本轮新增 |
| 11 | 98 464 | `lib/pkg-extract.js` |
| 12 | 51 446 | `lib/web-interaction.js` |
| 13 | 83 378 | `lib/web-wallpaper.js` |
| 14 | 1 736 | `package.json` |

**白名单逐条核对**（任务书要求的 5 项 + 本仓既有的 3 项）：

| 要求 | 实测 | 判定 |
| --- | --- | --- |
| `lib/` | 7 个运行时 js 全在（`index` / `client` / `pkg-extract` / `web-wallpaper` / `web-interaction` / `now-playing` / `now-playing-math`） | ✅ |
| `cordis.patch.yml` | 在（453 B） | ✅ |
| `README.md` | 在（69 048 B） | ✅ |
| `README.en.md` | 在（70 028 B） | ✅ |
| `LICENSE` | 在（1 088 B） | ✅ |
| 新增件 `lib/now-playing*.js` | **都在**（30 996 + 50 401 B） | ✅ |
| `dist/` 不夹带 | 0 个 | ✅ |
| `tools/` 不夹带 | 0 个 | ✅ |
| `docs/` / `screenshots/` 不夹带 | 0 个 | ✅ |
| `*.bak*` 不夹带 | 0 个（`lib/client.js.bak-20260907` 被 `!lib/**/*.bak*` 挡住） | ✅ |
| 包内无本机绝对路径 / 密钥 | 见 §4 | ✅ |
| ~~`lib/liquid-glass/**` 在包内~~ | **不在包内**（`!lib/liquid-glass/**` + `!lib/liquid-glass-bundle.js` 有意排除） | ⚠️ **有意排除，见下** |

### ⚠️ 一处与任务书字面要求**相反**的地方（必须挑明）

任务书写"**必须**确认 `lib/**` 里所有运行期需要的文件都在（尤其 `lib/liquid-glass/**`…）"，
但实测 **`lib/liquid-glass/**`（9 个源文件）+ `lib/liquid-glass-bundle.js` 共 10 文件 / 236 517 B
被 `files` 的负向模式有意排除在发布面之外**。这不是漏配：

- 这是**用户已拍板**的决定（`docs/PUBLISH-SURFACE-LIQUID-GLASS.md` P-127：*"Liquid glass 移出发布面"*，
  理由是"少分发本包唯一一份 vendored 第三方码 ⇒ MIT 署名义务面消失"），并有**双向机器断言**钉住
  （`integrity-check` ⑨：那 10 个路径**不在**包里 ✅ **且**仓库内一个都不能少 ✅，本轮 72/0 两条都绿）。
- 从 npm 装出来的副本上，宿主 `/api/mpkg-wallpaper/lg/<file>.js` 路由会退化成 **404**
  （`lib/index.js:3460` 的 handler 内 `existsSync` 判空 ⇒ 优雅降级，注册期不读该目录）；
  包内**客户端 0 调用方**（`mpwWebIxMode` 之外，`liquid-glass` 在 `lib/client.js` 里 0 命中）。
  ⇒ 对 npm 用户**无可观测影响**；本机开发/演示/仓库内不受影响（文件都在仓库里）。
- **所以我没有"修"它**（把它加回发布面等于推翻用户的决定）。如果用户的本意是"液态玻璃也要随包发"，
  那是一句话的改动（删两条负向模式）+ 重跑 §2，但**需要用户再拍一次板**。

### 与线上 3.7.3 的差异面（逐文件 md5 + 字节，拉回真实 tarball 比对）

线上 3.7.3 tarball = 467 488 B / **12 文件 / 1 398 847 B 解包**（与 `docs/RELEASE.md` §6 记录一致）。

| 文件 | 线上 3.7.3 | 本地工作树 | 判定 |
| --- | --- | --- | --- |
| `cordis.patch.yml` | 453 | 453 | IDENTICAL |
| `icon.svg` | 1 145 | 1 145 | IDENTICAL |
| `LICENSE` | 1 088 | 1 088 | IDENTICAL |
| `package.json` | 1 736 | 1 736 | **IDENTICAL（⇒ 版本号没动过，403 的直接原因）** |
| `README.en.md` | 70 028 | 70 028 | IDENTICAL |
| `README.md` | 69 048 | 69 048 | IDENTICAL |
| `lib/pkg-extract.js` | 98 464 | 98 464 | IDENTICAL |
| `lib/client.js` | 863 211 | 969 898 | CHANGED **+106 687** |
| `lib/index.js` | 198 506 | 209 865 | CHANGED **+11 359** |
| `lib/web-interaction.js` | 24 815 | 51 446 | CHANGED **+26 631** |
| `lib/web-wallpaper.js` | 54 212 | 83 378 | CHANGED **+29 166** |
| `THIRD-PARTY.md` | 16 141 | 22 445 | CHANGED **+6 304** |
| `lib/now-playing-math.js` | — | 30 996 | **NEW** |
| `lib/now-playing.js` | — | 50 401 | **NEW** |
| **合计** | **12 文件 / 1 398 847 B** | **14 文件 / 1 660 391 B** | **+2 文件 / +261 544 B** |

差值自洽：`106 687 + 11 359 + 26 631 + 29 166 + 6 304 + 30 996 + 50 401 = 261 544` ✅

> 也就是说：**这次要发的不是"3.7.3 的补丁"，是 3.7.3 之后 8 个提交 + NP-1 的全部内容**
> （`docs/RELEASE.md` 新增那节列了用户可见变化、回退开关、已知限制）。

---

## 4. 密钥 / 隐私重扫：命中逐条判定

**A. 本仓既有扫描器（只扫 tracked）**

```bash
node tools/secret-scan-test.mjs
# 扫描 99 个 tracked 文件（文本 99 个；跳过二进制 0 / >4MB 0）· 凭据模式 12 条 · 本机路径模式 3 条
# 白名单 2 条（每条都断言"仍然命中"；当前 2 条命中）
# ✓ 敏感信息扫描干净：凭据 0 命中、本机绝对路径 0 命中、白名单无腐烂条目     RC=0
```

**B. 我补的发布面扫描（关键：它只扫 tracked，而 `npm pack` 会带上 untracked 文件）**

`secret-scan-test.mjs` 的口径是 `git ls-files`（= tracked）。但 `lib/now-playing.js` /
`lib/now-playing-math.js` **当前是 untracked**，而 `files: ["lib"]` 会**照发不误**
⇒ 扫描器对它们**是盲的**。所以我把 `npm pack` 报的**那 14 个真实出货路径**单独扫了一遍：

| 模式 | 出货文件命中 | 逐条判定 |
| --- | --- | --- |
| `npm_` | **0** | — |
| 本机工作区路径 | **0** | — |
| 设备共享存储根（Android shared storage） | **0** | — |
| Termux 私有目录 | **0** | — |
| `token` | **411** | **全部白名单（设计 token，不是凭据）**：`lib/client.js` 250 / `lib/index.js` 105 / `README.en.md` 20 / `README.md` 18 / `lib/now-playing.js` 11 / `lib/pkg-extract.js` 6 / `THIRD-PARTY.md` 1。逐个抽样看：全是 CSS 变量语义（`--dsw-*` / `--mpw-np-*` / `host token` / `token 覆盖`）与 `now-playing.js` 的 `NP_ROOT_COLLAPSED_TOKEN = "collapsed"`、`classHas(el, token)` 这类**标识符**。 |
| `secret` | **1** | **假阳性**：`lib/index.js:2705` `const SANDBOX_TOKEN_SECRET = crypto.randomBytes(32);` —— **宿主每次启动随机生成**、不落盘、不是字面量凭据。 |
| `_authToken` / `authToken=` / `Bearer ` / `PRIVATE KEY` / `ghp_` / `AKIA…` / `password=` / `api_key=` | **各 0** | — |

**C. 全仓（不只出货面）扫描 + 逐条判定**

| 模式 | 全仓命中 | 判定 |
| --- | --- | --- |
| `npm_` | **1**：`tools/secret-scan-test.mjs:57` | **扫描器自身模式字面量** `/\bnpm_[A-Za-z0-9]{36}\b/`（要求 36 位，故不自指命中）。**不是泄漏**，且 `tools/` 不入包。 |
| 本机工作区绝对路径 | **12**，全在 `tools/**` | 分两类：**①检测模式本身** 6 条（`integrity-check.mjs:8/61/63/162`、`secret-scan-test.mjs:97`——后两条刻意把 把一个本机工作区绝对路径拆成片段以免自指）；**②开发机真实默认路径** 6 条（`_stub.mjs:199`、`panel-smoke.mjs:141`、`hdr-probe.mjs:14`、`better-sidebar-compat-test.mjs:291`、`dir-picker-probe.mjs:261/266`、`bs-bottom-panel-probe.mjs:51`）。**②确实是本机路径，但**：`tools/**` **不入 npm 包**（`files` 白名单里没有）、且它们是 `DSH` 标准路径（`/root/.dsh/…`）而非个人标识；`hdr-probe.mjs:14` 那条只是**提到** `/root/.dsh/.credentials.yaml` 这个路径，**没有**任何凭据内容。判定 = **隐私面白名单（研发工具，不入包）**，非泄漏。 |
| 设备共享存储根（Android shared storage） | **0** | — |
| Termux 私有目录 | **0** | — |

> 为什么 `/root/.dsh/…` 没被本仓门禁判红：`integrity-check` ⑩ 与 `secret-scan-test` 的本机路径模式
> 只针对 **本机工作区绝对路径**（`<DSHAREA>`）+ 设备共享存储 + Termux 私有目录三种；
> `/root/.dsh/…` 是**每台机器都一样的 DSH 标准路径**，按设计不拦（⑩ 三轮全绿）。

**结论：真泄漏 0 条；白名单/文档示例 411 + 6 + 2 + 1 条；需要动作的 0 条。**

---

## 5. 冒烟与自检（真实输出）

```bash
node -e "import('./lib/index.js').then(m=>console.log(Object.keys(m).sort().join(', ')))"
# ⇒ LOADED OK
# ⇒ __mpwTest, apply, inject        ← 导出形状与 3.7.3 发布记录**逐字相同**，没变
# PeakRSS 50.2 MB（VmHWM 51 448 kB）

node tools/integrity-check.mjs
# ⇒ 结果: 72 通过, 0 失败
# ⇒ ✓ 插件完整性自检通过（配合 tools/check.sh 的 12 步门禁一起看）
# ⇒ RC=0；PeakRSS 58.0 MB（含它自己 spawn 的 npm pack 子进程）
```

- 说明：任务书示例是 `node -e "require('./lib/index.js')"`，但本包 `"type": "module"`
  ⇒ 用本仓惯用/`RELEASE.md` 记过的 **`import()`** 方式（`require()` 在 ESM 下不是这条路径的惯用法）。
- 内存：两次都远低于 250 MB 上限；跑前 `free -m` 复核过（可用 6.4 GB），全程**同一时刻只跑一个 node 进程**，
  **没有起浏览器**。
- `integrity-check.mjs` 的 ⑨b 确认门禁是 **12 步**（13 个 `step` 标签 / 分母一致 / 序号 1..12 单调）。
- **`bash tools/check.sh` 本轮未跑**（第 9 步起要无头 Firefox，本轮硬约束"不起浏览器"）⇒ 见 §7。
- **`tools/now-playing-test.mjs`（NP-1 的漂移门禁）本轮未跑**：它属于另一条线正在收尾的文件，
  且 NP-1 的源/生成区在本次扫描时**正在被改**（`lib/client.js` 处于 `M` 状态）。

---

## 6. 回滚方式

发布后出问题（**不要** `npm unpublish`：24h 限制 + 会破坏已装用户的 lockfile）：

```bash
# 方式 A（最快、不动包内容）：把 latest 指回已知 good 版本 —— 只影响"新装/默认档"的用户
npm dist-tag add dsh-mpkg-wallpaper@3.7.3 latest --registry=https://registry.npmjs.org
npm view dsh-mpkg-wallpaper dist-tags --registry=https://registry.npmjs.org    # 复核 ⇒ { latest: '3.7.3' }
# 已经升级到坏版本的用户仍停在坏版本 ⇒ 还得让他们钉版本（下一条）

# 方式 B：让用户把 profile 里的依赖钉回 3.7.3
#   "dsh-mpkg-wallpaper": "3.7.3"   然后： pnpm --dir $DSH_HOME/profiles/web install

# 方式 C（推荐同时做）：标记坏版本 + 立刻发补丁版
npm deprecate dsh-mpkg-wallpaper@3.8.0 "原因 + 建议升到 3.8.1" --registry=https://registry.npmjs.org
#   然后改 package.json.version = 3.8.1 → 重跑 §2 的 ②③ → npm publish

# 方式 D（本机开发档回退）：profile 副本是从**仓库源码**同步的
git checkout <上一个 good 提交> && bash <DSHAREA>/update-plugin.sh
```

**还没发布之前要撤回**（= 只想取消这次发布）：什么都不用做 —— 包没上 registry，`npm dist-tag` 也无从谈起；
只要**不发**就行（这也是本轮的状态）。

---

## 7. 诚实清单（没核到的 / 发布时才会暴露的）

**A. 没核到的**

1. **`bash tools/check.sh`（12 步门禁）本轮未重跑** —— 第 9 步起要无头 Firefox，本轮硬约束禁止起浏览器。
   ⇒ "12 步全绿"是**上一轮（3.7.3 发布时）的记录**，本轮只有 `integrity-check` 72/0 + `secret-scan` 干净作证。
   发布前**必须**在能跑浏览器时补跑一次（§2 第 ⑤ 步）。
2. **NP-1 尚未提交**（`lib/now-playing*.js` untracked、`lib/client.js`/`THIRD-PARTY.md`/`tools/check.sh`/
   `tools/token-namespace-test.mjs` modified）—— 另一条线收尾中。本轮**没有碰这些文件**。
   ⇒ 它的漂移门禁（`tools/now-playing-test.mjs` N 段 + `check.sh` 第 2 步）**本轮未跑**；
   发布内容以它**最终落盘的字节**为准，本文件的 14 文件清单是**扫描那一刻**的快照。
3. **`npm publish` 的 write 权限未证实**：`whoami` = `xferoni66` 实测可读，但"该账号对这个包有没有 write"
   只能真发一次或看 npm 包设置页才知道（3.7.3 是这个账号发的 ⇒ 大概率有）。
4. **`npm pack` 的数字会漂移**：`lib/client.js` 正被另一条线改（NP-1），文件数/字节**以发布前那一刻的
   重跑为准**（§2 第 ③ 步）。判据是"**异常项 (无)** + 14 个文件里该有的都在"，不是死记 1 660 391 B。
5. **真机观感未验证**：触屏手势是否被浏览器抢走、NP 面板在窄侧栏下的排版、WP-1 的存储 facade 在真
   Live2D/Spine 壁纸上的效果 —— 都要用户在自己设备上确认（本轮不起浏览器、无真机）。
6. **方式四（单文件 bundle）本轮未重建**（`dist/` 不入库）；它的等价性对拍（38/0）是上一轮的记录。
7. 任务书说"线上 3.7.1"，**实测线上是 3.7.3**（§1）—— 凡是基于"3.7.1"的判断（含"差异面"）都应以
   本文件 §3 的**3.7.3 对拍表**为准。

**B. 只有"发布那一刻/发布之后"才会暴露的风险**

1. **版本号撞车 403**：只要 `package.json.version` 不改，`npm publish` **必然**失败（§1）——这是**唯一**的
   确定性阻塞项。
2. **untracked 文件照发**：`files: ["lib"]` 会把 `lib/` 下**所有**文件（含 untracked）打进包，
   而 `secret-scan-test.mjs` 只扫 tracked ⇒ **"扫描干净"不等于"出货面干净"**。本轮的补偿是 §4.B
   那次**按 pack 清单**的定向扫描（14/14 路径覆盖）。**若 NP-1 在发布前又改了这些文件，这次扫描即失效，必须重扫。**
3. **首次真实安装的运行时解析**：`lib/client.js` 被宿主**按单文件整体下发**、里面有 72 KB 的 NP 生成区，
   且 `integrity-check` ⑩ 断言"0 处相对 import/require" ✅。但"从 registry 装出来的副本在真宿主里能否
   正常加载客户端半"只能**真装一遍**才知道（§2 第 ⑦ 步的临时 profile）。
4. **`latest` 标签一改就影响所有新用户**：本包是**非 scoped**、不带 `--tag`，`npm publish` 直接移动 `latest`；
   而用户在 profile 里写的就是 `dsh-mpkg-wallpaper`（解析 `latest`）⇒ 没有"先发到 next 试水"的缓冲
   （除非显式 `--tag next`，但那样 `dsh plugin add dsh-mpkg-wallpaper` 装不到）。
5. **`/lg` 路由在 npm 副本上是 404**（P-127 的既定后果）：静态读码证明"优雅降级"，但**没有 HTTP 实测**
   （本轮禁止起浏览器；`curl` 一次即可，留待发布后）。
6. **中文 README / 英文 README 在包内是双份**（69 KB + 70 KB ≈ 139 KB，占解包体积 8.4%）——
   不是风险，只是提醒：真正的运行时代码是 `lib/` 的 1.44 MB，其中 `lib/client.js` 一个文件占 969 KB。

---

## 8. 本轮改动清单（提交只含这两个文件）

| 文件 | 改什么 |
| --- | --- |
| `docs/RELEASE-READY-3.8.0.md` | 本文件（新增） |
| `docs/RELEASE.md` | ①头部状态 + §0 版本判断改成 **3.7.3 已发布 / 必须 bump / 建议 3.8.0**；②§1 期望值表换成 **2026-09-19 实测**（14 文件 / 1 660 391 B / 562 640 B、integrity 72/0、secret-scan 干净）并把"未重跑"的行**标明**；③§3 版本号参数化 + 新增 §3.1 **三种装载方式 + 发布后各自怎么更新**；④§4 回退补上 `npm dist-tag` 与"仓库回滚 + update-plugin.sh"；⑤新增 **`## 3.7.3 → 下一版（待用户点头）`** 一节（WP-1/WP-2/NP-1 的用户可见变化 + 回退开关 + 已知限制 + 默认行为自查） |

**未改**（硬约束内、属于另一条线的文件一个都没碰）：`lib/client.js`、`lib/index.js`、`tools/check.sh`、
`tools/token-namespace-test.mjs`、`tools/build-now-playing.mjs`、`tools/now-playing-test.mjs`、
`docs/NOW-PLAYING-DSH.md`、`THIRD-PARTY.md`、`docs/COPYING-RULES.md`、`package.json`（版本号**没动**）、
`tools/integrity-check.mjs`（**只读式**跑了一次，未改）。

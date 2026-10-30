# BENCH-8901-DEPLOY —— `:8901` 测试台「部署树 vs 仓库 `demo/`」的一致性与形态判定

> 用户第 4 条要求核实：「`:8901` 那份界面」的部署树到底跟仓库 `we-scene-demo/demo/**` 一不一致、要不要同步。
> **结论先给**：`references/vendor-ref/ww-pages/WEwebLoader` 与 `…/wallpaper-engine-webgl` **都是软链**，
> `realpath` 落在 `we-scene-demo/demo`，`dev:ino` 与仓库侧**完全相同** ⇒ **同一棵目录树**。
> P-142 改的 `demo/index.html` / `bench-patch.js` / 新增的 `mpw-select.js` / `mpw-select-math.mjs`
> **已经**就是 `:8901` 在吐的字节（逐文件 md5 实测相等，见 §5）⇒ **本机不需要任何"同步"动作**。
> 但这**不是可以靠记忆的结论**：该挂载点被重建过两次（09-17、09-18），一次 `cp -r` 就会让它变成实体副本。
> ⇒ 判据与一条命令固化在 **`tools/bench-8901-sync.mjs`**（`--check` 只核不写，漂移 ⇒ 退出码 1）。

* 工具：`tools/bench-8901-sync.mjs`（零依赖，流式 md5，内存闸门）
* 服务：`references/vendor-ref/ww-pages/serve-8901.mjs`（静态根 = 该目录，挂载点 `WEwebLoader`）
* 实测日期：2026-09-19（CST）；服务器 pid 4189（本轮重启，见 §5.3）

---

## 1. 形态判定（先判形态，再谈对账 —— 顺序不能反）

### 1.1 证据命令与输出（原样粘贴）

```console
$ ls -la references/vendor-ref/ww-pages/
lrwxrwxrwx. 1 root root     22  9月 18 22:55 index.html -> WEwebLoader/index.html
lrwxrwxrwx. 1 root root     27  9月 18 22:55 WEwebLoader -> ../../../we-scene-demo/demo
lrwxrwxrwx. 1 root root     27  9月 17 06:34 wallpaper-engine-webgl -> ../../../we-scene-demo/demo
-rw-------. 1 root root  91110  9月 17 02:37 PATCH-NOTES.md
-rw-------. 1 root root 149576  9月 18 23:09 bench-patch.test.mjs
drwxr-xr-x. 2 root root   3452  9月 17 02:31 probes/
-rw-------. 1 root root   5577  9月 18 23:53 serve-8901.mjs
drwxr-xr-x. 3 root root   3452  9月 15 06:17 webwallgl/

$ readlink -f WEwebLoader wallpaper-engine-webgl index.html      # 在 ww-pages/ 下
<DSHAREA>/we-scene-demo/demo
<DSHAREA>/we-scene-demo/demo
<DSHAREA>/we-scene-demo/demo/index.html

$ stat -c '%i %h %s %y %n' WEwebLoader/index.html wallpaper-engine-webgl/index.html \
      <DSHAREA>/we-scene-demo/demo/index.html
1916745 1 80582 2026-09-19 02:06:09.969977701 +0800 WEwebLoader/index.html
1916745 1 80582 2026-09-19 02:06:09.969977701 +0800 wallpaper-engine-webgl/index.html
1916745 1 80582 2026-09-19 02:06:09.969977701 +0800 <DSHAREA>/we-scene-demo/demo/index.html

$ stat -c '%i %h %s %y %n' WEwebLoader/mpw-select.js WEwebLoader/bench-patch.js
2183058 1 13456 2026-09-19 04:14:57.513999485 +0800 WEwebLoader/mpw-select.js
2176459 1 300528 2026-09-19 04:14:57.521999485 +0800 WEwebLoader/bench-patch.js
```

### 1.2 判据（三条，全过 = 同一棵树）

| # | 判据 | 实测 | 
|---|---|---|
| ① | `lstat` 部署挂载点是**软链** | `isLink = true`（两条挂载点都是 27 字节的相对软链） |
| ② | `realpath(部署) == realpath(仓库 demo)` | 两侧都是 `<DSHAREA>/we-scene-demo/demo` |
| ③ | `stat` 的 **dev:ino** 相同 | 两侧同为 `65099:2170505`（目录）；`index.html` 三路径同为 inode `1916745` |

* ①+②+③ 全过 ⇒ 形态 = **`symlink-same-tree`**（同一棵目录树）。
* 反面判据（**出现任一条就说明变成了实体副本，需要同步**）：① 不是软链；② `realpath` 不等于仓库 `demo`；③ `dev:ino` 不同。
  工具把它们判成 `separate-copy`，`--check` 会红（退出码 1），不带 `--check` 才写入。
* 软链是**相对路径**（`../../../we-scene-demo/demo`）⇒ 工作区整体搬家不会断，无需绝对路径修补。
* 硬链接数 `%h = 1` 是**正常**的、**不是**"两份拷贝"的证据：文件只有一个 inode（同一份），
  被三条路径经软链访问；`%h` 统计的是"直接指向该 inode 的目录项数"，与软链无关。
  ⇒ **判形态只看 dev:ino 与 realpath，不要拿 `%h` 当判据。**

---

## 2. 「改了 `demo/` 之后要不要同步？」——结论与判据

**结论：本机 `:8901` 不用同步（一个字节都不用复制）；Pages 产物 / 线上必须重新构建。**

| 消费面 | 形态 | 改了 `demo/` 之后 | 判据 |
|---|---|---|---|
| **本机 `:8901`**（`references/vendor-ref/ww-pages/`） | **软链** → `we-scene-demo/demo` | **什么都不用做**，刷新页面即最新 | §1.2 三条全过 |
| **`build-pages.mjs` 的产物**（`OUT/`） | **真实拷贝**（产物里 `demo/` 与 `WEwebLoader/` 两份，见 `build-pages.mjs:18/153`） | **必须重跑构建** `node build-pages.mjs`；解引用软链（`demo/samples → ../samples` 在产物里必须是真文件，`build-pages.mjs:126`） | `realpath` 不同 ⇒ `separate-copy` |
| **线上 GitHub Pages** | 构建产物上传 | 同上一行（重新构建 + 发布） | 同上 |
| **`references/vendor-ref/webwallgl/`**（另一个 vendored 仓库，**不是** `:8901` 的静态根） | 其中 `bench-patch.js` 是指向 `../ww-pages/wallpaper-engine-webgl/bench-patch.js` 的软链（49 字节） | 不用做；它透传到仓库 `demo/bench-patch.js` | `readlink -f` ⇒ `we-scene-demo/demo/bench-patch.js` |

**为什么本机可以"永久不用同步"**：静态根里的挂载点不是拷贝，是**同一棵树的另一条路径**。
`serve-8901.mjs` 读文件时走 `realpathSync`（`:63`），所以软链被正常跟随 —— 服务端看到的字节 = 仓库的字节。

**为什么仍然要留一条检查命令**：这个挂载点**被重建过两次**（`wallpaper-engine-webgl` 于 09-17 06:34、
`WEwebLoader` 与 `index.html` 于 09-18 22:55 重新建过软链）。任何一次"为了省事 `cp -r`"都会把它变成实体副本，
此后**测试台会静默落后于仓库**（症状：新脚本 404 / 浏览器跑旧 `bench-patch.js`，而 `curl /` 仍 200，
看起来一切正常）。这条命令就是那个"静默"的探针。

### 2.1 改完 `demo/` 之后的两条动作

```bash
# ① 一致性（秒级；同一棵树形态下连哈希都不做）
cd <DSHAREA>/we-scene-demo
node tools/bench-8901-sync.mjs --check --serve      # 0 = 无漂移；1 = 有漂移

# ② 若 ① 报 separate-copy 漂移：先看清单，再同步（只新增/覆盖，绝不删部署侧独有文件）
node tools/bench-8901-sync.mjs --check              # 只报差异
node tools/bench-8901-sync.mjs                      # 写入 + 逐个 md5 复核 + 写完自检
node tools/bench-8901-sync.mjs --check              # 必须回到 0
```

---

## 3. `tools/bench-8901-sync.mjs`

### 3.1 用法与退出码

```console
$ node tools/bench-8901-sync.mjs --check              # 只核不写
$ node tools/bench-8901-sync.mjs --check --serve      # 追加：HTTP 字节 == 磁盘字节 + 旧名 302 + no-store
$ node tools/bench-8901-sync.mjs                      # 报告 + 同步（仅 separate-copy 形态会写）
$ node tools/bench-8901-sync.mjs --json               # 机器可读
# 附带开关：--hash-large（≥5MB 也哈希）、--force（无视内存闸门）
```

| 退出码 | 含义 |
|---|---|
| `0` | 无漂移（`separate-copy` 下「部署侧独有」**不算**漂移，只登记） |
| `1` | **有漂移**（仅在仓库 / 内容不同 / `--serve` 自证不过） |
| `2` | 用法错或硬错误（缺目录、内存低于红线、`hash` 失败、拷贝后 md5 不符） |

环境变量：`BENCH_8901_ROOT`（部署静态根）、`BENCH_8901_MOUNT`（默认 `WEwebLoader`）、
`BENCH_8901_URL`（默认 `http://127.0.0.1:8901`）、`BENCH_8901_WORKSPACE`、
`BENCH_8901_REPO`（**仅供工具自测/异地部署**：没有它就没法在 `/tmp` 造小夹具验 `separate-copy` 分支，
否则每次自测都要哈希真实的 65MB 树）、`BENCH_8901_MIN_AVAIL_MB`（内存红线，默认 3000）。

### 3.2 内存纪律（用户明确要求：单进程、PeakRSS ≤ 400MB）

| 措施 | 实现 |
|---|---|
| 同一棵树形态**零哈希** | 形态判定命中即返回，不遍历、不哈希（**本机现状走的就是这条**，全程 0.07s） |
| 流式 md5 | `createReadStream` 64KB 一块，一次一个文件，不把内容读进内存 |
| ≥5MB 文件默认**只比 size** | 列出来给你看（`demo/` 里只有 1 个：`now-playing/node_modules/lucide-react/dist/cjs/lucide-react.js.map` 7.3MB），要真哈希加 `--hash-large` ⇒ 避免一把梭把几十 MB 拖进 page cache |
| 跑前内存闸门 | 读 `/proc/meminfo` 的 `MemAvailable`，**< 3000MB 直接拒跑**（退出码 2），`--force` 才继续 |
| 拷贝边拷边核 | 逐文件 `copyFile` 后立刻 md5 比对，不符即退出码 2（不做"拷完再整体验"的乐观假设） |
| 实测 PeakRSS | `--check --serve` 全程 **91MB**（自读 `/proc/self/status:VmHWM`）；只 `--check` 时 **48MB** |

### 3.3 本工具自身的实测（10 项，含 RED→GREEN）

| # | 场景 | 期望 | 实测 |
|---|---|---|---|
| ① | 真实一对 `--check` | 0 漂移 / 退 0 | ✓ `symlink-same-tree`，0 漂移，EXIT=0 |
| ② | 真实一对 `--check --serve` | 0 漂移 / 退 0 | ✓ 4 个文件 md5 与磁盘一致 + 旧名 302 + `no-store`，EXIT=0 |
| ③ | 夹具 `separate-copy` `--check` | 2 个＋/1 个≠/1 个· / 退 1 | ✓ 全部命中，EXIT=1 |
| ④ | 夹具 `--check --hash-large` | 6MB 同 size 异内容现形 / 退 1 | ✓ `big.bin 内容不同`，EXIT=1 |
| ⑤ | 夹具同步（不带 `--check`） | 写 3 个 / 退 0 / 写完自检 0 漂移 | ✓ `已写入/覆盖 3 个文件（逐个 md5 复核通过）`，EXIT=0 |
| ⑥ | 同步后 `--check` | 0 漂移 / 退 0 | ✓ EXIT=0 |
| ⑦ | 部署侧独有文件 | **活下来** | ✓ `local-probe.txt` 仍在，内容 `probe` |
| ⑧ | 内存闸门（`BENCH_8901_MIN_AVAIL_MB=999999`） | 拒跑 / 退 2 | ✓ `✗ 宿主机 MemAvailable=6677MB < 999999MB 红线`，EXIT=2 |
| ⑨ | 同条件 `--force` | 照跑 / 退 0 | ✓ EXIT=0 |
| ⑩ | 未知参数 `--bogus` | 退 2 | ✓ `✗ 未知参数 --bogus`，EXIT=2 |

夹具配方（可复现，全在 `/tmp`、不碰仓库）：

```bash
FX=/tmp/bench-8901-fx; rm -rf "$FX"; mkdir -p "$FX/repo/sub" "$FX/deploy/WEwebLoader/sub"
printf 'same-content\n' > "$FX/repo/keep.txt";  cp "$FX/repo/keep.txt" "$FX/deploy/WEwebLoader/keep.txt"
printf 'v2-new\n'       > "$FX/repo/stale.txt"; printf 'v1-old\n' > "$FX/deploy/WEwebLoader/stale.txt"
printf 'brand-new\n'    > "$FX/repo/new.txt";   printf 'deep\n'   > "$FX/repo/sub/deep.txt"
printf 'probe\n'        > "$FX/deploy/WEwebLoader/local-probe.txt"
head -c 6000000 /dev/zero > "$FX/repo/big.bin"; cp "$FX/repo/big.bin" "$FX/deploy/WEwebLoader/big.bin"
printf 'X' | dd of="$FX/deploy/WEwebLoader/big.bin" bs=1 seek=5999999 conv=notrunc status=none
cd <DSHAREA>/we-scene-demo
BENCH_8901_REPO=$FX/repo BENCH_8901_ROOT=$FX/deploy node tools/bench-8901-sync.mjs --check  # ⇒ 1
```

---

## 4. `serve-8901.mjs` 的路由 / 302 规则（照代码 `:44-95` 复核）

| 请求 | 行为 | 代码 |
|---|---|---|
| `/` | 目录 ⇒ 拼 `index.html`（`rel.endsWith('/')`）⇒ ww-pages 下的 `index.html` 是**软链**到 `WEwebLoader/index.html` ⇒ 200 测试台 | `:57` |
| `/WEwebLoader/**` | 规范挂载点，读软链目标（仓库 `demo/`） | `:59-86` |
| `/wallpaper-engine-webgl` 或 `/wallpaper-engine-webgl/**` | **302** → `/WEwebLoader<rest>`，**query 原样透传**（`url.search`），`Cache-Control: no-store` | `:51-56` |
| 目录但无 `index.html` | 404 | `:66` |
| 路径穿越（规范化后逃出 `ROOT`） | 403 | `:60` |
| 所有响应 | `Cache-Control: no-store, must-revalidate`（这是本服务存在的唯一理由：`python3 -m http.server` 只发 `Last-Modified`，会出"新 HTML + 旧补丁"的混合体） | `:71/:82` |

实测（本轮）：

```console
$ curl -s -o /dev/null -w 'code=%{http_code} size=%{size_download}\n' --max-time 5 http://127.0.0.1:8901/
code=200 size=80582
$ curl -s -o /dev/null -D - --max-time 5 http://127.0.0.1:8901/wallpaper-engine-webgl/
HTTP/1.1 302 Found
Location: /WEwebLoader/
Cache-Control: no-store
$ curl -sL -o /dev/null -w 'code=%{http_code} redirects=%{num_redirects} url=%{url_effective}\n' --max-time 5 \
      http://127.0.0.1:8901/wallpaper-engine-webgl/
code=200 redirects=1 url=http://127.0.0.1:8901/WEwebLoader/
```

⚠ **`/` 与 `/WEwebLoader/` 是同一个文件**（`index.html` 软链），所以两条 URL 的 `Content-Length` 都是 80582 ——
这**不是**"两份产物"，是本机特有的软链形态。（Pages 产物那边 `/` 与 `/WEwebLoader/` 是**两份真实拷贝**，
且旧名只有三张极小重定向页；**别拿本机的 200 当线上也有真拷贝**，见 `serve-8901.mjs:16-20` 的说明。）

---

## 5. 本次实测：差异清单与最终 md5

### 5.1 差异清单：**启动时 0 项，修好后 0 项**（没有可"修"的漂移）

| 类别 | 启动时 | 修好后 |
|---|---|---|
| 仅在仓库（`only-repo`） | **0** | **0** |
| 内容不同（`differ`） | **0** | **0** |
| 仅在部署（`only-deploy`） | **0** | **0** |
| 一致（`same`） | 同一棵目录树，**工具直接跳过逐文件对账**（不做无意义的 4386 文件哈希） | 同左 |

* "启动时 0 差异"的**判定依据不是哈希**，而是 §1.2 的 `dev:ino` 相等 —— 同一棵树上不存在"文件不同"的可能。
* 本次真正的"修复"动作是**服务侧**：`:8901` 在我开始核验后**死过一次**（见 §5.3），我按 `OPERATING-LESSONS.md` L-07
  的配方重启，并用 `--serve` 证明"服务吐的字节 = 仓库的字节"。

### 5.2 最终 md5 校验（HTTP 吐出的字节 vs 仓库磁盘字节，逐字节相等）

| 文件 | 磁盘（= 部署软链目标） md5 | HTTP 抓回 md5 | HTTP |
|---|---|---|---|
| `index.html` | `73dc1c928a923bc89d849bb34c9571ce` | `73dc1c928a923bc89d849bb34c9571ce` | 200, 80582 B |
| `bench-patch.js`（P-142 改过） | `5bdb717bd67da0550d9d43a0d9e3c399` | `5bdb717bd67da0550d9d43a0d9e3c399` | 200, 300528 B |
| `mpw-select.js`（P-142 新增） | `28b2b4b56564b420ffe9f2bbf3f50d90` | `28b2b4b56564b420ffe9f2bbf3f50d90` | 200, 13456 B |
| `mpw-select-math.mjs`（P-142 新增） | `1884ca4d396be923e80065393fcc20ed` | `1884ca4d396be923e80065393fcc20ed` | 200, 5665 B |
| `sw.js`（未在自证清单内，仅登记） | `f56054cf065aff46a40e72069053640f` | — | — |

**"新标记"在哪里（重要，纠正一个想当然）**：`mpw-select` 在 **`index.html` 里出现 0 次** ——
它是 `bench-patch.js` 第 70 行 `import { enhanceSelect } from './mpw-select.js'` 拉进来的。
⇒ 核"新内容有没有被服务出去"要 grep **`bench-patch.js`**，grep 首页会得到一个**假阴性**：

```console
$ curl -s --max-time 10 http://127.0.0.1:8901/WEwebLoader/bench-patch.js -o /tmp/bp.js
$ grep -n "mpw-select" /tmp/bp.js | head -3
4://   上游产物渲染的"壁纸配置"面板里的 combo，全部换成同一个实现（`./mpw-select.js`，8899 渲染器页也在用）。
70:import { enhanceSelect } from './mpw-select.js'
1295://   ③ 幂等：跳过已带 `data-mpw-select-native` 的，重复调用没有副作用（上游重渲染后由观察者再补一遍）。
```

### 5.3 服务侧事件（必须登记，不是漂移但是"界面看起来没变"的另一种成因）

| 时刻（CST） | 事件 |
|---|---|
| 12:19 | `curl /WEwebLoader/` ⇒ 200，80582 B；pid 13566（父代理刚重启的） |
| 12:19–12:26 之间 | **服务消失**：`pgrep -af serve-8901` 无匹配、`curl` 报 `code=000`（连接被拒）、`node fetch` 报 `ECONNREFUSED`；`/tmp/8901.log` 尾部**只有启动 banner**（= 被外部杀掉，不是崩溃）；`dmesg` 读不到 OOM 记录 ⇒ **死因未确证**（与 L-07「重启/内存压力会带走服务」一致） |
| 12:28:18 | 按 L-07 配方重启：`setsid nohup node serve-8901.mjs 8901 > /tmp/8901.log 2>&1 &` ⇒ pid **4189**，RSS 57MB，cwd = `references/vendor-ref/ww-pages` |
| 12:28+ | `curl /` ⇒ 200 / 80582 B；`--serve` 四项 md5 全等；旧名 302 ✓ |

---

## 6. 诚实清单：没核到的、有歧义的

1. **`references/` 不在任何 git 仓库里 ⇒ 部署树文件"未提交"不是遗漏，是无处可提交。**
   `<DSHAREA>`（工作区根，按脚本自身位置推导） **本身没有 `.git`**（`git status` 直接报"不是 git 仓库"）；该工作区里存在的仓库是
   `we-scene-demo/`、`dsh-mpkg-wallpaper/`、`deepseek-watch/`、`references/{wer,we-layerd,lwe,dsbw}-ref/`、
   `references/vendor-ref/webwallgl/` —— **没有一个**覆盖 `references/vendor-ref/ww-pages/`。
   ⇒ 那三条软链（`WEwebLoader`、`wallpaper-engine-webgl`、`index.html`）**只能登记在本文件里**，无法 `git add`。
   它们都是**相对路径**软链，重建配方：
   ```bash
   cd <DSHAREA>/references/vendor-ref/ww-pages
   ln -sfn ../../../we-scene-demo/demo WEwebLoader
   ln -sfn ../../../we-scene-demo/demo wallpaper-engine-webgl
   ln -sfn WEwebLoader/index.html index.html
   ```
2. **"这两个目录逐字节相同、md5 已核"的旧记录，我在文档里没找到出处。** 最接近的是
   `references/vendor-ref/ww-pages/PATCH-NOTES.md:238` 的「两个入口 `index.html` 仍**逐字节相同**（`cmp` 通过）」——
   但那说的是**构建产物里** `/demo/index.html` 与 `/WEwebLoader/index.html` 两份**真拷贝**，**不是**本机静态根。
   ⇒ 若确实有人把这句话读成了"本机部署树是拷贝、已用 md5 核过"，那是一处**误读**；
   本文件用 `dev:ino` 给出了正确形态。**未核到**：是否还有第三处（例如某个备份目录）曾是真拷贝 ——
   全仓 `find … -name mpw-select.js` 只有一个实体文件（`we-scene-demo/demo/mpw-select.js`，inode 2183058），
   `bench-patch.js` 只有一条软链（`references/vendor-ref/webwallgl/bench-patch.js`）⇒ **没有第三份拷贝的迹象**。
3. **部署静态根里存在"仓库没有"的文件**，它们**不是**漂移（不在挂载点 `WEwebLoader/` 内，而在其父目录 = 服务静态根，
   所以**也会被 `:8901` 当静态文件吐出去**）：`PATCH-NOTES.md`（91KB）、`bench-patch.test.mjs`（149KB，
   md5 `2faee28c49f1e0a39c2aa6ae578caef7`，**仓库里没有对应文件** —— `we-scene-demo/tests/` 下无此名，
   `git ls-files` 也没有）、`probes/`（3 个探针 + 1 个结果 txt）、`webwallgl/`（2 个文件的兼容跳转页）、
   `serve-8901.mjs` 自身。⇒ 这些属于"服务根独有"，工具的对账口径**只覆盖挂载点内**；要连它们一起对账，
   得把 `BENCH_8901_MOUNT` 指到别的落点 —— **当前没有这样的需求，也没做**。
4. **`bench-patch.test.mjs` 是不是某个仓库测试的旧副本，未核**：仓库侧不存在同名文件，
   无法用 md5 判定"它对应哪个版本的测试"；只在文档里登记其 md5 与落点。
5. **≥5MB 文件默认不哈希**：`demo/` 内只有 1 个（`lucide-react.js.map` 7.3MB）。⇒ "0 漂移"这个结论
   在 `separate-copy` 形态下对**那一个文件**只保证"size 相同"；要更强保证需 `--hash-large`（本机同树形态下无差别）。
6. **`demo/now-playing/node_modules/` 属于被托管字节**（`demo/` 65MB / 4386 文件的大头），工具的清单**不排除**它
   （`git ls-files demo/` 只有 29 个文件 ⇒ 它未被 git 跟踪，但**确实会被 `:8901` 按 URL 吐出去**）。
7. **`demo/samples` 是指向 `../samples` 的软链**（`we-scene-demo/samples`，130KB）⇒ 工具的遍历**跟随目录软链**
   （与 `serve-8901.mjs` 的 `realpathSync` 行为一致），并用 `dev:ino` 去重防环。
8. **未做**：浏览器/X11/Playwright 侧验证（按任务约束只能主对话跑）；因此"页面在浏览器里渲染正确"
   **本轮没有核**，只核到"HTTP 吐的字节 = 仓库字节 + 关键脚本里有 P-142 的新 import"。
9. **`docs/OPERATING-LESSONS.md` L-07 的健康检查行已过时**（`:129` 用的还是旧名 `…/wallpaper-engine-webgl/`，
   现在按设计返回 **302** 而不是 200）。**我没有改那行**（不在我的提交范围、且别的线在动文档），
   建议改成 `curl … http://127.0.0.1:8901/WEwebLoader/`（或接受 302 并配 `-L`）。

---

## 7. 一句话复现配方

```bash
free -m                                                   # 先看内存（工具自己也会拦）
cd <DSHAREA>/we-scene-demo
node tools/bench-8901-sync.mjs --check --serve             # 0 = 形态同一棵树且服务吐的是新字节
```

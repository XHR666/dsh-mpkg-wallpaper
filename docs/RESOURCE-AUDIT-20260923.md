# 插件运行期资源占用与泄漏审计（2026-09-23）

> 目标：`dsh-mpkg-wallpaper` 3.13.1（HEAD `7e2f3ed`，2026-09-22 11:41:54 +0800）
> 场景约束：本机总内存 15GB / 可用约 4GB，用户刚经历一次**内存压力自动重启**。
> 本文件只记录**有 file:line 证据**的结论；没有证据的一律写「未核验」，不猜。

---

## 0. 结论速览

- 主表 **22 行**问题：**高 4 / 中 8 / 低 10**。
- 最严重 3 条（详见 §2.1）：
  1. **`lib/pkg-extract.js:2256-2258` + `2114/2141/2246`** —— 宿主进程的 `sceneVideoScanCache` 缓存的是**整段内嵌视频字节**，只按「条数 64」封顶、**没有字节预算**、且 `clearSceneVideoScanCache()`（`pkg-extract.js:2076`）在全仓**从无调用**。一个 30–150MB 的 scene 视频就是 30–150MB 常驻，最坏 64 份。
  2. **`lib/client.js:8240`+`8242`** —— np 播放器的 blob 兜底 URL **没有任何 revoke**（全仓 11 处 `revokeObjectURL` 都不覆盖它），每个 ≤32MiB 的 Blob 活到页面卸载；自动连播时按曲目数单调增长。
  3. **`lib/client.js:20840`+`20843`** —— 双 id 注册的两个 `catch (e) {}` 把「插件整个没注册上」这件事**完全静默**（无 console、无 trace、无全局标记），是本次审计里唯一的「功能级静默死亡」点。

---

## 1. 审计方法、命令与覆盖范围

### 1.1 覆盖范围

逐行 + grep 全覆盖审计的文件（共 **33,582 行**）：

| 文件 | 行数 | 角色 | 读法 |
| --- | --- | --- | --- |
| `lib/client.js` | 20,843 | 浏览器单文件产物（含 3 个生成区） | 全量 grep + 关键区段逐行（列于下） |
| `lib/index.js` | 3,831 | 宿主端（HTTP 路由 / 缓存 / 转码 / Steam 发现） | 全量 grep + 缓存与清理链逐行 |
| `lib/pkg-extract.js` | 2,279 | PKG/TEX 解析（含 `sceneVideoScanCache`） | 全量 grep + 两级缓存逐行 |
| `lib/now-playing.js` | 1,724 | NP 组件（生成区内联源） | 全量 grep + 观察者生命周期逐行 |
| `lib/web-wallpaper.js` | 1,696 | 帧内 WE API shim（跑在壁纸页里） | 全量 grep + 媒体登记/策略逐行 |
| `lib/media-session.js` | 1,052 | 宿主侧系统媒体会话 | 全量 grep + 单飞/探测缓存逐行 |
| `lib/web-interaction.js` | 806 | 帧内交互注入（纯逻辑） | 全量 grep |
| `lib/now-playing-math.js` | 677 | NP 纯数学 | 全量 grep（无 DOM/无定时器） |
| `lib/audio-bus.js` | 461 | WebAudio 总线静音内核（生成区内联源） | 全量逐行（状态集合 + 750ms tick） |
| `tools/build-audio-bus.mjs` | 89 | `client.js` 的 `MPW-AUDIO-BUS` 生成器 | 全量逐行（决定生成区接线） |
| `tools/build-now-playing.mjs` | 124 | `client.js` 的 `MPW-NP-GEN` 生成器 | 全量逐行 |

`lib/client.js` 逐行读过的区段（其余靠 grep 判据）：`1-80`、`2400-3000`、`3540-3640`、`3680-3740`、`3840-3960`、`4180-4200`、`4370-4400`、`4600-5100`、`5150-5200`、`5330-5400`、`5540-5580`、`5650-5760`、`5930-5960`、`6150-6500`、`6620-6700`、`6740-6800`、`7100-7200`、`7290-7460`、`8040-8300`、`8440-8620`、`8740-8900`、`9140-9200`、`9530-9800`、`9840-9920`、`10230-10320`、`15690-15760`、`16300-16340`、`16720-16760`、`16920-16960`、`17240-17420`、`17460-17530`、`20440-20800`、`20800-20843`。

**未覆盖（明确排除）**：`lib/liquid-glass/`（9 文件 3,211 行，第三方渲染器源码）、`lib/liquid-glass-bundle.js`（2,611 行，内联产物）、`lib/client.js.bak-20260907`（旧产物）、`dist/`、`tools/*` 里的探针脚本（只读不跑）。这些如需审计应单开一轮。

### 1.2 实际使用的命令（全部只读、轻量）

```bash
# ① 无界容器盘点
grep -c "new Map(\|new Set(" lib/*.js
grep -nE "^[[:space:]]{0,2}(let|var|const)[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*=[[:space:]]*(\[\]|\{\}|new Map\(|new Set\()" lib/*.js
grep -n "<容器名>" lib/*.js                      # 逐个追 set/add/push 与 delete/clear/shift 的对称性

# ② 监听器/观察者/定时器对称性
grep -o 'addEventListener("[a-zA-Z]*"' lib/client.js | sort | uniq -c | sort -rn
grep -o 'removeEventListener("[a-zA-Z]*"' lib/client.js | sort | uniq -c | sort -rn
grep -c 'setInterval(\|clearInterval(\|setTimeout(\|clearTimeout(\|requestAnimationFrame(\|cancelAnimationFrame(' lib/*.js
grep -n "new ResizeObserver\|new MutationObserver\|new IntersectionObserver\|\.observe(\|\.disconnect()" lib/client.js

# ③ objectURL / Blob / iframe / video 释放
grep -n "createObjectURL\|revokeObjectURL" lib/*.js
grep -n 'removeAttribute("src")' lib/*.js
grep -n "\.arrayBuffer()\|new Uint8Array(\|readFileSync" lib/client.js lib/pkg-extract.js lib/index.js

# ④ 高频 tick / 每帧分配点
grep -n "setInterval(\|requestAnimationFrame(" lib/client.js lib/now-playing.js lib/audio-bus.js
grep -n "function mpwSceneWdTick\|function npSystemMediaTick\|applyMute\|collectMedia\|allMedia\|syncFrames" lib/*.js

# ⑤ 吞错密度与关键路径
grep -c "catch {}\|catch (e) {}" lib/client.js               # 881
grep -c "mpwErr(" lib/client.js                              # 58
grep -c "\.catch(() => {})" lib/client.js                    # 57

# ⑥ 大对象生命周期
grep -n "bytes\b" lib/pkg-extract.js
grep -rn "clearSceneVideoScanCache\|scanSceneVideo(" lib/*.js
```

**纪律执行情况**：未启动浏览器 / ffmpeg / 任何测试套件 / 任何长跑命令；未使用 `node -e`（不需要）；全程只有 grep/sed/awk/ls/wc/free/git log 这类轻量只读命令；未修改任何代码文件（本轮只新建本文件）。

---

## 2. 主表：问题清单

| # | 类别 | file:line | 现象 | 触发条件 | 影响（内存/功能） | 严重度 | 建议修法 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 无界缓存 + 大对象生命周期 | `lib/pkg-extract.js:2069`、`2106`、`2114`、`2141`、`2246`、`2256-2258`；消费者 `lib/index.js:746`、`763` | `scanSceneVideo()` 返回的 `video` 对象**带完整 `bytes`**（`new Uint8Array(readFileSync(...))`，即整段视频的独立副本），而 `sceneVideoScanCache` 把 `{ video, indexEntries }` 整条缓存；上限只有 `SCENE_VIDEO_SCAN_CACHE_MAX = 64`（**按条数、无字节预算**），`clearSceneVideoScanCache()`（`pkg-extract.js:2076`）在 `lib/` 内**从无调用** | 任何走 `ensureSceneVideo()` 的路径（`/custom-scene-video-check`、场景帧、场景壁纸应用）看一个**新** scene 目录/mtime；每个不同的 `target+mtime+size` 是一个新键 | 宿主进程常驻内存 = Σ(被缓存视频体积)，最坏 64 × 单视频体积；按代码注释「单槽 ~50MB」量级算是数 GB 级，且**只增不减**（除非宿主进程重启）。这是本次审计里与「内存压力自动重启」最吻合的一条 | 高 | 缓存里只留 `{ ref, mtimeMs, size, hash }`（元数据），字节写到 `DATA_DIR/scene-videos/<hash>.mp4` 后立即释放引用；给该缓存加与 `mpkgPreviewCache`/`sceneFrameCache` 同款的**字节预算 + LRU**（如 32–64MB）+ `bytes` 计数；`sceneVideoScanStats()` 增补 `bytes` 字段暴露到 `/diag`，便于真机观测 |
| 2 | objectURL 释放 | `lib/client.js:8240`（创建）、`8242`（赋给 `npAudio.src`）；缺失点在 `8103`、`8061`、`8068`、`4184` | np 播放器「blob 兜底」用 `URL.createObjectURL(new Blob([b]))` 建 URL 后直接 `npAudio.src = obj`，**全仓 11 处 `revokeObjectURL`（`client.js` 10 处：`2879`、`2924`、`6403`、`6427`、`6435`、`6463`、`7120`、`17266`、`17364`、`17584`；`web-wallpaper.js:762`）都不覆盖这个 URL**；`npDropAudio()`（`8103`）与清 src 的几处（`8061`/`8068`/`4184`）也只 `removeAttribute("src")`，不 revoke | `npAudio` 触发 `error` 事件 → `npAudioError()`（`8219`）；该兜底存在的理由正是「宿主 `/raw` 一律回 octet-stream、部分浏览器据此拒播」（`8230-8231`），即真机常态路径；每次换曲/`ended` 自动下一首各一次 | 每个 ≤32MiB（`8235` 的门限）的 Blob 常驻到**页面卸载**；自动连播 N 首 = 32MiB × N 单调增长。同文件 `6459-6461` 的注释已经为**壁纸档**修过同类问题（"URL 仍存活在 registry，不可回收，只增不减"），np 档漏了同一处 | 高 | 与壁纸档同款：加 `let npBlobUrl = ""`，赋新 src 前 `if (npBlobUrl) URL.revokeObjectURL(npBlobUrl)`，记录新 URL；在 `npDropAudio()`（`8103`）与全部清 src 路径（`8061`/`8068`/`4184`）一并 revoke 并置空 |
| 3 | 吞掉的错误（关键路径） | `lib/client.js:20840`、`20843` | 双 id 注册的两个空 catch：内层 `try { window.__ModuleLoader__.load({...}) } catch (e) {}`、外层 `} catch (e) {}`；**没有任何 console / trace / 全局标记出口**（唯一 trace 在 factory 内部，注册失败时根本走不到） | 宿主模块载入器缺失、签名变化、`load()` 抛错，或 `globalThis.__mpwRegistered` 逻辑之外的任何异常 | 整个插件（壁纸层、设置面板、NP、静音总线）**静默不加载**，用户只看到"什么都没有"，日志里零线索——与本文件 `20832-20835` 自己记录的现场（"面板组件被渲染过但从未挂载"）同类 | 高 | 两个 catch 至少写 `console.error("[dsh-mpkg-wallpaper] 注册失败:", id, e)` + `globalThis.__mpwRegisterError = { id, msg, at }`（供探针读）；成功路径也记一次 `__mpwRegisteredIds` 便于对拍 |
| 4 | 无界台账 + 磁盘堆积 | `lib/index.js:1860`（`crypto.randomBytes(16)` 生成随机 token）、`1889`（`files.set`）、`115`（`files` Map 声明）、`411-446`（`restoreFiles()` 启动全量重建）；清理侧 `897-965` 只覆盖 `transcodes/` | 每次 `/upload` 都生成**新随机 token** → 一个新的 `files` Map 条目（含 `entries` 全条目表）**+ 一份永久的 `DATA_DIR/<token>.mpkg` 磁盘副本**；`files` 全仓**无 `delete`/`clear`**（`grep -n "files\.\(delete\|clear\)" lib/index.js` 无输出），`DATA_DIR` 下的 `*.mpkg` 也无任何按龄/按额清理 | 用户每次「导入本地 mpkg」（`client.js:17377` 上传）；重装/重导同一张壁纸会产生第二份 token、第二份磁盘文件、第二条 Map 记录 | 内存随导入次数单调增长（每条含该 mpkg 全部条目的 `{name,index,size}`，`index.js:264`）；磁盘同样只增（大 mpkg 数百 MB × N）；每次宿重重启 `restoreFiles()`（`413`）把这些条目**全部重新载入** | 高 | 按内容 sha256（或 `size+mtime+首 64KB hash`）去重：同包复用 token，命中则不重复落盘；`files` 加 LRU 上限（如 64 条）+ 定期清理 `DATA_DIR` 中无引用的 `*.mpkg`（可复用 `pruneTranscodeCache` 的「条数+字节双上限」写法） |
| 5 | 无界台账 | `lib/client.js:57`（声明）、`62-63`（写入） | `MPW_ERR_SEEN = new Map()` 用于同错去重，键 = `where + "\|" + msg`，**只 `set` 从不清理、无上限**；同一个 `mpwErr` 里 `MPW_ERR_RING` 有 40 条上限（`66`），`SEEN` 没有 | 任何进入 `mpwErr` 的**新**错误文本；错误消息里带动态内容（URL、token、id、尺寸）时每条都是新键 | 长跑会话按"错误种类"单调增长（每条约 100–200B：键串 + 计数）；量级不大但**无界**，且越长越难诊断 | 中 | 给 `MPW_ERR_SEEN` 加上限（如 64）+ 满时 `clear()`（或改成"只记首次 + 计数器"的定长结构）；`window.__mpwErrRing()` 顺带暴露 `seenSize` 便于观测 |
| 6 | 无界台账（强引用 DOM） | `lib/audio-bus.js:93`（`media: new Set()`）、`234`（`new Audio()` 包装器登记）、`199`（`createMediaElementSource` 登记）、`334-336`（只 `add`）、`380`（每次 `applyMute` 全量遍历） | `state.media` 是**强引用 Set**，`registerMedia()` 只有 `add` 没有 `delete`/`clear`；被登记的 `<audio>/<video>`（尤其是**不进 DOM** 的 `new Audio()`）永远无法被 GC | 页面里任何 `new Audio()`（含**别的插件**、壁纸作者脚本、NP 自己的 `npAudio`）或 `createMediaElementSource` 调用；`mode` 为静音档时每 750ms 被遍历一次 | 媒体元素及其缓冲/解码数据永不回收（32MiB 级的音频元素即 32MiB 常驻）；同时是 #9 的遍历基数 | 中 | 登记改为 `WeakRef`（列表）+ `WeakSet`（去重），或定期剔除 `isConnected === false && 无其他引用` 的元素；`allMedia()` 已能扫到 DOM 内的元素，Set 只需覆盖"不在 DOM 里的"这一类 |
| 7 | 无界台账（重对象） | `lib/audio-bus.js:90`（`contexts: []`）、`92`（`adopted: Set`）、`126`（`adopted.add`）、`129`、`176`（`contexts.push`，之后无 `splice`/`delete`） | 构造函数包装器每 `new AudioContext()` 就往 `state.contexts` push 一条**带 `ctx` 强引用**的记录（还带 `createStack` 字符串），`adopted` 同样只增；`report()`（`423-425`）每次还把 `contexts` 全量 `map` 拷贝一份 | 页面每次创建 `AudioContext`（Live2D 语音、可视化、别的插件），或第一个直连 `destination` 的节点被接管（`120-129`） | `AudioContext` 是 WebAudio 里最重的对象（独立音频线程 + 图 + 缓冲），被强引用后**永不释放**；反复换带声音的壁纸/角色语音可能累积几十个 | 中 | `adopted` 改 `WeakRef` 集合（`masters` 已是 `WeakMap`，口径可对齐）；`contexts` 只保留元数据（`id/adopted/createAt` + `WeakRef`），并在 `ctx.state === "closed"` 时剔除；`report()` 只输出必要字段 |
| 8 | 定时器注册/注销不对称 | `lib/client.js:10268`（生成区 800ms 轮询）、`lib/audio-bus.js:413-414`（750ms 轮询）、`433-436`（`dispose()` 才 `clearInterval`） | `mpwInstallAudioBus()` 里 `setInterval(..., 800)` **句柄被丢弃、永不清除**；bus 内部静音期 `setInterval(..., 750)` 只在"取消静音"或 `dispose()` 时清除，而 **`dispose()` 全仓无人调用**（`grep -n "mpwAudioBusApi" lib/client.js` 只有 install / setMuted 三处） | 默认档（`npaudit` 默认开、总线模式默认装）即安装 800ms；静音设置开着即安装 750ms | 页面全程两个常驻定时器 + 每次 tick 的全量 DOM 遍历（见 #9）；不是"越积越多"，但**永不释放、无关闭开关** | 中 | 把 bus 的 `dispose` 接到插件卸载/`mute` 关闭路径；800ms 轮询改成跟随事件（`storage` 事件 + 面板写设置时直接调 `mpwAudioBusSetMuted`），或至少在 `visibilitychange` 隐藏时停表 |
| 9 | 每 tick 分配（+ 放大） | `lib/audio-bus.js:342`（`doc.querySelectorAll('*')` 找 shadow root）、`347-355`（`allMedia()` 每次新建 `out` 数组）、`380`（遍历全部媒体元素）、`389`（每 tick `querySelectorAll('iframe')` + `slice`）、`393`（对**每个同源帧**再调 `installAudioBus`）、`413`（750ms） | 每次 `applyMute()` 都做一次**整文档遍历**（为找 shadow root 而 `querySelectorAll('*')`）+ 新建数组；`syncFrames()` 每 tick 重新枚举 iframe 并 `.map`；`installAudioBus` 幂等分支里仍会 `setMode()` → 子帧再跑一遍自己的 `syncFrames + applyMute + emit` | 静音档下每 750ms 一次；每次 `setMuted`/`setMode`/设置变更各一次 | 稳定的 GC 压力与 CPU 占用（NodeList/数组/`state.frames` 每次重建），在元素多、帧多的 DSH 页面上被放大为「帧数 × 全文档遍历」；这是"每 tick 分配"类问题里最实的一条 | 中 | 媒体元素清单改事件驱动（`MutationObserver` 增量登记，或用 `document.querySelectorAll("audio,video")` 直接取，不做 `querySelectorAll('*')`）；shadow root 用一次性登记表缓存；幂等分支只在 `mode` 真变时下发 `setMode`，`syncFrames` 复用上一次的帧列表（帧增删由 observer 触发） |
| 10 | 大对象瞬时峰值 | `lib/client.js:2288`（host token 档）、`2302`（会话 File 档）、`2290-2291`/`2304-2305`（检查在分配之后）、`2176`（前置门 <250MB） | `ensureSlotBlob()` 先 `new Uint8Array(await rr.arrayBuffer())` 把**整条**读进 JS 堆，再 `new Blob([mp4])`（**再复制一份**），**之后**才做 `b.size > 250MB` 的判断——等于没有防护 | 时间变化壁纸切换时段（`swapTimeSlot`，含 60s 自动切换定时器与手动点「清晨/白天/黄昏/夜晚」） | 单次瞬时峰值 ≈ 2× 条目体积（典型 50MB → ~100MB；极端 250MB → ~500MB），叠加 `idbPut` 的写缓冲；在本机 4GB 可用内存下这是最容易直接触发 OOM 的一步 | 中 | 先按 `entry.size` 判断再决定是否读取（把 250MB 门提到 fetch 之前）；用 Range 分段流式处理或让宿主直接落盘、客户端只拿 URL，避免整段进 JS 堆；`Blob` 构造后立即 `mp4 = null` 断开引用 |
| 11 | 吞掉的错误（功能静默失效） | `lib/audio-bus.js:378`（`catch (e) { try { master.gain.value = ... } catch (e2) {} }` 双重吞）、`380`（逐元素 `catch (e) {}`） | 写 masterGain 失败时回退写 `gain.value`，再失败就**什么都不做也不记**；逐元素 `suppress()` 失败同样静默 | 第三方 `AudioParam` 被替换/被冻结，或元素 `volume`/`pause` 抛错（跨 realm、已 detach、被别的插件重定义 setter） | 用户视角就是"设置里静音了还是会响"——**正是该模块存在的理由**，却在这个路径上无法自证；`emit('apply-mute')`（`382`）也只记数量不记失败 | 中 | 两处 catch 至少 `emit('mute-failed', { reason, ctxId })`（模块已有 `log` 环与 `opts.onEvent` 上报口），并计入 `report()`；失败次数 >0 时在 `/diag` 出信标 |
| 12 | 吞掉的错误（聚合 + 用户动作静默无效） | `lib/client.js:2314`（`ensureSlotBlob` 失败只 `console.warn`）、`2347`（`swapTimeSlot` 整链 `.catch(() => {})`）；密度：`client.js` 空 catch **881** vs `mpwErr(`**58**、`.catch(() => {})`**57** | 切时段整链（取 blob → 写 IDB → 写 section → 重挂）任何一步失败都被吞到只剩一行 console，面板/提示**零反馈**；同类的还有 `20751`（`initHostSettings`）、`20754`（`refreshBetterSidebarVersion`） | host 不可用、ffmpeg/IDB 失败、source 失效时点时间槽按钮 | 用户点「清晨/白天」没有任何反应且不知道自己该做什么（与 `1985`/`5992` 已经建好的 `mpwPersistEmit` 反馈机制不一致）；聚合看，881 个空 catch 中任何落在功能路径上的都是同类风险 | 中 | 关键路径 catch 统一走 `mpwErr(where, e)` + `mpwPersistEmit(用户可读原因)`；至少给 `swapTimeSlot` 的 `.catch` 加 `mpwErr("swapTimeSlot", e)`；把 `2314` 的 `console.warn` 升级为 `mpwErr` |
| 13 | 无界台账 | `lib/client.js:1460`（`mpwArmProbeCache`）、`1461`（`mpwArmHinted`）、`1506`、`1477` | 两个模块级 `Map` 只 `set`，**无上限、无 clear、无 TTL 淘汰**（`mpwArmProbeCache` 有 20s 读时新鲜度判断 `1505`，但过期条目仍留在表里） | 每次壁纸挂载验活（`mpwVerifyArm`：图片 `2900`、视频 `2949`、web `6021`）；URL 含 `&_t=<hostBustTick>`（`2677` 的缓存击穿机制，用在 `resolveHostUrl` 上）时切换/刷新一次就是一个新键 | 长会话下单调增长（每条 ~150B 的 URL + 小对象）；量级小但无界 | 低 | 加 64 条 LRU 上限 + 命中时 touch；或把 `at` 超过 TTL 的条目在 `set` 时顺带清掉 |
| 14 | 无界台账 | `lib/client.js:2603`（声明）、`2606`（`sceneThumbSrc` 内 `set`） | `__mpwSceneThumbReg`（thumbUrl → 场景 key）只 `set`，无上限、无 clear（只在 `7171` 诊断时取前 12 条） | 每次生成场景缩略图 URL（浏览壁纸库时每个缩略图一次） | 壁纸库很大时按缩略图数单调增长（每条两个字符串）；无界但小 | 低 | 加条数上限（如 256）+ 按插入顺序淘汰，或直接把 Map 改成诊断时才构建的临时表 |
| 15 | 无界台账 | `lib/index.js:723`（声明）、`756`、`766`（`set`） | `sceneVideoIndex`（scene 目录 → `{mtimeMs,size,hash,mime}`）只 `set`，无上限、无淘汰 | 每个**不同**的 scene 目录被探测一次（含 `hash: null` 的"无视频"负缓存） | 条目小（~100B），但目录数无界，宿主进程常驻；负缓存条目永远留着 | 低 | 加条数上限（如 256）+ LRU，或按 `mtime` 失效时顺带清理久未访问项 |
| 16 | 无界台账 | `lib/index.js:3101`（声明）、`3232`（`set`） | `__mpwSceneThumbMeta`（identity → `{lastPostAt, bytes}`）只 `set`，无上限、无 clear | 每次看门狗信标上报（每个场景身份一次） | 条目小、只存 `bytes.length`（**不存字节**，无大对象风险），但身份数无界 | 低 | 同上：加条数上限 + LRU；或按 `lastPostAt` 剔除超过看门狗窗口的条目 |
| 17 | 无界台账 | `lib/client.js:5093`（声明）、`17519`（写入） | `sessionFiles`（`name|size` → `{file, dataStart}`）只写不删，用于"纯浏览器导入"的会话内 File 引用 | 每次纯浏览器（host 不可用）导入 mpkg | `File` 对象是磁盘引用、不占堆，但字典本身无界；会话内导入很多包时缓慢增长 | 低 | 只保留**当前壁纸**需要的键（换档时清掉不在 `section.timeVideos` 里的项），或加 32 条上限 |
| 18 | 定时器注册/注销不对称 | `lib/now-playing.js:986`（声明）、`1189-1193`（设置）、对照 `1521-1529`（`stopObservers`） | `noteTimer`（"做不到的事"提示 4s 自动收）**不在 `stopObservers()` 的清理清单里**（那里清了 `resizeObs`/`mutObs`/两个 rAF/`settleTimer`/`syncTimer`，独缺 `noteTimer`） | 用户在 NP 上按了做不到的操作（`refuse()`）后 4s 内关掉 NP 开关/卸载 | 一个 4s 一次性定时器在卸载后仍会触发一次 `render()` 写已摘除的容器；不累积、影响极小 | 低 | `stopObservers()` 里补 `if (noteTimer) { win.clearTimeout(noteTimer); noteTimer = 0 }`；顺带把 `note` 复位 |
| 19 | 定时器注册/注销不对称 | `lib/client.js:4804`（web 交互徽标 1s）、`10305`（审计帧扫描 1s，`9557-9558` 默认开） | 两个 `setInterval` **句柄都没保存**，也没有任何 `clearInterval`；`10305` 的扫描函数内部用 `mpwAuditFrameScans++ > 60` 自限（`9772`），但**定时器本身仍在每秒空转** | 页面加载即安装（`mpwWebIxWire` 一次性守卫 `4682-4683`；`mpwInstallAudioAudit` 默认装） | 每秒两次空回调（一次判断 `isOn()`、一次判断计数），CPU 可忽略；属"只有注册没有解除"的账面欠债 | 低 | 保存句柄；`10305` 在 60 次后自 `clearInterval`；`4804` 在 `mpwWebIxDisarm` 永久退出时清掉 |
| 20 | 监听器/观察者（有意常驻，但无注销路径） | `lib/client.js:7361-7362`（`frostObserver`）、`7432-7433`（`compatObserver`）、`20585-20586`（`sblurObserver`）、`20623-20624`（`headerBlurWatch`）、`20657-20658`（`aquaThemeWatch`）、`20723-20746`（`window.__mpwStyleWatch`）、`20760`（`storage`）、`5951`（3s 磨砂）、`5176`（30s 渲染器探测）、`20773`（60s 时段切换） | 这些观察器/监听器全部由 `if (x !== null) return` 或 `window.__mpwXxx` 一次性守卫保护（**不会每次 apply 叠加**），但**没有任何一处 `.disconnect()` / `clearInterval` / `removeEventListener`**（例如 `frostObserver` 全仓只有声明/新建/observe 三处） | 页面加载/首次 apply 时各装一次，随后常驻 | 设计上插件是页面生命周期单例，故不构成"越积越多"；但它们观察 `document.body`/`documentElement` 的 `subtree`，宿主页面很吵时是持续的微 CPU 与闭包常驻 | 低 | 若确定不做插件卸载，至少在注释里写明"有意常驻"（避免后人重复怀疑）；若要做卸载，把这些句柄集中到一个 `disposeAll()`，与 `now-playing.js` 的 `stopObservers()` 同款 |
| 21 | 每 tick/每次调用分配 | `lib/client.js:10286-10304`（`frames()` 内的 `walk`） | 为判 Live2D，对每个可达帧做 `d.documentElement.innerHTML` 的 `slice(0, 200000)` + 正则（`10295`）——**单帧单次最多物化 200KB 字符串**；`querySelectorAll("audio,video")` 每帧一次 | 仅当**显式调用** `window.__mpwAudioAudit.frames()`（诊断钩子）；仓库内 `lib/` 无调用点，真机探针/面板才调 | 非定时路径，所以不是持续 GC 压力；但一次调用 = 帧数 × 200KB 瞬时字符串，在场景渲染器帧（内含 canvas）上必然触发 | 低 | 用 `documentElement.outerHTML.length` 之外的廉价判据（如 `!!d.querySelector('canvas')` + 已登记的 Live2D 标记），或把 `slice` 降到 8–16KB；把该钩子显式标注"仅诊断、勿在热路径调用" |
| 22 | 静默缺失的功能（文档承诺 vs 代码） | `lib/audio-bus.js:96`（`bypassSuspected: []`）、`426`（`report()` 输出前 12 条） | 模块头注释（`audio-bus.js:34`）承诺 `report()` 会把"能观测到出声但不在 bus 上"的 ctx 单列为 `bypassSuspected`，但**全文件只有声明与读取，没有任何 `push`**（`grep -n bypassSuspected lib/audio-bus.js` 仅 3 处） | 任何时刻 | 不影响内存；影响**诊断可信度**：该字段恒为空数组，容易被读成"没有绕过总线的声源"，即"假绿"（该模块注释自己点名的风险） | 低 | 要么在 `applyMute`/`patchConnect` 里补上真正能观测到出声但未接管的 ctx 采集（如 `AnalyserNode` 电平判据），要么把注释与 `report()` 字段一起删掉，不留"看起来收了其实没收"的字段 |

---

## 2.1 高严重度问题详解（含旁证）

### #1 `sceneVideoScanCache` 缓存整段视频字节（高）

- 上界只有条数：`lib/pkg-extract.js:2069` `const SCENE_VIDEO_SCAN_CACHE_MAX = 64;`
- 值里带字节的三条生产路径：
  - 松散目录里的独立视频：`pkg-extract.js:2106`（`new Uint8Array(readFileSync(join(dir, rel)))`，**整文件独立副本**）→ `2114`（`standalone.push({ ref, bytes: b, ... })`）
  - TEX 内嵌 MP4（目录）：`pkg-extract.js:2141`（`texVideos.push({ ref: f.rel, bytes: mp4, ... })`）
  - TEX 内嵌 MP4（scene.pkg 索引路径）：`pkg-extract.js:2246`（`found.push({ ref: e.path, bytes: mp4, ... })`）
- 落缓存：`pkg-extract.js:2256` `const rec = { video, indexEntries };` → `2258` `sceneVideoScanCache.set(key, rec);`（`video` 即上面那些带 `bytes` 的对象）
- 键：`pkg-extract.js:2161` `target + '|' + st.mtimeMs + '|' + st.size + '|' + source` —— **按 scene 目录/mtime 分裂**，看得越多键越多
- 清理：`clearSceneVideoScanCache()`（`pkg-extract.js:2076`）在 `lib/` 内**零调用**（`grep -rn "clearSceneVideoScanCache" lib/` → 只有定义 `2076` 与导出 `2277`）；`lib/index.js` 只 import 了 `scanSceneVideo`（`index.js:19`）
- 消费端：`lib/index.js:746` `video = (hasPkg ? scanSceneVideo(pkgPath) : scanSceneVideo(dir)).video;` → `763` `writeFileSync(tmp, video.bytes)` 写到 `DATA_DIR/scene-videos/`。**注意：写盘之后代码没有再需要这份字节，但缓存仍把它扣在堆里。**
- 与既有纪律的对照：同仓 `mpkgPreviewCache`（`index.js:124-148`，48MB + 128 条 LRU）、`sceneFrameCache`（`150-176`，96MB + 64 条 + 单条 >24MB 不入缓存）、`layerCache`（`3269-3288`，128MB 字节预算）**都做了字节预算**，唯独这个放"整段视频"的缓存只数条数。

### #2 np blob URL 未 revoke（高）

- 创建：`client.js:8240` `obj = URL.createObjectURL(new Blob([b], { type: ... }))`；使用：`8242` `npAudio.src = obj;`
- 全仓 `revokeObjectURL` 清单（`grep -rn "revokeObjectURL" lib/`，排除 `.bak`）：`client.js:2879`、`2924`（`lastObjectUrl`，壁纸视频档）、`6403`、`6427`、`6435`、`6463`、`17364`、`17584`（`lastBgSig`，idb:blob / idb:img / 清壁纸 / 刷新路径）、`7120`（导出下载，`setTimeout(...,0)` 后 revoke）、`17266`（导入下载，2s 后 revoke）、`web-wallpaper.js:762`（帧内 worker blob）。**没有任何一处作用于 np 的 `obj`。**
- 触发链：`client.js:8097` `on("error", () => { try { npAudioError() } catch (e) {} })` → `8219 npAudioError()` → `8240`。该兜底的成立前提写在 `8230-8231`：「宿主 `/raw` 的 content-type 是 octet-stream，部分浏览器据此拒绝播放」——即真机上的**正常**兜底，不是罕见异常；体积门限在 `8235`（`size > (32 << 20)` 即放弃）。
- 为什么不会自动回收：blob URL 只在 `revokeObjectURL` 或**文档卸载**时释放（[MDN `URL.revokeObjectURL`](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL)）；`npAudio.src` 被下一次赋值覆盖、`removeAttribute("src")`（`8103`/`8061`/`8068`/`4184`）都**不会**释放旧 URL 对应的 Blob。
- 同仓先例：`client.js:6459-6461` 的注释已经为壁纸档写明「置 null 前 revoke 旧 Blob URL——否则……URL 仍存活在 registry，不可回收，只增不减」。np 档是同一问题的漏网。

### #3 注册失败完全静默（高）

- `client.js:20836-20843` 是整份产物的**唯一对外入口**：
  ```js
  try {
    if (!globalThis.__mpwRegistered) {
      globalThis.__mpwRegistered = 1;
      for (const __mpwId of [...]) {
        try { window.__ModuleLoader__.load({ id: __mpwId, factory: __mpwFactory }); } catch (e) {}   // ← 20840
      }
    }
  } catch (e) {}                                                                                      // ← 20843
  ```
- 该文件自己的纪律声明在 `client.js:50-54`：「关键路径（CSS 注入 / token 覆盖 / 壁纸挂载 / 磨砂同步 / 样式自愈 / 定时子系统）一律走 `mpwErr`……本文件历史上有 500+ 个空 catch；正是因为 catch 把 ReferenceError/TypeError 吞掉，才出现『磨砂三轮没修好』」。**注册入口不在这个纪律的覆盖范围内**，而它恰恰是"后面所有功能都不存在"的那一步。
- 旁证（同类现场的代价）：`lib/index.js:3505-3513` 记录了另一个被空 `catch { /* skip */ }` 藏住的 `ReferenceError`，后果是「`wallpapers` 数组与 `library` Map 恒为空」，潜伏很久才被发现。注册入口的风险等级更高。

---

## 3. 已确认安全（查过、有成对释放或明确上限；后人不必重复怀疑）

| # | 点位 | 证据（file:line） | 结论 |
| --- | --- | --- | --- |
| S1 | `MPW_TRACE` 追踪缓冲 | `client.js:32`（声明）、`34`（`> 300` 即 `shift`）、`42`（默认不上报，只有 `mpwdiag=1` 才 POST） | 有界（≤300 条）+ 默认零网络；**安全** |
| S2 | 错误环 `MPW_ERR_RING` | `client.js:56`、`66`（`> 40` 即 `shift`） | 有界 40 条；**安全**（注意 `MPW_ERR_SEEN` 是另一回事，见主表 #5） |
| S3 | 音频审计环 `window.__mpwAudioAudit.list` | `client.js:9554`（`MPW_AUDIT_MAX = 200`）、`9619-9621`（`9620` 超限 `splice` 到 200）；记录条数上限 200，含栈摘要与 src 摘要（已脱敏截断） | 有界；**安全**（CPU 成本见主表 #21 与 §4） |
| S4 | `mpkgPreviewCache` | `index.js:124`（声明）、`125-126`（48MB / 128 条）、`128-148`（get 时 touch、set 时按字节+条数淘汰） | 字节+条数双上限 LRU；**安全** |
| S5 | `sceneFrameCache` | `index.js:150`、`151-153`（96MB / 64 条 / 单条 >24MB 不入缓存）、`156-176` | 双上限 + 超大单条不驻留；**安全** |
| S6 | 场景图层缓存 `layerCache` | `index.js:3269`、`3274-3288`（256 条 + `LAYER_CACHE_MAX_BYTES = 128MB`，`layerCacheBytes` 逐条记账） | 字节预算 + LRU；**安全** |
| S7 | `manifestCache` | `index.js:3268`、`3320`、`3384`（`> MANIFEST_CACHE_MAX`(=64, `3270`) 即删最旧） | 有界；manifest 为小对象；**安全** |
| S8 | 转码三件套 | `TRANSCODE_PROBE_CACHE`（`index.js:578-579` 上限 64、`694-695` 满则 `clear`）；`transcodeJobs`（`569`、`1439-1441` 上限 64）；`TRANSCODE_INFLIGHT`（`567`、**`1529` 外层 finally 必删**，注释 `1526-1530` 记录了把删除移到外层的根因）；`TRANSCODE_WAITERS`（`882`、`1483` push、`1533` shift、`1470-1475` 30s 超时自摘） | 四项都有明确上限或必经的清理路径；**安全** |
| S9 | 宿主磁盘清理 | `index.js:897-919`（`tc_*.mp4` 条数 + `TRANSCODE_MAX_BYTES` 双上限、最旧先删）、`920-934`（`ffmpeg-err-*.log` 保留 50）、`938-965`（`src_*.bin` / `tc_*.tmp<pid>` 按 `mtime > 1h` 判残留删除）、`1584-1610`（`diag/` 条数 + `DIAG_MAX_BYTES` 双上限） | 磁盘侧有界；**安全**（注意：**不含 `DATA_DIR/*.mpkg`**，见主表 #4） |
| S10 | `pkgAudioIndexCache` | `pkg-extract.js:627`、`628`（上限 64）、`731`（记录体 `{ tracks, indexEntries, ms }` —— **只有元数据，无字节**）、`670`（LRU touch）、`734-737`（超限淘汰） | 有界且不驻留字节；**安全** |
| S11 | 帧内媒体登记 `liveMedia` | `web-wallpaper.js:1414`、`1420`（`W.WeakRef` 优先）、`1421`（无 WeakRef 时**上限 16** 并 `shift`）、`1474-1479`（剔除已死引用） | 弱引用 / 有界退化；**安全** |
| S12 | 帧内 `directoryFiles` | `web-wallpaper.js:1077`、`1622-1637`（`directory` 加、`directory-remove` 做交集收缩） | 按属性名分桶、可收缩；**安全** |
| S13 | 系统媒体会话轮询 | `media-session.js:565`、`633-637`（单飞 Map 在 resolve **与** reject 两侧都 `delete`）；`566`、`822-834`（`probeCache` 单条）；`client.js:8446`、`8466`（自适应 2s/30s、单链不叠定时器、`unref`、不可见不发请求、关开关即停） | 无单飞泄漏、无定时器堆积；**安全** |
| S14 | objectURL 成对释放（壁纸/下载/帧内） | `client.js:2879`、`2924`（`lastObjectUrl`：切图/切视频档时 revoke 旧的）、`6403-6404`、`6427-6428`、`6435`、`6463`、`17364`、`17584`（`lastBgSig`：idb:blob / idb:img / 清壁纸 / 刷新路径都 revoke）、`7115-7120`（导出：`setTimeout` 0 后 revoke）、`17254-17266`（下载：2s 后 revoke）、`web-wallpaper.js:755-762`（帧内 worker：建完即 revoke） | 除主表 #2 的 np 档外，**全部成对**；**安全** |
| S15 | 观察器成对断开 | `client.js:2841`、`2844`（`disposeWebFrame` 断 `frame.__mpwWebObs` / `__mpwPanelObs`，`3915-3929` / `5074-5079` 是成对的创建点）、`5687`、`5717`（`disarmHeaderFrostWatch` 断 `W.mo`）、`7190-7191`（诊断观察器自己在第 6 条后 `disconnect`）、`now-playing.js:1521-1529`（`stopObservers`：`resizeObs` + `mutObs` + 两个 rAF + `settleTimer` + `syncTimer` 全清）、`now-playing.js:12719`、`12838-12839`（生成区同源） | 可卸载路径上的观察器**都是成对的**；**安全** |
| S16 | `video` 元素释放 | `client.js:2886-2887`（`pause()` + `removeAttribute("src")` + `load()`——按 HTML 规范移除媒体元素的 `src` **不会**停止播放，必须 `pause`+`load`；代码注释 `2881-2884` 把这一点写对了）、`2950-2952`、`5341`+`5348`、`5561`（换 src 前 `pause` + 清旧 src + `load`） | 视频档卸载语义正确；**安全** |
| S17 | `iframe` 卸载语义 | 5 处 `frame.removeAttribute("src")`：`client.js:2814`、`2858`、`2876`、`2921`、`5348` | **安全**：按 HTML 规范，移除 `iframe` 的 `src` 会触发 `process the iframe attributes` → `shared attribute processing steps` 得到 `about:blank` → **导航到 about:blank**，原文档被卸载（与媒体元素的 `src` 语义**不同**，见 S16）。规范依据：[HTML Standard §4.8.5 The `iframe` element](https://html.spec.whatwg.org/multipage/iframe-embed-object.html)（"Whenever an iframe element ... has its `src` attribute set, changed, or removed, the user agent must process the iframe attributes"）。所以「只 `removeAttribute` 没 `about:blank`」**不是**泄漏点。（实际释放时延见 §4-U1） |
| S18 | 一次性守卫（防每次 apply 叠加注册） | `client.js:4682-4683`（`mpwWebIxWired`，保护 `4742-4804` 的 16 个 window 监听器 + 1 个 interval）、`3712`/`4960`/`6641`/`6684`（`window.__mpwHealthHook` / `__mpwWebShimHook` / `__mpwSandboxCapHook` / `__mpwLnGuard` 包住的 message/keydown）、`6185-6194`（注释明写"原来每次 applyFromStorage 都累积监听器"，改用 `vid.__mpwErrWired`）、`8112-8117`（`video.__mpwNpWired` 保护 6 个媒体事件）、`8828-8852`（省电三档监听器）、`20760`（`window.__mpwGlobalWired`）、`5176-5181`（`window.__mpwSceneProbeTimer` 只装一次，注释记录了"每次 apply 都 setInterval → 30s 定时器越积越多"的根因）、`10274`（`mpwAuditInstalled`） | **所有会随 apply/换档重复执行的注册点都有守卫** ⇒ 不存在"切 N 次壁纸 = N 份监听器"；**安全** |
| S19 | 列表滚动记忆 | `client.js:15725`、`15729-15730`（`> 64` 即 `shift` 并同步 `delete MPW_LIST_SCROLL_MEM[drop]`） | 有界 64 + 同步删数据；**安全** |
| S20 | 持久化监听器表 | `client.js:1981`、`1984-1985`（push 返回退订闭包，内部 `indexOf` + `splice`） | 有成对退订；**安全** |
| S21 | 宿主转码内存准入 | `index.js:863`（`transcodeMemGuard()` 定义；可用内存不足 → **不起** ffmpeg，直接抛错让客户端读原片；`TRANSCODE_MIN_AVAIL_MB` 口径见注释）、`1493-1498`（在 `1499` 的 `TRANSCODE_ACTIVE++` **之前**做准入） | 对内存紧张机器是**正向**设计，别在后续重构里删掉；**安全且应保留** |
| S22 | 宿主大文件读取纪律 | `index.js:222-235`（`readMpkgHead`：`openSync`+`readSync` 只读定长头，注释记录了旧写法 `readFileSync(path).subarray()` 会整包载入）、`236-247`（`readRange` 只读 `[offset, offset+len)`）、`1236`+`1245`（`materializeSource` 用 256KB 缓冲循环 `readSync`/`writeSync` 落临时文件，不整条进堆） | 宿主读取路径**安全**；**安全** |
| S23 | `readSection()` 高频调用 | `client.js:447-459`（命中 `sectionCache` 直接返回）、`mpwStripMeta`（`876` 无元键时**返回原对象**，不复制）、`mpwNormalizeSection`（`438` 无需迁移时**返回原对象**） | 各定时器（750ms/800ms/1s/2s/3s/60s）里的 `readSection()` 在稳态**不分配**大对象；**安全** |
| S24 | 生成区与源的一致性 | `tools/build-now-playing.mjs:37-77`（`buildRegionBody` 逐字节内联）、`tools/build-audio-bus.mjs:25-58`（音频总线块生成） | 生成区内容 = `lib/now-playing.js` + `now-playing-math.js` / `lib/audio-bus.js` 的逐字节副本 ⇒ **本审计对 `lib/audio-bus.js` / `lib/now-playing.js` 的结论同样适用于 `client.js` 的生成区**（行号对应：NP 生成区 `client.js:10631-13049`；音频总线块 `client.js:9776-10272`）；**安全** |

---

## 4. 无法判定（需要真机/浏览器才能测；本轮**不许**跑）

| # | 待测问题 | 为什么本审计判不了 | 建议的真机测法（不占内存） |
| --- | --- | --- | --- |
| U1 | `iframe` 卸载后，壁纸页/场景渲染器的**堆与 WebGL 纹理何时真正释放** | 规范只保证 `removeAttribute("src")` → 导航到 about:blank（见 S17）；渲染器进程/GPU 侧回收时延要看实现 | 真机开 `chrome://gpu` 看上下文回收，或 DevTools Memory 面板：切走场景壁纸前后各记一次 heap snapshot / `performance.memory`，只看差值趋势 |
| U2 | 主表 #1 的**实际**常驻量级 | 代码注释里的「单槽 ~50MB」是注释、不是实测读数；`sceneVideoScanStats()` 目前只暴露条数/读取字节，**不暴露"已驻留字节"** | 真机连续浏览 N 张带内嵌视频的 scene 壁纸，采样宿主进程 RSS；对照 `/diag` 的 `sceneVideoScanStats()` 条数（`pkg-extract.js:2071-2075`）。**需先按修复建议补 `bytes` 字段**才有直接读数 |
| U3 | `idbPut` 大 Blob（`client.js:2292`/`2306`，≤250MB；壁纸档 `2008`/`2020`，≤600MB）时浏览器是否**额外复制**一份 | 引擎实现相关（结构化克隆 + 落盘策略），代码里看不出来 | 真机 DevTools → Application → IndexedDB 看占用 + Memory 面板看峰值；或改用 `navigator.storage.estimate()` 观察增长 |
| U4 | 主表 #2 的 blob URL 在真实会话里的**增长速率** | 取决于 `/raw` 的 octet-stream 是否在用户浏览器上必现拒播（即兜底命中率），无法静态判定 | 真机 `performance.memory.usedJSHeapSize` 采样：连续换曲 20 次看基线是否台阶式上升；配合 `URL.revokeObjectURL` 修复前后对拍 |
| U5 | 主表 #9 的 750ms 全文档遍历在**真实 DSH 页面**（元素数、shadow DOM 数、iframe 数）下的 CPU 占比 | 静态只能看出"每 tick 分配"，看不出占比 | 真机 Performance 面板录 10s，看 750ms 周期的函数耗时；或临时用 `?mpwhardmute=off` 对比 |
| U6 | `mpwAuditOn()` 默认开（`client.js:9557-9558`）时，原型包装（`HTMLMediaElement.prototype` 的 `muted`/`volume` setter 被 `Object.defineProperty` 重定义、`AudioContext` 构造被替换）对**宿主与别的插件**是否有可观测副作用 | 需要真机上多个插件共存才能暴露 | 真机开 `?npaudit=0` 与默认档对拍宿主功能（尤其别的插件的音量/静音行为） |
| U7 | 主表 #4 里 `files` Map 中 `entries` 的**真实字节规模** | 取决于用户 mpkg 的条目数（`index.js:258-268` 每条 `{name,index,size}`），仓库里没有真实包可测 | 真机连续导入同一张 mpkg 5 次，观察 `/diag` 或调试端口里 `files.size` 与 RSS 增长 |
| U8 | `lib/liquid-glass/` + `liquid-glass-bundle.js`（共 5,822 行）是否另有资源问题 | **本轮明确未覆盖**（第三方渲染器源码与内联产物） | 需单开一轮审计 |
| U9 | 宿主进程的生命周期边界（决定 #1 的缓存能活多久） | 「`dsh web` 是否在同一宿主进程内跨会话保留插件模块」取决于宿主实现，仓库内看不到 | 真机：改一次壁纸后重启前端页面但不重启宿主，读 `sceneVideoScanStats().entries` 是否仍 >0 |

---

## 5. 修复顺序建议（按"收益/风险"排）

1. **#1**（`sceneVideoScanCache` 去字节 + 字节预算）——改动量小、收益最大，直接对应本次 OOM 事故。
2. **#2**（np blob URL 成对 revoke）——10 行内可完成，与壁纸档既有写法完全同构，可直接照抄 `6459-6463` 的模式。
3. **#3**（注册入口补错误出口）——2 行，把"静默死亡"变成"一眼可见"。
4. **#4**（上传去重 + `files` 上限 + `DATA_DIR` 清理）——需要设计 token 语义（保持重启后自愈），但磁盘+内存双收益。
5. **#6/#7/#9**（audio-bus 状态集合弱引用化 + 事件驱动替代 750ms 全遍历）——一起改最省事，改完 750ms tick 的成本与常驻引用一并消失。
6. 其余中/低按主表逐条处理；建议每条修完在本文件追加一行"已修"标记（文件名带日期，便于逐轮对拍）。

---

*本文件由资源审计轮生成：只读命令 + 静态判据，未运行任何浏览器/ffmpeg/测试套件，未修改任何代码。所有结论均可按 §1.2 的命令复现。*

# 诊断自证闭环 —— payload 字段表 / 一次点击 / 落点 / 上限

> 需求来源：`docs/MASTER-TODO.md` §5 第 3 项
> 「插件诊断 payload 补齐关键子系统状态（磨砂、侧栏、时间线是否被影响、壁纸类型/路径、
> shim 是否注入、视频解码状态…），并让**用户一次点击**就能把状态发回 ⇒ 以后所有真机 bug 都能一轮定位」
>
> 机器判据：`node tools/diag-subsystem-test.mjs`（门禁第 2 步，41 条断言 + 4 条变异自证）。
> 实现：`lib/client.js` 的 `MPW-DIAG-SUBSYS-BEGIN/END` 块（字段表 `MPW_DIAG_FIELDS`）。

## 0. 一句话

原来各子系统状态是"随手塞的字段"（有的在 `reveal`、有的在 `rail`，**读不到就整段消失**，拿到 diag 也说不清
是在哪读的、是"没读到"还是"真没有"）。现在是一张**声明式字段表**：每个字段**一定出现在 payload 里**、
一定带 `provenance`，读不到就是 `value:null + degraded`。

## 1. 怎么发（用户侧：一次点击）

设置页「外观 → 诊断」里的 **「一键上报」**按钮（`lib/client.js` 的 `diagsend.*` 文案）：

1. 采集 → 单份 payload 字节上限瘦身 → `POST /api/mpkg-wallpaper/diag`；
2. 成功 ⇒ 界面上显示宿主的**落点路径**（可直接点「复制落点」）；
3. 宿主不可用（离线 / 路由未注册 / 403 / 500）⇒ **自动改为下载 `mpw-diag-<ISO时间>.json`**，
   用户把这个文件发回来即可（**离线可用**，不需要宿主）；
4. 两条路径都失败（例如 Blob 不可用）⇒ 界面显示红色失败原因，不静默。

另外两条既有上报路径仍然在（默认关、且与上面共用同一份采集器）：
`localStorage['mpwdiag']='1'` 后页面加载 6s 自动上报一次（每会话 ≤6 次）、以及错误自上报（`window.onerror`）。

## 2. 字段表（`MPW_DIAG_FIELDS`，`schema = mpw-subsystems/1`）

每个字段的形态固定为 `{ value, provenance, degraded }`：

| 字段 id | 补的是什么 | provenance（来源） | 读不到时 |
| --- | --- | --- | --- |
| `frost` | 顶栏磨砂链路是否生效（是否注入 / 半径 / 原因 / computed） | `mpwHeaderFrostDiag()`（JS 侧 `hdrFrostState`）+ `.wSkVaW_header`、`.mpw-hdrFrost` 的 computed | `value:null` + `degraded{kind:"throw"}` |
| `sidebarAffected` | **侧栏是否被我们影响**（底色 / 是否带 backdrop-filter / 我们的门控属性 / 我们覆盖的那个宿主 token 现值） | `[class*="sidebarCol"]`、`.hHd-Xa_root`、`[data-slot="sidebar"]` 的 computed + `body[data-mpw-sblur-off|rsblur|bs-version]` + `--dsw-specific-sidebar-fill` 解析值 | 同上 |
| `railAffected` | **时间线是否被影响** / 条是否可见（`::before` 底色、反色晕、rect、是否零尺寸、祖先裁切、我们的门控） | `.eGxaPq_mark::before` computed + `body[data-mpw-rail-ink]` + `html` 上 `--mpw-rail-*` 内联值 | 同上 |
| `wallpaper` | **壁纸类型与路径**（`scene`/`video`/`web`/`gif`/`image`/`none` + mpkg 名 + 容器内文件 + 实际媒体 URL 尾部） | `readSection()` 持久化字段 + `#mpw-bgWrap`/`#mpw-bgImg`/`#mpw-bgVideo`/`iframe.mpw-webFrame` | 持久化侧是主来源 ⇒ DOM 读不到只记 `degraded.partial`（**仍给出类型/路径**） |
| `shim` | **网页 shim 是否注入**（src 是否带 `mpwshim=1`、帧是否回报 shimOk、是否已回退成裸 iframe、sandbox 属性） | `iframe.mpw-webFrame` 的 `src`/`sandbox` + `frame.__mpwShimOk`/`__mpwShimFellBack`（`webShimArm` 维护）+ `mpwSandboxDiag()` | `value:null` + `degraded` |
| `video` | **视频解码状态**（readyState/networkState/paused/muted/loop/尺寸/错误码 + `decoding` 判据 + 宿主转码三态） | `#mpw-bgVideo` 的媒体属性 + `data-mpw-wp-state` + `window.__mpwWallpaperState` | `value:null` + `degraded` |
| `surfaceTokens` | §5 第 1 项的表面 token 在本机是否真解析出值（磨砂/主题一致性断在哪一层） | `getComputedStyle(document.body)` 上 `--mpw-surface-*`/`--mpw-rail-*`/`--mpw-hdr-blur` | `value:null` + `degraded` |
| `sceneHealth` | 场景壁纸健康（看门狗状态 / 渲染器 `mpw-health` 最近消息 / 信标 / 低内存） | `mpwSceneWdState()` + `window.__mpwSceneHealth` + `__mpwSceneBeaconOk` + `mpwSceneLowMem()` | `value:null` + `degraded` |

**三条硬约束**（判据都在 `tools/diag-subsystem-test.mjs` 的 A 段）：

1. **字段一定在**：读不到时字段照样出现在 payload 里（只是 `value:null`）——变异「读不到就 `return null` 丢掉」
   必须让断言变红；
2. **一定带 provenance**：`degraded` 时也保留（能指回"我本来要从哪读"）；
3. **不许静默残缺**：主来源读不到 ⇒ `value:null`；**子来源**读不到（例如持久化可读但 DOM 不可读）⇒
   `degraded:{reason:"partial", partial:["bgElements():…"]}`，而不会伪装成"没有这个子系统"
   （例如元素查不到**不会**变成 `{present:false}`）。

字段表可被测试枚举（`window.__mpwDiagTest.spec()`）⇒ "某个子系统被删掉/改名"是断言失败而不是肉眼漏看。

## 3. 落在哪

宿主把 POST body 原样写成 `~/.dsh/.dsh-mpkg-wallpaper/diag-<epochms>.json`（`lib/index.js` 的 `/diag` 路由），
返回 `{ok:true, file:"<绝对路径>"}`——**这个路径就是界面上显示、可一键复制的落点**。
（`DSH_WE_DIAG_DIR` 可换目录，只用于测试/现场调参。）

## 4. 上限（用户定过的规矩：自动落盘的产物必须有**数量 + 字节**双上限、最旧先删）

| 层 | 上限 | 在哪 | 超出时 |
| --- | --- | --- | --- |
| 客户端单份 payload | **512 KB**（`MPW_DIAG_MAX_BYTES`） | `lib/client.js` 的 `mpwDiagFit()` | 先删可选段（`groups`/`thumbSources`），仍超 ⇒ 截断超长字符串字段（**保字段名**，值加 `…[truncated]`），并写 `truncated:{reason:"payload-over-cap",capBytes,…}` |
| 宿主请求体 | 8 MB | `lib/index.js` 的 `/diag` 路由（超了直接 `req.destroy()`） | 连接被丢弃 ⇒ 客户端走下载兜底 |
| 宿主 diag 目录 | **50 个** + **32 MB**（`DIAG_KEEP`/`DIAG_MAX_BYTES`） | `lib/index.js` 的 `pruneDiagDir()`：启动清一次 + 每次写入前后各一次 | **最旧先删**（按文件名里的 epoch），并打一行日志说明删了几个/释放多少；只认 `diag-<数字>.json`，不碰同目录其它文件 |

`tools/diag-subsystem-test.mjs` 的 C 段直接调 `__mpwTest.pruneDiagDir` / `limits`（**不重写一份清理逻辑**）断言：
数量上限、字节上限、最旧先删、非 `diag-*.json` 不受影响、出厂默认值 50/32MB（静态断言，防被 env 覆盖掩盖）。

## 5. 判据怎么跑（都是单文件秒级）

```bash
node tools/diag-subsystem-test.mjs     # 41 条断言 + 4 条变异自证（约 1.5s）
node tools/switch-wiring-test.mjs      # 开关接线审计（含 accent/aquaTextEnhance 解耦的双向判据）
```

`--only-a` 只跑 payload 组装段（调试用）；`MPW_DIAG_MUT_CLIENT=<copy>` 是变异自证用的内部钩子。

## 6. 覆盖边界（如实写明）

* 采集器跑在**页面上下文**，只能看到父页 DOM：网页壁纸帧内（沙箱 iframe）的实际 DOM 读不到，
  所以 `shim` 段给的是"宿主侧可观测"的证据（src 标记 / 握手标志 / sandbox 属性），不是帧内状态；
* "像素级/观感"类结论不在这里（本机无 GPU，无头 Firefox 不合成 `backdrop-filter`）；
* 字段里的路径/URL 只保留尾部 160–200 字符（够定位、防 payload 被撑爆），要看完整值请同时提供 `section` 段。

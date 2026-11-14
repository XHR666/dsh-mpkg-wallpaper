# 场景首帧预算（Z16，2026-11-15）

> 适用：`dsh-mpkg-wallpaper` 的场景渲染器（strict/legacy 两个看门狗）。
> 判据：`node tools/stale-scene-commit-test.mjs`（G6）、`node tools/mobile-shell-adapt-test.mjs`（W4）、
> `node tools/error-log-firefox-test.mjs`（B 组 + M5 变异）。

## 1. 现场（用户导出，2026-11-14）

- 场景：`custom|3326873240|scene.pkg`，体积 **246,875,625 B（235.4 MiB）**；本机 `dd/3326873240`。
  （口径：任务书/提交信息/代码注释里的"236MB"即本条 235.4 MiB 的十进制约数，同一数字。）
- 渲染器：strict 沙箱，挂载后 ~1.1s 已回 `mpw-cap{ok:true, firstFrame:false}` = **已 boot、正在加载**；
  `8.2s` 后父页判定 `scene-fallback(strict-fail)|cap-no-first-frame`，视频/静态兜底接管。
- 同一导出里 `host:__mpwHostCompatCache is not defined`：宿主 `/compat` 采集器 ReferenceError，
  `hostRuntime` 恒 null（Z6 重构遗漏声明，已在本轮同修）。

### 预算为什么必须放宽

| 读数 | 值 | 来源 |
|---|---|---|
| `/raw` 吞吐（本机，131.8MB mpkg） | 3.86s ⇒ **34.2 MB/s** | `curl -o /dev/null -w '%{time_total}'`（与本轮同机） |
| 236MB 包仅取包 | **≈ 7.2s** | 外推 |
| 渲染器取包超时 | **90s** | `renderer/demo.html` `PKG_TIMEOUT_MS`（2026-11-05 为 236MB 包单列） |
| 父页 strict 看门狗 | **8s 一步判死** | `mpwSandboxArmStrictWatch`（Z16 前） |

结论：父页 8s 比渲染器给同一份包的 90s 还短，且 236MB 仅网络传输就吃掉 8s 预算的 90% ⇒
"渲染器活着并在加载"被误判成 strict 失败。旧实现还**无视**用户设置（`sceneWatchdog` /
`sceneWatchdogSecs` 只接在 legacy 看门狗上）。

## 2. 裁决（唯一纯函数）

`mpwSceneFirstFrameBudget(remote, alive, big, userSecs)`：

| 条件 | 预算 / 步进 | reason |
|---|---|---|
| `remote`（非回环 / 移动外壳） | 60s / 15s | `remote`（Z13 口径不变） |
| 本地 + `alive`（cap ok:true 且未出画） | 60s / 15s | `renderer-alive` |
| 本地 + `big`（宿主信标 `pkgBytes` ≥150MB，且 ident 匹配） | 60s / 15s | `big-pkg` |
| 本地其余（无心跳/无大包证据） | 用户设置 3–30s，一步判死 | `local-no-signal` |

- strict 与 legacy 两个看门狗共用该裁决（legacy 的秒数基座是 `wd.secs`，strict 是 `mpwSceneWatchSecs()`）。
- **总开关生效**：`sceneWatchdog:false` / `localStorage.mpwwatch='0'` ⇒ 两个看门狗都不武装、不判死；
  strict 失败表不写，迟到首帧仍会 `mpwSceneFrameReady` 恢复。
- 一步判死计划（无任何进展证据）定时器按**完整用户预算**排；到点即判，与 Z16 前默认 8s 逐字一致。
- 可续等计划先按 15s 检查，到点按新现场重算（cap 心跳/大包可能在挂载后才到）。

## 3. 诊断

- `window.__mpwSandbox.diag().watch`：
  `{armAt, plan, cur, pkgBytes, pkgBig, userSecs, remote, enabled}`。
- strict 失败的错误 ring `detail.watch`：同口径（`plan/cur/armAt/pkgBytes/pkgBig/userSecs/remote/enabled`）。
- `window.__mpwSceneTest.state()`：`{..., secs, budgetMs, budgetReason}`。
- 测试入口：`__mpwSandbox.firstFrameBudget(remote, alive, big, secs)`、
  `__mpwSandbox.setCap({ok:true, firstFrame:false})`（桩环境无真 message 时复现"已 boot 未出画"）；
  `__mpwMobileProbe.firstFrameBudget`。

## 4. 未验 / 边界

- 真机 236MB 场景修复后是否能**出画**：本轮只证明"不再 8s 误判 + 预算按 60s 续等"；
  实际首帧耗时仍需用户在重启 DSH 后复测（本机内存 available≈3.2GB，未起浏览器）。
- `pkgBytes` 只在挂载后信标请求返回；若该请求本身失败，仍靠 cap 心跳兜底（两者任一即可续等）。
- 用户把等待时长设得很短（如 3s）且确实无 cap 心跳 ⇒ 仍按 3s 判死（这是显式设置语义）。

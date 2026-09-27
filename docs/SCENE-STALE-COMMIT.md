# 场景"迟到提交"翻盘（B1）：8s strict 看门狗 × 换档竞态

> 用户症状：**最后一次点的壁纸没留下** —— 切到某个 scene 后 1 秒内又切走（比如改成网页/视频壁纸），
> 约 **8 秒后背景自己变回那个旧 scene**，而且**刷新、切走再回来都还是旧 scene**（档位被写死了）。
> 现场与原始读数：`<工作区>/docs/reverse/STRESS-RAPID-SWITCH-20260925.md` §S2 / §S4 / §S5
> （真机 headless Firefox 复现：S2 1/5、S4 1/3、S5 **3/3** 轮翻盘；S1/S3 同类型连点不翻盘 —— 
> 这正是它容易被漏测的原因：**只有"scene 之后又切走"才看得见**）。
>
> 判据：`node tools/stale-scene-commit-test.mjs`（74 条；6 组变异各自必红，~1s，全离线）。

---

## 1. 根因（符号定位；行号为 2026-09-28 工作树，行号会漂，按符号 grep）

| # | 位置（符号） | 行为 |
|---|---|---|
| ① | `mpwSandboxArmStrictWatch`（`lib/client.js:4187`，原报告 `:4106`） | strict 场景挂载时起一个 **8s 一次性 `setTimeout`**；旧写法**换档/切走时不取消**（`clearTimeout` 不成对）⇒ 定时器一直悬挂着到点 |
| ② | `mpwSandboxFail`（`:4169`，原报告 `:4093`） | 到点后 `__mpwSandboxCap.firstFrame` 仍为假 ⇒ 判"8s 没出首帧"，**无条件** `applySceneViaRenderer(__mpwSandboxLastMeta)`（原报告 `:4102`）|
| ③ | `__mpwSandboxLastMeta`（`:3734` 附近声明，`:6303` 挂载时写入） | 是**模块级"最近一次场景挂载的 meta"**，不随用户改选失效 ⇒ 8 秒前那个 scene 被**重新 commit**：`converted/sceneKey/webUrl` 一起写回 localStorage + 宿主 settings ⇒ 刷新也拿回旧 scene |
| ④ | `mpwSandboxMaybeUpgrade`（`:4157`，原报告 `:4081`） | **同族**：token 是异步取回的，迟到时同样**无条件**重挂旧 scene（原报告 `:4089`）⇒ 同一类翻盘，只是触发窗口更短 |

为什么"8s 没出首帧"这个观察是**无效**的：用户切走时那张渲染器 iframe 早已被导航走/卸载，
首帧永远不可能到 ⇒ 这不是"渲染器慢"，而是"被测对象已经不存在了"。

## 2. 修法（三件事，全部走仓内既有素材）

1. **换档/切走必须成对 `clearTimeout`**：新增 `mpwSandboxCancelStrictWatch(why)`（`:4146`），
   在这些"当前档不再是这个 strict scene"的位置调用（每个位置都紧挨既有的 `disarmSceneWatchdog`）：
   - `showWebEl` 的 `else` 分支（`:4601`）—— **网页壁纸 / legacy 场景**（正是 B1 最小复现那条路）；
   - `showImageEl`（`:3458`）、`showVideoEl`（`:3499`）、`showSceneEl`（canvas 合成，`:6507`）；
   - `teardownWebFrame`（`:3435`，卸载 web iframe = 这次 strict 观察作废）；
   - `mpwSandboxArmStrictWatch` 自身在重新武装前先撤旧的（与改前一致，保持"重挂不叠加"）。
2. **迟到重挂前核对当前档**：新增 `mpwSandboxStaleNow(why)`（`:4110`），用**仓内既有** `sectionSigNow()`
   （`:621`；时段导入 `:2527`、时段切换 `:2637` 已在用同一套"迟到提交先核对当前档"口径）比较
   "该 meta 挂载时写入的档位签名"`__mpwSandboxLastSig` 与"现在的档位签名"：
   不同 ⇒ **丢弃**这次重挂，**并且不把该 ident 记成 strict-failed**
   （否则用户切回同一 scene 会被无谓降级 legacy —— 那是旧写法留下的第二重伤害）。
   签名的记录点（`mpwSandboxMarkSig`，`:4099`）有三处：场景挂载成功（`:6435`）、
   strict 看门狗武装（`:4194`）、同场景原地改调试参数（`:4412`）——
   第三处是为了"改 `sceneDebugParams` 只换 webUrl、sceneKey 不变"那条路不被误判成换档。
3. **如实记账（不静默）**：`mpwSandboxReattach`（`:4135`）是迟到重挂的**唯一入口**
   （契约：调用方先核对），两种结局分别计数：`staleDrops/staleLast`（丢弃）vs
   `reattaches/reattachLast`（正常重挂）；丢弃时向宿主 `POST /diag`
   `{kind:"scene-sandbox", why:"stale-drop", reason, ident, sigWant, sigNow}`，并 `console.info` 一行。
   全部读数经 `window.__mpwSandbox.diag()` 可查：`watchArmed / staleDrops / staleLast / reattaches /
   reattachLast / watchCancels / watchCancelLast / sigRecorded / sigMarkedBy`（新增字段，纯增量）。

**回退口**：无需新旗标 —— 这一改动没有"行为开关"，只有"迟到就丢弃"一条语义；
若要临时回到旧行为做二分，把 `mpwSandboxFail` 里那次 `mpwSandboxStaleNow(why)` 提前返回去掉即可
（但**不建议**：那正是"档位被写坏"的入口）。真机二分可用既有的 `?mpwsandbox=legacy`
（`mpwSandboxForced()`）绕开 strict 路径 —— 走 legacy 时压根不会起这个 8s 定时器。

## 3. 判据与读数（`node tools/stale-scene-commit-test.mjs`，74 通过 / 0 失败）

| 组 | 内容 | 读数 |
|---|---|---|
| G1 | strict 挂载（token 路由可用） | `diag.last.mode=strict`、假定时器表里**恰 1 条 8000ms**、`watchArmed=true`、`sigRecorded=true` |
| G2 | ①切走（面板 commit 一条 web 档，走真 `showWebEl`） | 假表 8000ms **0 条**、`watchArmed=false`、`watchCancels=1`、`watchCancelLast.why=showWebEl:non-strict` |
| G2 | 把"未取消时就会到点"的**真回调**推到点 | 档位/`webUrl` 仍是最后一次选择的 web（内存 + localStorage **两处**）、渲染器帧数不变、`staleDrops+1`、`reattaches=0`、宿主 diag 一条 `stale-drop`、**没有** `strict-fallback`、`failed` 表**未**写入 |
| G3 | ②切走再切回同一 scene ⇒ 定时器到点 | `reattaches=1`、`reattachLast.why=strict-fallback:…`、`staleDrops` 不变、该 ident 记入 `failed`、重挂的是 **legacy** URL（不再带 `sandbox=strict`）、档位仍是 scene |
| G4 | ④同族 token 迟到（`mpwSandboxMaybeUpgrade`） | 换档后 token 到手 ⇒ 丢弃（`staleDrops+1`、`reattaches=0`、档位/帧都不动）；**未换档**的对照 ⇒ 正常升级重挂（`reattaches=1`、URL 带 `sandbox=strict`、帧 +1） |
| G5 | 变异自证 | **D1** 去 token 升级路径的 stale 判定 / **D2** 去 8s 失败路径的先行核对 / **D3** 去换档取消调用 / **D4** `clearTimeout` 空转 / **D5** 档位签名不记 / **D6** 丢弃不记账 —— 6 组**各自必红**（并断言"期望的那条判据确实红"） |

口径（为什么这不是"自己写一份等价逻辑"）：用例走的是**生产路径**
（`__mpwSceneTest.applyScene` = `applySceneViaRenderer`；换档走面板同一条 `writeSection` + `applyFromStorage`），
定时器用假表驱动 —— `_stub.mjs` 的 world 定时器在**调用时**读 `globalThis.setTimeout`，
所以换掉全局即可让插件内部的定时器进表；"把定时器推到点"= 直接调用那次武装**真正注册的回调**
（先把它从表里取出来，模拟"旧写法没取消"），既不睡 8 秒，也不是模拟逻辑。

## 4. 未验证边界（如实记）

- **真机（:3080 + 浏览器）复跑本轮没做**：只读探针确认**运行中的宿主给浏览器的客户端仍是启动期缓存的那一版**
  （`/tmp/b1-live-probe.mjs` 读数：`window.__mpwSandbox.diag()` 的键只有
  `last/attr/tokens/failed/upgraded/pending/cap`，**没有** `watchArmed/staleDrops/reattaches` ⇒ 服务的是改动前的
  `lib/client.js`）。压测报告自己也记了同一现象（"测试所用版本 = 宿主加载期缓存的那一份"）⇒
  **不重启/重载宿主就无法用浏览器验证这次修复**，本轮按纪律没有重启 3080；因此
  "面板点 4 次 + 等 15s ⇒ 档位没被改回"这条真机口径**未验证**（改动前它在报告里已 3/3 复现）。
  宿主重载后可直接复跑报告 §最小复现；判据读数看 `__mpwSandbox.diag().staleDrops/watchCancels`。
- ⚠ **只读探针也会改宿主档**（本轮实测，值得单独记）：只要用浏览器打开一次 :3080，插件 boot 就会
  `GET /settings` → 合并 → `mpwBootSettle` 落盘（`PUT /settings`），于是
  `~/.dsh-mpkg-wallpaper/settings.json` 的 `__mpwHostAt` 被重新盖章，**并且宿主内存里那份"上一轮压测残留的
  `customDirPath=/tmp/mpw-stress-corpus`"会被一并写回文件**（把用户真实的 `.../wallpaperE/小鸟游星野` 顶掉）。
  本轮已用存档原文 `PUT` 复原并 `cmp` 逐字节相同（sha256 `e0796a31…`，与压测报告基线一致）；
  另 `media-audio.json` 仅 `updatedAt` 被重新盖章（值未变）、`custom-dir.json` 未动（sha256 `855cef08…`）。
  **教训**：真机探针前先备份 settings.json，跑完按报告 §"用户设置档：改动与复原"同款复原。
- **真机首帧耗时不同** ⇒ 8s 窗口内的触发概率需真机复测（纯 JS 逻辑一致，与设备无关）。
- **多标签页同时改档**、以及"刷新恰好落在 8s 定时器触发瞬间"的更极端交错：仍未覆盖。
- **scene 的真实画面**（渲染器 WebGL2 在本机 headless 不可用，见报告 B5）：本轮只验证挂载/档位/元素账。
- 同场景"改调试参数"与 token 迟到**同时**发生时，签名刷新点（`:4412`）覆盖了 legacy 挂载那条路，
  但没做交叉时序的专项用例。

## 5. 与 B2（目录型壁纸整类消失）的关系

B2 的**生产实现不存在于本次改动里**：`listWallpaperFiles` 的 `Dirent` 类型不可信 / 真软链兜底
（`lib/web-wallpaper.js:306-345`）由"类型判定轮"完成，回归判据在
`tools/web-wallpaper-test.mjs`（431/0）与 `tools/type-detect-test.mjs`（48/0），规格见 `docs/TYPE-DETECT.md`。
本次只补了一次**只读**真语料读数（`/tmp/b2-scan-readout.mjs`，不写任何文件）：

| 语料目录 | 旧口径（只认 `Dirent.isFile()`） | 现行实现 | 判定 |
|---|---|---|---|
| `allwallpaper/dd`（根，含子目录） | 201 | **352** | — |
| `dd/3715743282` | **0** | 3 | `scene(scene-container)` |
| `dd/3721991999` | **0** | 3 | `scene(scene-container)` |
| `dd/3580207945` | **0** | 24 | `web(html-entry)` |
| `dd/3646392375` | **0** | 121 | `web(html-entry)` |
| `wallpaperE` | 147 | **150** | `scene(scene-container)`，mpkg=148 |
| `wallpaperE/佩丽卡 · 卡提希娅 · 白洲梓` | 10 / 9 / 18 | **11 / 10 / 19** | 各 +1（软链真文件） |

合计抽查 45 个目录：旧口径数出 **0** 条的有 **6** 个（整张壁纸消失）；现行实现 **43/45** 数出 >0，
剩下 2 个（`wallpaperE/未分类`、`wallpapertest1`）是**真空目录**（`ls -A` 无条目）。

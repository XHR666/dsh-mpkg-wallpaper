# 壁纸持久化（刷新不丢）：阈值表 / 写入路径 / 失败降级

> ①(2026-09-17 独立成线) 前一条线排查 `.mpw-bgWrap` 可见性时发现：**刷新后壁纸选择有时会丢**。
> 本文是该 bug 的判据、修法与复测方法；回归门禁 `tools/persist-test.mjs`（`tools/check.sh` 第 2 步）。
> 配套测量器：`tools/persist-size-scan.mjs`（只读语料量 dataURL 真实体积，实测数字见 §3）。

## 1. 机制（真因）

壁纸 `image` 经常是 **dataURL**（内联 base64），它被塞进同一个 `localStorage` 单值里：

| 环节 | 位置 | 上限口径 |
|---|---|---|
| 写 localStorage | `lib/client.js` `mpwLsSafeSet()` | **`MPW_LS_MAX_BYTES = 262144`（256 KB）**，超限**拒写** + 一行 `console.warn` |
| 写 IndexedDB（大图） | `lib/client.js` `storeImage()` / `storeImageBlob()` | 旧代码写死 **`2 * 1024 * 1024`（2 MB）** 才算"大图" |
| 宿主 `/settings` | `lib/index.js` 路由 + `HOST_SKIP_KEYS` | **不保存 `image`**（宿主只存它自己的字段） |

⇒ dataURL 落在 **(256 KB, 2 MB]** 这一带时：既被 localStorage 拒写、又按"小图"内联、宿主也不存
⇒ **没有任何一路保存过这个选择**，刷新后回默认壁纸。而且旧代码那条 catch 只写了注释
`/* 存储满时静默失败 */`，用户拿不到任何提示。

读侧还有第二处静默：`image === "idb:img"` 分支旧实现只认 `v instanceof Blob`，而写侧
`storeImage()` 落进 IDB 的是 **dataURL 字符串** ⇒ 命中时**什么都不做**（壁纸区空着，无提示）。

## 2. 阈值表（**真值只此一处**）

| 常量 | 真值（字节） | 人类口径 | 定义处（唯一定义点） | 语义 |
|---|---|---|---|---|
| `MPW_LS_MAX_BYTES` | 262144 | 256 KB | `lib/client.js`（`mpwLsSafeSet` 上方） | 单个 localStorage 值的硬顶；超限**拒写**（既不截断也不静默） |
| `MPW_LS_SPILL_BYTES` | 2097152 | 2048 KB | `lib/client.js`（同上，紧邻） | 只写 IndexedDB 的线：`image` 长度 **>** 该值（`storeImage`/`storeImageBlob` 判据）或整串 JSON 放不进 localStorage 时 ⇒ 落 IDB，localStorage 只留 `idb:img` 哨兵 |

判定顺序（`mpwPersistSection()`，**唯一落盘入口**）：

1. `JSON.stringify(section).length + 160 ≤ MPW_LS_MAX_BYTES` → **整串内联**（老路径，小图不受影响）；
2. 否则抽掉 `image` 再试 → 放得下就把 `image` 落 IDB（长度 > `MPW_LS_SPILL_BYTES` 的 dataURL，或任意放不下的 dataURL；
   `host:`/`blob:`/`http` 这类引用直接重写回 JSON）并留哨兵 `image: "idb:img"`；
3. 连抽掉 `image` 都放不下（`propEdits` 等配置过大）→ **整段** `section` 落 IDB，localStorage 只留
   `{"secIdb":1}` 哨兵，读侧回读重放；
4. 以上都失败（localStorage 满 + IndexedDB 不可用）→ 留痕 `__mpwPersistFail`（本地存储里几十字节）
   + 面板弹窗/hint + `console.error`：**明确告知"刷新后会丢"，绝不静默**。

> 旧口径 `2MB 以内可直接内联进 localStorage` 是**错的**（256 KB 就写不进去了），已从代码与文案里清除；
> 面板文案里的两个数字由常量算出（`Math.round(MPW_LS_SPILL_BYTES / 1048576)` /
> `Math.round(MPW_LS_MAX_BYTES / 1024)`），不再手写。

## 3. 真实语料实测（dataURL 体积分布）

`node tools/persist-size-scan.mjs`（口径：`pickBackgroundEntry` 命中项 → 真字节数 →
`dataURL = 前缀 + ceil(字节/3)*4`，GIF 走真 `ensureInfiniteGif`）：

| 包 id | 条目 | 素材字节 | dataURL 字节 | 超 256 KB | 超 2 MB |
|---|---|---|---|---|---|
| `allwallpaper/dd/3716620662` | preview.gif | 1047660（1023.1 KB） | **1396902（1364.2 KB）** | 是 | 否 |
| `allwallpaper/dd/3470764447` | preview.gif | 1046401（1021.9 KB） | 1395226（1362.5 KB） | 是 | 否 |
| `allwallpaper/dd/3660962877` | preview.gif | 1045423（1020.9 KB） | 1393922（1361.3 KB） | 是 | 否 |
| `allwallpaper/0917/3233141951` | preview.gif | 1043906（1019.4 KB） | 1391898（1359.3 KB） | 是 | 否 |
| `allwallpaper/0917/3299228616` | preview.gif | 1037131（1012.8 KB） | 1382866（1350.5 KB） | 是 | 否 |
| `allwallpaper/dd/3719111841` | preview.gif | 1036585（1012.3 KB） | 1382138（1349.7 KB） | 是 | 否 |
| `allwallpaper/wallpaperE/遐蝶/夜莺Night——….mpkg` | preview.gif | 1019773（995.9 KB） | 1359722（1327.9 KB） | 是 | 否 |

**结论**：`dd` + `0917` 共 34 个图片类候选，dataURL 中位数 **1129.1 KB**、最大 **1364.2 KB**，
**34/34 全部超 256 KB、0/34 超 2 MB** —— 也就是**整批**都落在"被拒写又不落 IDB"的缝里。
这不是"少数大图"的边角情况，而是**主力壁纸普遍命中**，与用户"为什么有时刷新就回到默认壁纸"一致。
（另有 11 个 `wallpaperE` 候选是内嵌视频/目录 mpkg，走 Blob→IndexedDB，不在此列。）

## 4. 失败降级行为（**不静默**）

| 场景 | 行为 | 可见性 |
|---|---|---|
| 大 dataURL（≥ `MPW_LS_SPILL_BYTES`） | 只进 IDB，localStorage 留 `idb:img` | 面板一行"当前壁纸较大，已存入 IndexedDB（刷新/重启后自动恢复）"+ 状态 `__mpwPersist.state().usedIdb === true` |
| 超 256 KB 但 < 2 MB（历史缝区） | 同上（抽掉 `image` 后整串放得下） | 同上 |
| 落 IDB 失败（回读校验不通过） | **不返回假哨兵**，原样内联并留痕 + 弹窗 | 弹窗 + hint + `console.warn`（写明"刷新后会丢"） |
| IDB 不可用（隐私模式/被禁） | localStorage 拒写 ⇒ 留痕 `__mpwPersistFail` | 当场 `console.warn`；**下一次加载**弹窗"上一次的壁纸设置没有存下来（原因）" |
| 哨兵 `idb:img` 读回来是空/形态不对 | 不假装成功 | `mpwPersistEmit` → 弹窗"壁纸数据在 IndexedDB 里缺失…请重新选择" |
| 整段 section 落 IDB 且读不回来 | 不假装成功 | 弹窗"整段存在 IndexedDB 里，但读不回来…" |

告警通道：工厂层 `mpwPersistEmit()` → ① `console.error`（`localStorage['mpwdiag']='1'` 时随 `/diag`
上报）② 面板弹窗 + hint ③ 面板未挂载时先排队（`mpwPersistTakePending()`），挂载后立刻显示。

## 5. 回退开关

| 开关 | 默认 | 作用 |
|---|---|---|
| `?mpwpersist=legacy` | 关（= 修复后行为） | 回到旧行为：只有 > 2 MB 才落 IDB、localStorage 拒写就丢，**且不留痕/不告警**。用于真机 A/B（`__mpwPersist.legacy()` 可读当前档位） |

## 6. 判据与复测

```bash
node tools/persist-test.mjs                  # 34 条断言：阈值一致 / 大图重载恢复 / IDB 不可用告警 / 小图原路径 / legacy 变红
node tools/persist-size-scan.mjs --top 14    # 只读语料量 dataURL 体积（§3 的数字）
```

`persist-test.mjs` 的分辨力自证（PART 5）：`?mpwpersist=legacy` 或删掉"落 IDB"分支时，
PART 2 的「重载后仍能恢复」「localStorage 里留 `idb:img` 哨兵」等断言必须变红；
对**修复前**的副本（`git show HEAD:lib/client.js > /tmp/before.js`）跑 `--client /tmp/before.js`，
PART 0 的钩子守卫就会红（旧代码没有 `__mpwPersist`）。

真机复测（无头 Firefox 不再需要：本链路是纯存储语义，Node 桩里用**真插件 + 假 DOM + 假 IndexedDB**
跑真实现，跨 "重载" 复用同一份 localStorage/IDB 数据）：

1. 面板里选一张 >256 KB 的本地图片/GIF → 确认出现"已存入 IndexedDB"状态行；
2. 刷新页面 → 壁纸仍在（`__mpwPersist.read().image === 'idb:img'`，`#mpw-bgImg.src` 是原 dataURL/objectURL）；
3. 隐私窗口（IDB 不可用）重复 → 必须弹窗/警告，而不是"刷新后悄悄回默认"。

## 7. 未定项 / 边界

- **宿主能否提供"引用而非内联"的数据源**：实测**只能覆盖一部分**。`/custom-media`（`host:?custom=1&…`）
  能服务自定义目录里的原文件，但 `onMedia`（本地单文件）、容器内 `preview.gif`、URL 壁纸都没有
  宿主可寻址的落点（宿主 `/settings` 明确跳过 `image`，也不持有上传副本）。所以本轮**没有**改成
  "只存引用"，而是把 IndexedDB 这条路接通（对图片、GIF、mpkg 预览图、本地单文件一律有效）。
- `bgsec`（整段 section 落 IDB）与 `bg`（媒体）是两个 key：切壁纸时只覆盖 `bg`，`bgsec` 仅在极端
  配置下才写；两者都在**浏览器侧**（站点 IndexedDB），**不进**宿主的 `~/.dsh/.dsh-mpkg-wallpaper/`，
  因此与宿主那套"数量 + 字节"双上限无关（实测该目录 1.5MB：`diag-*.json` 50 个 / 1.4MB，正好顶在既有
  `DIAG_KEEP=50` / `DIAG_MAX_BYTES=32MB` 口径上；`transcodes/` 0 个，上限 12 个 / 512MB）。
  副作用要说清：**清浏览器站点数据会丢 IDB 里的那张壁纸**（最后成功保存的配置仍在 localStorage /
  宿主 `/settings`），此时需要重新选一次图。
- 未做：IDB 配额逼近时的主动清理/淘汰（`navigator.storage.estimate()`）。当前只在写入失败时显式告警。

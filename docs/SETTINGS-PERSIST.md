# SETTINGS-PERSIST —— 壁纸选择字段为什么会丢 / 怎么修 / 判据是什么

> ①(2026-09-19 设置持久化轮 · 真机 `:3080` 现场)
> 本条只解决一件事：**用户明明选了壁纸，`image`/`webUrl` 却从两处存储里消失，
> 于是 `buildCss` 的 `hasImage=false` ⇒ `.mpw-bgWrap{display:none}` ⇒ 用户看不到壁纸。**
> 台账：渲染器仓 `we-scene-demo/docs/PATCHES.md` 的 **P-157**（跨仓先例 P-155/P-156）。
> 机器判据：`tools/settings-persist-test.mjs`（门禁名 `settings-persist`，接在 `tools/check.sh` 第 2 步内）。
> 真机探针：`tools/settings-persist-live-probe.mjs`（只读诊断 + `--save-toggle <key>` 的保存前后 diff）。

---

## 1. 现场读数（真机，不是推测）

`node tools/settings-persist-live-probe.mjs`（headless Firefox 打开真 `:3080`）在**修前**读到：

| 口径 | 读数 |
|---|---|
| 浏览器 `localStorage['dsh.mpkg-wallpaper.v2']` | 1649 B，**`{"mpkgKey":"custom|3582362359","converted":"mp4","source":"小鸟游星野Hoshino（中秋）…"}`** |
| 插件内存 `sectionCache`（`window.__mpwPersist.read()`） | 同上——**没有 `image`、没有 `webUrl`** |
| 宿主磁盘 `<DATA_DIR>/settings.json`（= `/root/.dsh-mpkg-wallpaper/settings.json`，由 `PUT` 写） | 同样 **`image`/`webUrl` 都不在**（`mpkgKey:"custom|3582362359"` 在、`converted:"mp4"` 在） |
| 真机 CSS/DOM | `#mpw-bgWrap` 存在，`getComputedStyle(wrap).display === "none"`，生成的样式表里有 `.mpw-bgWrap{display:none}` |
| 插件自身记账 | `__mpwErrRing()` 空、`__mpwPersistFail` 无、`mpw_settings_backup` 无 ⇒ **没有任何"存不下"的留痕** |

补充事实（同一轮量到的，影响判据设计）：

* 目标素材**真的存在**：`customDirPath=/root/Desktop/DSHarea/allwallpaper/dd` 下确实有 `3582362359/Mid-Autumn Hoshino.mp4`
  ⇒ `mpkgKey="custom|3582362359"` 足以把源推回来。
* `mpkgKey:"custom|3582362359"` 里的这段数字**不是哈希**，就是**目录名**（见 `tools/np-media-test.mjs:265` 的夹具与
  `docs/NOW-PLAYING-DSH.md:774`）。这条纠正了"custom|<id> 是某种 token、丢了就不可恢复"的直觉。

---

## 2. 根因链（`文件:行` 逐跳）

修前的实现（`git show 9be7ec5:lib/client.js`）里，壁纸选择字段有**四条独立的丢失路径**，
其中**主因是 ⓐ**，ⓑ/ⓒ/ⓓ 是"丢了以后永远回不来"的次因。

### ⓐ 主因：两处存储都是"整档替换"，缺字段的档会把完整档写残

1. `lib/client.js` `writeSection()`（修前 :380，`persistTimer` 回调 :401–445）
   —— 把**内存里的整段 `sectionCache`**（减 `HOST_SKIP_KEYS`）写进 localStorage，并 **PUT 给宿主**：
   ```js
   const payload = {};
   for (const k of Object.keys(sectionCache || {})) {
     if (!HOST_SKIP_KEYS.includes(k)) payload[k] = sectionCache[k];
   }
   fetch(HOST_BASE + "/settings", { method: "PUT", body: JSON.stringify(payload) })
   ```
   ⇒ "这次保存"与"这份档完不完整"**没有任何关系**。
2. `lib/index.js` `PUT /api/mpkg-wallpaper/settings`（修前 :1668–1680）
   —— 宿主把请求体**整串覆写**磁盘文件：
   ```js
   writeFileSync(tmp, JSON.stringify(settings)); renameSync(tmp, filePath);
   ```
   ⇒ 客户端发来的缺字段载荷，会把宿主那份**完整档**也一起抹掉（两处一起写残）。
3. 而 `HOST_SKIP_KEYS`（`lib/client.js:286`）**明确跳过 `image`**
   ⇒ 宿主那份**永远不会有 `image`**；壁纸源在宿主侧本来就只有 `webUrl` 一半。
   于是"两处一起残"的表现就是现场读到的：`mpkgKey` 在、`image`/`webUrl` 都不在。

**这一跳是本条的主因**：`image`（壁纸源）只有 localStorage 一份，而写入路径没有任何"缺字段不覆盖"的护栏。

### ⓑ 次因：boot 的第一次渲染/落盘跑在宿主 `GET /settings` **之前**

`lib/client.js` `applyInner()`：`applyFromStorage()`（修前 :16099）在
`initHostSettings()`（修前 :16133）**之前**执行。那一刻内存里的档最不完整（宿主带回来的外观字段还没合并），
而 `writeSection` 的防抖定时器只有 250ms
⇒ **"先渲染一次无源档（display:none）" + "可能把这份残档写进两处存储"** 同时存在。
现场表现：刷新后壁纸先消失、（若宿主还有 `image`）再回来。

### ⓒ 次因：两处存储的新旧**没有任何裁决口径**

`initHostSettings()`（修前 :301–323）的合并是：
```js
const merged = Object.assign({}, d.settings, local);   // 只是"本地有的用本地"
for (const k of ["image","info","propEdits","webUrl"]) if (local[k] !== void 0) merged[k] = local[k];
```
* 两处**谁新**完全没判（`Object.assign` 的先后顺序就是全部规则）；
* 合并结果**只写回 localStorage**（`mpwPersistSection(merged)`），宿主那份半残档**永远修不回来**
  —— 下一轮宿主 GET 又把残档喂回来，形成"越刷新越残"的闭环。

### ⓓ 次因：读侧对"半残档"照单全收，没有任何自愈

`buildCss()` 的 `hasImage = !!(section.image || section.webUrl)`（`lib/client.js:8688`，修前同）
⇒ 半残档直接落进 `if (!hasImage)` 那条 `display:none` 分支；
而 `mpkgKey`（"custom|3582362359"）明明足以反推源（见 §1），读侧却**从不尝试**，
也**没有任何提示** —— 用户看到的就是"壁纸没了"，无处可查。

### 已证伪的怀疑方向（逐条给证据）

| 方向 | 结论 | 证据 |
|---|---|---|
| `boolFields` / 导入净化把未知字段丢掉 | **否** | `lib/client.js:13255–13266`：净化只作用于**备份导入**（`BACKUP_FIELDS` 白名单），且 `image`/`webUrl`/`mpkgKey` 根本不在 `BACKUP_FIELDS` 里 ⇒ 导入备份既不写也不删它们。（另注：`strFields`（:13296）只放颜色/调试参数字符串，`unifyAmount`/`sidebarAlpha` 等数值键在 `numFields` 里 —— 这段净化目前**没有**丢字段的真 bug。） |
| "恢复默认"把壁纸一起清掉 | **否（当前实现）** | `resetSettings()`（:12724–12753）先 `keep = {image, source, mpkgKey, …, converted, propEdits}` 再写回，语料里 `image` 被保留。行为断言见门禁 D9/D10。 |
| `commit(patch)` 做的是"整段覆盖" | **是，但不是主因** | `commit`（:11896）与工厂层 `mpwSceneCommit`（:1697）都是 `Object.assign({}, readSection(), patch)`：`patch` 里 `undefined` **会覆盖**（`image: undefined` 是刻意用来"切到 web 壁纸时丢掉旧 image"的），但只要 `readSection()` 还有源，这条路径本身不会抹字段。**真正危险的是 `writeSection` 收到"调用方自己拼的缺字段 next"**（:319 的宿主合成结果、:661 的 `mpwMarkPersistFail` 留痕写），而它没有护栏。 |
| `localStorage` 拒写（>256KB）导致丢 | **否（本次现场）** | 现场档只有 1649 B；`__mpwPersist.state().ok === true`、`usedIdb === false`、`__mpwPersistFail` 不存在 ⇒ 不是 2026-09-17 那条"大图落 IDB"的路径（那条由 `tools/persist-test.mjs` 继续看住）。 |
| `mpkgKey` 在库重扫后找不到条目 ⇒ 上层清空 `image` | **未证** | 库里**能**找到（§1）；代码里没有"扫不到就把 `image` 置空"的分支（`grep -n "image: \"\""` 只命中 `clearBg` / `enabled===false` 两条**显式**清空路径）。 |

**取证边界（诚实）**：真机那一份档**是在什么时刻**变成半残的，没有留下可判读的时间戳
（修前两处存储都不带写入时刻，diag 环形缓冲也没有相关事件）⇒ 只能钉死"结构性缺陷 + 现场状态"，
不能钉死"那一刻是哪一次点击触发的"。这正是本次修法要补的能力：**从这一版起，两处存储各自带写入时刻
（`__mpwLocalAt`/`__mpwHostAt`），任何一次丢失都能在 `__mpwTrace` 里查到 `settings:reconcile` 的裁决理由。**

---

## 3. 修法（三条不变量 + 一条自愈链）

### 不变量Ⅰ 合并不替换 —— `mpwMergeSection(base, patch)`（`lib/client.js:836`）

* `patch[k] === undefined` ⇒ **不覆盖** base（旧写法 `Object.assign` 会把这个键一起写掉）；
* `patch[k] === null` ⇒ **显式删除**（唯一的删除语义）；
* 其余照常覆盖。

### 不变量Ⅱ 源字段粘性 —— `mpwStickySource(base, next)`（:851）

`next` 里**没有**源字段（`image`/`webUrl`/`sceneKey`）而 `base` 有 ⇒ 从 `base` 带过来。
显式清空（`""`）与显式删除（`null`）都不受影响 —— **用户主动清壁纸仍然能清掉**（门禁 D 组）。

`writeSection()`（:390–405）落盘前依次走：`mpwStickySource` → `mpwMergeSection`，并把三个入口都覆盖：
面板 `commit`、工厂 `mpwSceneCommit`、宿主合成结果回写。

### 不变量Ⅲ 两处存储的显式裁决（`lib/client.js:877`）

* 每份档带**自己的**写入时刻：本地写 `__mpwLocalAt`、宿主 PUT 带 `__mpwHostAt`（互不覆盖）；
* 启动合成 `mpwReconcileStores(local, host)`：
  * 两边都有时间戳 ⇒ **新者优先**（`local-newer(Δms)` / `host-newer(Δms)`，理由进 trace）；
  * 只有一边有 ⇒ 那一边优先（理由是 `host-unstamped` / `local-unstamped`）；
  * 两边都没有（升级上来的旧档）⇒ 如实标 `newer:"unknown"` + `no-stamps(...)`，**不假装知道谁新**；
  * 合成规则是 **`mpwOverlayFill(win, lose)`（补空缺、不覆盖）**：两端都有的键由时间戳裁决，
    只有一端有的键一定保留。**写错过两次**（都靠门禁 B1/B4 抓出来，函数注释里留了记录）。
* 宿主侧同一条契约：`lib/index.js` 的 `PUT /settings` 改成**逐键合并**，`null` 才删。

### boot 收尾闸门（`lib/client.js` 的 `mpwBootPending` / `mpwBootSettle`）

`applyInner` 第一次跑时置 `mpwBootPending=true` 并**先把本地那份合成出来**（渲染第一帧就是完整的）；
这之后到宿主 `GET /settings` 回来（或 3.5s 超时）之间的任何写**只置脏、不落盘**，
收尾时补落一次。⇒ 掐掉 ⓑ 那条"先渲染无源档 + 把残档写死"的窗口。

### 半残档自愈链（`lib/clinent.js` 的 `mpwHealHalfArchive`，:1000 起）

判据 `mpwSrcMissing(s)`：**有来源线索（`mpkgKey`/`source` 非空）却没有源字段**（干净的空档不算）。

1. **先查本地备份** `mpw_settings_backup`（面板被误重置时写的那份）——有源就直接还原；
2. 否则按 `mpkgKey` **反推**（只读宿主路由，不猜路径）：
   * `custom|<folder>` ⇒ `POST /custom-dir` 取清单 → 命中该 folder 那条 → 按 `type`/`media` 拼
     `host:?custom=1&folder=…&file=…`（同一目录**多个候选**时**不猜**，直接算"推不出"）；
   * `custom|<folder>/<file>` ⇒ 直接拼；
   * `custommpkg|<folder>/<file>` ⇒ `GET /custom-mpkg` 换一个**新鲜 token**；
   * `library|<ltoken>[|<file>]` ⇒ web 走 `/library-web`、其余走 `/library-scene-*`；
3. **能推就推**：写回两处存储（走同一条 `writeSection` 护栏）+ **渲染前生效**（不闪一帧 display:none）
   + trace `settings:heal` + 面板一行提示 + `__mpwPersist.healState()` 可查；
4. **推不出就明确提示**：`mpwPersistEmit("…请在「壁纸」页重新选一次壁纸 —— 已保留其余全部设置")`，
   **不改写**用户的档、**不伪造**假源；
5. **只做一次**：同一把 `mpkgKey` 只尝试一次；迟到那次若用户已换壁纸/清壁纸 ⇒ 丢弃结果（幂等性）。

---

## 4. 判据（无浏览器，驱动真代码）

`node tools/settings-persist-test.mjs` —— **111 通过 / 0 失败**（7 组变异自证；`--no-mutations` 只跑主体）。
它用 `tools/_stub.mjs` 把**真 `lib/client.js`** 在假 DOM 里 `apply()`，并用**真 `lib/index.js`**
（`DSH_HOME` 指临时目录，绝不碰用户数据）驱动真 `/settings` 路由。

| 组 | 判据 |
|---|---|
| A | 一次"无关开关"保存后**逐字段 diff**：`removed=[]`、`changed` 只有这一次改的键、源字段逐字节不变；部分档写入（`next` 里没有 `image`）后 `image` 仍在；宿主 PUT 仍跳过 `image` |
| B | 两处存储裁决 4 种组合（本地新 / 远端新 / 仅本地 / 仅远端）+ 无时间戳的保守档；每种都断"源字段不许丢" |
| C | 半残档自愈：能推导（真走 `/custom-dir`）⇒ 写回两处 + **`buildCss` 产物里不再有 `.mpw-bgWrap{display:none}`**；备份优先；**推不出 ⇒ 明确提示 + 不改写 + 不伪造**；**只做一次** |
| D | 显式清空壁纸仍然能清空（`image:""` / `null`），自愈**不复活**；清空后 `buildCss` **应当**生成 `display:none`（"无源就隐藏"是正常语义） |
| E | 三条不变量本身（合并/粘性/元键不进 section） |
| F | boot 收尾闸门：宿主未回来时 localStorage 一个字节不动、脏标记不丢、收尾补落盘、宿主 404 也必须收尾 |
| G | **真宿主模块**：`PUT` 合并不替换（本次没提的键保持原值；客户端从不发的 `image`/`info`/… 一个都没丢；`null` 才删；坏 JSON 仍 400） |
| H | **7 组变异**各自必须让**指定那一组**变红：`merge-deletes-undefined`(E) / `partial-write-drop`(E) / `writesection-no-guard`(A) / `boot-merge-off`(B) / `local-always-wins`(B) / `heal-off`(C) / `host-put-blind-overwrite`(G) |

> ⚠ **如实标注两条护栏的交互**："`undefined` 不覆盖"（`mpwMergeSection`）与"源字段粘性"
> （`mpwStickySource`）是**两层**：单独拿掉任意一层，另一层仍能把 A16 那条"部分档写入"兜住 ⇒
> 它们的独立分辨力落在 **E 组的不变量断言**上（E1/E7）。真机上最常见的误删形态是
> "两层一起去掉"，由 `writesection-no-guard`(A) 钉住。**没有**为"单独拿掉粘性"设变异，因为
> 它在本实现里不会变红（设了就是假绿/假红）。

门禁接线：`tools/check.sh` **第 2 步内**追加一行（不新开 step —— `integrity-check` 断言 `step N/M` 分母与序号连续）。

---

## 5. 真机复核（`tools/settings-persist-live-probe.mjs`，同一台机器、同一个 `:3080`）

**原则**：`bash update-plugin.sh` 同步进 profile、逐个文件 md5 校验通过之后才跑；跑前跑后
`ps -eo comm | grep -cx firefox` 都是 **0**（单进程、headless），跑前看 `free -m`。

### 5.1 修前（`git show 9be7ec5` 的 lib/ 在跑）：**4 PASS / 1 FAIL**

```
localStorage len=1649  {"mpkgKey":"custom|3582362359","converted":"mp4"}      ← image/webUrl 都不在
内存 sectionCache      {"mpkgKey":"custom|3582362359"}
宿主磁盘 settings.json {"mpkgKey":"custom|3582362359","converted":"mp4"}      ← 同样都缺
真机 CSS/DOM: wrap=true computed.display=none 生成 .mpw-bgWrap{display:none}=true
FAIL A4 半残档已被自愈（mpkgKey 在则必须能推导回源，或明确提示而不是静默隐藏）
```

### 5.2 修后（同一条探针、同一份现场档）：**9 PASS / 0 FAIL**

```
localStorage len=1749  {"image":"host:?custom=1&folder=3582362359&file=Mid-Autumn%20Hoshino.mp4",
                        "mpkgKey":"custom|3582362359","converted":"mp4"}   ← 自愈推回来的源
真机 CSS/DOM: wrap=true computed.display=block 生成 .mpw-bgWrap{display:none}=false
PASS A3 有壁纸源 ⇒ 不得 display:none   （现场这一条由 FAIL 转 PASS）
```

**自愈推出来的源，与用户在面板里点一次那张壁纸会写下的 URL 完全一致**
（`host:?custom=1&folder=3582362359&file=Mid-Autumn%20Hoshino.mp4`）——
即"推"出来的东西不是替代品，就是原本那一条。

### 5.3 "无关开关保存一轮"前后 diff（`--save-toggle fontColorGray`）

```
localStorage 字段集合（不含元键）：前 90 → 后 90   丢失=[]   变化=["fontColorGray"]
                                   元键变化=["__mpwLocalAt"]（写入时刻，本来就该变）
宿主磁盘 89 字段 → 89 字段：removed=[] added=[] changed=[]
壁纸字段 diff：localStorage before/after 完全相同（image 那条 URL 一字不差）；宿主那份三次都是 absent（HOST_SKIP_KEYS，老契约）
```

宿主侧合并口径的**当场读数**（另跑一枚只读探针抓 PUT 载荷与磁盘）：
`PUT 状态 = 200`、`PUT 载荷里有 __mpwHostAt = true`、`磁盘里有 __mpwHostAt = true`
⇒ 宿主确实按新口径**逐键合并**落盘（旧写法会把磁盘上客户端不发的那些键一起抹掉）。

---

## 6. 诚实清单

1. **"那一刻是哪一次点击把字段弄丢的"没有直接证据**：修前两处存储都不带写入时刻、diag 环形缓冲也没有
   相关事件 ⇒ 本次只钉死"结构性缺陷（ⓐ–ⓓ）+ 现场状态"。从这一版起有时间戳与 `settings:reconcile`
   trace，**下一次**同类问题可以追到具体一轮。
2. **`lib/index.js` 的合并只保护"未来的写"**：磁盘上**已经**缺字段的档不会被宿主单方面补回来
   （补它需要客户端把源发过去，而宿主明确不存 `image`）。现场那份半残档靠**客户端自愈**补回。
3. **自愈只覆盖有来源线索的档**：`mpkgKey` 为空、`source` 也为空的"白档"不介入（那是"从没选过壁纸"的
   正常语义）。`mpkgKey` 是 `steam|…` 等**尚未支持**的前缀时 ⇒ 走"推不出"分支，明确提示用户重选
   （`library|`/`custom|`/`custommpkg|` 三类已支持）。
4. **"同一目录多个候选"不猜**：自定义目录里若是 `type:"unknown"` 且同 folder 有多条候选，
   推导会返回 null（宁可让用户重选，也不猜错素材）。真机现场那条是唯一的 `video`，所以能推出。
5. **测试侧的诚实边界**：插件里有两组延迟动作（boot 超时兜底 3.5s / 自愈 1.2s），
   它们持有**上一个实例**的闭包；真机上插件一个页面只加载一次，不存在这个问题，
   但**测试里**必须排空（`boot()` 开头的 `sleep(320)`），否则会出现"单跑绿、连跑红"的假红。
6. **只能人眼看的**：自愈后壁纸**画面**是否真的是用户原来那张（探针只判"源字段回来了 +
   `.mpw-bgWrap` 不再 `display:none` + 元素有 src"；像素级比对不做）。
7. **用户的现有设置要不要手动重选**：**不需要**。现场那份半残档已被自愈推回原源（§5.2 的
   `image` 就是用户那张 `Mid-Autumn Hoshino.mp4`），其余 90 个用户字段一字未动（§5.3 的 diff）。
   只有"推不出"的档（目录被删/改名/多候选）才需要重选一次，且那时面板有明确提示、其余设置全部保留。
8. `README*.md` / `package.json` / `lib/web-wallpaper.js` / `lib/web-interaction.js` /
   `lib/media-session.js` **未动**；版本号未动。

---

## 7. 提交

* 插件仓：`6514e6e`（本条修法 + 门禁 + 探针 + 本文档；只提交自有路径，未用 `git add -A`）。
* 台账：渲染器仓 `we-scene-demo/docs/PATCHES.md` 的 **P-157**（跨仓登记，本仓一行代码未动）。
* 提交前自跑：`bash tools/check.sh --quick` 全绿、`bash tools/pre-commit.sh` 通过、
  `node tools/settings-persist-test.mjs` 112 通过/0 失败（含 7 组变异）。

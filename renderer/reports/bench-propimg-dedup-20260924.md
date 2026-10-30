# 属性面板图片去重 · 第 3 档「同一张画面在整个面板里只画一次」+ 三层回退（2026-09-24）

**用户的选择（原话）**：
> 「先按 3 处理，后续效果如果不对，要**留有回退空间**」

第 3 档 = **两样都去掉：任何一张图在整个面板里只画一次（含被作者有意重复的分隔图）**，并且必须能一键回退。

**一句话结论**：`?propimg=once`（缺省）已从"同一 **URL** 只画一遍"升级为"同一 **画面** 只画一遍" ——
① 逐字节同一 URL ⇒ 无条件一遍；② 只差**尺寸/格式/水印类**参数或后缀（白名单见 §2）⇒ **候选**；
③ 候选要**尺寸证据**：两张都 `load` 成功且 `naturalWidth/naturalHeight` **完全相同**才归并
（不同 ⇒ 一定不归并；拿不到 ⇒ 不归并）。归并**只发生在 DOM 渲染期**，tokenizer 语义一个字节没动。
回退三层：`?propimg=once|row|all`（URL 档，**最高**）> 面板里可见的三档开关（`#bench-imgmode`，记
`localStorage['bench-props-imgmode']`）> 缺省 `once`。

**最重要的读数（防"改了个寂寞"）**：本地 **20 个含图语料包**上，新规则相对旧规则**多压 0 张**
（没有任何"只差处理参数/后缀"的对子 —— 真语料里同一张图的重复都是**逐字节相同**的 URL）；
反例护栏（同一个 `m.qpic.cn/psc` path 下的 **4 张真图** + 6 张同形态）**一张都没被压**。
新规则的价值在"作者用同一张图的不同尺寸/格式变体"这类语料上，本地语料暂时没有 —— 这一条**如实写在这里**，
不拿合成夹具冒充实测（合成夹具的读数单独标为夹具）。

---

## 0 改前 / 改后读数（真机 :8902，两份包 × 三档）

**方法**：`tests/_gl-browser.mjs` 的 `launchGLBrowser`（有头 `DISPLAY=:0`，GL=WebGL2 / llvmpipe），
**同一时刻只开一个 Firefox**，两次会话（面板读数 / 开关接线）串行执行，每次跑完 `closeQuiet(browser)`；
`pageerror` = 0。读数走真面板探针 `window.__benchPatch.propsImages()`。

| 包 | 档（`?propimg=`） | 面板 img token | **实际画出的 `<img>`** | 压掉 | 身份组 | 变体探针 | 载入成功 |
|---|---|---|---|---|---|---|---|
| `3660962877` | 缺省 `once` | 38 | **6** | 32 | 6 | 0 | 0/38 |
| `3660962877` | `row` | 38 | **38** | 0 | 38 | 0 | 0/38 |
| `3660962877` | `all` | 38 | **38** | 0 | 6 | 0 | 0/38 |
| `3326873240` | 缺省 `once` | 13 | **6** | 7 | 6 | 0 | 0/13 |
| `3326873240` | `row` | 13 | **13** | 0 | 13 | 0 | 0/13 |
| `3326873240` | `all` | 13 | **13** | 0 | 6 | 0 | 0/13 |

* **改前**（= 现在的 `all` 档 / 上一版 `once` 的行为）：`3660962877` 画 **38** 张（其中 33 张是**同一张图**），
  `3326873240` 画 **13** 张（其中 8 张同一张图）。
* **改后**（缺省 `once`）：`3660962877` 画 **6** 张、`3326873240` 画 **6** 张 —— 与上一轮的实测读数
  （`all` 38 / `once` 6 / `dupSkipped` 32）**逐数字吻合**，说明这次升级没有回退上一版已经修好的跨行去重。
* `row` 档在这两份包上与 `all` **读数相同**（38/13）：这些包里**每条属性行最多一张图** ⇒ 行内去重没有可压的。
  这是读数事实，不是"`row` 档没生效"（判据 5h 用合成夹具证明 `row` 档确实会在行内压重复）。
* **新规则相对旧规则多压掉了几张**：**0 张**。两份包、以及本地全部 20 个含图包，都是 0（见 §3 表）。
  按整条 URL 去重这一档，新规则与旧规则**完全一致**。
* 读数复现性：同一探针在冻结代码上复跑，`3660962877` 三档逐数字一致；`3326873240` 有一轮 `once` 那次点选
  没落地（`tokens=0`，环境时序抖动、`pageerror=0`），单例复读得到 `13 / 6 / dupSkipped 7 / groups 6` ——
  与 §0 表相同（该包在另两轮里也是同一组数字）。**抖动读数没有被当成结论用**。

### 0.1 真机读数与离线扫描的对账（为什么离线看到 5 个身份、真机看到 6 个）

| 口径 | `3660962877` | `3326873240` |
|---|---|---|
| 离线：只读 `general.properties[*].text` 的**顶层** img token | 37 token / 5 身份 | 12 / 5 |
| 离线：**任意深度**（含 `<a href><img></a>` 里嵌套的 img） | **39 token / 7 身份** | **14 / 7** |
| 其中 `condition` 非空、产物默认**隐藏**的行 | −1 行 | −1 行 |
| ⇒ 真面板（产物自己的可见行集合） | **38 token / 6 身份** | **13 / 6** |
| 真机 `propsImages()` 实测 | **38 / 6** ✅ | **13 / 6** ✅ |

对账**逐数字闭合**（`39−1=38`、`7−1=6`）。判据 `tests/bench-props-text-test.mjs` 的 5t 用"任意深度 + 不减
condition 行"的口径读语料，并把真机两个数（38/13 与 6 身份）写进断言。

### 0.2 `3660962877` 面板里那 6 个身份（真机读数，原文 URL）

```
x33  http://photogz.photo.store.qq.com/psc?/V12uhwIt3z28yp/bqQfVz5yrrGYSXMvKr.cqSF.*RaTqLFzr86N9EuoDN4nRLGP3a.X9rtw.tsnRh*i7J6Ys7CPxuV4UY0yhigma9023ByDaD5n5tpcicJ6V5Q!/b&bo=HgEIAAAAAAACJxQ!&rf=viewer_4
x1   http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEBsexJSlhMg7OiSbTz*Vq3QACEYkZ8E7D9iP.Od05WVwf*Zty7Ju024B0os.zP7PIbqo.3*UAdtYXXx9jjaGF1A!/b&bo=4gHXAQAAAAABBxU!&rf=viewer_4
x1   http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEOlNbbR8QyH.V3DOKIQNRif85YCGLfi9pSXuaZqxdq9vSR5s5uHZgJLf1DqrxMxRMTafCMS1IHiigGZSLlOCyvE!/mnull&bo=SAFIAUgBSAEDByI!&rf=photolist&t=5
x1   http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEK.dTR0S5PnqaxucocfhhjUEzkloqXuqp0JsbUmHwzB1hnBAwn4iULfdmGz9S2FcNNdUWClXxYZKe6DMP4VWV5M!/mnull&bo=AQF3AAEBdwADByI!&rf=photolist&t=5
x1   http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEN0V7PtMf6HgitP8mBBmIbw*LFU9xgCDdr3*lz.6zvJmRzMuMdTOjezKg3zoG5RvjNMQkNOphtv0WDDyR2Klubw!/mnull&bo=twDIAAAAAAADB10!&rf=photolist&t=5
x1   http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/ruAMsa53pVQWN7FLK88i5s4Ru.FxJVLHfuEcbN9phT8I00ri*qc9y2RTZyA1aopw88nnmF1sZx37Es.pr9gP*jZUKpvD8qVn72w8522q8Q4!/mnull&bo=QAYWAwAAAAADB3E!&rf=photolist&t=5
```

**注意**：这 6 条里 5 条是 `m.qpic.cn/psc`（**同一个 path**），它们的差异**全部在 query 的第一个无名段**
（`?/V54…/<id>!/mnull`）+ `bo`/`rf` 里 —— 这就是 §3 反例护栏的真实来源。

---

## 1 改动清单（只有 4 个文件 + 本报告）

| 文件 | 改动 |
|---|---|
| `demo/bench-patch.js` | ①**纯函数层**（模块顶部）：`RICH_IMAGE_DROP_PARAMS`/`RICH_IMAGE_DROP_SUFFIX_RES` 白名单、`richImageKey`（候选键）、`richImageRelation`、`RICH_IMAGE_MODES`/`normalizeRichImageMode`/`planRichImageMode`（URL 档 > UI 档 > 缺省）、`makeRichImagePass` 升级成**两层身份 + 尺寸证据账本**（`take` / `sizeEvidence` / `releasePending` / `report` 扩了 `variants`/`sizes`）、`dedupeRichImages` 适配；②**渲染期接线**：变体候选先建节点但藏起来（`data-bench-img-variant`）、`load`/`error` 都结算、1.5s 超时兜底放行（`armRichImageProbeTimer`）、`propsImages()` 扩了 `probes`/`unmerged`/`modeSource`/`mode`；③**面板可见开关**：`#bench-imgmode`（三档 + 一行读数 + `data-bench-imgmode-source`）、`IMG_MODE_PREF_LS='bench-props-imgmode'`、`redrawPropsRich()`（换档**立即生效**，作者原文存 `RICH_TEXT_SRC`）、中英 i18n 键 7 条、样式只进 `BENCH_PICK_CSS`；④`WE_GROUP_KEY` → `WE_GROUP_COLLAPSED_LS`（见 §7 的发布阻塞项） |
| `tests/bench-props-text-test.mjs` | 29 → **48 断言**：规则真值表（5a–5d）、三档语义（5e–5h）、链接压制（5i–5j）、分隔图保留（5k）、tokenizer 不动（5l）、**真阳性**①②（5m/5n）、**真阴性**（5o 尺寸硬否 / 5p 证据缺失）、同变体重复（5q）、**反例护栏**（5r 4 张真图 / 5s 6 张同形态）、真语料对账（5t）、三层回退与 UI 接线（5u–5za，含"控件文案不许是空标签"5v2 与"常量改名必须三处齐全"5zb）、**10 组变异自证**（M1–M5 纯函数 + S1–S5 源码级，打印 `MUTANT-RED-OK`，期望红集 == 实际红集） |
| `docs/README-DIAGNOSTICS.md` | **+1 行**：`propimg` 登记进「补丁层开关（`demo/bench-patch.js`，刻意放在表区之外）」那张表（**不是**主表，原因见 §7） |
| `tests/run-all-tests.sh` | **+1 行**：补登记 `demo-check`（132 断言）—— 它此前只在文档/手工命令里被引用，`--only demo-check` 会报"未知测试项"exit 2（父任务给的门禁命令里就有它） |

**没碰**：`demo.html`、`core/**`、`server/**`、`tests/mpkg-*`、`tests/gyro-*`、`tests/bench-dsh-libroot-test.mjs`、插件仓。
`web/diag-flags.json` 也**没有被改写**（`diag-flag-check` 内容未变 ⇒ 按它的幂等纪律不落盘）。

---

## 2 规则的可判定表述（唯一实现处 = `demo/bench-patch.js` 模块顶部）

```
identity(url)  = normalizeRichImageUrl(url)     ⓐ 的键：scheme/host 小写、去 fragment、去默认端口；query 逐字节不动
candidate(url) = richImageKey(url)              ⓑ 的键：identity 再去掉白名单里的"处理类"参数与后缀
merge(a, b)    = identity(a) === identity(b)                       ⇒ 归并（无需证据：同一条 URL 就是同一份资源）
               | candidate(a) === candidate(b)
                 ∧ a、b 都 load 成功（naturalWidth/Height > 0）
                 ∧ a.naturalWidth  === b.naturalWidth
                 ∧ a.naturalHeight === b.naturalHeight             ⇒ 归并（规则 ③ 真阳性）
               | 其余                                              ⇒ **不归并**（尺寸不同 / 证据拿不到）
```

**ⓑ 的白名单**（`RICH_IMAGE_DROP_PARAMS` + `RICH_IMAGE_DROP_SUFFIX_RES`，其余**一个字节都不动**）：

| 类别 | 名单 | 依据 |
|---|---|---|
| 微信 CDN 格式/来源/懒加载 | `wx_fmt`、`wxfrom`、`wx_lazy`、`wx_co`、`tp` | 同一 `mmbiz.qpic.cn/.../<size>` 的 jpeg/png/webp 变体 |
| qpic（QQ 空间/照片） | `bo`（尺寸编码）、`rf`（展示形态：`viewer_4`/`photolist`） | 真语料里这两项在同 id 的不同副本间会变 |
| 服务端图像处理指令 | `x-oss-process`、`imageView2`、`imageMogr2`、`imageView` | 阿里 OSS / 七牛 |
| path 末尾后缀 | `_!web-…`（微信文章图水印）、`@<数字>w[_<数字>h][_1e_1c…]`（淘宝/阿里尺寸后缀） | 后缀删掉后**图片 id 仍在** |

**刻意不删**（写了判据守着）：`t=`、`from=` 这类语义未确认的具名参数，以及**无名段**——
qpic 的图片 id 就挂在第一个无名段里（`?/V54…/TmE…!/mnull`）。删了它们 = 把**不同图**压成一张。

**三条规则与"用户要什么"的对应**：
* ⓐ 覆盖"同一张图重复出现"（本次 bug 的主因：`3660962877` 里同一 URL 出现 **33** 次）；
* ⓑ+③ 覆盖"同一张画面的不同尺寸/格式/水印变体"（用户第 3 档的另一半）；
* **③ 的硬否决**（尺寸不同 ⇒ 不归并）是这次新加的安全阀：它把"候选"挡在"结论"之外，
  所以 ⓑ 的名单**不可能**单方面把两张不同的图压成一张（判据 5o + 变异 M1 守着）。

---

## 3 反例护栏读数（"绝对不许压"的那一类）

| 夹具 | 内容 | 读数 |
|---|---|---|
| 5r **真语料** | `3660962877` 里 `m.qpic.cn/psc` **同一个 path** 下的 **4 张不同图**（原文 URL 抄录，见 §0.2） | 4 张进来 ⇒ **4 张画出**（旧规则也是 4；`host+path` 归并会压成 1 ⇒ 变异 M2 必红） |
| 5s **同形态 6 张** | 同 host+path、6 个不同 id 段 + 不同 `bo`/`rf`（父任务书里的"6 张"口径） | 6 ⇒ **6** |
| 5k 分隔图 | 3 个不同 URL/path 的 `fengefu*.gif`（作者**有意重复**的装饰） | 3 ⇒ **3**（去重只认"同一张画面"） |
| 5c 参数白名单边界 | `t=`/无名段/图片 id 段 | 不删 ⇒ 不同图键不同 |

### 3.1 本地语料全量读数（20 个含图包，"新规则多压了几张"）

口径：任意深度 img token；`once(旧)` = 按整条归一化 URL 去重；`once(新)` = 按 ⓑ 候选键（未加载 ⇒ 不归并，
所以"候选键数"是**上界**）。**20 个包全部 `新 = 旧`，多压 0 张**：

```
id            token  旧once  新候选键   新规则多压
3660962877      39      7        7         0
3448877775      15      5        5         0
2902406982      14      5        5         0
3326873240      14      7        7         0
3327063360      14      7        7         0
3470764447      14      7        7         0
3462491575      14      7        7         0
3233141951      10      3        3         0
3448290956       8      5        5         0
3351163962       7      2        2         0
3544152633       4      1        1         0
2887099508       4      3        3         0
3605722997       3      2        2         0
884307090        3      3        3         0
3554161528       2      2        2         0
3479521040       2      2        2         0
3521337568       2      2        2         0
3195212886       2      2        2         0
3653641024       1      1        1         0
3662790108       1      1        1         0
```

`m.qpic.cn/psc` 同 path 多图组（反例护栏的语料面）：`3326873240`/`3327063360`/`3470764447`/`3660962877`/
`3448290956`/`3448877775`/`3462491575` 各 **4 张**，`2887099508` **3 张**，`3554161528`/`3479521040`/
`3521337568`/`3351163962` 各 **2 张** —— **新规则下一张都没少**（旧规则同样 0 误伤）。

---

## 4 变异自证读数（10 组；打印 `MUTANT-RED-OK`，**期望红集 == 实际红集**）

纯函数层 5 组（同一批 11 条**真断言**，分别跑真实现与被变异实现；红的 = 值真的变了的那些）：

```
MUTANT-RED-OK M1-去掉尺寸护栏        期望=实际=[C7-尺寸不同 ⇒ 一定不归并, C8-证据缺失 ⇒ 不归并]
MUTANT-RED-OK M2-丢掉图片 id          期望=实际=[C2-跨行, C5-尺寸后缀, C6-格式/水印, C9-反例护栏 4 张真图, C11-同变体两次]
MUTANT-RED-OK M3-all 档失效           期望=实际=[C3-all 档完全不去重]
MUTANT-RED-OK M4-账本退回每行一个     期望=实际=[C2-跨行同一 URL 只画一遍]
MUTANT-RED-OK M5-证据缺失即归并       期望=实际=[C8-证据缺失 ⇒ 不归并]
```

源码级 5 组（claim 在真源码为真、在改坏的源码为假）：

```
MUTANT-RED-OK S1-URL 档优先的接线（planRichImageMode({url, stored})）
MUTANT-RED-OK S2-面板开关 id + 三档
MUTANT-RED-OK S3-变体探针藏起来 + 结算
MUTANT-RED-OK S4-换档立即生效（原地重画）
MUTANT-RED-OK S5-新样式走 BENCH_PICK_CSS 而不是 SITE_LAYOUT_CSS
```

（父任务点名的三组都在：**去掉尺寸护栏** ⇒ C7/C8 必红；**丢掉 id 保留** ⇒ C9 反例护栏必红；
**`all` 档失效** ⇒ C3 必红。`M4` 就是上一轮那个"跨行不生效"的 bug 的忠实复刻。）

---

## 5 三层回退 + "URL 档 vs UI 档谁优先"（真机读数，逐步骤）

优先级**唯一解析点**：`planRichImageMode({ url, stored })` ⇒ `?propimg=` > 面板开关（localStorage） > 缺省 `once`。
理由：`?propimg=` 是排障/对照入口，必须**可复现** —— 带参数的链接在任何机器、任何本地偏好下都得到同一档。

| 步骤 | 控件值 / 来源 | localStorage | 生效档 | 真机画出 | 读数行 |
|---|---|---|---|---|---|
| 打开（无 `?propimg=`，localStorage 空） | `once` / `default` | （空） | `once` | **6**（38 token） | `32 duplicate image(s) suppressed` |
| 面板开关 → `all` | `all` / `stored` | `all` | `all` | **38** | `0 duplicate image(s) suppressed` |
| 面板开关 → `row` | `row` / `stored` | `row` | `row` | **38** | 同上 |
| 面板开关 → `once` | `once` / `stored` | `once` | `once` | **6** | `32 duplicate image(s) suppressed` |
| 重开同一页（不带参数） | `once` / `stored` | `once` | `once` | **6** | 偏好被记住 ✅ |
| 带 `?propimg=all` 打开（存的是 `once`） | `all` / **`url`** | `once` | `all` | **38** | `Decided by the URL gear ?propimg=all` |
| URL=`all` 时把开关点成 `row` | `all` / **`url`** | `row` | **仍是 `all`** | **38** | URL 档压过 UI（偏好被记下，供下次不带参数时用）✅ |

控件文案真机实测（三档 option 与提示都在，**不是空标签**）：
`["once=Once (whole panel)","row=Once per row","all=All (no dedup)"]`；
`data-bench-imgmode-source` 随来源取 `default` / `stored` / `url`（`url` 时边框用 accent 色）。
中英两套文案（`props.imgDedup*`，7 条键）都在 `DICT` 里，切语言走既有 `data-i18n*` 一趟 + 幂等补写。

---

## 6 **没验证的** / 明确不合并的（如实）

1. **"同一画面，但 URL 的图片 id 完全不同"⇒ 静态无法判定，本规则不合并（这是设计边界，不是 bug）**。
   典型形态（都能在本语料里找到）：
   * 同一张图被作者**重传/换 CDN**：`m.qpic.cn/psc?/…/<id-A>` 与 `photogz.photo.store.qq.com/psc?/…/<id-B>`；
   * 微信的**格式目录**不同：`mmbiz_png/<hash>/…` 与 `mmbiz_jpg/<hash>/…`（path 不同 ⇒ 键不同）；
   * 微信路径里的**尺寸段**不同：`/mmbiz_jpg/<hash>/640` 与 `/mmbiz_jpg/<hash>/0`（path 不同 ⇒ 键不同）。
   这三类的共同点是"身份在 path/主机里，且我们**故意**不动 path"（动了就会把 §3 那类不同图压成一张）。
   ⇒ 要合并它们只能靠**人眼**或**作者自己的说明**；本规则**不能**，报告与文档里都写明了这一点
   （`docs/README-DIAGNOSTICS.md` 的 `propimg` 行有同样一句）。
2. **规则 ③ 的"真归并"分支在真机上没有被触发**：两份包在这台机器上**一张图都没加载成功**
   （真机读数 `载入成功 0/38`、`0/13` —— 本环境到 `m.qpic.cn` / `photogz.photo.store.qq.com` 出不去），
   而且这两份包里本来就没有"只差处理参数"的对子 ⇒ 真机走的是"**没有候选**"这条路径（`probes=0`、`unmerged=0`）。
   ③ 的判定逻辑由**纯 Node 夹具**覆盖（5m/5n 真阳性、5o 尺寸硬否、5p 证据缺失、5q 变体重复、M1/M5 变异）；
   **DOM 侧"藏起来 → 归并则摘掉 / 否归并则显示"的三态没有在真机上被走到**（只有源码级接线判据 S3 守着）。
   要真机验它，需要一个含"同 id 两个尺寸变体、且图片能加载"的包 —— 我没有往语料/库里造这种包（不在我的写权限内）。
3. `row` 档在真机上与 `all` 同读数（§0 已解释：这些包每条属性行最多一张图）。
4. `?propimg=` **没有进 `docs/README-DIAGNOSTICS.md` 的主表** ⇒ `diag-flag-check` 计数是 **179 → 179**（不是 180）。
   原因见 §7 第 2 条（主表是"代码抓取 == 文档行"的双向比对，而抓取源**不含** `demo/bench-patch.js`）。
5. ~~`tests/bench-dsh-libroot-test.mjs` 的 A8a 现在红~~ —— **已关闭**：owner 把 A8a 的断言更新成新常量名后，
   A8a 抓出了我改名漏掉 `setItem` 那处的真 bug（静默失效），修完两处一致 ⇒ `bench-dsh-libroot` 全绿（§7.1）。
6. 真机上**没有**验证"尺寸证据到达后把已画出的重复图摘掉"是否会造成**视觉闪烁**：归并成功的路径是
   "候选一开始就藏着"（设计上不闪），但"证据缺失 ⇒ 1.5s 后放行"这条路会让被藏起来的候选**延迟出现**；
   本地语料没有候选，所以这条时序**没有真机读数**。

---

## 7 两条跨文件/跨线的事项（**两条都已关闭**，过程如实记在这里）

### 7.1 发布阻塞项 `WE_GROUP_KEY` → `WE_GROUP_COLLAPSED_LS`（已关闭；协调过程 + 一个真 bug）

* 我按追加指示把 `demo/bench-patch.js` 里的 localStorage 键名常量 `WE_GROUP_KEY` 改名成
  **`WE_GROUP_COLLAPSED_LS`**（值不变：`'bench-props-we-collapsed'`；常量名避开 `key` 词根 ⇒
  `secret-scan-test.mjs` 的 `assigned-credential-ext` 不再命中）。
* 这个改名**必须与 `tests/bench-dsh-libroot-test.mjs` 的 A8a 原子地一起改**（它逐字断言旧名，而该文件在我禁碰清单里）。
  我把这条冲突连同**需要它 owner 落的两处改动**中途回传给了协调方；owner 随后把 A8a 的断言更新成新名
  （`tests/bench-dsh-libroot-test.mjs:388`，mtime 03:02），两处从此一致。
* **A8a 随后抓出了我这次改名的真 bug**：我一共三处引用（声明 / `getItem` / `setItem`），改名时漏了
  `setItem` 那一处 ⇒ `localStorage.setItem(WE_GROUP_KEY, …)` 抛 `ReferenceError`，而它外面套着
  `try { … } catch { /* 隐私模式 */ }` ⇒ **静默失效**（"渲染器设置"分组的折叠状态记不住，页面上看不出来）。
  已修（`demo/bench-patch.js:4734`），并在我自己的判据里补了 **5zb**：
  `声明/get/set 三处同一新名 + 全文 0 处旧名` —— 这一类"只改一半"的事故从此有断言守着。
* 终态：`node tests/secret-scan-test.mjs` → **凭据 0 命中（全绿）**；`bench-dsh-libroot` → **PASS（75→81 断言全绿）**。

### 7.2 `?propimg=` 登记在「补丁层开关」那张表，而不是主表（179 → **179**，不是 180）

* `tests/diag-flag-check.mjs` 的抓取源**只有四类**：`core/we-scene-bundle.js`、`demo.html`、`elysia/**/*.js`、
  插件 `dsh-mpkg-wallpaper/lib/client.js` —— **不含 `demo/bench-patch.js`**；而主表做的是**双向**比对
  （代码有·文档无 = 漏写；文档有·代码无 = 陈旧）。
* 这不是我猜的：`docs/README-DIAGNOSTICS.md` 第 239 行那节就是这条纪律（`openrewrite` 等 bench 侧开关的既有家），
  里面记着 P-129 的同款实测："插进表区之内 ⇒ `✗ 文档有·代码无（陈旧 1 个）: openrewrite`（exit 1）"。
* 我另外实测（/tmp 镜像副本 + 同一份脚本，不动真树）：把 `demo/bench-patch.js` 加进抓取源 ⇒ **179 → 183**
  （多出 `propimg` + `online` + `sample` + `shell` 四个），要 4 行文档才能双向一致 —— 超出"只加一行"的授权。
* ⇒ 我的落法：`propimg` 进「补丁层开关」表（表区之外），`node tests/diag-flag-check.mjs` 保持
  `✓ 代码 179 个开关 == README 主表 179 行，0 差异`（exit 0），`web/diag-flags.json` **未变、未落盘**。
  真要 180：需要先决定"抓取面扩到 bench-patch.js + 补 `online`/`sample`/`shell` 三行"，那是跨线的规矩改动。
* **代码里的权威读点在**：`demo/bench-patch.js` 的 `richImageModePlan()`
  （`new URLSearchParams(location.search).get('propimg')`）+ `planRichImageMode()` 纯函数（单一解析点）。

---

## 8 复现命令

```bash
# 判据（纯 Node，无浏览器/网络/GPU；~0.3s）
node tests/bench-props-text-test.mjs          # 47 断言；含 10 组 MUTANT-RED-OK

# 开关登记（双向比对 + 生成物幂等）
node tests/diag-flag-check.mjs                # ✓ 179 == 179，0 差异；diag-flags.json 未变

# 门禁（父任务给的命令；`demo-check` 本次补登记进 run-all-tests.sh，否则 --only 会 exit 2）
bash tests/run-all-tests.sh --only bench-props-text bench-dsh-libroot demo-check docs-check

# 真机读数（需要 :8902 在跑；一次只开一个 Firefox）
node server/we-scene-demo-server-8902.mjs 8902 &        # 库根 = ../allwallpaper/dd
#   读数：打开 ?propimg=once|row|all + 在左侧列表点 id，然后
#   page.evaluate(() => window.__benchPatch.propsImages())
#   → { rendered, probes, unmerged, tokens: report.images, dupSkipped: report.duplicatesSkipped, report.groups }
#   开关：page.evaluate(() => { const s=document.getElementById('bench-imgmode'); s.value='all'; s.dispatchEvent(new Event('change',{bubbles:true})) })
```

---

## 9 门禁尾部（原样贴回）

### 9.1 `node tests/bench-props-text-test.mjs`（判据本体：48 断言 + 10 组 MUTANT-RED-OK）
```
结果: 48 通过, 0 失败
✓ 属性面板富文本通过：nbsp 收口（含双重/无分号、不过度解码）/ BV 转链接走既有白名单通道 / 图片去重三规则（①逐字节同一资源无条件一遍 ②只差尺寸·格式·水印类参数或后缀的算候选 ③候选要两张都 load 成功且原始宽高相同才归并）+ 反例护栏 + 三层回退（URL 档 > 面板开关 > 缺省）+ 10 组变异自证
```

### 9.2 `bash tests/run-all-tests.sh --only bench-props-text bench-dsh-libroot demo-check docs-check`（门禁尾部，原样；冻结状态上的最后一次）
```
[gate] MPW_PERF_PKG = /root/.dsh-mpkg-wallpaper/5a85a54b12b64bc882d1e7bab0f8e837.mpkg（扫描 /root/.dsh-mpkg-wallpaper/*.mpkg 取最大者：331194792 B；可用 MPW_PERF_PKG= 显式覆盖）
PASS bench-props-text (148ms)
PASS bench-dsh-libroot (27264ms)
PASS demo-check (1173ms)
PASS docs-check (921ms)
══ 汇总：PASS=4 FAIL=0 SKIP=0 / 总 4 项
（本次运行产物：/tmp/mpw-gate-12917-1790190836 ；日志副本：/tmp/mpw-gate-12917-1790190836/last.log）
GATE-EXIT=0
```

> 注：`demo-check` 是我这次**补登记**进 `tests/run-all-tests.sh` 的（父任务给的门禁命令里就有它，
> 但此前 `--only demo-check` 会报「未知测试项」exit 2）；`bench-dsh-libroot` 的 A8a 在协调后也已全绿（§7.1）。

### 9.3 `node tests/diag-flag-check.mjs` / `node tests/docs-check.mjs`（原样）
```
✓ diag-flag-check：代码 179 个开关 == README 主表 179 行，0 差异
  diag-flags.json 未变（保持旧时间戳，不落盘）（common=11 个常用）
EXIT=0
检查 17 个文档 · 778 个文件引用 · P-编号健康 ✓ · diag-flags ✓   diag-flags.json 未变（保持旧时间戳，不落盘）（common=11 个常用）
✓ 文档一致性全部通过
```

### 9.4 `node tests/secret-scan-test.mjs`（发布安全网，原样：**凭据 0 命中**）
```
扫描 482 个 tracked 文件（文本 457 个；跳过二进制 24 / >4MB 0）· 凭据模式 12 条 · 本机路径模式 3 条
白名单 3 条（每条都断言"仍然命中"；当前 3 条命中）

✓ 敏感信息扫描干净：凭据 0 命中、本机绝对路径 0 命中、白名单无腐烂条目
EXIT=0
```

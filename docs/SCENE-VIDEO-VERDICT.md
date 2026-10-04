# SCENE-VIDEO-VERDICT —— 「只判不取」的 scene 内嵌视频判定

> 适用版本：插件 **3.16.4** 起（`lib/pkg-extract.js` 的 `probeSceneVideoVerdict` + `decodeStoredEntry`，
> `lib/index.js` 的 `probeSceneVideo` 路由）。
> 对照：上游渲染器同族 issue #136（索引 + 前缀读替代整包读）的修法；逐条对比与吸收清单见
> `<工作区>/docs/reverse/ELYSIA-COMPARE-ABSORB-20261004.md`。
> 本文只写**可核对的读数与口径**。

## 1. 问题：一条路由同时承担"判定"和"提取"

`/custom-scene-video-check` 与 `/library-scene-video-check` 是客户端在**卡片/清单阶段**问
"这张场景壁纸有没有内嵌视频"的路由（`lib/client.js` 的 `sceneVideoCheckUrl` 只读响应里的 `d.has`）。
改前这两条路由直接调 `ensureSceneVideo()` —— 那是"判定 + 提取"一体：判定完会把**整段内嵌视频**
读进内存并落盘到插件数据目录。于是"只为问一句"付出了整段视频的读盘与内存。

## 2. 改法：判定路径只读目录表 + 候选前缀

新增 `probeSceneVideoVerdict(dirOrPath)`：读 PKG 目录表（`readPkgIndexFromFile`，64KB 起步、
不够按 ×4 倍增到 8MB）→ 只看候选条目的前缀（TEX 用 `TEX_PEEK_BYTES`，判定函数与快路径**同一个**
`probeTexVideoDecision`）→ 给出三态结论：

| 结论 | 条件 | 与 legacy（`findSceneVideoInPkg`）的关系 |
|---|---|---|
| `has:true, decided:true` | 独立视频条目恰好 1 条；或 TEX 里恰好 1 条判为 `video` 且无 `unknown` | 与 legacy 的选择规则一致（独立优先取最大；单条 TEX 内嵌才用） |
| `has:false, decided:true` | 无独立视频且 TEX 全判 `none`；或 TEX 里 ≥2 条判 `video` | legacy 对"多 TEX 视频"返回 null（无单一内嵌动画） |
| `decided:false`（回退） | ≥2 条独立视频（"谁最大"要看解压后长度）/ 出现 `unknown` / **松散目录**（`scene.json` + 平铺 `.tex`） | 调用方回退 `ensureSceneVideo()`，答案与改前逐项一致，只是慢 |

`decided:false` 一律回退，**不在不确定时给答案**。

## 3. 读数（本机实测，2026-10-04）

单容器（同一台机器、同一份语料）：

| 容器 | 大小 | 全量扫描（改前口径） | verdict（改后） |
|---|---|---|---|
| `wallpaperE/小鸟游星野/小鸟游星野_01.mpkg` | 792.0 MB | 791.6 MB / 446 ms | **64 KB / 0.4 ms** |
| `wallpaperE/终末地/zmd_01.mpkg` | 713.2 MB | 712.7 MB / 635 ms | **64 KB / 1.0 ms** |
| `wallpaperE/白洲梓/白洲梓_01.mpkg` | 527.0 MB | 526.4 MB / 441 ms | **64 KB / 1.3 ms** |
| `1004/-爱伦坡.mpkg`（视频类） | 73.4 MB | 73.2 MB / 83 ms | **64 KB / 3.6 ms** |

全量审计（`tools/scene-video-verdict-audit.mjs`，205 个容器 / 19.1 GB，两条路径逐条对拍
"是否有视频 + 选中哪条 + 提取字节 sha256"）：**判定不一致 0 个**（含视频 154 个）。

> 读量口径说明：verdict 的读量 = 目录表 + `TEX_PEEK_BYTES`(96KB) × 前缀条目数；含大量 TEX 的包会线性
> 上升（实测最坏一例：543MB 的包读 3.45 MB / 47 条前缀）。这仍远小于整包，且**与视频载荷无关**。

## 4. 顺带修掉的构造性缺陷：压缩条目被当 raw

`readPkgIndexFromFile` 只读目录表 ⇒ 条目内容不在已读头里 ⇒ 头解析出来的条目 `flags` 恒为 `0`
（`partial:true`），且 `size` 是**存储长度**。索引先行的路径据此把 **LZ4 链条目**当 raw 用：
视频/TEX 若以压缩形式存储，快路径会静默判成"没有视频"，而 legacy 整包口径却能成功 ——
即"两条路径判定分叉"。

修法：新增 `decodeStoredEntry(stored, entry)`，把"是否 LZ4 链"的判定交给唯一口径
`probeCompressedEntry(raw, 0, raw.length)`（与 `parsePkg` 同一个函数），原始长度取**链头 u64**
（不信任头解析的 `size`），再用现成的 `readPkgEntry(..., { flags: 1 })` 解压。

**诚实说明**：本机语料 205 个容器里**压缩条目 0 个**（`flags & 1` 全为 0）⇒ 这条在现存语料上
**无观感差异**；它是按容器格式构造的加固，判据用**自造夹具**钉住（见下）。

## 5. 判据

- `tools/scene-video-verdict-test.mjs`（挂在 `tools/check.sh` 的 **step 8**，不新增步骤号）
  **15 通过 / 0 失败**：A 单条独立视频只判不取（读量 < 载荷 1/8）；B 两条独立视频 ⇒ `decided:false`
  且慢路径仍给出唯一答案；C 无视频 ⇒ `has:false, decided:true`；D **压缩条目**（手搓合法 LZ4 RLE 链，
  前置 128KB padding 把它挤出索引头）两条路径都必须还原出原始字节；E 结构棘轮（路由先试 verdict、
  条目读取必须走 `decodeStoredEntry`、不许再有裸 `new Uint8Array(buf)`）；F 语料段（缺语料 SKIP）：
  verdict 与全量扫描判定一致 + 读量结构性上界。
  **变异自证**：把 `decodeStoredEntry` 的压缩判定去掉 ⇒ D3 必红（实测拿到的长度 36 vs 期望 4096）。
- `tools/scene-video-verdict-audit.mjs`：上面第 3 节的全量审计工具（只读语料、默认不写缓存）。

## 6. 未验证边界

1. **松散目录**（`scene.json` + 平铺 `.tex`，如 WE `defaultprojects`）一律 `decided:false` 回退：
   那种场景没有大载荷，未为它单独实现 verdict 分支。
2. `decided:false` 的比例随语料变化：小型包（TEX 载荷 < 12 字节等）可能因前缀判定 `unknown` 而回退
   —— 回退是安全方向（答案不变、只是慢）。
3. TEX 前缀读取量随 TEX 条目数线性（96KB × N）；若要进一步压，需要按 `probeTexVideoDecision` 的
   真实需求分档（raw 情形下 4KB 足够）——本轮未做，属可选的下一步。
4. 两条 check 路由共用一个 handler（`probeSceneVideo`），本改动对二者同时生效；`serveSceneVideo`
   （取字节）未改，仍走 `ensureSceneVideo`。

## 7. 复现

```bash
cd <插件仓库>
node tools/scene-video-verdict-test.mjs                 # 15/0（含变异体；无浏览器/无网络）
node tools/scene-video-verdict-audit.mjs --sample 12    # 抽样对拍
node tools/scene-video-verdict-audit.mjs                # 全量（本机 205 容器 / 19.1GB，约 1.5 分钟）
bash tools/check.sh --full                              # 12 步门禁（step 8 含本条）
```

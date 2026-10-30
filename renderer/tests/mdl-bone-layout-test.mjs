// mdl-bone-layout-test.mjs — ①(P-152 2026-09-19) **MDLS 骨骼布局校验（防回归）** + ①(P-152b 2026-09-23) **变长布局（骨名前置）重扫救回**门禁
//
// 门禁名 `mdl-bone-layout`（`tests/run-all-tests.sh`）。**无浏览器 / 无网络 / 无 X11**，单 node 进程。
//
// 依据：`docs/UPSTREAM-PORT-PLAN-20260919.md` §4「MDLS 变长骨名」——
//   上游（`oneincase/webwallgl` `be3c246`，MIT）在 `renderer/vendor/we-scene/render/mdl-parse.js`
//   里把"MDLS 逐骨记录不止一种布局"这条病修掉：**先按布局 A 整体解析并校验，通过就逐位采用；
//   任一骨非法才判定为变长布局；重扫拿全且全合法才采用，否则回退，绝不返回残缺骨架**。
//   本仓两侧解析器（`core/attach-transform.mjs::parseMdl` 与 `elysia/we-renderer/puppet.js::_parseMdl`）
//   当时**都是布局 A 定步、且没有任何校验** ⇒ 一旦记录不是 A 就**静默产出错位骨架**（`parent` 读成
//   16256 之类的垃圾、矩阵退化成垃圾/假旋转），不抛异常、不报错。**本仓语料 43 `.mdl` / 35 含 MDLS /
//   332 骨 / 非法骨 0** ⇒ 本项**今天没有可见收益**，价值全在"以后不回归 + 别人的包不炸"。
//
// ①(P-152b 2026-09-23) 追加：**变长布局（骨名前置）重扫救回**（上游语义，本仓自研实现）——
//   P-152 只校验不重扫 ⇒ 真语料 3 个"非 A 变长布局"包被拒收（`bones=[]` = 丢蒙皮），而 legacy 在那 3 个
//   包上本来就只产**残缺骨架**（声明 7 得 1 / 55 得 3 / 2 得 0）。P-152b 补上"重扫救回"这条**可判定**的
//   解析路径（判据合取见 `core/attach-transform.mjs::rescanMdlsNameFrontedBones`），A 路径逐位不变。
//
// 本门禁锁五件事：
//   ① 合成样本逐类判定：合法 A（逐位采用）/ parent 越界 / 材质(id)索引越界 / 记录截断 / 骨名槽超长 /
//      骨名槽非法字节 / 旋转非单位长 / 平移非有限 / 声明骨数越界 —— 每种都有**期望的判定结果**
//      （`bones=[]` + `mdlDiag.reason` + 一行 warn），**绝不出现"残缺骨架"**
//      （返回的 bones 长度 ∈ {0, 声明骨数}）。
//   ①b **变长布局（骨名前置）合成夹具**：布局 B（无槽）/ 布局 C（矩阵后跟槽：JSON 元数据）⇒ **救回**，
//      骨数 == 声明骨数、type/parent 与构造值逐位相同、`mdlDiag.layout` = `'B'`/`'C'`/`'B/C'`（两种读法
//      结果一致时的无歧义档）；变长布局的失败形态（父前向引用 / len≠64 / 记录截断 / 矩阵非正交 / 越过
//      段界）⇒ **仍如实拒绝**且 `mdlDiag.rescan.reason` 可见。
//   ② 全语料回归：**布局 A 文件**逐字段与**基线**（`?mdls=legacy` = P-152 之前的实现路径）逐位相同；
//      基线计数（自导出、只增不减）写成断言。
//   ③ `?mdls=legacy` 逐位回退：逐样本（**布局 A 合法**的样本）+ 全语料的 **bones 描述符 sha256** 相同，
//      且旧路径不产生 `mdlDiag` —— legacy 档**不救回**（逐位回到"残缺骨架"的旧行为，门禁有断言）。
//   ④ 变异自证 R1–R6（真跑：把 `core/attach-transform.mjs` 复制到临时目录后**字符串变异**再 import）：
//      R1 强制走"无校验旧路径" ⇒ 逐类判定组必红；R2 布局判定恒为 A ⇒ 拒绝档的 `layout` 必红；
//      R3 骨名槽判据弱化 ⇒ 本门禁**必须仍然全绿**（没有过度拒绝的证明）；
//      R4 关掉重扫 ⇒ 救回组必红；R5 重扫在矩阵截断处 `break`（= 接受残缺）⇒ "绝不残缺"组必红；
//      R6 去掉"父必须先声明"⇒ 前向引用夹具被误救回 ⇒ 必红。
//
// ⚠ 诚实口径（与 `docs/PATCHES.md` P-152/P-152b 的"未证实项"同一口径）：
//   · 布局 B/C 的**合成**夹具仍是合成（官方二进制/上游实现**未对拍**）；但 P-152b 的布局判据来自
//     **真语料逐字节核对**（3/3 命中，门禁第 ③ 组逐文件点名）；
//   · 上游**只作判据引用**（`file:line`），**没有照抄任何代码/注释/文案** ⇒ 无 `THIRD-PARTY.md` 新增段；
//   · 重扫的"两种读法都成立但骨不同 ⇒ 拒绝"这条分支本轮**没造出触发夹具**（合取判据下 `len==64` 与
//     `parent<骨序号` 互相挤压；两种读法同时成立的唯一形态是"所有骨名/槽皆空"，而那种形态布局 A
//     本来就通过、不会走到重扫）⇒ 该分支只作**防御**保留，本门禁**不**宣称它可达（如实登记）。
//   · **闸门**代价（如实登记）：A 定步若"运气好"把某份变长布局读齐且读合法（短骨名 + 空槽的形态可以），
//     闸门不开、按布局 A 采用 —— 这是 P-152 既有口径（A 读齐且合法 ⇒ 采用），本轮**有意不动**
//     （动它就等于改 A 路径的接受条件）；组 ①b 用一份短骨名夹具把它钉住。
//
// ⚠ **语料敏感 / 渲染敏感**标注：
//   · **语料敏感**：③ 组（全语料回归）的计数与文件名清单随本机语料走（`$MPW_ROOT/allwallpaper` +
//     `~/.dsh-mpkg-wallpaper`）——基线自导出、只增不减；真语料缺失 ⇒ 该组必红（**不** SKIP）。
//   · **不渲染敏感**：无浏览器 / 无 GPU / 无网络 / 无 X11；①②④⑤ 组是纯字节解析 + 合成夹具，与语料无关。
//
// 运行：node tests/mdl-bone-layout-test.mjs        （全过输出 ALL PASS，退出码 0）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { WS } from './_root.mjs'
import { readIndexHead, readEntryBytes, walkContainers } from './_pkg-index.mjs'
import { parseMdl, mdlsLegacy, readMdlsLayoutABones, rescanMdlsNameFrontedBones } from '../core/attach-transform.mjs'
import { installPuppet, mdlsLegacy as mdlsLegacyElysia } from '../elysia/we-renderer/puppet.js'
import { Buffer as MpwBuffer } from '../elysia/buffer.js'

const H = {}
installPuppet(H)

let PASS = 0, FAIL = 0
const RED = {}
function check(group, name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { FAIL++; RED[group] = (RED[group] || 0) + 1; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// A. 合成样本：自研 MDL 构造器（块顺序照 `parseMdl` 的扫描契约排，构造时自检）
//
// 为什么不自己拼一个假 MDL：顶点块的定位是**启发扫描**（`u32@offset+4` 是 80 的倍数、
//   索引块紧随 `offset+8+vertexBytes`、前 64 个顶点有限、索引 ≥98% 小于顶点数），手拼字节
//   时"看起来对"的偏移会被扫描跳过（本轮实测踩了 4 次）。模板法 = **WYSIWYG**：真文件的
//   顶点/索引/材质区一个字节都不动，只把 MDLS 的"逐骨记录区"换成合成记录 ⇒ 差异只可能
//   来自本项判据本身（这正是回归测试要的隔离度）。
//   ⚠ 模板文件只用**最小**的那一个（本机语料里 `models/眼球_puppet.mdl` = 10095B）：
//     只读 entry 表 + 单个 entry，**从不**整包 readFileSync（大包 220–792MB）。
// ══════════════════════════════════════════════════════════════════════════════════════════
const F32 = (x) => { const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, x, true); return [...new Uint8Array(b)] }
const I32 = (x) => { const b = new ArrayBuffer(4); new DataView(b).setInt32(0, x, true); return [...new Uint8Array(b)] }
const U32 = (x) => I32(x)
const A32 = (s) => [...new TextEncoder().encode(s)]   // ①(P-152b) 真 UTF-8 字节：旧版按 charCode 写 ⇒ 非 ASCII 骨名（'主'/'腿'）的夹具一直是**非法字节**，靠"布局非 A 直接拒"掩盖过去了
// 旋转部分两行单位长（±0.05 内）+ 平移有限 = 合法骨矩阵（行主序，与真语料的布局 A 同型）
const ROW_IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const ROW_BADROT = [0.2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]     // 第 1 行长度 0.2 ⇒ 非法
const ROW_BADTRANS = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, NaN, 0, 0, 1]  // 平移非有限 ⇒ 非法
// 变长布局（B/C）用的矩阵：三行都 ≈ 单位长（"看起来像合法矩阵"——正是要证明定步仍会失步）
const ROW_VAR = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

// ── 自研 MDL 构造器（**不手算偏移**：块顺序照 `parseMdl` 的定步契约排，偏移由 `indexOf` 复核）──
//
// `parseMdl` 的顶点块扫描（`core/attach-transform.mjs`）实际口径（本轮逐字节核对，**不是猜的**）：
//   扫描 `offset = 9, 10, …`，命中条件 `u32@offset+4` 是 **80 的倍数**（非 0），
//   且 `u32@(offset+8+vertexBytes)` 是**非 0 偶数**（索引字节数），且 `offset+8+vertexBytes+4+indexBytes ≤ mdlsOffset`。
//   ⇒ 取 `offset = 9` ⇒ 扫描读的是 **u32@13**（= 顶点计数）、`顶点数据 @17`（`vertexBytes` 字节）、
//   `索引计数 @17+vertexBytes`。本构造器就按这个顺序拼：
//   `[13B 填充][顶点计数][顶点数据][索引计数][索引][间隔][MDLS…]`，
//   并**断言** `u32@13` == 顶点数、`u32@(17+vertexBytes)` == 索引字节数（拼错就当场红，不靠人眼）。
const VERTEX_COUNT = 1
const VERTEX_BYTES = VERTEX_COUNT * 80     // +13 处**必须是 80 的倍数**（扫描条件就是 `vertexBytes % 80 === 0`）
const INDEX_COUNT = 3
const INDEX_BYTES = INDEX_COUNT * 2        // +17+VERTEX_BYTES 处是**索引字节数**（非 0 偶数）
// 旋转部分两行单位长（±0.05 内）+ 平移有限 = 合法骨矩阵（行主序，与真语料布局 A 同型）
// 变长布局（B/C）用的矩阵：三行都 ≈ 单位长（"看起来像合法矩阵"——要证的正是**定步仍会失步**）
// 记录区之后的余量：变长布局（B/C）的合成记录**比声明骨数的定步长度短**，若不留余量，定步会先撞
// "读到文件尾"（reason=record-truncated）而不是"读出错位骨"（layout=not-A）——本门禁要证的是后者。
const SLACK = 2048

/**
 * 造一个 MDL 样本。`bones` 项：`{ head: 'u8'|'u16', id, parent, mat, len, slot, name }`
 *   `mode='A'`：`[tmp][id u32][parent i32][len u32][矩阵][骨名槽 cstr]`（真语料形态）
 *   `mode='B'`：`[name cstr][id u32][parent i32][len=64][矩阵]`（名字前置变长，**无槽**）
 *   `mode='C'`：`[name cstr][id u32][parent i32][len=64][矩阵][槽 cstr]`（名字前置 + 矩阵后槽；槽由
 *              `jsonAfterMatrix` 给、逐骨可用 `bn.slot` 覆盖，缺省 = 空槽 —— 真语料 3/3 的形态）
 *   `segBytes`：段界字段 `u32@mdls+9`。缺省 = **真段尾**（`u8.length - 1`，与本仓 6/86 个真文件同形：
 *              段界 = 下一段起点 - 1）；`null` = 写文件长；给具体值可测"记录流越过段界"这条判据。
 */
function buildMdl({ declaredCount, bones, mode = 'A', jsonAfterMatrix = null, tail = null, segBytes = undefined }) {
  const rec = (bn) => {
    const mat = bn.mat || ROW_IDENT
    const len = bn.len === undefined ? mat.length * 4 : bn.len
    if (mode === 'B' || mode === 'C') {
      const name = bn.name === undefined ? [0] : A32(bn.name).concat([0])
      const hdr = U32(bn.id).concat(I32(bn.parent), U32(len), (bn.mat || ROW_VAR).flatMap(F32))
      if (mode === 'B') return name.concat(hdr)
      return name.concat(hdr, bn.slot !== undefined ? bn.slot : (jsonAfterMatrix || [0]))
    }
    const head = bn.head === 'u16' ? [0, 0] : [0]
    return head.concat(U32(bn.id), I32(bn.parent), U32(len), mat.flatMap(F32), bn.slot === undefined ? [0] : bn.slot)
  }
  const recs = bones.flatMap(rec)
  const bytes = [].concat(
    new Array(13).fill(0),                                  // 前缀：顶点计数必须落在 +13（扫描从 +9 起、读 offset+4）
    U32(VERTEX_BYTES),                                      // 顶点字节数 @+13（不是顶点数！）
    new Array(VERTEX_BYTES).fill(0),                        // 顶点数据 @+17（位置全 0 ⇒ 有限、量级合法）
    U32(INDEX_BYTES),                                       // 索引计数 @+17+VERTEX_BYTES
    new Array(INDEX_BYTES + 4).fill(0),                     // 索引 + 4B 间隔
    A32('MDLS0004'), [0],                                   // 段魔数（+8B）+ u8
    U32(22 + recs.length),                                  // § 段界（真语料口径 = **下一段起点的绝对偏移**；下面回填）
    U32(declaredCount),                                     // 骨数 @mdls+13
    recs,
    tail !== null ? tail : new Array(SLACK).fill(0),
  )
  const u8 = new Uint8Array(bytes)
  const dv = new DataView(u8.buffer)
  const mo = u8.indexOf(0x4d)
  if (dv.getUint32(13, true) !== VERTEX_BYTES || dv.getUint32(17 + VERTEX_BYTES, true) !== INDEX_BYTES || mo < 0) {
    throw new Error('buildMdl 自检失败（块顺序与 parseMdl 的扫描契约不符）')
  }
  // ①(P-152b) 段界回填：真语料 86/86 的这个字段都是"MDLS 段尾（下一段起点，或差 1 字节）"的**绝对偏移**
  //   ⇒ 夹具按真形态写 `u8.length - 1`（缺省），需要测边界时由调用方显式给值。
  dv.setUint32(mo + 9, typeof segBytes === 'function' ? segBytes(u8, mo)
    : (segBytes === null ? u8.length : (segBytes === undefined ? u8.length - 1 : segBytes)), true)
  return u8
}
const mdlsOffsetOf = (u8) => { for (let i = 0; i + 4 <= u8.length; i++) if (u8[i] === 0x4d && u8[i + 1] === 0x44 && u8[i + 2] === 0x4c && u8[i + 3] === 0x53) return i; return -1 }
const boneA = (id, parent, extra = {}) => ({ head: 'u8', id, parent, ...extra })

const OW = console.warn
const capture = (fn) => { const got = []; console.warn = (...a) => got.push(a.join(' ')); try { return { r: fn(), warns: got } } finally { console.warn = OW } }

// ── A.1 样本表（每种一个**期望判定**）────────────────────────────────────────────────────────
const legalA = buildMdl({ declaredCount: 3, bones: [boneA(1, -1), boneA(2, 0), boneA(3, 1)] })
const layoutB = buildMdl({ declaredCount: 3, mode: 'B', bones: [{ name: 'a1x', id: 1, parent: -1 }, { name: 'b1x', id: 2, parent: 0 }, { name: 'c1x', id: 3, parent: 1 }] })
// ①(P-152b) 布局 C 夹具按**真语料形态**排：第 1 条骨名空（A 定步能读中它 ⇒ legacy 会读出错位前缀），
//   第 2 条是非 ASCII 骨名（真 UTF-8 3 字节 ⇒ A 定步从这里失步），第 3 条又空。
const layoutC = buildMdl({ declaredCount: 3, mode: 'C', jsonAfterMatrix: A32('{"tm":100,"tp":"1 2 3"}').concat([0]), bones: [{ name: '', id: 1, parent: -1 }, { name: '主', id: 2, parent: 0 }, { name: '', id: 3, parent: 1 }] })
const badParent = buildMdl({ declaredCount: 3, bones: [boneA(1, -1), boneA(2, 0), boneA(3, 99)] })
const badMatIdx = buildMdl({ declaredCount: 2, bones: [boneA(1, -1), boneA(100000, 0)] })
const truncated = (() => { const u8 = buildMdl({ declaredCount: 3, bones: [boneA(1, -1), boneA(2, 0), boneA(3, 1)] }); return u8.slice(0, u8.length - (SLACK + 120)) })()
const longNameSlot = buildMdl({ declaredCount: 2, bones: [boneA(1, -1, { slot: A32('x'.repeat(5000)).concat([0]) }), boneA(2, 0, { slot: A32('y'.repeat(5000)).concat([0]) })] })
const badRot = buildMdl({ declaredCount: 2, bones: [boneA(1, -1, { mat: ROW_BADROT }), boneA(2, 0)] })
const badTrans = buildMdl({ declaredCount: 2, bones: [boneA(1, -1, { mat: ROW_BADTRANS }), boneA(2, 0)] })
const declaredZero = buildMdl({ declaredCount: 0, bones: [] })
const declaredHuge = buildMdl({ declaredCount: 100000, bones: [boneA(1, -1)] })
const head10 = buildMdl({ declaredCount: 2, bones: [{ head: 'u16', id: 1, parent: -1 }, { head: 'u16', id: 2, parent: 0 }] })

// ── A.1b ①(P-152b) 变长布局（骨名前置）夹具：救回形态 + 5 种**必须如实拒绝**的形态 ──────────────
// 真语料的槽长这样（`{"a":null,"lamax":null,"tm":100.0,"tp":"…"}` = 布局 C 的元数据；布局 A 里它落在
// 骨名槽位置上，所以 P-152 的骨名槽判据**不**拒它）。
const RESC_JSON = A32('{"a":null,"lamax":null,"tm":100.0,"tp":"892.50433 0.00000 0.00000"}').concat([0])
// 绕 X 轴 90° 的**合法**正交矩阵：布局 A 的两行近似判据（`hypot(m0,m1)`/`hypot(m4,m5)`）会拒它
// （m[4]=m[5]=0），救回路径的三行正交判据接受它 —— 真语料 `deimos.fbx.mdl` 就是这一形态。
const ROW_ROT_X = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]
const rescMixed = buildMdl({ declaredCount: 4, mode: 'C', bones: [
  { name: '', id: 1, parent: -1, slot: RESC_JSON },
  { name: '腿', id: 1, parent: 0, slot: RESC_JSON },
  { name: '', id: 1, parent: 1, slot: [0] },
  { name: 'tail', id: 2, parent: 2, slot: [0] },
] })
const rescMixedSegNull = buildMdl({ declaredCount: 4, mode: 'C', segBytes: null, bones: [
  { name: '', id: 1, parent: -1, slot: RESC_JSON }, { name: '腿', id: 1, parent: 0, slot: RESC_JSON },
  { name: '', id: 1, parent: 1, slot: [0] }, { name: 'tail', id: 2, parent: 2, slot: [0] },
] })
const rescSingle = buildMdl({ declaredCount: 1, mode: 'C', bones: [{ name: 'only', id: 7, parent: -1, slot: [0] }] })
const rescRotX = buildMdl({ declaredCount: 2, mode: 'C', bones: [
  { name: 'RootNode', id: 0, parent: -1, slot: [0], mat: ROW_ROT_X },
  { name: 'Deimos', id: 1, parent: 0, slot: [0], mat: ROW_ROT_X },
] })
const badRotX_A = buildMdl({ declaredCount: 2, bones: [boneA(1, -1, { mat: ROW_ROT_X }), boneA(2, 0)] })
const rescFwdParent = buildMdl({ declaredCount: 2, mode: 'C', bones: [
  { name: 'forward-parent-bone', id: 1, parent: 1, slot: [0] }, { name: 'b', id: 2, parent: 0, slot: [0] },
] })
const rescLenBad = buildMdl({ declaredCount: 2, mode: 'C', bones: [
  { name: 'len-not-64-bone-name', id: 1, parent: -1, len: 32, slot: [0] }, { name: 'b', id: 2, parent: 0, slot: [0] },
] })
const rescCut = (() => {
  const u8 = buildMdl({ declaredCount: 3, mode: 'C', bones: [
    { name: 'cut-a-bone-name', id: 1, parent: -1, slot: [0] }, { name: 'cut-b-bone-name', id: 2, parent: 0, slot: [0] }, { name: 'cut-c-bone-name', id: 3, parent: 1, slot: [0] },
  ] })
  return u8.slice(0, u8.length - SLACK - 20)   // 砍进最后一条记录（段界字段随之越界 ⇒ 判据退回文件长）
})()
const rescBadMatrix = buildMdl({ declaredCount: 2, mode: 'C', bones: [
  { name: 'bad-matrix-bone-name', id: 1, parent: -1, slot: [0] }, { name: 'b', id: 2, parent: 0, slot: [0], mat: ROW_BADROT },
] })
const rescCrossSection = buildMdl({ declaredCount: 3, mode: 'C', segBytes: (u8, mo) => mo + 24, bones: [
  { name: 'section-overrun-bone', id: 1, parent: -1, slot: [0] }, { name: 'b', id: 2, parent: 0, slot: [0] }, { name: 'c', id: 3, parent: 1, slot: [0] },
] })

/** 逐样本统一判定：`bones.length ∈ {0, declared}`（绝无残缺中间态）+ 台账 + 一行 warn。 */
function runSample(label, u8, declared) {
  const cap = capture(() => parseMdl(u8))
  const m = cap.r
  const out = { ok: !!m, bones: m ? m.bones.length : -1, diag: m && m.mdlDiag, warns: cap.warns }
  check('A 合成逐类', label + '：返回对象非 null', !!m)
  check('A 合成逐类', label + '：bones.length ∈ {0, 声明骨数}（绝不残缺）', !!m && (m.bones.length === 0 || m.bones.length === declared), 'len=' + out.bones + ' declared=' + declared)
  return out
}

console.log('① 合成样本逐类判定')
{
  const r = runSample('合法布局 A', legalA, 3)
  check('A 合成逐类', '合法布局 A：逐位采用（3 骨）', r.bones === 3 && !r.diag, 'bones=' + r.bones)
  check('A 合成逐类', '合法布局 A：parent/矩阵 与构造值一致', r.ok && JSON.stringify(parseMdl(legalA).bones.map((b) => [b.type, b.parent])) === JSON.stringify([[1, -1], [2, 0], [3, 1]]))
  check('A 合成逐类', '合法布局 A：0 行 warn（合法语料日志面不变）', r.warns.length === 0)
}
{
  const r = runSample('布局 B（名字前置变长，无槽）', layoutB, 3)
  check('A 合成逐类', '布局 B：**救回**（bones=3 == 声明，rejected=false, rescued=true）',
    !!r.diag && r.diag.rescued === true && r.diag.rejected === false && r.bones === 3, JSON.stringify(r.diag))
  check('A 合成逐类', '布局 B：`layout` = B（只"不带槽"这一种读法成立）', !!r.diag && r.diag.layout === 'B', JSON.stringify(r.diag && r.diag.layout))
  check('A 合成逐类', '布局 B：id/parent 与构造值逐位相同（不是只凑对数）',
    JSON.stringify(parseMdl(layoutB).bones.map((b) => [b.type, b.parent])) === JSON.stringify([[1, -1], [2, 0], [3, 1]]),
    JSON.stringify(parseMdl(layoutB).bones.map((b) => [b.type, b.parent])))
  check('A 合成逐类', '布局 B：一行可读 warn 含 declared/parsed/layout（救回也有痕）',
    r.warns.length === 1 && /\[P-152\] MDLS bone layout rescued/.test(r.warns[0]) && /declared=3/.test(r.warns[0]) && /layout=B/.test(r.warns[0]), r.warns[0])
}
{
  const r = runSample('布局 C（名字前置 + 矩阵后槽）', layoutC, 3)
  check('A 合成逐类', '布局 C：**救回**（bones=3 == 声明）', !!r.diag && r.diag.rescued === true && r.bones === 3, JSON.stringify(r.diag))
  check('A 合成逐类', '布局 C：`layout` = C（只"带槽"这一种读法成立）', !!r.diag && r.diag.layout === 'C', JSON.stringify(r.diag && r.diag.layout))
  check('A 合成逐类', '布局 C：id/parent 与构造值逐位相同（含非 ASCII 骨名那条记录）',
    JSON.stringify(parseMdl(layoutC).bones.map((b) => [b.type, b.parent])) === JSON.stringify([[1, -1], [2, 0], [3, 1]]),
    JSON.stringify(parseMdl(layoutC).bones.map((b) => [b.type, b.parent])))
  check('A 合成逐类', '布局 C：台账记下"A 路径读到几条 + 卡在哪"（可回归；真语料 55 骨那份读 3 条）',
    !!r.diag && r.diag.rescan && r.diag.rescan.aBones === 1 && r.diag.rescan.aReason === 'layout-name-fronted', JSON.stringify(r.diag && r.diag.rescan))
}
{
  const r = runSample('parent 越界（parent=99 > boneCount=3）', badParent, 3)
  check('A 合成逐类', 'parent 越界：reason=parent-out-of-range', !!r.diag && r.diag.reason === 'parent-out-of-range', JSON.stringify(r.diag))
  check('A 合成逐类', 'parent 越界：rejectedBones≥1 且台账带首个骨号', !!r.diag && r.diag.rejectedBones >= 1 && r.diag.entryErrors[0].b === 2)
}
{
  const r = runSample('材质(id)索引越界（id=100000）', badMatIdx, 2)
  check('A 合成逐类', '材质索引越界：reason=material-index-out-of-range', !!r.diag && r.diag.reason === 'material-index-out-of-range', JSON.stringify(r.diag))
}
{
  const r = runSample('记录截断（砍掉尾部 90 字节）', truncated, 3)
  check('A 合成逐类', '记录截断：reason=record-truncated（可判定的失败，不是静默错位）', !!r.diag && /record-truncated|name-not-terminated|bone-count-mismatch/.test(r.diag.reason), JSON.stringify(r.diag))
}
{
  const r = runSample('骨名槽超长（5000B > 4096）', longNameSlot, 2)
  check('A 合成逐类', '骨名槽超长：reason=name-slot-too-long', !!r.diag && r.diag.reason === 'name-slot-too-long', JSON.stringify(r.diag))
}
{
  const r = runSample('旋转非单位长（第 1 行长度 0.2）', badRot, 2)
  check('A 合成逐类', '旋转非单位长：reason=rotation-row-not-unit', !!r.diag && r.diag.reason === 'rotation-row-not-unit', JSON.stringify(r.diag))
}
{
  const r = runSample('平移非有限（m[12]=NaN）', badTrans, 2)
  check('A 合成逐类', '平移非有限：reason=translation-not-finite', !!r.diag && r.diag.reason === 'translation-not-finite', JSON.stringify(r.diag))
}
{
  const r = runSample('声明骨数越界（0）', declaredZero, 0)
  check('A 合成逐类', '声明骨数越界(0)：layout=refused 且不读骨', !!r.diag && r.diag.layout === 'refused' && r.diag.reason === 'declared-bone-count-out-of-range' && r.bones === 0)
}
{
  const r = runSample('声明骨数越界（100000）', declaredHuge, 100000)
  check('A 合成逐类', '声明骨数越界(100000)：refused（不按 100000 循环读骨）', !!r.diag && r.diag.reason === 'declared-bone-count-out-of-range' && r.bones === 0)
}

// ── A.1b ①(P-152b) 变长布局（骨名前置）重扫救回：合成夹具 ──────────────────────────────────────
console.log('①b 变长布局（骨名前置）重扫救回：合成夹具')
{
  const r = runSample('变长布局·混合骨名/JSON 槽（真语料同形）', rescMixed, 4)
  check('A2 变长救回', '混合夹具：救回 4 骨（== 声明）且 rejected=false', r.bones === 4 && !!r.diag && r.diag.rescued === true && r.diag.rejected === false, JSON.stringify(r.diag))
  check('A2 变长救回', '混合夹具：id/parent 与构造值逐位相同',
    JSON.stringify(parseMdl(rescMixed).bones.map((b) => [b.type, b.parent])) === JSON.stringify([[1, -1], [1, 0], [1, 1], [2, 2]]),
    JSON.stringify(parseMdl(rescMixed).bones.map((b) => [b.type, b.parent])))
  check('A2 变长救回', '混合夹具：段界字段不可信（= 文件长）时仍能救回（判据退回文件长）',
    (() => { const m = parseMdl(rescMixedSegNull); return m.bones.length === 4 && !!m.mdlDiag && m.mdlDiag.rescued === true })())
  const r2 = runSample('变长布局·单骨（两种读法结果一致）', rescSingle, 1)
  check('A2 变长救回', '单骨夹具：`layout` = B/C（带槽/不带槽两种读法骨逐位相同 ⇒ 无歧义档）',
    r2.bones === 1 && !!r2.diag && r2.diag.rescued === true && r2.diag.layout === 'B/C', JSON.stringify(r2.diag))
}
{
  // 绕 X 的 90° 合法旋转（m[4]=m[5]=0）：布局 A 的"两行近似"判据会拒它。**闸门**（A 定步读齐声明骨数
  // ⇒ 不进重扫）保证这类文件的结局与 P-152 逐位相同（仍拒）——救回路径的"三行正交"判据只服务
  // **真的失步**的变长布局（真语料 deimos.fbx 就是：它是骨名前置，A 定步在骨 0 就失步）。
  const ra = runSample('布局 A·绕 X 90°（A 判据的两行近似假设不成立）', badRotX_A, 2)
  check('A2 变长救回', 'A 定步读齐声明骨数 ⇒ 闸门关闭：仍按 P-152 拒绝（rotation-row-not-unit, rescan=null）',
    ra.bones === 0 && !!ra.diag && ra.diag.rejected === true && ra.diag.reason === 'rotation-row-not-unit' && ra.diag.rescan === null, JSON.stringify(ra.diag))
  check('A2 变长救回', 'A 路径判据函数本身逐位不变（readMdlsLayoutABones 仍报 rotation-row-not-unit）',
    (() => { const q = readMdlsLayoutABones(badRotX_A, new DataView(badRotX_A.buffer), mdlsOffsetOf(badRotX_A), 2, null); return q.complete === true && q.entryErrors.length === 1 && q.entryErrors[0].reason === 'rotation-row-not-unit' })())
  const r = runSample('变长布局·绕 X 90°（真失步 ⇒ 重扫用三行正交判据）', rescRotX, 2)
  check('A2 变长救回', '变长布局 + ROT_X：救回 2 骨（重扫判据比 A 的两行近似判据更严也更通用）',
    r.bones === 2 && !!r.diag && r.diag.rescued === true && r.diag.layout === 'C', JSON.stringify(r.diag))
}
{
  // ①(P-152b) **闸门**：重扫只在 A 定步失步时启动。下面这些夹具的 A 定步都读不齐声明骨数（骨名前置里
  //   的长 ASCII 骨名会让 A 的 `len` 字段读成 ≥0x20202020 ⇒ 立刻结构错）⇒ 进重扫、且**必须被重扫拒绝**。
  const unit = (u8, declared) => rescanMdlsNameFrontedBones(u8, new DataView(u8.buffer, u8.byteOffset, u8.byteLength), mdlsOffsetOf(u8), declared)
  const r = runSample('变长布局·父前向引用（parent=1 于骨 0）', rescFwdParent, 2)
  check('A2 变长救回', '父前向引用：**仍拒绝** + rescan.reason=parent-not-before-child 可见',
    r.bones === 0 && !!r.diag && r.diag.rejected === true && !!r.diag.rescan && r.diag.rescan.reason === 'parent-not-before-child', JSON.stringify(r.diag))
  check('A2 变长救回', '父前向引用：判据单元直调结果一致（纯函数口径）',
    unit(rescFwdParent, 2).rescued === false && unit(rescFwdParent, 2).reason === 'parent-not-before-child')
  const r2 = runSample('变长布局·len≠64（len=32）', rescLenBad, 2)
  check('A2 变长救回', 'len≠64：**仍拒绝** + rescan.reason=bone-len-not-64',
    r2.bones === 0 && !!r2.diag && r2.diag.rescan && r2.diag.rescan.reason === 'bone-len-not-64', JSON.stringify(r2.diag))
  check('A2 变长救回', 'len≠64：判据单元直调结果一致', unit(rescLenBad, 2).rescued === false && unit(rescLenBad, 2).reason === 'bone-len-not-64')
  const r3 = runSample('变长布局·最后一条记录截断', rescCut, 3)
  check('A2 变长救回', '记录截断：**仍拒绝** + rescan.reason 可见（matrix/name/slot-truncated）',
    r3.bones === 0 && !!r3.diag && r3.diag.rejected === true && /truncated/.test((r3.diag.rescan || {}).reason || ''), JSON.stringify(r3.diag))
  const r4 = runSample('变长布局·矩阵非正交（第 1 行 0.2）', rescBadMatrix, 2)
  check('A2 变长救回', '矩阵非正交：**仍拒绝** + rescan.reason=matrix-not-orthonormal',
    r4.bones === 0 && !!r4.diag && r4.diag.rescan && r4.diag.rescan.reason === 'matrix-not-orthonormal', JSON.stringify(r4.diag))
  check('A2 变长救回', '矩阵非正交：判据单元直调结果一致', unit(rescBadMatrix, 2).rescued === false && unit(rescBadMatrix, 2).reason === 'matrix-not-orthonormal')
  const r5 = runSample('变长布局·记录流越过段界', rescCrossSection, 3)
  check('A2 变长救回', '越过段界：**仍拒绝** + rescan.reason=overruns-section',
    r5.bones === 0 && !!r5.diag && r5.diag.rescan && r5.diag.rescan.reason === 'overruns-section', JSON.stringify(r5.diag))
  check('A2 变长救回', '越过段界：判据单元直调结果一致', unit(rescCrossSection, 3).rescued === false && unit(rescCrossSection, 3).reason === 'overruns-section')
  // ⚠ 如实登记一处**闸门**造成的"救不到"：A 定步若"运气好"把某份变长布局读齐且读合法（短骨名 + 空槽的
  //   合成形态可以），闸门就不开、按布局 A 采用 —— 这是 P-152 既有口径（A 读齐且合法 ⇒ 采用），本轮
  //   **有意不动**（动它就等于改 A 路径的接受条件）。用一份**短骨名**夹具把它钉住，避免后人误判成回归。
  const shortNameFwd = buildMdl({ declaredCount: 2, mode: 'C', bones: [{ name: 'a', id: 1, parent: 1, slot: [0] }, { name: 'b', id: 2, parent: 0, slot: [0] }] })
  const ra = readMdlsLayoutABones(shortNameFwd, new DataView(shortNameFwd.buffer, shortNameFwd.byteOffset, shortNameFwd.byteLength), mdlsOffsetOf(shortNameFwd), 2, null)
  check('A2 变长救回', '（如实登记）短骨名夹具：A 定步"读齐且全合法" ⇒ 闸门不开、按 A 采用（P-152 既有口径，本轮不动）',
    ra.complete === true && ra.structErrors === 0 && ra.entryErrors.length === 0 && !parseMdl(shortNameFwd).mdlDiag,
    'A步 bones=' + ra.bones.length + ' 重扫=' + JSON.stringify(unit(shortNameFwd, 2).reason))
}
{
  // 救回路径**不得**在布局 A 合法的记录流上被"顺手接受"（调用点契约：A 通过就不进重扫）
  const m = parseMdl(legalA)
  check('A2 变长救回', '布局 A 合法 ⇒ 不产生 mdlDiag（= 根本没走重扫；A 路径逐位不变）', !!m && !m.mdlDiag && m.bones.length === 3)
  check('A2 变长救回', '`rescanMdlsNameFrontedBones` 是纯函数、不写全局（同输入两次结果逐位相同）',
    JSON.stringify(rescanMdlsNameFrontedBones(rescMixed, new DataView(rescMixed.buffer), mdlsOffsetOf(rescMixed), 4))
    === JSON.stringify(rescanMdlsNameFrontedBones(rescMixed, new DataView(rescMixed.buffer), mdlsOffsetOf(rescMixed), 4)))
  // 畸形/越界输入必须**返回一个可判定的拒绝**（不是抛异常 —— 抛出去会被 parseMdl 外层 catch 吞成
  // "没台账的空骨架"，正是 P-152 不许的静默失败）
  const dvM = new DataView(rescMixed.buffer, rescMixed.byteOffset, rescMixed.byteLength)
  check('A2 变长救回', '判据单元：越界/畸形输入不抛异常、返回可判定的 rescued=false（not-attemptable）',
    (() => {
      const cases = [
        rescanMdlsNameFrontedBones(rescMixed, dvM, rescMixed.length - 4, 3),   // 段起点在文件尾
        rescanMdlsNameFrontedBones(rescMixed, dvM, -5, 3),                     // 负偏移
        rescanMdlsNameFrontedBones(rescMixed, dvM, mdlsOffsetOf(rescMixed), 0),
        rescanMdlsNameFrontedBones(rescMixed, dvM, mdlsOffsetOf(rescMixed), 99999),
      ]
      return cases.every((r) => r && r.rescued === false && typeof r.reason === 'string' && r.reason.length > 0)
    })(), '四种畸形输入的 reason 均为可读字符串')
}
{
  const r = runSample('10 字节头变体（tmp=u16）', head10, 2)
  check('A 合成逐类', '10 字节头变体：合法 ⇒ 逐位采用（2 骨，id/parent 与构造一致）',
    r.bones === 2 && !r.diag && JSON.stringify(parseMdl(head10).bones.map((b) => [b.type, b.parent])) === JSON.stringify([[1, -1], [2, 0]]))
}

// ── A.2 判据单元（纯函数；布局 A 判据自身 + 骨名槽字节判据 + 未定义长度字段）──────────────────
console.log('①b 判据单元（readMdlsLayoutABones 的逐骨判据）')
{
  // 骨名槽含控制字节 0x01：定步本身能读完整（complete），但**逐骨判据拒绝**
  const u8 = buildMdl({ declaredCount: 1, bones: [boneA(1, -1, { slot: [0x01, 0x62, 0x63, 0] })] })
  const cap = capture(() => readMdlsLayoutABones(u8, new DataView(u8.buffer), mdlsOffsetOf(u8), 1, null))
  const r = cap.r
  check('A 判据单元', '骨名槽控制字节：complete=true 但 entryErrors=[name-slot-invalid-bytes]',
    r.complete === true && r.entryErrors.length === 1 && r.entryErrors[0].reason === 'name-slot-invalid-bytes', JSON.stringify(r.entryErrors))
  const cap2 = capture(() => parseMdl(u8))
  check('A 判据单元', '骨名槽控制字节：parseMdl 拒绝整个骨架（bones=[] + reason 落到台账）',
    !!cap2.r && cap2.r.bones.length === 0 && !!cap2.r.mdlDiag && cap2.r.mdlDiag.reason === 'name-slot-invalid-bytes',
    cap2.r ? JSON.stringify(cap2.r.mdlDiag) : 'parseMdl=null')
  // 非法 UTF-8（0xFF 0xFE）
  const u8b = buildMdl({ declaredCount: 1, bones: [boneA(1, -1, { slot: [0xff, 0xfe, 0] })] })
  const rb = readMdlsLayoutABones(u8b, new DataView(u8b.buffer), mdlsOffsetOf(u8b), 1, null)
  check('A 判据单元', '骨名槽非法 UTF-8：拒绝（name-slot-invalid-bytes）', rb.entryErrors.length === 1 && rb.entryErrors[0].reason === 'name-slot-invalid-bytes')
  // 布局 C 的 JSON 元数据槽必须**不**被误拒（本仓语料 40/332 骨是这种槽）
  const jsonSlot = buildMdl({ declaredCount: 1, bones: [boneA(1, -1, { slot: A32('{"a":null,"lamax":null,"tm":100.0,"tp":"892.50433 0.00000 0.00000"}').concat([0]) })] })
  const rj = readMdlsLayoutABones(jsonSlot, new DataView(jsonSlot.buffer), mdlsOffsetOf(jsonSlot), 1, null)
  check('A 判据单元', 'JSON 元数据槽（布局 C 形态）：**不**误拒（判据只查可打印+长度）', rj.entryErrors.length === 0 && rj.complete === true)
  // len=0（未定义长度）⇒ 结构错（定步失步的可判定形式）
  const lenZero = buildMdl({ declaredCount: 2, bones: [boneA(1, -1, { len: 0 }), boneA(2, 0)] })
  const cap3 = capture(() => parseMdl(lenZero))
  check('A 判据单元', 'len=0：拒绝 + reason=record-truncated（可判定）',
    !!cap3.r && !!cap3.r.mdlDiag && cap3.r.mdlDiag.reason === 'record-truncated' && cap3.r.bones.length === 0,
    cap3.r ? JSON.stringify(cap3.r.mdlDiag) : 'parseMdl=null')
}

// ── A.3 ?mdls=legacy 的判定式 + 逐样本逐位回退 ────────────────────────────────────────────
console.log('② `?mdls=legacy`：判定式 + 逐位回退')
{
  check('B legacy', 'mdlsLegacy 判定式：&mdls=legacy ⇒ true', mdlsLegacy('?a=1&mdls=legacy') === true && mdlsLegacyElysia('?a=1&mdls=legacy') === true)
  check('B legacy', 'mdlsLegacy 判定式：其它值/空/undefined ⇒ false', mdlsLegacy('?mdls=1') === false && mdlsLegacy('') === false && mdlsLegacy(undefined) === false && mdlsLegacy('?mdlsx=legacy') === false)
}
const SAMPLE_SET = [['legalA', legalA, 3], ['layoutB', layoutB, 3], ['layoutC', layoutC, 3], ['badParent', badParent, 3], ['badMatIdx', badMatIdx, 2], ['truncated', truncated, 3], ['longNameSlot', longNameSlot, 2], ['badRot', badRot, 2], ['badTrans', badTrans, 2], ['head10', head10, 2],
  // ①(P-152b) 变长布局夹具也进 legacy 组：legacy 档必须**不救回**（逐位回到旧行为）
  ['rescMixed', rescMixed, 4], ['rescSingle', rescSingle, 1], ['rescRotX', rescRotX, 2], ['rescFwdParent', rescFwdParent, 2], ['rescLenBad', rescLenBad, 2], ['rescCut', rescCut, 3], ['rescBadMatrix', rescBadMatrix, 2], ['rescCrossSection', rescCrossSection, 3]]
{
  let same = 0, layoutAN = 0, legacyDiag = 0, refusedDefault = 0, rescuedPrefixOK = 0, rescuedN = 0
  const legacyDescs = []
  for (const [label, u8, declared] of SAMPLE_SET) {
    const d = parseMdl(u8)                                    // 默认档（带校验 + 重扫）
    const l = capture(() => parseMdl(u8, { mdls: 'legacy' })) // legacy（无校验旧行为，**不重扫**）
    const le = capture(() => H._parseMdl(new MpwBuffer(u8.buffer, u8.byteOffset, u8.byteLength), { mdls: 'legacy' }))
    // "逐位回退"的判据：**布局 A 合法**的样本上 legacy ≡ 默认档；其余样本上 legacy 退回旧结果（可残缺）
    const isA = !d.mdlDiag
    if (isA) { layoutAN++; if (JSON.stringify(d.bones) === JSON.stringify(l.r.bones)) same++ }
    if (!isA && l.r.bones.length !== 0) refusedDefault++
    if (l.r.mdlDiag || le.r.mdlDiag) legacyDiag++
    if (l.warns.length || le.warns.length) legacyDiag++
    // ①(P-152b) 救回样本：legacy 的骨必须是默认档的**前缀**（逐位）⇒ 救回只"延长真实前缀"，
    //   没有重排/篡改已读出的骨；且 legacy 的条数 < 声明骨数（= 旧路径当时确实产的是**残缺骨架**）
    if (d.mdlDiag && d.mdlDiag.rescued === true) {
      rescuedN++
      const pre = JSON.stringify(d.bones.slice(0, l.r.bones.length)) === JSON.stringify(l.r.bones)
      if (pre && l.r.bones.length < declared) rescuedPrefixOK++
    }
    legacyDescs.push(label + '=' + crypto.createHash('sha256').update(JSON.stringify(l.r.bones)).digest('hex').slice(0, 12))
  }
  check('B legacy', 'legacy 逐样本：**布局 A 合法**样本的骨与默认档逐位相同（' + layoutAN + '/' + layoutAN + '）', same === layoutAN, same + '/' + layoutAN)
  check('B legacy', 'legacy 逐样本：被默认档拒绝的样本，legacy 退回**旧结果**（`bones.length != 0` 或空骨架，不是新失败路径）', refusedDefault >= 5, 'refusedThenLegacyParsed=' + refusedDefault)
  check('B legacy', 'legacy 逐样本：**不产生** mdlDiag、**不打** warn（= 逐位回到无校验旧行为）', legacyDiag === 0, 'legacyDiag=' + legacyDiag)
  check('B legacy', 'legacy 逐样本：救回样本（' + rescuedN + ' 个）上 legacy 仍产**残缺骨架**（条数 < 声明）且是默认档的逐位前缀',
    rescuedN === 5 && rescuedPrefixOK === rescuedN, 'prefixOK=' + rescuedPrefixOK + '/' + rescuedN)
  console.log('  · legacy 档逐样本骨指纹 sha256[0:12]：' + legacyDescs.join(' '))
  // 非法/变长样本在 legacy 下必须能"坏得出来"（否则 R1 变异无从谈起）
  const lb = parseMdl(layoutB, { mdls: 'legacy' })
  const lc = parseMdl(layoutC, { mdls: 'legacy' })
  check('B legacy', 'legacy 下布局 B/C **不被拒也不救回**（正是"恰好没坏/残缺"的旧行为）',
    !lb.mdlDiag && !lc.mdlDiag && lb.bones.length === 0 && lc.bones.length === 1, 'B=' + lb.bones.length + ' C=' + lc.bones.length)
  check('B legacy', 'legacy 下混合夹具（真语料同形）只读出错位前缀（1 < 4）',
    (() => { const m = parseMdl(rescMixed, { mdls: 'legacy' }); return !m.mdlDiag && m.bones.length === 1 })())
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// B. 全语料回归（只读 entry 表 + 流式读单个 .mdl entry；不整包 readFileSync）
//   ⚠ **语料敏感（corpus-sensitive）**：本组（③）的计数随本机语料规模/内容走 —— 基线自导出、只增不减；
//     真语料缺失时本组按"根不存在 ⇒ 容器 0 ⇒ 基线断言红"处理（不 SKIP，因为语料是本项判据的可信来源）。
//   ✅ **不渲染敏感**：无浏览器 / 无 GPU / 无网络 / 无 X11，只有 node 的字节解析（①②④⑤ 组与语料无关）。
// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('③ 全语料回归（自导出基线：rows≥165 / MDLS≥79 / 骨≥825 / 救回≥3 / 拒收基数 0 / 两档全 null≥5；2026-10-04 语料漂移同步）')
const WS_ROOT = process.env.MPW_ROOT || WS
const ROOTS = [path.join(WS_ROOT, 'allwallpaper'), path.join(os.homedir(), '.dsh-mpkg-wallpaper')]
// 逐字段**流式** sha256（**不**先拼大 JSON 字符串）：26.8MB 的 `球体04.mdl` 若整份
//   `JSON.stringify`，单次峰值会多出上百 MB —— 分片喂 hash 拿到的仍是"逐位相同"的判据（同样字节序）。
function hashFields(m, extra = null) {
  const h = crypto.createHash('sha256')
  const num = (v) => { const x = +v; return Number.isFinite(x) ? (Number.isInteger(x) ? String(x) : x.toFixed(6)) : String(v) }
  // 逐行拼（不 `flat()`：335k 顶点的文件上 `flat()` 会多一份 100 万元素数组）
  const put = (label, arr) => { h.update(label + ':' + arr.length + ':') ; for (const v of arr) h.update(num(v) + ',') }
  const putRows = (label, rows) => { h.update(label + ':' + rows.length + ':') ; for (const row of rows) { h.update('[') ; for (const v of row) h.update(num(v) + ',') ; h.update(']') } }
  putRows('p', m.positions)
  putRows('u', m.uvs)
  put('i', m.indices)
  putRows('bi', m.blendIndices)
  putRows('bw', m.blendWeights)
  for (const bn of m.bones) h.update('B' + bn.index + '|' + bn.type + '|' + bn.parent + '|' + String(bn.bind) + ';')
  for (const an of m.animations) { h.update('A' + an.id + '|' + an.name + '|' + an.frameCount + '|' + an.boneCount + '|' + an.segBytes + '|' + an.fps + '|'); put('segs', an.segs) }
  if (extra) h.update(extra)
  return h.digest('hex')
}
const bonesDesc = (m) => ({
  n: m.bones.length,
  sha: crypto.createHash('sha256').update(JSON.stringify(m.bones)).digest('hex'),
})
const corpus = { rows: 0, mdls: 0, bones: 0, badParent: 0, badMat: 0, rejected: 0, warns: 0, warnsRescued: 0, diffLegacy: 0, diffElysia: 0, descs: [], shapes: 0, nullWithMdls: 0, nullNoMdls: 0, declaredMismatch: 0, digests: [],
  // ②(2026-09-23) 新增台账：null 的两种成因、被拒文件清单、非 A 布局理由
  nullBoth: 0, nullDefaultOnly: 0, nowNotNullLegacyNull: 0, rejects: [], rescued: [], badBoneCount: 0, elysiaRescued: 0, elysiaRefusedRescued: 0, elysiaTruncated: 0 }
/* ②(2026-09-23 语料漂移修复) **语料自导出基线**（只增不减）+ 与规模无关的逐文件判据。
 *   旧写法把"43 `.mdl` / 35 MDLS / 332 骨 / 0 非法 / 0 拒绝 / 0 差异"钉死 ⇒ 今晚新增 `0923/`
 *   （+`wallpaperE/` 重命名）后整组变红（红在"语料长了"）。新判据分三层：
 *     ① **零回归（逐文件，与规模无关）**：默认档的"能不能解析 / 骨数 / 逐字段"必须与 legacy 档一致，
 *        **例外只有两类，且每一类都必须当场满足可验证前提**（不看计数、逐个文件验）：
 *          (a) **P-152b 救回**（`mdlDiag.rescued === true`）：骨数 == 声明骨数；layout ∈ {B,C,B/C}；
 *              legacy 档在那份文件上**本来就**读不齐声明骨数、且它的骨是默认档的**逐位前缀**
 *              （= 救回只延长真实前缀，没有重排/篡改）；A 定步当时确实失步（`rescan.aBones < 声明`）。
 *          (b) **P-152 拒收**（`mdlDiag.rejected === true`）：`layout !== 'A'`（拒的是真的非 A，不是把
 *              合法 A 判错 = 真"误伤"）+ legacy 档本来就 `骨数 != 声明骨数`（旧路径在产残缺骨架
 *              ⇒ 拒收是修不是伤）+ 重扫也被拒（`rescan.reason` 非空 ⇒ 不是"没试"）。
 *        ⇒ 这比原来的 `rejected == 0` **更强**：合法 A 被拒、或默认档与 legacy 档出现任何未解释的差异 ⇒ 红。
 *     ② **规模（自导出基线）**：行数 / MDLS 数 / 累计骨数 / 无 MDLS 的形状数 / 救回数必须 ≥ 基线。
 *     ③ **已知局限照实登记**：`0923/2887099508` 有 5 个 `.mdl` 在**两档下都**返回 null（顶点块扫描
 *        没命中；它们的第一段是 `MDLV0016` 变体，null 发生在 MDLS 解析**之前** ⇒ 变长布局重扫无从作用）
 *        —— 与 P-152/P-152b 无关（legacy 同值），逐条点名 + 基线计数，**不伪装成"零 null"**；
 *        反过来"默认 null 而 legacy 非 null"= 真回归，必红。
 *        ⚠ ③(P-173 2026-09-24) 这 5 个**已不再是 null**（网格容器变体另立一项救回，见下方重定基说明）⇒
 *          第 ③ 条今天只剩"第 6 个 `MDLV0016`（无 MDLS 的 `Hollow Cylinder`，仍 null）"这一个同类样本，
 *          其判据在 `tests/mdlv0016-test.mjs`（本组不再重复）。
 *   基线取法：`P152_SCAN_UPDATE=1` 时本组打印可粘贴的一行。
 *   ⚠ ③(P-173 2026-09-24) **重定基一次（判据谓词一字未动）**：`nullBoth` 5 → **0**、`bones` 885 → **899**。
 *     原因不是"语料变了"，而是**本项列在这里的那条已知局限被另一项修掉了**：`0923/2887099508` 的 5 个
 *     `MDLV0016`（顶点块步长 52 的紧凑容器变体）现在能被解析 ⇒ 它们从"两档都 null"变成"两档都给出骨架"
 *     （新增 14 骨 = 2+5+2+2+3）。判定这些文件的判据**全部**搬去了新门禁 `tests/mdlv0016-test.mjs`
 *     （逐字节取证 / 全语料改前改后对拍 / 骨架与台账 / 16 条边界夹具 / 8 组变异自证）；
 *     本组保留的谓词仍是"nullBoth ≥ 基线 ∧ 默认 null 而 legacy 非 null == 0 ∧ 默认非 null 而 legacy null == 0"
 *     —— 只是基线数字随"局限被修掉"下调（否则本组会把"修好了"记成红）。
 *     ⚠ 本组**不**声称"零 null"：`nullNoMdls` 与 `shapes` 随"局限被修掉"更新 ——
 *     **P-250（2026-10-07）补上 48B 静态 PBR 布局** ⇒ `nullNoMdls` 46 → 4、`shapes` 40 → 82；
 *     **P-256（2026-10-07）又补上"平铺 uv"的接受判据**（`models/自制天空盒0[012]` 的 uv 超出 [0,1]、
 *     命中率仅 0.46）⇒ `nullNoMdls` **4 → 0**、`shapes` **82 → 86**：**语料里再也没有"无 MDLS 且解析不出"的 mdl**。
 *     本组原先写的"第 6 个 `MDLV0016`（`Hollow Cylinder`）有意不接"已被 P-250 **取代**：它现在按 48B
 *     静态网格解析（bones=[]）。 */
const MDL_CORPUS_BASELINE = {
  note: '2026-09-23 全语料自导出（只增不减）。旧写死值：rows=43 / mdls=35 / bones=332 / 非法=0 / 拒绝=0 / 差异=0 / nullNoMdls=7 / shapes=1。P-152b 后：rejects 3→0（那 3 个被救回）、rescued=3、bones 821→885。P-173（2026-09-24）：MDLV0016 紧凑变体（5 个文件）被解析 ⇒ nullBoth 5→0、bones 885→899（+14）。',
  // ①(2026-10-04 语料漂移同步) 172/86/899 → 165/79/825：wallpapertest1_*.mpkg 被主线移入
  //   allwallpaper/delete/（离开扫描根集）——同步并记录原因（发现按内容特征，不与路径绑定）。
  rows: 165, mdls: 79, bones: 825, nullBoth: 0, rejects: 0, rescued: 3, nullNoMdls: 0, shapes: 86,
}
/* ②(P-152b) 救回的**已知清单**（按文件名钉住，不是只比数量）：关掉重扫 ⇒ 清单为空 ⇒ 必红。
 *   真语料实测（2026-09-23，改前/改后骨数）：`asuna body bottom_puppet.mdl` 声明 7 / 旧路径 1 → 7；
 *   `人物_puppet.mdl`（`0923/3479521040`）声明 55 / 旧路径 3 → 55；`deimos.fbx.mdl` 声明 2 / 旧路径 0 → 2。 */
const RESCUED_KNOWN = ['asuna body bottom_puppet.mdl', '3479521040', 'deimos.fbx.mdl']
const rescuedNamePred = (list) => RESCUED_KNOWN.every((x) => list.some((r) => r.name.endsWith(x) || r.pkg === x))
{
  const pkgs = []
  for (const r of ROOTS) { if (!fs.existsSync(r)) continue; for (const p of walkContainers(r)) pkgs.push(p) }
  check('C 语料', '语料根存在（' + ROOTS.length + ' 个）', pkgs.length > 0, 'containers=' + pkgs.length)
  const ow = console.warn, warnLines = []
  console.warn = (...a) => warnLines.push(a.join(' '))
  for (const f of pkgs) {
    let idx
    try { idx = readIndexHead(f) } catch { continue }
    for (const e of idx.entries.filter((x) => /\.mdl$/i.test(x.name))) {
      corpus.rows++
      let b
      try { b = readEntryBytes(f, idx, e) } catch { continue }
      const mo = b.indexOf('MDLS', 0, 'latin1')
      const hasMdls = mo >= 0
      const declared = hasMdls ? b.readUInt32LE(mo + 13) : 0
      if (hasMdls) corpus.mdls++
      const base = parseMdl(b, { mdls: 'legacy' })          // 基线 = ?mdls=legacy（P-152 之前的实现路径）
      const cap = capture(() => parseMdl(b))
      const now = cap.r
      if (!now || !base) {
        /* null 的两种成因分开记：①两档都 null（= 顶点块扫描没命中，与 P-152 无关的**已知局限**）；
         * ②只有默认档 null（= 真回归，下面单独判红）。 */
        if (hasMdls) {
          corpus.nullWithMdls++
          if (!now && !base) corpus.nullBoth++
          else if (!now && base) { corpus.nullDefaultOnly++; check('C 语料', '默认档 null 而 legacy 非 null（回归）：' + e.name, false) }
          else if (now && !base) corpus.nowNotNullLegacyNull++
        } else corpus.nullNoMdls++
        continue
      }
      for (const bn of now.bones) {
        if (!(bn.parent === -1 || (bn.parent >= 0 && bn.parent < now.bones.length))) corpus.badParent++
        if (!(Number.isFinite(bn.type) && bn.type >= 0 && bn.type < 100000)) corpus.badMat++
      }
      if (!hasMdls) corpus.shapes++
      corpus.warns += cap.warns.length
      if (cap.warns.length && now.mdlDiag && now.mdlDiag.rescued === true) corpus.warnsRescued++
      corpus.bones += now.bones.length
      if (hasMdls) corpus.descs.push(e.name + '|' + bonesDesc(now).sha)
      /* ②(2026-09-23 / P-152b) **允许差异的唯一两类条件**（逐文件当场验证，不看计数）：
       *   (a) 救回：bones == 声明 + layout ∈ {B,C,B/C} + A 步确实失步 + legacy 本来就残缺且是逐位前缀；
       *   (b) 拒收：有 mdlDiag + layout ≠ A + legacy 本来就与声明骨数不符 + 重扫也拒。
       *   其余情况一律要求 默认 == legacy（逐字段）。 */
      const rescued = !!now.mdlDiag && now.mdlDiag.rescued === true
      const justifiedReject = !!now.mdlDiag && now.mdlDiag.rejected === true && now.mdlDiag.layout !== 'A' && base.bones.length !== declared
      const el = H._parseMdl(new MpwBuffer(b.buffer, b.byteOffset, b.byteLength))
      const ell = H._parseMdl(new MpwBuffer(b.buffer, b.byteOffset, b.byteLength), { mdls: 'legacy' })
      if (rescued) {
        corpus.rejected++   // 有台账（供"台账数 == 救回数 + 拒收数"这条总账断言用）
        const pre = JSON.stringify(now.bones.slice(0, base.bones.length)) === JSON.stringify(base.bones)
        const rec = { name: e.name, pkg: path.basename(path.dirname(f)), declared, bones: now.bones.length, legacyBones: base.bones.length, layout: now.mdlDiag.layout, aBones: (now.mdlDiag.rescan || {}).aBones, aReason: (now.mdlDiag.rescan || {}).aReason, prefixOK: pre }
        corpus.rescued.push(rec)
        check('C 语料', '救回文件**当场验证**（骨数==声明 / layout∈{B,C,B/C} / A 步确实失步 / legacy 残缺且是逐位前缀）：' + e.name,
          now.bones.length === declared && ['B', 'C', 'B/C'].includes(now.mdlDiag.layout)
          && base.bones.length !== declared && pre && rec.aBones < declared,
          'declared=' + declared + ' rescued=' + now.bones.length + ' legacy=' + base.bones.length + ' layout=' + rec.layout + ' A步读=' + rec.aBones + '(' + rec.aReason + ') 前缀逐位=' + pre)
        check('C 语料', '救回文件：恰好一行 warn（救回也有痕，不是静默）', cap.warns.length === 1 && /\[P-152\] MDLS bone layout rescued/.test(cap.warns[0]), (cap.warns[0] || '(无 warn)'))
        // elysia 侧（`demo.html` 实际运行的那份）：**契约 = 绝不产残缺骨架**（`bones.length ∈ {0, 声明}`）。
        // 现状：elysia 还没移植 P-152b ⇒ 它在这 3 个文件上仍是 `bones=[]`（拒收）。这里**不断言**它必须救回
        // （`elysia/**` 由另一条线改），只断言"不许残缺"，并把两侧现状点名打印出来。
        if (el) {
          if (el.bones.length === declared) corpus.elysiaRescued++
          else if (el.bones.length === 0) corpus.elysiaRefusedRescued++
          else corpus.elysiaTruncated++
          check('C 语料', 'elysia 侧在救回文件上**绝不产残缺骨架**（bones ∈ {0, 声明}）：' + e.name,
            el.bones.length === 0 || el.bones.length === declared, 'elysia=' + el.bones.length + ' declared=' + declared)
          check('C 语料', 'elysia legacy 档与 core legacy 档骨数一致（旧行为两侧同源）：' + e.name,
            !!ell && ell.bones.length === base.bones.length, 'elysia legacy=' + (ell ? ell.bones.length : 'null') + ' core legacy=' + base.bones.length)
        }
      } else if (justifiedReject) {
        corpus.rejected++
        corpus.rejects.push({ name: e.name, pkg: path.basename(path.dirname(f)), declared, legacyBones: base.bones.length, layout: now.mdlDiag.layout, reason: now.mdlDiag.reason, rescanReason: (now.mdlDiag.rescan || {}).reason || null })
        // 同契约：elysia 侧也必须同样拒收（两边不许一边拒一边产残缺骨架）。
        // ⚠ 如实记一处**两侧可观测面不同**：core 的 `parseMdl` 在返回值上带 `mdlDiag`；elysia 的
        //   `_parseMdl`（`elysia/we-renderer/puppet.js:321/357/366`）把 `mdlDiag` 算成**局部变量**、
        //   第 510 行的 return 里**没有**它 ⇒ elysia 侧只留下"warn + bones=[]"这两个可观测量。
        //   所以这里按**可观测契约**判：elysia 默认档也 bones=[]，且它的 legacy 档仍产出那副残缺骨架。
        check('C 语料', '被拒文件两侧同契约（core/elysia 默认档都 bones=[]，legacy 档骨数两边一致）：' + e.name,
          !!(el && ell && el.bones.length === now.bones.length && now.bones.length === 0 && ell.bones.length === base.bones.length),
          'elysia 默认=' + (el ? el.bones.length : 'null') + ' elysia legacy=' + (ell ? ell.bones.length : 'null') + ' core 默认=' + now.bones.length + ' core legacy=' + base.bones.length)
      } else {
        if (now.bones.length !== base.bones.length) corpus.badBoneCount++
        // 逐字段（流式 sha256，不拼大字符串）：默认 vs legacy
        const ha = hashFields(now), hc = hashFields(base)
        if (ha !== hc) { corpus.diffLegacy++; check('C 语料', '默认 == legacy（逐字段）：' + e.name, false) }
        else corpus.digests.push(ha.slice(0, 16))
        if (hasMdls && now.bones.length !== declared) { corpus.declaredMismatch++; check('C 语料', '骨数 == 声明骨数：' + e.name, false) }
        // elysia 侧（`demo.html:3442` 实际运行的那份）：**同契约**的判据是
        //   ① 合法语料上"默认档 == 自己的 legacy 档"（逐位）且不产生 mdlDiag；
        //   ② 骨数 == 声明骨数（= core 侧同一判据）。
        //   ⚠ **不**断言 "core == elysia"：本仓两侧的**骨矩阵**在若干 `.mdl` 上本来就不一致（属既有差异，
        //     与 P-152 无关）——写成断言会把**既有**差异记到 P-152 头上（不诚实）。
        if (!el || hashFields({ positions: [], uvs: [], indices: [], blendIndices: [], blendWeights: [], bones: el.bones, animations: [] })
          !== hashFields({ positions: [], uvs: [], indices: [], blendIndices: [], blendWeights: [], bones: ell.bones, animations: [] }) || el.mdlDiag) {
          corpus.diffElysia++
          check('C 语料', 'elysia 默认 == legacy 且无 mdlDiag：' + e.name, false)
        }
        if (el && hasMdls && el.bones.length !== declared) { corpus.diffElysia++; check('C 语料', 'elysia 骨数 == 声明骨数：' + e.name, false) }
      }
    }
  }
  console.warn = ow
  corpus.legacyWarns = warnLines.length
  const B = MDL_CORPUS_BASELINE
  if (process.env.P152_SCAN_UPDATE) console.log('  [scan-baseline] ' + JSON.stringify({ rows: corpus.rows, mdls: corpus.mdls, bones: corpus.bones, nullBoth: corpus.nullBoth, rejects: corpus.rejects.length, rescued: corpus.rescued.length, nullNoMdls: corpus.nullNoMdls, shapes: corpus.shapes, declaredMismatch: corpus.declaredMismatch, diffLegacy: corpus.diffLegacy, diffElysia: corpus.diffElysia, badParent: corpus.badParent, badMat: corpus.badMat }))
  check('C 语料', '`.mdl` 行数 ≥ ' + B.rows + '、含 MDLS 的 ≥ ' + B.mdls + '、骨骼累计 ≥ ' + B.bones + '（**自导出基线，只增不减**；P-152b 前是 821）',
    corpus.rows >= B.rows && corpus.mdls >= B.mdls && corpus.bones >= B.bones, 'rows=' + corpus.rows + ' mdls=' + corpus.mdls + ' bones=' + corpus.bones)
  check('C 语料', '非法骨（parent 越界 / 材质索引越界）= 0（纯合法性；骨数差异另判）', corpus.badParent === 0 && corpus.badMat === 0, 'badParent=' + corpus.badParent + ' badMat=' + corpus.badMat)
  check('C 语料', '骨数 != legacy 的**未解释**文件 = 0（零回归；救回/拒收文件走上面两条的"当场验证"）', corpus.badBoneCount === 0, 'badBoneCount=' + corpus.badBoneCount)
  check('C 语料', '**救回文件**（P-152b）≥ ' + B.rescued + ' 个且逐个当场验证过（骨数==声明 / layout∈{B,C,B/C} / legacy 残缺且逐位前缀 / A 步确实失步）',
    corpus.rescued.length >= B.rescued && corpus.rescued.every((r) => r.bones === r.declared && ['B', 'C', 'B/C'].includes(r.layout) && r.legacyBones !== r.declared && r.prefixOK && r.aBones < r.declared),
    'rescued=' + corpus.rescued.length + '（基线 ' + B.rescued + '）；' + corpus.rescued.map((r) => r.pkg + '/' + r.name + ' declared=' + r.declared + ' 改后=' + r.bones + ' 改前(legacy)=' + r.legacyBones + ' layout=' + r.layout).join(' | '))
  /* ②(P-152b · **数字自证**："把基线数字改回旧值必红"—— 对**同一条谓词**当场求值，不是嘴说）：
   *   · `rejects`：P-152b 前 = 3（3 个非 A 包被拒收），现在 = 0（都救回）⇒ 把基线改回旧值 3 ⇒ 谓词为 false ⇒ 必红。
   *   · `rescued`：救回清单**按文件名**钉住（`RESCUED_KNOWN`）⇒ 关掉重扫（组 D 的 R4）时清单为空 ⇒ 谓词为 false ⇒ 必红。
   *   ⚠ **语料敏感**：本组所有计数随本机语料规模走（自导出基线、只增不减）；谓词本身与规模无关。 */
  {
    const rejectsPred = (list, n) => list.length >= n && list.every((r) => r.layout !== 'A' && r.legacyBones !== r.declared && typeof r.rescanReason === 'string' && r.rescanReason.length > 0)
    check('C 语料', '数字自证：`rejects` 基线改回旧值 3（= 声称仍有 3 个拒收）⇒ 本组必红（现在 ' + corpus.rejects.length + ' 个）',
      rejectsPred(corpus.rejects, 3) === false && rejectsPred(corpus.rejects, B.rejects) === true, 'rejects=' + corpus.rejects.length)
    check('C 语料', '数字自证：救回清单**按文件名**钉住（' + RESCUED_KNOWN.join(' / ') + '）⇒ 关掉重扫后为空清单 ⇒ 必红',
      rescuedNamePred(corpus.rescued) === true && rescuedNamePred([]) === false,
      '清单命中=' + corpus.rescued.map((r) => r.name).join(' | '))
  }
  check('C 语料', '**被拒文件**（仍拒绝的）**每一个都当场验证过**：layout ≠ A 且 legacy 档本来就骨数 != 声明骨数且重扫也拒（拒收 ≠ 误伤合法 A，也不静默）',
    corpus.rejects.length >= B.rejects && corpus.rejects.every((r) => r.layout !== 'A' && r.legacyBones !== r.declared && typeof r.rescanReason === 'string' && r.rescanReason.length > 0),
    'rejectedButNotRescued=' + corpus.rejects.length + '（基线 ' + B.rejects + '）；' + corpus.rejects.map((r) => r.pkg + '/' + r.name + ' declared=' + r.declared + ' legacy=' + r.legacyBones + ' layout=' + r.layout + ' rescan=' + r.rescanReason).join(' | '))
  check('C 语料', 'warn 行数 == 救回数 + 拒收数（一个异常文件一行 warn，不多不少）', corpus.warns === corpus.rescued.length + corpus.rejects.length, 'warns=' + corpus.warns + ' rescued=' + corpus.rescued.length + ' rejects=' + corpus.rejects.length)
  check('C 语料', '默认 vs legacy 逐字段差异 = 0（零回归；救回/拒收文件走上面的"当场验证"）', corpus.diffLegacy === 0, 'diff=' + corpus.diffLegacy)
  check('C 语料', 'core vs elysia 骨逐位差异 = 0（布局 A 同契约；救回文件另有"两侧都不许残缺"的判据）', corpus.diffElysia === 0, 'diff=' + corpus.diffElysia)
  check('C 语料', '骨数 == 声明骨数（未救回也未拒收的 MDLS 文件，core 默认档与 legacy 档都成立）', corpus.declaredMismatch === 0, 'mismatch=' + corpus.declaredMismatch)
  check('C 语料', '无 MDLS 的 .mdl：null 数 ≥ ' + B.nullNoMdls + '、bones=[] 数 ≥ ' + B.shapes + '（自导出基线）', corpus.nullNoMdls >= B.nullNoMdls && corpus.shapes >= B.shapes, 'nullNoMdls=' + corpus.nullNoMdls + ' shapes=' + corpus.shapes + ' nullWithMdls=' + corpus.nullWithMdls)
  // ③(P-173 2026-09-24) 谓词一字未动，只把基线数字重定基（见 `MDL_CORPUS_BASELINE` 上方那段注释）：
  //   本项之前这里点的"顶点块扫描没命中"的 5 个 `MDLV0016` 已被新门禁 `tests/mdlv0016-test.mjs` 收编
  //   ⇒ `nullBoth` 基线随之下调；两条"方向性"判据（默认 null/legacy 非 null = 真回归；
  //   默认非 null/legacy null = 两侧分叉）仍**钉死为 0**。
  check('C 语料', '含 MDLS 而**两档都** null 的 .mdl ≥ ' + B.nullBoth + ' 个（自导出基线；P-173 前那 5 个 `MDLV0016` 已由 `mdlv0016` 项解析 ⇒ 基线 5→0）+ "默认 null 而 legacy 非 null" = 0 + "默认非 null 而 legacy null" = 0',
    corpus.nullBoth >= B.nullBoth && corpus.nullDefaultOnly === 0 && corpus.nowNotNullLegacyNull === 0,
    'nullBoth=' + corpus.nullBoth + '（基线 ' + B.nullBoth + '） nullDefaultOnly=' + corpus.nullDefaultOnly + ' nowNotNullLegacyNull=' + corpus.nowNotNullLegacyNull)
  // ③(P-152b) 两侧**可观测面**：core 有 `mdlDiag`（机器可判）；elysia 现状是**没有**它（局部变量、
  //   return 未带，见组 E 的逐条断言）⇒ 只留下"warn + bones=[]"。这里先钉住**跨两侧的不变量**：
  //   在 P-152b 新救回的这些文件上，elysia 侧**不许出现残缺骨架**（`bones ∈ {0, 声明}`）。
  check('C 语料', '两侧不变量：elysia 侧在救回文件上**绝不产残缺骨架**（' + corpus.rescued.length + ' 个文件，残缺数 = 0）',
    corpus.elysiaTruncated === 0, 'elysia 已救回=' + corpus.elysiaRescued + '（= 已移植 P-152b） elysia 仍拒收=' + corpus.elysiaRefusedRescued + '（未移植，现状） elysia 残缺=' + corpus.elysiaTruncated)
  check('C 语料', '总账：有台账的文件数 == 救回数 + 仍拒收数（每条异常路径都有一份机器可判台账）',
    corpus.rejected === corpus.rescued.length + corpus.rejects.length, 'diagFiles=' + corpus.rejected + ' rescued=' + corpus.rescued.length + ' refused=' + corpus.rejects.length)
  console.log('  · 语料指纹 sha256(' + corpus.descs.length + ' 行骨描述符) = ' + crypto.createHash('sha256').update(corpus.descs.join('\n')).digest('hex').slice(0, 32))
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// C. 变异自证（R1–R6）：把 core 复制到临时目录后**字符串变异**再 import，真跑本门禁的判据
//    "改回去必红"：R1/R2/R4/R5/R6 各自把一条**本轮新增或本轮依赖**的判据改回旧样 ⇒ 对应断言必红；
//    R3 是反向自证（把判据**弱化** ⇒ 本门禁必须仍全绿 = 没有靠它做过度拒绝）。
// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('④ 变异自证（真跑：复制 core → 字符串变异 → 重新 import）')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p152-mut-'))
const CORE_SRC = path.join(import.meta.dirname, '..', 'core')
let mutN = 0
async function withMutant(label, from, to, fn) {
  const dir = path.join(TMP, 'm' + (++mutN))
  fs.mkdirSync(dir, { recursive: true })
  // ①(2026-09-20 同上) 手抄清单 → 整目录复制（只跳子目录）：相对 import 闭包不会再因为"谁加了新模块"而断。
  for (const f of fs.readdirSync(CORE_SRC)) {
    const srcF = path.join(CORE_SRC, f)
    if (!fs.statSync(srcF).isFile()) continue
    fs.copyFileSync(srcF, path.join(dir, f))
  }
  const p = path.join(dir, 'attach-transform.mjs')
  const src = fs.readFileSync(p, 'utf8')
  if (!src.includes(from)) { check('D 变异自证', label + '：变异锚点存在', false); return null }
  fs.writeFileSync(p, src.replace(from, to))
  const mod = await import(pathToFileURL(p).href + '?v=' + mutN)
  return fn(mod)
}
{
  // R1：强制走"无校验旧路径" ⇒ 非法样本不再被拒 ⇒ 逐类判定必红
  await withMutant('R1 无校验旧路径', 'const mdlsLegacyMode = !!(opts && (opts.mdls === \'legacy\' || opts.mdlsLegacy === true))',
    'const mdlsLegacyMode = true /* MUT-R1 */', (mod) => {
      const reds = []
      for (const [label, u8] of [['layoutB', layoutB], ['layoutC', layoutC], ['badParent', badParent], ['badMatIdx', badMatIdx], ['badRot', badRot], ['badTrans', badTrans]]) {
        const m = mod.parseMdl(u8)
        if (!m || !m.mdlDiag || m.bones.length !== 0) reds.push(label + '(bones=' + (m ? m.bones.length : 'null') + ',diag=' + !!(m && m.mdlDiag) + ')')
      }
      check('D 变异自证', 'R1 去掉校验（恒走旧路径）⇒ 非法样本不再被拒 ⇒ 本组必红', reds.length >= 6, '实际变红样本 ' + reds.length + '/6: ' + reds.join(' '))
      const la = mod.parseMdl(legalA)
      check('D 变异自证', 'R1 下合法布局 A 仍照常解析（说明红的是"校验"不是"解析"）', !!la && la.bones.length === 3)
    })
  // R2：布局判定恒为 A ⇒ **拒绝档**的 `layout` 从 not-A 变 refused（B/C 现在会被救回，不再是这一档的观测点）
  await withMutant('R2 布局判定恒 A', 'export function mdlLooksLikeLayoutA(entryErrors) {\n  return ((entryErrors && entryErrors.length) || 0) === 0\n}',
    'export function mdlLooksLikeLayoutA(entryErrors) {\n  return true /* MUT-R2 */\n}', (mod) => {
      const bp = mod.parseMdl(badParent) || {}, bt = mod.parseMdl(badTrans) || {}
      const reds = []
      if (!(bp.mdlDiag && bp.mdlDiag.layout === 'not-A')) reds.push('badParent(layout=' + (bp.mdlDiag && bp.mdlDiag.layout) + ')')
      if (!(bt.mdlDiag && bt.mdlDiag.layout === 'not-A')) reds.push('badTrans(layout=' + (bt.mdlDiag && bt.mdlDiag.layout) + ')')
      check('D 变异自证', 'R2 布局判定恒 A ⇒ 拒绝档 `layout` 从 not-A 变 refused ⇒ 本组必红', reds.length === 2, '实际变红 ' + reds.join(' '))
      check('D 变异自证', 'R2 下"仍拒绝/仍空骨架"不变（失败路径与判定档是两件事）', (bp.bones || []).length === 0 && (bt.bones || []).length === 0)
      const b = mod.parseMdl(layoutB) || {}
      check('D 变异自证', 'R2 下救回路径不受影响（救回按"真失步 + 重扫成功"，不依赖 layout 档）',
        !!(b.mdlDiag && b.mdlDiag.rescued === true && b.bones.length === 3))
    })
  // R3：骨名槽判据弱化 ⇒ 本门禁**必须仍然全绿**（没有过度拒绝的证明）
  await withMutant('R3 骨名槽判据弱化', 'function mdlNameSlotOK(raw, s, e) {',
    'function mdlNameSlotOK(raw, s, e) {\n  return true /* MUT-R3 */', async (mod) => {
      let green = 0, red = []
      const cases = [
        ['layoutB 仍救回 3 骨', () => { const m = mod.parseMdl(layoutB); return !!(m.mdlDiag && m.mdlDiag.rescued === true && m.bones.length === 3) }],
        ['layoutC 仍救回 3 骨', () => { const m = mod.parseMdl(layoutC); return !!(m.mdlDiag && m.mdlDiag.rescued === true && m.bones.length === 3) }],
        ['longNameSlot 仍拒（name-slot-too-long）', () => { const m = mod.parseMdl(longNameSlot); return !!(m.mdlDiag && m.mdlDiag.reason === 'name-slot-too-long') }],
        ['badParent 仍拒（parent-out-of-range）', () => { const m = mod.parseMdl(badParent); return !!(m.mdlDiag && m.mdlDiag.reason === 'parent-out-of-range') }],
        ['badRot 仍拒（rotation-row-not-unit）', () => { const m = mod.parseMdl(badRot); return !!(m.mdlDiag && m.mdlDiag.reason === 'rotation-row-not-unit') }],
      ]
      for (const [label, fn] of cases) { if (fn()) green++; else red.push(label) }
      check('D 变异自证', 'R3 骨名槽判据弱化 ⇒ 本门禁仍全绿（5/5 判据不受影响 = 没靠它做过度拒绝）', green === 5, 'green=' + green + '/5' + (red.length ? ' red=' + red.join(',') : ''))
    })
  // R4：**关掉重扫**（= 回到 P-152 的"只校验不重扫"）⇒ 救回组必红（这条是 P-152b 的主自证）
  await withMutant('R4 关掉重扫（回到 P-152 只校验）', 'export function rescanMdlsNameFrontedBones(raw, dv, mdlsOffset, boneCount) {',
    'export function rescanMdlsNameFrontedBones(raw, dv, mdlsOffset, boneCount) {\n  return { rescued: false, reason: \'disabled-by-mutant-R4\', parsedBones: 0, variant: null } /* MUT-R4 */', (mod) => {
      const reds = []
      for (const [label, u8, declared] of [['layoutB', layoutB, 3], ['layoutC', layoutC, 3], ['rescMixed', rescMixed, 4], ['rescRotX', rescRotX, 2]]) {
        const m = mod.parseMdl(u8)
        if (!m || !m.mdlDiag || m.mdlDiag.rescued !== true || m.bones.length !== declared) reds.push(label + '(bones=' + (m ? m.bones.length : 'null') + ')')
      }
      check('D 变异自证', 'R4 关掉重扫 ⇒ 4 个变长布局夹具全部退回"拒绝/残缺" ⇒ 救回组必红', reds.length === 4, '实际变红 ' + reds.length + '/4: ' + reds.join(' '))
    })
  // R5：重扫在"矩阵截断"处 `break`（= 接受残缺）⇒ "绝不残缺"组必红
  await withMutant('R5 重扫接受残缺（矩阵截断处 break）', 'if (p + len > raw.length) return { bones, reason: \'matrix-truncated\', at: b, end: p }',
    'if (p + len > raw.length) break /* MUT-R5 */', (mod) => {
      const m = mod.parseMdl(rescCut)
      const truncatedOut = m ? m.bones.length : -1
      check('D 变异自证', 'R5 重扫接受残缺 ⇒ 截断夹具返回 0 < bones < 声明（本门禁的"绝不残缺"判据必红）',
        !!m && truncatedOut > 0 && truncatedOut < 3, 'bones=' + truncatedOut + ' declared=3')
      const ok = mod.parseMdl(rescMixed)
      check('D 变异自证', 'R5 下完整的变长夹具仍照常救回（说明红的是"残缺"不是"解析"）', !!ok && ok.bones.length === 4)
    })
  // R6：去掉"父必须先声明"⇒ 前向引用夹具被误救回 ⇒ 必红
  await withMutant('R6 去掉父序判据', '    if (!(parent === -1 || parent < b)) return { bones, reason: \'parent-not-before-child\', at: b, end: p }\n',
    '', (mod) => {
      const m = mod.parseMdl(rescFwdParent)
      check('D 变异自证', 'R6 去掉"父必须先声明" ⇒ 前向引用夹具被误救回（bones=2 > 0）⇒ 本门禁必红',
        !!m && m.bones.length === 2, 'bones=' + (m ? m.bones.length : 'null'))
      const ok = mod.parseMdl(rescLenBad)
      check('D 变异自证', 'R6 下 len≠64 判据不依赖父序（仍拒）', !!ok && ok.bones.length === 0 && ok.mdlDiag && ok.mdlDiag.rescan && ok.mdlDiag.rescan.reason === 'bone-len-not-64')
    })
}
// ══════════════════════════════════════════════════════════════════════════════════════════
// E. ①(P-152b) 两侧**可观测面**（core 有 `mdlDiag` ⇔ elysia 现状）
//   core：`parseMdl` 在真拒绝/救回时把台账挂到返回值上（机器可判：rescued / rejected / layout / reason / rescan）。
//   elysia：`elysia/we-renderer/puppet.js` 的 `_parseMdl` 把 `mdlDiag` 算成**局部变量**（:321 声明、:357/:366
//     赋值、:358/:372 只用于 warn），**第 510 行的 return 里没有它** ⇒ 调用方只能看到"warn + bones=[]"。
//   ⚠ 本组**只作现状登记 + 不变量断言**，`elysia/**` 由另一条线改（本门禁不改它、也不许改）。
// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('⑤ 两侧可观测面（core `mdlDiag` ⇔ elysia 现状）')
{
  const m = parseMdl(layoutB)
  check('E 可观测面', 'core：救回时 `mdlDiag` 挂到返回值上（machine-readable：rescued/rejected/layout/parsedBones/rescan）',
    !!m.mdlDiag && m.mdlDiag.rescued === true && m.mdlDiag.rejected === false && m.mdlDiag.layout === 'B'
    && m.mdlDiag.parsedBones === 3 && !!m.mdlDiag.rescan && m.mdlDiag.rescan.variant === 'name-fronted', JSON.stringify(m.mdlDiag))
  const m2 = parseMdl(badParent)
  check('E 可观测面', 'core：拒绝时 `mdlDiag` 同样机器可判（rejected=true + reason + entryErrors）',
    !!m2.mdlDiag && m2.mdlDiag.rejected === true && m2.mdlDiag.reason === 'parent-out-of-range' && m2.mdlDiag.entryErrors.length >= 1, JSON.stringify(m2.mdlDiag))
  const cap = capture(() => H._parseMdl(new MpwBuffer(layoutB.buffer, layoutB.byteOffset, layoutB.byteLength)))
  const el = cap.r
  const elysiaHasDiag = !!el && el.mdlDiag !== undefined
  // ⚠ 这条**故意写成两档都可绿**：`elysia/**` 由**另一条线**在改 —— 它现在还没移植 P-152b 与台账（现状 =
  //   `mdlDiag` 是局部变量、没随 return 带出 ⇒ 只剩 "warn + bones=[]"），但**哪天移植了也必须绿**。
  //   真正的不变量是"**不许静默**"：要么有机器可判台账，要么有 warn + 空骨架。
  check('E 可观测面', 'elysia 侧可观测面：**或**同形（有 `mdlDiag`）**或**"warn + bones=[]"（不许静默失败）',
    !!el && (elysiaHasDiag ? (el.mdlDiag === null || typeof el.mdlDiag === 'object')
      : (el.bones.length === 0 && cap.warns.length === 1 && /MDLS bone layout/.test(cap.warns[0]))),
    'elysia.mdlDiag=' + (el ? (elysiaHasDiag ? '有' : '无（局部变量未随 return：puppet.js:321/357/366 ↔ return@510 ⇒ 现状 = warn + bones=[]）') : 'null') + ' bones=' + (el ? el.bones.length : 'null') + ' warns=' + cap.warns.length)
  check('E 可观测面', '两侧不变量：**都不许出现"既不拒也不救"的残缺骨架**（core ∈ {0,声明}、elysia ∈ {0,声明}）',
    (m.bones.length === 0 || m.bones.length === 3) && (el.bones.length === 0 || el.bones.length === 3),
    'core=' + m.bones.length + ' elysia=' + el.bones.length + ' declared=3')
}
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* 临时目录清不掉不影响判据 */ }

// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('断言：PASS=' + PASS + ' FAIL=' + FAIL + (Object.keys(RED).length ? ' | 变红组：' + JSON.stringify(RED) : ''))
console.log('corpus: rows=' + corpus.rows + ' mdls=' + corpus.mdls + ' bones=' + corpus.bones + ' rescued=' + corpus.rescued.length + ' refused=' + corpus.rejects.length + ' warns=' + corpus.warns + ' diffLegacy=' + corpus.diffLegacy + ' diffElysia=' + corpus.diffElysia)
console.log(FAIL === 0 ? 'ALL PASS' : 'FAILED')
process.exit(FAIL ? 1 : 0)

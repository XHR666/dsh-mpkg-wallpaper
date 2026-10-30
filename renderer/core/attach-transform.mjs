/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // core/attach-transform.mjs — elysia 附件/父链变换的逐字移植（2026-09-13，POSITION-FINDINGS §4 修法落地）
//
// 证据源（移植前已实测证明与官方逐层吻合：elysia-transform-check 3719111841 → 19/22 层 Δ<5px）：
//   - elysia/we-renderer/core.js   _mdlAnchors(L280) / _puppetBoneFinal(L314) / _attachmentOffset(L364) / resolveTransform(L421)
//   - elysia/we-renderer/puppet.js _parseMdl(L278) / _sampleAnimRT(L205) / _matMulRow(L255)
// 语义要点（与 POSITION-FINDINGS.md §4 公式一致，勿"优化"）：
//   1) 父链：root→叶，origin += R(ang.z)·(锚点偏移 × 累积scale) + R(ang.z)·(child.origin × 累积scale)；
//      scale *= child.scale；ang += child.angles（scene.json 的 angles 是**弧度**——语料实测 3.14159/1.57080，
//      wer-ref SceneNode.cpp Eigen AngleAxis 直收弧度，elysia 原样直收）。
//   2) 锚点：父模型 json.puppet → MDL 的 MDAT0001 表（u16 骨索引 + 名字\0 + 4×4 矩阵）；
//      偏移 = [bx + A.tx·cos(ba) − A.ty·sin(ba), by + A.tx·sin(ba) + A.ty·cos(ba)]，
//      (bx,by,ba) = 锚点骨骼**动画后最终世界位姿**（bind 世界位姿 ⊕ animationlayers 增量；
//      fps=每动画自带 framerate，①G-1 定案，opts.fps 可覆盖）。
//      MDAT 矩阵只取平移列（elysia 同：锚点旋转项实测可忽略）。
//   3) 单位/坐标：全部在**编辑器 y-up 空间**计算；y-down 翻转由渲染端统一做一次
//      （我们 = parseScene 末尾 PROJ_H−y；elysia = 绘制时 H−y）。本模块不做任何 y 取反。
//
// 本模块零外部依赖（纯 Uint8Array/DataView），浏览器与 Node 共用；①(P-110) 只依赖仓库内
//   `core/puppet-skin.js::bindWorldChain`（bind 世界链的唯一实现处，无第三方依赖）：
//   - core/we-scene-bundle.js parseScene（opts.attachCtx 注入时自动计算全部附件偏移）
//   - demo.html（默认路径；?att=legacy 回退旧 anchorsOf/mkOff）
//   - layer-rect-check.mjs / attach-transform-test.mjs（验收）
import { bindWorldChain, bindWorldPolar } from './puppet-skin.js'

// ── 值解包：静态字符串 / {value} / {animation}（t=0 取首帧，与 elysia 烘焙语义一致）──
function unwrapVal(v, def) {
  if (v == null) return def
  if (typeof v === 'object') {
    if (v.value !== undefined) return v.value
    if (v.animation && Array.isArray(v.animation.c0) && v.animation.c0[0] && v.animation.c0[0].value !== undefined) return v.animation.c0[0].value
    return def
  }
  return v
}

function parseVec3v(o, key, def) {
  const s = unwrapVal(o && o[key], null)
  if (s == null) return def.slice()
  if (typeof s === 'number') return [s, s, s]
  if (Array.isArray(s)) return [s[0] ?? def[0], s[1] ?? def[1], s[2] ?? def[2]]
  const p = String(s).trim().split(/\s+/).map(Number)
  return [Number.isFinite(p[0]) ? p[0] : def[0], Number.isFinite(p[1]) ? p[1] : def[1], Number.isFinite(p[2]) ? p[2] : def[2]]
}

function matchBytes(buf, off, str) {
  for (let i = 0; i < str.length; i++) if (buf[off + i] !== str.charCodeAt(i)) return false
  return true
}

function indexOfBytes(buf, str, from) {
  for (let i = from | 0; i + str.length <= buf.length; i++) if (matchBytes(buf, i, str)) return i
  return -1
}

// ── MDAT0001 锚点表（elysia _mdlAnchors 移植；Buffer 换 Uint8Array 扫描）──
// 结构：wallpaper64.exe 解析确认 —— u16 计数 + [u16 骨骼索引 + 名字\0 + 64B 列主序矩阵]×count
export function parseMdatAnchors(buf) {
  const out = []
  if (!buf) return out
  try {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    for (let idx = indexOfBytes(buf, 'MDAT', 0); idx >= 0; idx = indexOfBytes(buf, 'MDAT', idx + 4)) {
      if (!matchBytes(buf, idx, 'MDAT0001')) continue
      let p = idx + 9 + 4
      if (p + 2 > buf.length) break
      const count = dv.getUint16(p, true); p += 2
      for (let e = 0; e < count && e < 64 && p + 2 < buf.length; e++) {
        const boneIdx = dv.getUint16(p, true); p += 2
        let ne = p
        while (ne < buf.length && buf[ne] !== 0) ne++
        if (ne === buf.length || ne - p > 128) break
        const name = new TextDecoder().decode(buf.subarray(p, ne))
        p = ne + 1
        if (p + 64 > buf.length) break
        const m = []
        for (let i = 0; i < 16; i++) m.push(dv.getFloat32(p + i * 4, true))
        p += 64
        out.push({ name, boneIdx, m, tx: m[12], ty: m[13] })
      }
    }
  } catch { /* 解析失败 → 无锚点 */ }
  return out
}


// ── 行主序 4×4（elysia _matMulRow / _matInvertRow 逐字）──
export function matMulRow(a, b) {
  const o = new Array(16)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = a[r * 4 + 0] * b[0 * 4 + c] + a[r * 4 + 1] * b[1 * 4 + c] + a[r * 4 + 2] * b[2 * 4 + c] + a[r * 4 + 3] * b[3 * 4 + c]
    }
  }
  return o
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// ①(P-152 2026-09-19) **MDLS 骨骼布局校验（判据契约来自上游 be3c246，实现自研）**
//
// 病（上游 `renderer/vendor/we-scene/render/mdl-parse.js`（be3c246，MIT）的注释里记的实测）：
//   MDLS 的逐骨记录**不止一种布局**。我们两侧（本文件、`elysia/we-renderer/puppet.js`）都是
//   **布局 A 定步**（`id@+1 / parent@+5 / len@+9 / 64B 矩阵 / 骨名 cstr`），一旦记录不是 A，
//   定步会**静默失步**：`parent` 读成 `0x3F800000`(=16256) 之类的垃圾、矩阵退化成 1e-43 / 89° 假旋转 /
//   z=2.1e18，下游（蒙皮、附件锚点）拿着**错位数据**继续画 —— 不抛异常、不报错，最难查的一类病。
//   上游自报影响面 238 个骨架里 2 个（"旧坏→新好"）；**本仓语料 0 命中**（43 `.mdl` / 35 含 MDLS /
//   332 骨，见 `tests/mdl-bone-layout-test.mjs` 的全语料回归）⇒ 本项是**防回归**，不是修可见 bug。
//
// 依据：`docs/UPSTREAM-PORT-PLAN-20260919.md` §4（判据契约、语料影响面、补丁方案、可证伪判据）；
//   上游原文只以 `file:line` 引用**判据**（"先按 A 整体解析并校验，通过就逐位采用；任一骨非法才判定为
//   变长布局；重扫拿全且全合法才采用，否则回退，绝不返回残缺骨架"），**没有抄代码/注释/文案**：
//   上游用固定 78B 步进 + `findHeader` 窗口锚扫，我们是"9/10 字节头变体"的既有实现 ⇒ 逐行对照无从谈起。
//
// 契约（判据，本文件的唯一实现处；`elysia/we-renderer/puppet.js` 同批落同一契约）：
//   ① **布局判定不许静默按 A 解**：`bin/mdl-bone-layout` 在"布局 A 整体校验失败"时**不采用** A 的结果，
//      并把判定档写进 `mesh.mdlDiag.layout`（`'A'` / `'not-A'` / `'refused'`）。
//   ② **非法/越界 ⇒ 可判定的结果**：逐骨判据说全（parent 越界 / 材质(id)索引越界 / 记录长度不足 /
//      骨名槽非法字节 / 骨名槽超长 / 旋转两行非单位长 / 平移非有限），任一不满足 ⇒ **拒绝该骨**
//      （计数 `rejectedBones` + 首个原因 `reason` + 一行 `console.warn`），而**不是**把错位数据当结果。
//   ③ **绝不返回残缺骨架**：结构性问题（记录截断 / 骨数不符 / 声明骨数越界 / 定步失步）⇒ `bones = []`
//      （与今天"解析失败返回空"的既有口径一致），`mesh.mdlDiag.rejected = true` 是机器可判的失败信号。
//   ④ **合法语料逐位不变**：判据只在"记录本身不合法"时才生效 ⇒ 35/35 合法 MDLS 的 `bones`
//      与改动前**逐位相同**（`?mdls=legacy` 亦逐位相同，见 `mdlsLegacy`）。
//
// ⚠ 与上游的**有意差异**（不是"没抄全"）：上游在 A 校验失败后会按 B/C **顺序重扫**（`findHeader` 的
//   `id<100000 + parent 合法 + len==64 + 矩阵正交 + 前一字节 00` 合取）来**救回**变长骨名的包。
//   本轮**只落校验 + 明确失败路径，不落重扫**：布局 B/C 是**合成**样本（真语料 0 命中，官方二进制
//   未对拍），重扫的判据不被任何真数据检验 ⇒ 宁可"明确拒绝 + 计数 + 一行 warn"，也不引入一个
//   "可能把合法 A 包改坏"的启发式。理由与未证实项记在 `docs/PATCHES.md` P-152。
// ⚠ 骨名槽（name slot）：布局 A 的空名骨与**布局 C 的矩阵后 JSON 元数据**都会落到这里
//   （本仓语料实测 40/332 骨的槽是 `{"a":null,…,  "tp":"…"}` 这种 ASCII JSON，是**合法**的）⇒
//   判据只查"可打印 ASCII/UTF-8 且长度有界"，**不**要求它是骨名。超长槽（>4096）或含控制字节 ⇒ 拒。
const MDLS_NAME_SLOT_MAX = 4096

/** 单一骨记录的判据（纯函数，无状态；`matrix` 为 16 个 float，行主序）。 */
function mdlBoneEntryOK(parent, id, matrix, nameSlotBytes, boneCount) {
  if (!(parent === -1 || (parent >= 0 && parent < boneCount))) return 'parent-out-of-range'
  if (!(Number.isFinite(id) && id >= 0 && id < 100000)) return 'material-index-out-of-range'
  // 判据：旋转部分两行必须单位长（±0.05）+ 平移必须有限（上游同判据；`m[12..14]` = 平移列）
  if (Math.abs(Math.hypot(matrix[0], matrix[1]) - 1) >= 0.05) return 'rotation-row-not-unit'
  if (Math.abs(Math.hypot(matrix[4], matrix[5]) - 1) >= 0.05) return 'rotation-row-not-unit'
  if (!Number.isFinite(matrix[12]) || !Number.isFinite(matrix[13]) || !Number.isFinite(matrix[14])) return 'translation-not-finite'
  if (nameSlotBytes > MDLS_NAME_SLOT_MAX) return 'name-slot-too-long'
  return null
}

/** 骨名槽字节判据：可空；可打印 ASCII（含布局 C 的 JSON 元数据）或合法 UTF-8；不含控制字节。 */
function mdlNameSlotOK(raw, s, e) {
  if (!(e >= s)) return true
  for (let i = s; i < e; i++) { const c = raw[i]; if (c < 0x20 || c === 0x7f) return false }
  try { new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(s, e)); return true } catch { return false }
}

/**
 * 布局 A 定步读骨（**唯一实现处**；`parseMdl` 与 elysia `_parseMdl` 同契约）。
 *
 * 结构（与改动前**逐字相同**的读法，只把"记录/骨名槽的边界"变成可判定的返回值）：
 *   `tmp u8（或个别 u16，按 len 合理性判定） + id u32 + parent i32 + len u32 + len 字节矩阵 + 骨名 cstr`
 *
 * 返回 `{ bones, complete, structErrors, entryErrors, rejectReason }`：
 *   `complete`    = 声明的骨数**全部**读出（否则 = 截断/失步）；
 *   `structErrors`= 定步自身的错（len 越界、矩阵跨过文件尾、p+12 越过文件尾）；
 *   `entryErrors` = 逐骨判据拒绝的骨号（`{b, reason}`）。
 * ⚠ 调用方在 `complete && !structErrors && !entryErrors.length` 时才**采用** `bones`。
 */
export function readMdlsLayoutABones(raw, dv, mdlsOffset, boneCount, onEntryError) {
  const bones = []
  const entryErrors = []
  let complete = true
  let structErrors = 0
  let rejectReason = null
  let p = mdlsOffset + 9
  p += 4 // 段字节
  p += 4 // boneCount 字段（调用方已读）
  for (let b = 0; b < boneCount; b++) {
    // ①(P-152) 定步**在读完声明骨数之前**撞上读不动的地方 ⇒ 记录流不是布局 A（变长布局会这样失步）。
    //   与"文件本身被截断"共用同一条失败路径（拒绝 + 计数 + warn），但判定档记 `not-A`（判据见 PATCHES P-152）。
    if (p + 12 >= raw.length) { structErrors++; rejectReason = b > 0 ? 'layout-name-fronted' : 'record-truncated'; complete = false; break }
    // 骨骼头变体：tmp u8（9 字节头）为主；个别为 u16（10 字节头），按 len 合理性判定
    let headExtra = 0
    let tmp = raw[p]
    let type = dv.getUint32(p + 1, true)
    let parent = dv.getInt32(p + 5, true)
    let len = dv.getUint32(p + 9, true)
    if (len === 0 || len > 4096) {
      tmp = dv.getUint16(p, true)
      type = dv.getUint32(p + 2, true)
      parent = dv.getInt32(p + 6, true)
      len = dv.getUint32(p + 10, true)
      headExtra = 1
      // ①(P-152) 第 2 条及以后的记录读不出合法 len ⇒ 定步已失步（= 记录流不是布局 A）：
      //   第 0 条就读不出 ⇒ 更像文件损坏/截断，分开记 reason。
      if (len === 0 || len > 4096) { structErrors++; rejectReason = b > 0 ? 'layout-name-fronted' : 'record-truncated'; complete = false; break }
    }
    p += 9 + headExtra // tmp + type + parent 之后（len 字段起点）
    p += 4 // len 字段本身
    if (p + 16 * 4 > raw.length) { structErrors++; rejectReason = 'record-truncated'; complete = false; break }
    const m = new Array(16)
    for (let i = 0; i < 16; i++) m[i] = dv.getFloat32(p + i * 4, true)
    p += len
    let je = p
    while (je < raw.length && raw[je] !== 0) je++
    if (je >= raw.length) { structErrors++; rejectReason = 'name-not-terminated'; complete = false; break }
    const slotLen = je - p
    p = je + 1
    const reason = mdlBoneEntryOK(parent, type, m, slotLen, boneCount)
      || (mdlNameSlotOK(raw, je - slotLen, je) ? null : 'name-slot-invalid-bytes')
    if (reason) {
      entryErrors.push({ b, reason })
      if (typeof onEntryError === 'function') onEntryError(b, reason)
    }
    bones.push({ index: b, type, parent: parent === -1 ? -1 : parent, bind: m })
  }
  // 读到的骨数 != 声明骨数 ⇒ 定步失步（同样判 not-A，理由记 bone-count-mismatch）
  if (bones.length !== boneCount && !structErrors) { structErrors++; rejectReason = 'bone-count-mismatch'; complete = false }
  return { bones, complete, structErrors, entryErrors, rejectReason }
}

/** ①(P-152) 布局判定：定步读出的骨**任一非法** ⇒ 不是布局 A（可能是 B/C 变长骨名布局）。 */
export function mdlLooksLikeLayoutA(entryErrors) {
  return ((entryErrors && entryErrors.length) || 0) === 0
}

// ── ②(P-152b 2026-09-23) 变长布局（骨名前置）**重扫救回** ─────────────────────────────────────
//
// 缺口（P-152 **有意**留下的，见 `docs/PATCHES.md` P-152 §P-152.1 末 / §P-152.4 第 4 条）：P-152 只校验
//   不重扫 ⇒ 真语料里 3 个**非 A 变长布局**包被拒收（`bones=[]` = 丢蒙皮）；而 legacy 路径在这 3 个包上
//   本来就只产出**残缺骨架**（`asuna body bottom` 声明 7 得 1 / `人物` 声明 55 得 3 / `deimos.fbx`
//   声明 2 得 0）⇒ "拒收"是把残缺换成没有，不是误伤合法 A。
//
// 上游（`oneincase/webwallgl` be3c246，MIT）在 A 校验失败后按 B/C **重扫救回**。本条落**同语义的可判定
//   形式**（判据引用，不照抄实现）。物理布局（本机语料逐字节核对 3/3 命中）：
//     `[骨名 cstr][id u32][parent i32][len u32=64][64B 矩阵][槽 cstr]`
//   ——骨名在**前**（布局 A 是 `[tmp u8][id][parent][len][矩阵][骨名 cstr]`，且矩阵在骨名之前），矩阵后
//   还有**一个 cstr 槽**（布局 C 的 JSON 元数据 `{"a":…,"tp":"…"}`；空槽、或合成布局 B 里它就是
//   **下一条记录的名字**）。
//
// 判据（**全部是可判定的合取**；任一不满足 ⇒ `rescued=false` = **如实拒绝**，绝不返回残缺骨架）：
//   ① 起点固定 `mdlsOffset + 17`（**不搜窗口**：上游 `findHeader` 的窗口锚扫是启发式；这里改成"记录流
//      必须从声明骨数之后的第一字节开始"，位置由格式决定，不由"哪条最像"决定）；
//   ② `len === 64`（上游同判据；本仓 839/839 骨的 len 全 = 64 —— 全语料实扫）；
//   ③ 骨名/槽 ≤4096B 且可打印 ASCII 或合法 UTF-8（**复用**布局 A 的 `mdlNameSlotOK`，与 A 同判据）；
//   ④ `parent ∈ [-1, 骨数)` 且 `parent === -1 || parent < 骨序号`（父必须先声明；本仓 825/825 骨满足
//      —— 全语料实扫。比布局 A 的判据**更严**：越界的"残缺/错位骨架"仍然一律拒）；
//   ⑤ 矩阵三行基向量各自单位长（±0.05）且两两正交（±0.05）—— 比布局 A 的"两行在 xy 分量上单位长"
//      近似判据**更强**（2026-09-23 全语料实扫：825/825 骨满足）；再加平移 `m[12..14]` 有限、
//      id ∈ [0,100000)。⚠ **A 路径仍用旧的两行近似判据**（本轮不改 A 判据 ⇒ 布局 A 里绕 X 的 90°
//      正交矩阵仍被判 rotation-row-not-unit，见门禁 ①b 的 ROT_X 对照片；真语料 `deimos.fbx` 是骨名
//      前置、A 定步在骨 0 就失步 ⇒ 走的是重扫路径，不受这条影响）；
//   ⑥ 记录流不越过**段界** `segBytes@+9`（2026-09-23 全语料实扫：86/86 MDLS 文件的该字段都落在
//      (MDLS 起点, 文件长]，且 = 下一段起点或差 1 字节 ⇒ 取 `segBytes + 1` 为开区间上界；不可信时退回文件长）；
//   ⑦ **变体歧义 ⇒ 拒绝**：带槽（= 合成布局 C）/ 不带槽（= 合成布局 B）两种读法各跑一遍 ——
//      · 恰好一种完整且全合法 ⇒ 采用（`layout` = `'C'` / `'B'`）；
//      · 两种都完整且全合法、**骨逐位相同** ⇒ 采用（`layout` = `'B/C'`：结果与读法无关，无歧义）；
//      · 两种都成立但骨不同 ⇒ **拒绝**（分不清 B/C，宁可不给）。
// ⚠ 本函数**只在** `readMdlsLayoutABones` 未整体通过时被调用（调用点见 `parseMdl`）⇒ 布局 A 合法的
//   文件（本仓 83/86 MDLS / 825 骨）**一个字节都不经过这里** ⇒ A 路径逐位不变（门禁有断言）。
const MDLS_RESCAN_BONE_LEN = 64

/** ②(P-152b) 救回路径专用矩阵判据：三行基向量单位长（±0.05）+ 两两正交（±0.05）。 */
function mdlBoneMatrixOrthonormal(m) {
  const l0 = Math.hypot(m[0], m[1], m[2]), l1 = Math.hypot(m[4], m[5], m[6]), l2 = Math.hypot(m[8], m[9], m[10])
  if (Math.abs(l0 - 1) >= 0.05 || Math.abs(l1 - 1) >= 0.05 || Math.abs(l2 - 1) >= 0.05) return false
  const d01 = m[0] * m[4] + m[1] * m[5] + m[2] * m[6]
  const d02 = m[0] * m[8] + m[1] * m[9] + m[2] * m[10]
  const d12 = m[4] * m[8] + m[5] * m[9] + m[6] * m[10]
  return Math.abs(d01) < 0.05 && Math.abs(d02) < 0.05 && Math.abs(d12) < 0.05
}

/** ②(P-152b) 单一变体的定步扫描（`withSlot` = 矩阵后是否还有 cstr 槽）。返回 `{bones, reason, at, end}`。 */
function scanMdlsNameFronted(raw, dv, start, boneCount, sectionEnd, withSlot) {
  const bones = []
  let p = start
  for (let b = 0; b < boneCount; b++) {
    let je = p
    while (je < raw.length && raw[je] !== 0) je++
    if (je >= raw.length) return { bones, reason: 'name-not-terminated', at: b, end: p }
    if (je - p > MDLS_NAME_SLOT_MAX) return { bones, reason: 'name-slot-too-long', at: b, end: p }
    if (!mdlNameSlotOK(raw, p, je)) return { bones, reason: 'name-slot-invalid-bytes', at: b, end: p }
    p = je + 1
    if (p + 12 > raw.length) return { bones, reason: 'head-truncated', at: b, end: p }
    const id = dv.getUint32(p, true), parent = dv.getInt32(p + 4, true), len = dv.getUint32(p + 8, true)
    p += 12
    if (len !== MDLS_RESCAN_BONE_LEN) return { bones, reason: 'bone-len-not-64', at: b, end: p }
    if (p + len > raw.length) return { bones, reason: 'matrix-truncated', at: b, end: p }
    const m = new Array(16)
    for (let i = 0; i < 16; i++) m[i] = dv.getFloat32(p + i * 4, true)
    p += len
    if (withSlot) {
      let se = p
      while (se < raw.length && raw[se] !== 0) se++
      if (se >= raw.length) return { bones, reason: 'slot-not-terminated', at: b, end: p }
      if (se - p > MDLS_NAME_SLOT_MAX) return { bones, reason: 'slot-too-long', at: b, end: p }
      if (!mdlNameSlotOK(raw, p, se)) return { bones, reason: 'slot-invalid-bytes', at: b, end: p }
      p = se + 1
    }
    // ⑥ 段界：记录流必须留在 MDLS 段内（越界 ⇒ 不是一份可解释的记录流）
    if (p > sectionEnd) return { bones, reason: 'overruns-section', at: b, end: p }
    // ④ / ⑤ 逐骨判据（与布局 A 同族的可判定判据，父序与矩阵更严）
    if (!(parent === -1 || (parent >= 0 && parent < boneCount))) return { bones, reason: 'parent-out-of-range', at: b, end: p }
    if (!(parent === -1 || parent < b)) return { bones, reason: 'parent-not-before-child', at: b, end: p }
    if (!(Number.isFinite(id) && id >= 0 && id < 100000)) return { bones, reason: 'material-index-out-of-range', at: b, end: p }
    if (!mdlBoneMatrixOrthonormal(m)) return { bones, reason: 'matrix-not-orthonormal', at: b, end: p }
    if (!Number.isFinite(m[12]) || !Number.isFinite(m[13]) || !Number.isFinite(m[14])) return { bones, reason: 'translation-not-finite', at: b, end: p }
    bones.push({ index: b, type: id, parent: parent === -1 ? -1 : parent, bind: m })
  }
  return { bones, reason: null, at: boneCount, end: p }
}

/** ②(P-152b) 两副骨逐位相同？（用于"两种读法结果一致 ⇒ 无歧义"的判定；NaN 也按位同形比较） */
function sameBones(a, b) {
  if (a.length !== b.length) return false
  const f = (v) => (Number.isFinite(v) ? String(v) : 'x' + String(v))
  for (let i = 0; i < a.length; i++) {
    if (a[i].index !== b[i].index || a[i].type !== b[i].type || a[i].parent !== b[i].parent) return false
    for (let k = 0; k < 16; k++) if (f(a[i].bind[k]) !== f(b[i].bind[k])) return false
  }
  return true
}

/**
 * ②(P-152b 2026-09-23) 变长布局（骨名前置）**重扫救回**（唯一实现处；判据见上）。
 * 只在布局 A 未整体通过时调用；返回 `{rescued:true, bones, layout, variant}` 或
 * `{rescued:false, reason, parsedBones, variant}`（`reason` 只用于**台账**，不改变"拒绝"这一结果）。
 * ⚠ **不抛异常**：内部 `try` 兜底（畸形/越界输入也返回一个可判定的 `rescued=false`）—— 调用点的
 *   `parseMdl` 外层有 `catch { bones = [] }`，若这里抛出去就会变成"没台账的静默空骨架"，正是不许的。
 */
export function rescanMdlsNameFrontedBones(raw, dv, mdlsOffset, boneCount) {
  try {
    const start = mdlsOffset + 17
    if (!(boneCount > 0 && boneCount <= 1024) || !(mdlsOffset >= 0) || start + 12 > raw.length) {
      return { rescued: false, reason: 'not-attemptable', parsedBones: 0, variant: null }
    }
    const segBytes = dv.getUint32(mdlsOffset + 9, true)
    const sectionEnd = (segBytes > start && segBytes <= raw.length) ? segBytes + 1 : raw.length
    const v1 = scanMdlsNameFronted(raw, dv, start, boneCount, sectionEnd, true)   // 合成布局 C（带槽）
    const v2 = scanMdlsNameFronted(raw, dv, start, boneCount, sectionEnd, false)  // 合成布局 B（不带槽）
    const ok1 = !v1.reason, ok2 = !v2.reason
    if (ok1 && ok2) {
      if (sameBones(v1.bones, v2.bones)) return { rescued: true, bones: v1.bones, layout: 'B/C', variant: 'name-fronted' }
      return { rescued: false, reason: 'ambiguous-layout-bc', parsedBones: Math.max(v1.bones.length, v2.bones.length), variant: 'both' }
    }
    if (ok1) return { rescued: true, bones: v1.bones, layout: 'C', variant: 'name-fronted+slot' }
    if (ok2) return { rescued: true, bones: v2.bones, layout: 'B', variant: 'name-fronted' }
    // 只用于台账：报"走得最远"的那一副的失败原因（**不影响**接受/拒绝的判定）
    const best = v1.bones.length >= v2.bones.length ? v1 : v2
    return { rescued: false, reason: best.reason, parsedBones: best.bones.length, variant: best === v1 ? 'C' : 'B' }
  } catch {
    return { rescued: false, reason: 'rescan-exception', parsedBones: 0, variant: null }
  }
}

/** ①(P-152) `?mdls=legacy` 的**唯一判定式**（与 `bindOrderLegacy` 同形：正则字面量，
 *  由 `tests/diag-flag-check.mjs` 的规则 c 抓取）。缺省/任何其它值 = 走校验（判据见上）。 */
export function mdlsLegacy(search) {
  const s = (search === undefined || search === null) ? '' : String(search)
  return /[?&]mdls=legacy/.test(s)
}

/** ①(P-152) 一行可读 warn（只在**真的拒绝/不符**时打；合法语料一个字都不打 ⇒ 逐位不变含日志面）。 */
function warnMdlBoneLayout(mdlsOffset, boneCount, diag) {
  try {
    const w = (typeof console !== 'undefined' && typeof console.warn === 'function') ? console.warn : null
    if (!w) return
    const first = diag.entryErrors.length ? (' bone#' + diag.entryErrors[0].b + '=' + diag.entryErrors[0].reason) : ''
    const cnt = diag.entryErrors.length ? (' entryErrors=' + diag.entryErrors.length + first) : ''
    const tail = diag.rejectReason ? (' rejectReason=' + diag.rejectReason) : ''
    w('[P-152] MDLS bone layout rejected @+' + mdlsOffset + ': declared=' + boneCount + ' parsed=' + diag.parsedBones
      + ' layout=' + diag.layout + cnt + tail + ' -> bones=[] (?mdls=legacy = 逐位回到无校验旧行为)')
  } catch { /* 日志失败不影响解析 */ }
}

/** ②(P-152b) 一行可读 warn：**变长布局重扫成功**（与"拒绝"同样只在异常文件上打一行 ⇒ 合法 A 语料零输出）。 */
function warnMdlBoneLayoutRescued(mdlsOffset, boneCount, diag) {
  try {
    const w = (typeof console !== 'undefined' && typeof console.warn === 'function') ? console.warn : null
    if (!w) return
    const r = diag.rescan || {}
    w('[P-152] MDLS bone layout rescued @+' + mdlsOffset + ': declared=' + boneCount + ' parsed=' + diag.parsedBones
      + ' layout=' + diag.layout + ' variant=' + (r.variant || '-') + ' (A 校验未过 ⇒ 按骨名前置布局重扫)')
  } catch { /* 日志失败不影响解析 */ }
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// ③(P-173 2026-09-24) **`MDLV0016` 紧凑网格容器变体**（顶点块签名 `0x01800009` + 顶点步长 52）
//
// 病（`docs/PATCHES.md` P-172 末段点名的"未救回"项）：`0923/2887099508` 的 5 个 `.mdl` 在**顶点块扫描**
//   这一步就 `return null`（`parseMdl` 与 elysia `_parseMdl` 都在解析 MDLS **之前**退出）⇒ 蒙皮/骨架整块
//   丢失；而它们的 MDLS 逐骨记录本身**合法**（A 定步读齐声明骨数、0 结构错、0 逐骨错 —— 本项实测）。
//
// 逐字节取证（2026-09-24，只读语料；夹具与逐条断言见 `tests/mdlv0016-test.mjs`）：
//   · 5/5 文件头 = `MDLV0016`；`8..20` = 13 字节固定头；**`21` 起 = `materials/…` cstr**
//     （全语料 172/172 条 `.mdl` 都在这个地址上，与版本无关 ⇒ 可作锚点）
//   · material 路径 cstr 之后 **4 个 0 字节**，再 `u32 = 0x01800009`（紧凑顶点块签名）、`u32 = 顶点字节数`
//     ⇒ 顶点数据从 `签名 + 8` 起（旧 80 步长布局的块签名是 `0x0180000f` / `0x0000000f`）
//   · **顶点步长 = 52**：`vertexBytes / 52 === maxIndex + 1`（5/5 **精确相等**：8684/52=167、33488/52=644、
//     16900/52=325、152776/52=2938；且 `vertexBytes % 80 ≠ 0` ⇒ 旧 `%80` 闸门**不可能**命中
//     —— 这是"另一套读法"，**不是**把闸门放宽）
//   · 索引块紧跟顶点数据：`u32 = 索引字节数`（偶数），索引数据一直写到 **MDLS 起点**（5/5 gap = 0）
//   · 52 字节顶点布局（相对 80 字节布局少了 28 字节中段，其余字段顺序一致）：
//       `+0 pos.xyz(3×f32) | +12 混合索引(4×u32) | +28 权重(4×f32) | +44 uv(2×f32)`
//     判读依据（可复算）：全部顶点 `Σ权重 = 1.000000`、4 个混合索引 `< 声明骨数`、`uv` 有限、
//     按索引重建的三角形**退化数 = 0**、`z ≡ 0`（2D puppet 网格）、材质路径与 `models/*.json` 同名。
//   ⚠ 判据**不是**从这 5 个文件里挑出来的：同语料 **81** 个"读法正确"的 stride=80 网格块
//     （`vertexBytes == 80×(maxIndex+1)`）上，`全部索引 < 顶点数` **81/81**、`混合索引 < 声明骨数`
//     **81/81**、`uv 有限` **81/81**、`权重和 ≈ 1` **80/81**（唯一例外 `rw_puppet.mdl` 1 个顶点）
//     ⇒ 这几条描述的是"网格块自洽"，与步长无关。
//   ⚠ 语料里第 6 个 `MDLV0016`（`3509243656/models/Hollow Cylinder/Hollow Cylinder.mdl`）**无 MDLS**，且是
//     **另一种**紧凑格式（块签名 `0x0000000f`、步长 48：`12384/48 === maxIndex+1 === 258`）—— 不在本项
//     范围（本分支只服务"要骨架"的网格）⇒ 它连试都不试（无 MDLS 即不进入），仍按既有口径返回 `null`。
//
// 判据（**全部是可判定的合取**；任一不满足 ⇒ `reason = …`、`parseMdl` 仍返回 `null` + 一行 warn，
//   **绝不返回残缺/错位网格**）：
//   ① 旧 80 步长扫描没命中（⇒ 今天能解析的非 v16 文件**一个字节都不经过这里**）
//   ② 魔数 `MDLV0016` 且**有 MDLS 段**（无 MDLS ⇒ 本分支不进入、不产台账、不打日志）
//   ③ `21` 起是 `materials/…` cstr，≤512B 且能终止
//   ④ cstr 之后跳过 0 字节（≤64 个）后 `u32 == 0x01800009`
//   ⑤ `vertexBytes > 0` 且 `% 52 === 0`
//   ⑥ 索引块 `u32` 偶数且 > 0；顶点块 + 索引块**逐字节落在文件内**、且索引块结束不越过 MDLS 起点
//   ⑦ `vertexBytes / 52 === maxIndex + 1`（**全量扫索引** ⇒ 顶点数与索引域互相印证）
//   ⑧ **全部**索引 `< 顶点数`（全量）
//   ⑨ 声明骨数 ∈ (0,1024]（与 P-152 同界）；逐顶点**全量**：pos 三轴有限且 `|v| ≤ 1e6`（**同一个量级
//      闸门，没放宽**）、uv 有限、权重 4 个有限且 `|Σ−1| < 1e-3`（允许 ≤0.1% 顶点例外 = 语料实测口径）、
//      4 个混合索引 `< 声明骨数`
// ⚠ 与 `?mdls=legacy` 的关系（**有意如此**）：那个开关的文档语义是"MDLS **骨骼布局校验** + 变长布局
//   重扫"的回退开关（`docs/README-DIAGNOSTICS.md` 主表 `mdls` 行），**不管网格容器变体** ⇒ 本分支**两档
//   都生效**。实测：这 5 个文件的 MDLS 记录两档下都读齐且**逐位相同**（A 定步 complete + 0 错）⇒
//   两档给出的网格与骨架完全一致（门禁有"两档逐字段相同"的断言）。
// ⚠ 本分支**不新增任何 URL 开关**（新增开关要求同批登记 `docs/README-DIAGNOSTICS.md` 主表，本轮禁碰
//   `docs/**`）⇒ 回退手段 = `git revert` 本段的**一处入口**（`findMdlVertexBlock` 里的那行调用）。
const MDLV0016_MAGIC = 'MDLV0016'
const MDLV0016_VERTEX_TAG = 0x01800009
const MDLV0016_STRIDE = 52
const MDLV0016_ATTR = { pos: 0, blendIndices: 12, blendWeights: 28, uv: 44 }      // 52B 步长（本项新增）
const MDL_STRIDE80_ATTR = { pos: 0, blendIndices: 40, blendWeights: 56, uv: 72 }  // 80B 步长（改动前的偏移，一字不变）
const MDL_MATERIAL_PATH_OFFSET = 21     // 全语料 172/172：8B 魔数 + 13B 固定头之后就是 `materials/`
const MDL_MATERIAL_PATH_MAX = 512
const MDLV0016_HEADER_GAP_MAX = 64      // cstr 与顶点块之间的 0 填充上限（实测 4）
const MDLV0016_WEIGHT_SUM_TOL = 1e-3
const MDLV0016_WEIGHT_BAD_RATE = 0.001  // 权重和判据的例外率（语料 80/81 文件 100% 成立）
const MDL_POS_MAX_ABS = 1e6             // 顶点量级闸门（改动前是字面量 1e6；值一字不变）

/* ══ ①(P-250 2026-10-07) 静态 PBR 顶点块（步长 48）：`pos3@0 + normal3@12 + tangent4@24(w≈±1) + uv2@40` ══
   语料审计（158 个 `.mdl`）：**86 个**命中该签名（法线单位/切线 w≈±1/uv∈[0,1] 三项抽样全 1.00），其中
     · **42 个**在修前**完全解析不了**（`findMdlVertexBlock` 只认 80/52 两种步长）⇒ 本分支救回；
     · **40 个**在修前被误判成 **80B 步长**（`vb % 80 == 0` 巧合成立）⇒ 拿到的是**垃圾网格**（位置能过闸门、
       但 uv/blend 全是错的）—— 这正是"同一张壁纸该按哪版加载"的判别缺口。
   判别规则（有实测依据，见 `tests/mdl-variant-dispatch-test.mjs`）：
     ① **有 MDLS（蒙皮）⇒ 绝不用 48**：语料有 **4 个 puppet** 同时满足两套签名（48 签名也会"像"，因为
        0 值 float 落在 uv 区间内）⇒ 蒙皮文件一律走 80/52（否则骨架与顶点错配）。
     ② **无 MDLS 且 48 签名强**、且现有 80B 候选的 **uv 证据弱**（uv@72 不在 [0,1]）⇒ 用 48。
     ③ 其余一律保持原判（零回归：63 个蒙皮 + 5 个 MDLV0016 + 已正确的文件逐位不变）。 */
const MDL_STRIDE48_STRIDE = 48
const MDL_STRIDE48_ATTR = { pos: 0, normal: 12, tangent: 24, uv: 40 }
const MDL48_NRM_MIN = 0.9
const MDL48_TANW_MIN = 0.8
const MDL48_UV_MIN = 0.9
const MDL48_UV_MAX_ABS = 64      // ①(P-256) 平铺 uv 的量级闸门（天空盒 v 可到 2 量级；64 已远超真实资产）
const MDL48_SPREAD_MIN = 0.05    // ①(P-256) uv 必须有实际变化（全 0 的那种「假 uv」不算）
const MDL48_SAMPLE_MAX = 80

/** ①(P-250) 48B 布局签名：抽样统计"法线单位率 / 切线 w≈±1 率 / uv∈[-0.05,1.05] 率"。纯读，不改任何状态。 */
export function mdlStride48Signature(dv, verticesOffset, vertexCount) {
  const vc = Math.max(0, vertexCount | 0)
  if (!vc) return { nrm: 0, tanw: 0, uv: 0, uvFin: 0, spread: 0, sample: 0 }
  const step = Math.max(1, Math.floor(vc / MDL48_SAMPLE_MAX))
  let n = 0, nrm = 0, tanw = 0, uv = 0, uvFin = 0
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity
  for (let i = 0; i < vc; i += step) {
    const b = verticesOffset + i * MDL_STRIDE48_STRIDE
    const nx = dv.getFloat32(b + 12, true), ny = dv.getFloat32(b + 16, true), nz = dv.getFloat32(b + 20, true)
    if (Math.abs(Math.hypot(nx, ny, nz) - 1) < 0.1) nrm++
    const w = dv.getFloat32(b + 36, true)
    if (Math.abs(Math.abs(w) - 1) < 0.15) tanw++
    const u = dv.getFloat32(b + 40, true), v = dv.getFloat32(b + 44, true)
    if (u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05) uv++
    if (Number.isFinite(u) && Number.isFinite(v) && Math.abs(u) <= MDL48_UV_MAX_ABS && Math.abs(v) <= MDL48_UV_MAX_ABS) uvFin++
    if (u < uMin) uMin = u
    if (u > uMax) uMax = u
    if (v < vMin) vMin = v
    if (v > vMax) vMax = v
    n++
  }
  const d = Math.max(1, n)
  const spread = Math.max(uMax - uMin, vMax - vMin)
  return { nrm: nrm / d, tanw: tanw / d, uv: uv / d, uvFin: uvFin / d, spread: Number.isFinite(spread) ? spread : 0, sample: n }
}

/** ①(P-250) 现有 80B 候选的"uv 证据"：uv@72 落在 [0,1] 的抽样比例（判"这个 80B 解释像不像真的"）。 */
export function mdlStride80UvEvidence(dv, blk) {
  try {
    if (!blk || blk.stride !== 80) return 0
    const vc = blk.vertexBytes / 80
    if (!(vc > 0)) return 0
    const step = Math.max(1, Math.floor(vc / MDL48_SAMPLE_MAX))
    let n = 0, ok = 0
    for (let i = 0; i < vc; i += step) {
      const b = blk.verticesOffset + i * 80
      const u = dv.getFloat32(b + 72, true), v = dv.getFloat32(b + 76, true)
      if (u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05) ok++
      n++
    }
    return n ? ok / n : 0
  } catch (e) { return 0 }
}

/** ①(P-250) 48B 静态顶点块定位（接受条件与 80B 扫描同族：位置闸门 + 索引 98% 合法 + **48 签名强**）。 */
export function findMdlStride48Block(raw, dv, limit) {
  const end = Math.min(raw.length, (limit === undefined || limit === null) ? raw.length : limit)
  for (let offset = 9; offset + 12 < end; offset++) {
    const vertexBytes = dv.getUint32(offset + 4, true)
    if (vertexBytes === 0 || vertexBytes % MDL_STRIDE48_STRIDE !== 0) continue
    const verticesOffset = offset + 8
    const vc = vertexBytes / MDL_STRIDE48_STRIDE
    if (vc < 3) continue
    const indexLenOffset = verticesOffset + vertexBytes
    if (indexLenOffset + 4 > end) continue
    const indexBytes = dv.getUint32(indexLenOffset, true)
    const indicesOffset = indexLenOffset + 4
    if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > end) continue
    let sane = true
    for (let i = 0; i < Math.min(vc, 64); i++) {
      const vo = verticesOffset + i * MDL_STRIDE48_STRIDE
      for (let k = 0; k < 3; k++) {
        const v = dv.getFloat32(vo + k * 4, true)
        if (!isFinite(v) || Math.abs(v) > MDL_POS_MAX_ABS) { sane = false; break }
      }
      if (!sane) break
    }
    if (!sane) continue
    const ic = indexBytes / 2
    let idxOk = 0
    for (let k = 0; k < Math.min(ic, 400); k++) if (dv.getUint16(indicesOffset + k * 2, true) < vc) idxOk++
    if (idxOk < Math.min(ic, 400) * 0.98) continue
    const sig = mdlStride48Signature(dv, verticesOffset, vc)
    /* ①(P-256 2026-10-07) 接受判据：法线单位 + 切线 w≈±1（两条强判据）+ uv **要么**绝大多数落在 [0,1]
       **要么**全部有限、量级合理且有实际变化（= 平铺 uv 的天空盒：真包 models/自制天空盒02 的 v 到 2.04）。 */
    const uvOk = (sig.uv >= MDL48_UV_MIN) || (sig.uvFin >= 0.99 && sig.spread >= MDL48_SPREAD_MIN)
    if (!(sig.nrm >= MDL48_NRM_MIN && sig.tanw >= MDL48_TANW_MIN && uvOk)) continue
    return {
      block: { verticesOffset, vertexBytes, indicesOffset, indexBytes, stride: MDL_STRIDE48_STRIDE, variant: 'stride-48', attr: MDL_STRIDE48_ATTR },
      sig,
    }
  }
  return { block: null, sig: null }
}

/**
 * ③(P-173) `MDLV0016` 紧凑顶点块（步长 52）：**定位 + 全量校验**（唯一实现处）。
 *
 * 返回 `{ block, diag }`：
 *   `block` = `{verticesOffset, vertexBytes, indicesOffset, indexBytes, stride, variant, attr}` 或 `null`；
 *   `diag`  = 机器可判台账；`null` = 本分支**根本没被触发**（不是 v16 / 无 MDLS —— 此时不产生任何日志）。
 * 拒绝时 `diag = { layout:'mdlv0016-compact', variant:'stride-52', rejected:true, reason, … }`。
 * ⚠ 不抛异常：内部 `try` 兜底（畸形/越界输入 ⇒ `reason='v16-scan-exception'` 的可判定拒绝）。
 */
export function readMdlv0016CompactVertexBlock(raw, dv, mdlsOffset) {
  const refuse = (reason, extra) => ({ block: null, diag: Object.assign({ layout: 'mdlv0016-compact', variant: 'stride-52', rejected: true, reason }, extra || {}) })
  const accept = (blk, extra) => ({ block: blk, diag: Object.assign({ layout: 'mdlv0016-compact', variant: 'stride-52', rejected: false, reason: null }, extra || {}) })
  // ② 只对"自述 MDLV0016 且带得下 MDLS 头"的文件尝试；其余 ⇒ `diag = null`（不产台账、不打日志）
  if (!(raw.length >= 8 && matchBytes(raw, 0, MDLV0016_MAGIC))) return { block: null, diag: null }
  if (!(mdlsOffset >= 0 && mdlsOffset + 17 <= raw.length)) return { block: null, diag: null }
  try {
    // ③ material 路径 cstr（锚点 = 固定头之后的 21；不搜窗口，位置由格式决定）
    if (!(raw.length >= MDL_MATERIAL_PATH_OFFSET + 10) || !matchBytes(raw, MDL_MATERIAL_PATH_OFFSET, 'materials/')) return refuse('material-path-not-at-21')
    let pe = MDL_MATERIAL_PATH_OFFSET
    while (pe < raw.length && raw[pe] !== 0) pe++
    if (pe >= raw.length) return refuse('material-path-not-terminated')
    if (pe - MDL_MATERIAL_PATH_OFFSET > MDL_MATERIAL_PATH_MAX) return refuse('material-path-too-long')
    // ④ 0 填充 + 紧凑顶点块签名
    let p = pe + 1
    let gap = 0
    while (p < raw.length && raw[p] === 0) { p++; gap++ }
    if (gap > MDLV0016_HEADER_GAP_MAX) return refuse('vertex-block-header-not-found', { gap })
    if (p + 8 > raw.length || dv.getUint32(p, true) !== MDLV0016_VERTEX_TAG) return refuse('vertex-block-tag-mismatch')
    // ⑤ 步长 52
    const vertexBytes = dv.getUint32(p + 4, true)
    if (!(vertexBytes > 0) || vertexBytes % MDLV0016_STRIDE !== 0) return refuse('vertex-bytes-not-multiple-of-52', { vertexBytes })
    // ⑥ 两块都要完整落在文件内、且索引块不越过 MDLS 起点
    const verticesOffset = p + 8
    const indexLenOffset = verticesOffset + vertexBytes
    if (indexLenOffset + 4 > raw.length) return refuse('vertex-block-overruns-file', { vertexBytes })
    const indexBytes = dv.getUint32(indexLenOffset, true)
    if (!(indexBytes > 0) || indexBytes % 2 !== 0) return refuse('index-bytes-invalid', { indexBytes })
    const indicesOffset = indexLenOffset + 4
    if (indicesOffset + indexBytes > raw.length) return refuse('index-block-overruns-file', { indexBytes })
    if (indicesOffset + indexBytes > mdlsOffset) return refuse('mesh-overruns-mdls', { indexBytes })
    const vertexCount = vertexBytes / MDLV0016_STRIDE
    const indexCount = indexBytes / 2
    // ⑧ 索引界内（全量）
    let maxIndex = -1
    for (let k = 0; k < indexCount; k++) {
      const v = dv.getUint16(indicesOffset + k * 2, true)
      if (v >= vertexCount) return refuse('index-out-of-range', { at: k, index: v, vertexCount })
      if (v > maxIndex) maxIndex = v
    }
    // ⑦ 顶点数与索引域互证（全量）
    if (maxIndex + 1 !== vertexCount) return refuse('vertex-count-mismatch', { vertexCount, maxIndexPlus1: maxIndex + 1 })
    // ⑨ 声明骨数（与 P-152 同界）—— 混合索引的判据上界
    const declaredBones = dv.getUint32(mdlsOffset + 13, true)
    if (!(declaredBones > 0 && declaredBones <= 1024)) return refuse('declared-bone-count-out-of-range', { declaredBones })
    // ⑨ 逐顶点全量
    const A = MDLV0016_ATTR
    const allowedBadWeights = Math.floor(vertexCount * MDLV0016_WEIGHT_BAD_RATE)
    let badWeights = 0
    for (let i = 0; i < vertexCount; i++) {
      const vo = verticesOffset + i * MDLV0016_STRIDE
      for (let k = 0; k < 3; k++) {
        const v = dv.getFloat32(vo + A.pos + k * 4, true)
        if (!isFinite(v) || Math.abs(v) > MDL_POS_MAX_ABS) return refuse('vertex-position-invalid', { at: i })
      }
      const u = dv.getFloat32(vo + A.uv, true), vv = dv.getFloat32(vo + A.uv + 4, true)
      if (!isFinite(u) || !isFinite(vv)) return refuse('vertex-uv-not-finite', { at: i })
      let sum = 0
      for (let k = 0; k < 4; k++) {
        const w = dv.getFloat32(vo + A.blendWeights + k * 4, true)
        if (!isFinite(w)) return refuse('vertex-weight-not-finite', { at: i })
        sum += w
      }
      if (Math.abs(sum - 1) >= MDLV0016_WEIGHT_SUM_TOL) {
        badWeights++
        if (badWeights > allowedBadWeights) return refuse('vertex-weights-not-normalized', { at: i, weightSum: sum })
      }
      for (let k = 0; k < 4; k++) {
        const bi = dv.getUint32(vo + A.blendIndices + k * 4, true)
        if (bi >= declaredBones) return refuse('blend-index-out-of-range', { at: i, blendIndex: bi, declaredBones })
      }
    }
    return accept(
      { verticesOffset, vertexBytes, indicesOffset, indexBytes, stride: MDLV0016_STRIDE, variant: 'mdlv0016-compact-52', attr: MDLV0016_ATTR },
      { blockHeaderOffset: p, materialPathEnd: pe, vertexCount, indexCount, declaredBones })
  } catch { return refuse('v16-scan-exception') }
}

/**
 * ③(P-173) **顶点块定位（唯一实现处）**：`parseMdl` 与 `elysia/we-renderer/puppet.js::_parseMdl` 共用本函数。
 *   ① 旧路径：自 `offset = 9` 起启发扫描（`u32@offset+4` = 80 的倍数 ⇒ 顶点块，索引块紧随其后），
 *      **逐字保留**（既有 166 个非 v16 文件的接受条件与顺序一字不动）；
 *   ② ① 没命中 且 `MDLV0016` 且带 MDLS ⇒ 紧凑变体分支（判据见 `readMdlv0016CompactVertexBlock`）。
 * 返回 `{ block, diag }`（`block` 形状见上；`diag` 只在 ② 被拒时有值）。
 */
export function findMdlVertexBlock(raw, dv, mdlsOffset) {
  let found = null
  for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
    const vertexBytes = dv.getUint32(offset + 4, true)
    const verticesOffset = offset + 8
    if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue
    const indexLenOffset = verticesOffset + vertexBytes
    if (indexLenOffset + 4 > mdlsOffset) continue
    const indexBytes = dv.getUint32(indexLenOffset, true)
    const indicesOffset = indexLenOffset + 4
    if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue
    // 顶点合理性：前若干顶点 pos 必须有限且量级合理（部分 MDL 有垃圾候选块）
    const vc = vertexBytes / 80
    let sane = true
    for (let i = 0; i < Math.min(vc, 64); i++) {
      const vo = verticesOffset + i * 80
      for (let k = 0; k < 3; k++) {
        const v = dv.getFloat32(vo + k * 4, true)
        if (!isFinite(v) || Math.abs(v) > MDL_POS_MAX_ABS) { sane = false; break }
      }
      if (!sane) break
    }
    if (!sane) continue
    // 索引范围：前若干索引必须 < 顶点数
    const ic = indexBytes / 2
    if (ic > 0) {
      let idxOk = 0
      for (let k = 0; k < Math.min(ic, 400); k++) {
        if (dv.getUint16(indicesOffset + k * 2, true) < vc) idxOk++
      }
      if (idxOk < Math.min(ic, 400) * 0.98) continue
    }
    found = { verticesOffset, vertexBytes, indicesOffset, indexBytes, stride: 80, variant: 'stride-80', attr: MDL_STRIDE80_ATTR }
    break
  }
  /* ①(P-250 2026-10-07) **静态 48B 判别**（放在 80 候选之后、紧凑变体之前）：
     只在"文件里没有 MDLS"时考虑；且要求 48 签名强、而现有 80B 候选的 uv 证据弱（< 0.9）。
     两条闸门都过 ⇒ 用 48（救回 42 个完全解析不了的文件、纠正 40 个被误判成 80B 的静态网格）。
     有任何一条不满足 ⇒ 保持原判（含 MDLS 的蒙皮文件**永不**走这里 ⇒ 63+5 个逐位不变）。 */
  const noMdls = !(mdlsOffset >= 0 && mdlsOffset < raw.length)
  if (noMdls) {
    try {
      const s48 = findMdlStride48Block(raw, dv, mdlsOffset)
      if (s48.block) {
        const uv80 = found ? mdlStride80UvEvidence(dv, found) : 0
        if (!found || uv80 < 0.9) return { block: s48.block, diag: null }
      }
    } catch (e) { /* 48B 判别失败 ⇒ 落回原判（零行为变化） */ }
  }
  if (found) return { block: found, diag: null }
  // ③(P-173) 紧凑变体分支（**本项唯一的入口**；关掉这一行 = 逐位回到改动前）
  return readMdlv0016CompactVertexBlock(raw, dv, mdlsOffset)
}

/** ③(P-173) 一行可读 warn：**`MDLV0016` 紧凑顶点块被拒**（只在真拒绝时打 ⇒ 5/5 救回文件零输出）。
 *  与骨骼布局的 warn 同族：文案由本函数唯一产出，core 与 elysia 两侧共用（同一契约同一个出口）。 */
export function warnMdlV16MeshRefused(diag) {
  try {
    const w = (typeof console !== 'undefined' && typeof console.warn === 'function') ? console.warn : null
    if (!w || !diag) return
    w('[P-173] MDLV0016 compact vertex block rejected: reason=' + diag.reason
      + (diag.vertexBytes !== undefined ? ' vertexBytes=' + diag.vertexBytes : '')
      + (diag.vertexCount !== undefined ? ' vertexCount=' + diag.vertexCount : '')
      + (typeof diag.at === 'number' ? ' at=' + diag.at : '')
      + ' -> mesh=null (网格按既有口径拒收；绝不返回残缺/错位网格)')
  } catch { /* 日志失败不影响解析 */ }
}

// ── MDL 解析（elysia _parseMdl 逐字移植；顶点块校验规则原样保留）──
// 返回 { positions, uvs, indices, vertexCount, indexCount, blendIndices, blendWeights, bones, animations, raw }
// bones 为空数组 = 无 MDLS / 校验拒绝（后者多一个 `mdlDiag`，见上）；`opts.mdls === 'legacy'` = 无校验旧行为
// ③(P-173) 顶点块定位收敛到 `findMdlVertexBlock`（唯一实现处；旧 80 步长扫描 + MDLV0016 紧凑变体）；
//   `opts.diag`（可选，对象）= 顶点块**被拒**时的台账出口（拒绝路径按既有契约返回 `null`，`null` 上挂不了字段）。
export function parseMdl(buf, opts) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let mdlsOffset = buf.length
  for (let off = 9; off + 4 < buf.length; off++) {
    if (buf[off] === 0x4d && buf[off + 1] === 0x44 && buf[off + 2] === 0x4c && buf[off + 3] === 0x53) { mdlsOffset = off; break }
  }
  let found = null
  {
    // ③(P-173) 旧 80 步长扫描逐字搬进 `findMdlVertexBlock`（唯一实现处，elysia 侧共用同一份）；
    //   没命中时它再试 MDLV0016 紧凑变体（判据见该函数）。**接受条件与顺序一字不动**。
    const vscan = findMdlVertexBlock(buf, dv, mdlsOffset)
    found = vscan.block
    if (!found) {
      // ③ 顶点块被拒（只在 MDLV0016 分支真被触发时有 `diag`）：如实拒绝 + 一行 warn；
      //   返回值仍是 `null`（既有契约：拿不到网格 = null）。台账出口仅在调用方显式给 `opts.diag` 时填。
      if (vscan.diag) {
        warnMdlV16MeshRefused(vscan.diag)
        if (opts && opts.diag && typeof opts.diag === 'object') opts.diag.mdlDiag = vscan.diag
      }
      return null
    }
  }
  const vertexCount = found.vertexBytes / found.stride
  const indexCount = found.indexBytes / 2
  // ③(P-173) 属性偏移由 finder 给出（80 步长 = 0/40/56/72，52 步长 = 0/12/28/44）⇒ 两侧不再各写一套偏移
  const attr = found.attr
  const positions = [], uvs = [], blendIndices = [], blendWeights = [], normals = [], tangents = []
  for (let i = 0; i < vertexCount; i++) {
    const vo = found.verticesOffset + i * found.stride
    positions.push([dv.getFloat32(vo + attr.pos, true), dv.getFloat32(vo + attr.pos + 4, true), dv.getFloat32(vo + attr.pos + 8, true)])
    uvs.push([dv.getFloat32(vo + attr.uv, true), dv.getFloat32(vo + attr.uv + 4, true)])
    /* ①(P-250) 48B 静态布局**没有**蒙皮字段 ⇒ 给中性值（骨 0 / 权重 1），与"未提供 blendIndices[i]"的
       既有兜底契约一致；48B 有独立的 normal/tangent 槽，顺手解出来挂到网格上（几何渲染/判据可用）。 */
    if (attr.blendIndices != null) {
      blendIndices.push([dv.getUint32(vo + attr.blendIndices, true), dv.getUint32(vo + attr.blendIndices + 4, true), dv.getUint32(vo + attr.blendIndices + 8, true), dv.getUint32(vo + attr.blendIndices + 12, true)])
    } else blendIndices.push([0, 0, 0, 0])
    if (attr.blendWeights != null) {
      blendWeights.push([dv.getFloat32(vo + attr.blendWeights, true), dv.getFloat32(vo + attr.blendWeights + 4, true), dv.getFloat32(vo + attr.blendWeights + 8, true), dv.getFloat32(vo + attr.blendWeights + 12, true)])
    } else blendWeights.push([1, 0, 0, 0])
    if (attr.normal != null) {
      normals.push([dv.getFloat32(vo + attr.normal, true), dv.getFloat32(vo + attr.normal + 4, true), dv.getFloat32(vo + attr.normal + 8, true)])
      if (attr.tangent != null) tangents.push([dv.getFloat32(vo + attr.tangent, true), dv.getFloat32(vo + attr.tangent + 4, true), dv.getFloat32(vo + attr.tangent + 8, true), dv.getFloat32(vo + attr.tangent + 12, true)])
    }
  }
  const indices = []
  for (let i = 0; i < indexCount; i++) indices.push(dv.getUint16(found.indicesOffset + i * 2, true))
  // 骨骼（MDLS）+ 动画（MDLA）
  let bones = [], animations = []
  // ①(P-152 2026-09-19) 校验开关：`opts.mdls === 'legacy'` / `opts.mdlsLegacy === true` ⇒ 逐位回到
  //   "无校验"的旧行为（回退开关 `?mdls=legacy`，判定式唯一实现处 = `mdlsLegacy()`）。
  const mdlsLegacyMode = !!(opts && (opts.mdls === 'legacy' || opts.mdlsLegacy === true))
  // ①(P-152) 机器可判的校验台账（只在真拒绝/不符时才挂到返回值上 ⇒ 合法语料对象形状逐位不变）
  let mdlDiag = null
  if (mdlsOffset < buf.length) {
    try {
      let p = mdlsOffset + 9
      p += 4 // 段字节
      const boneCount = dv.getUint32(p, true); p += 4
      if (mdlsLegacyMode) {
        // ── 旧行为（无任何校验，P-152 之前逐字）────────────────────────────────────────────
        for (let b = 0; b < boneCount && p + 12 < buf.length; b++) {
          // 骨骼头变体：tmp u8（9 字节头）为主；个别为 u16（10 字节头），按 len 合理性判定
          let headExtra = 0
          let tmp = buf[p]
          let type = dv.getUint32(p + 1, true)
          let parent = dv.getInt32(p + 5, true)
          let len = dv.getUint32(p + 9, true)
          if (len === 0 || len > 4096) {
            tmp = dv.getUint16(p, true)
            type = dv.getUint32(p + 2, true)
            parent = dv.getInt32(p + 6, true)
            len = dv.getUint32(p + 10, true)
            headExtra = 1
            if (len === 0 || len > 4096) break
          }
          p += 9 + headExtra // tmp + type + parent 之后（len 字段起点）
          p += 4 // len 字段本身
          const m = new Array(16)
          for (let i = 0; i < 16; i++) m[i] = dv.getFloat32(p + i * 4, true)
          p += len
          let je = p
          while (je < buf.length && buf[je] !== 0) je++
          p = je + 1
          bones.push({ index: b, type, parent: parent === -1 ? -1 : parent, bind: m })
        }
      } else {
        // ── ①(P-152) 显式校验 + 明确失败路径（判据见 readMdlsLayoutABones / mdlBoneEntryOK）──────
        //   ① 声明骨数越界 ⇒ 直接拒绝（不读骨）：上游同界（`boneCount <= 0 || > 1024`）
        if (!(boneCount > 0 && boneCount <= 1024)) {
          mdlDiag = {
            declaredBones: boneCount, parsedBones: 0, layout: 'refused', rejected: true,
            reason: 'declared-bone-count-out-of-range', rejectedBones: 0, entryErrors: [],
          }
        } else {
          const r = readMdlsLayoutABones(buf, dv, mdlsOffset, boneCount, null)
          const rejects = r.entryErrors
          if (r.complete && !r.structErrors && !rejects.length) {
            bones = r.bones // 布局 A 整体合法 ⇒ 逐位采用（= 改动前结果；**不经过**重扫）
          } else {
            // ② 不许静默按 A 解：定步结果**不采用**（绝不返回残缺/错位骨架）
            const notA = !mdlLooksLikeLayoutA(rejects) || r.structErrors > 0 || r.bones.length !== boneCount
            // ③(P-152b 2026-09-23) **变长布局（骨名前置）重扫救回**：判据/失败路径见
            //   `rescanMdlsNameFrontedBones`（可判定的合取；解析不出 ⇒ 返回 rescued=false）。
            //   ⚠ **闸门**：只在 A 定步**真的失步**时重扫（`!complete || structErrors > 0` = 记录流读不齐
            //   声明的骨数 / 结构错 —— 变长布局的签名）。若 A 定步把声明的骨数**读齐了**（只是某条骨的
            //   判据不过），那这份流就是布局 A，骨非法 = 真缺陷 ⇒ 按 P-152 原样拒绝，**不**用另一种读法
            //   去"绕过"逐骨判据（否则 P-152 的"非法 ⇒ 拒绝整个骨架"会被悄悄削弱）。
            const res = (!r.complete || r.structErrors > 0) ? rescanMdlsNameFrontedBones(buf, dv, mdlsOffset, boneCount) : null
            if (res && res.rescued) {
              bones = res.bones
              mdlDiag = {
                declaredBones: boneCount, parsedBones: bones.length,
                layout: res.layout, rescued: true, rejected: false,
                reason: null, rejectedBones: 0, entryErrors: [],
                // 台账里留"为什么需要救回"（A 路径读了几条 / 卡在哪）⇒ 机器可判、可回归
                rescan: { variant: res.variant, aBones: r.bones.length, aReason: r.rejectReason || (rejects[0] && rejects[0].reason) || null },
              }
            } else {
              bones = []
              mdlDiag = {
                declaredBones: boneCount, parsedBones: r.bones.length,
                layout: notA ? 'not-A' : 'refused',
                rejected: true,
                reason: r.rejectReason || (rejects[0] && rejects[0].reason) || 'unknown',
                rejectedBones: rejects.length,
                entryErrors: rejects.slice(0, 8),
                // 救援尝试也留痕（**只作台账**：这不改变"拒绝"）；A 定步没失步时=null（闸门见上）
                rescan: res ? { attempted: true, parsedBones: res.parsedBones, reason: res.reason, variant: res.variant } : null,
              }
            }
            if (mdlDiag.rescued) warnMdlBoneLayoutRescued(mdlsOffset, boneCount, mdlDiag)
          }
        }
        if (mdlDiag && mdlDiag.rejected === true) { warnMdlBoneLayout(mdlsOffset, boneCount, mdlDiag) }
      }
    } catch { bones = [] }
    // MDLA 动画（RE-03 官方头布局：id i32 + 丢弃 i32 + name\0 + mode\0 + fps f32 + length i32 + pad + boneTrackCount + segBytes）
    const mdla = indexOfBytes(buf, 'MDLA', 0)
    if (mdla >= 0) {
      try {
        let p = mdla + 9
        p += 4 // 总字节
        const animCount = dv.getUint32(p, true); p += 4
        for (let a = 0; a < animCount && p + 12 < buf.length; a++) {
          const animId = dv.getInt32(p, true)
          p += 8 // id + 丢弃字段
          let nameEnd = p
          while (nameEnd < buf.length && buf[nameEnd] !== 0) nameEnd++
          if (nameEnd >= buf.length) break
          const animName = new TextDecoder().decode(buf.subarray(p, nameEnd))
          p = nameEnd + 1
          let loopEnd = p
          while (loopEnd < buf.length && buf[loopEnd] !== 0) loopEnd++
          if (loopEnd >= buf.length) break
          p = loopEnd + 1
          // fps：头布局 = mode\0 之后紧跟 f32 framerate（第三方参考 wer-ref WPMdlParser.cpp:698 animation.fps = f.ReadFloat()）。
          // ①(G-fps 2026-09-14) 直读该字段（fps 定案=每动画自带，见 blink-phase-test.mjs）。
          //   旧实现靠搜索 [f0 41]=30.0f 的字节序特征跳位——fps≠30 的动画会搜过头把头解析炸掉（潜伏 bug）。
          //   读出的值不合理时回退旧搜索（对现存语料 48/48 动画两条路径逐位一致，blink-phase-test 有断言）。
          let fpsHdr = dv.getFloat32(p, true)
          if (!(isFinite(fpsHdr) && fpsHdr >= 1 && fpsHdr <= 240)) {
            while (p + 1 < buf.length && !(buf[p] === 0xf0 && buf[p + 1] === 0x41)) p++
            p += 2
            fpsHdr = dv.getFloat32(p - 4, true)
          } else {
            p += 4
          }
          const frameCount = dv.getUint16(p, true); p += 2
          p += 2 // u16 0
          p += 4 // u32 0
          const boneCount = dv.getUint32(p, true); p += 4
          p += 4 // u32 0
          const segBytes = dv.getUint32(p, true); p += 4
          const segs = []
          for (let b = 0; b < boneCount && p + (b + 1) * segBytes <= buf.length; b++) segs.push(p + b * segBytes)
          // fps 定案（G-1）：头里 f32 framerate（fpsHdr 已在 mode\0 后直读；回退路径也定位到同字段）
          animations.push({ id: animId, name: animName, frameCount, boneCount, segBytes, segs, fps: (isFinite(fpsHdr) && fpsHdr >= 1 && fpsHdr <= 240) ? fpsHdr : 30 })
          p += segBytes * boneCount
        }
      } catch { animations = [] }
    }
  }
  const out = { positions, uvs, indices, vertexCount, indexCount, blendIndices, blendWeights, bones, animations, raw: buf }
  // ①(P-250) 只有 48B 静态布局解出的法线/切线才挂上去（其余布局零新增字段 ⇒ 既有消费方形状不变）
  if (normals.length) out.normals = normals
  if (tangents.length) out.tangents = tangents
  // ③(P-173) 网格来自紧凑变体 ⇒ 记一条**机器可判**台账（这 5 个文件在本项之前是 `null`，对象形状不可能
  //   "变化"；合法 stride-80 语料一个字段都不多）。与骨骼台账（P-152/P-152b）同用一个键：网格信息落在
  //   `mdlDiag.mesh` 里，两个台账都在时字段取并集、键名不冲突。
  const meshLedger = found.variant === 'mdlv0016-compact-52'
    ? { variant: found.variant, stride: found.stride, vertexCount, indexCount }
    : null
  if (mdlDiag && meshLedger) mdlDiag.mesh = meshLedger
  // ①(P-152) 只在真拒绝/不符时挂台账（合法语料 = 无此字段 ⇒ 对象形状与改动前逐位相同）
  if (mdlDiag) out.mdlDiag = mdlDiag
  else if (meshLedger) {
    out.mdlDiag = {
      layout: 'mdlv0016-compact',
      // 声明骨数（v16 分支成立时必有 MDLS 头 ⇒ 这个读址在界内；仍留一个界检查作防御）
      declaredBones: (mdlsOffset + 17 <= buf.length) ? dv.getUint32(mdlsOffset + 13, true) : 0,
      parsedBones: bones.length,
      rejected: false, reason: null, rejectedBones: 0, entryErrors: [], mesh: meshLedger,
    }
  }
  return out
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// ①(P-139 2026-09-19) **MDLA 逐骨局部量采样 = 全仓库唯一实现处（本函数）**
//
// 为什么要有"唯一实现处"（与 `core/puppet-skin.js::bindWorldChain` 同一条纪律）：同一套
//   "MDLA 轨寻址 + 轨道作用域 + 越界回绕" 的判定原先在**两个地方各写了一遍**：
//     ① 本文件 `sampleAnimRT`（只服务**附件锚点** → `puppetBoneFinal` → `attachmentOffset`）；
//     ② `elysia/we-renderer/puppet.js::_sampleAnimRT`（服务**渲染网格的 GPU 蒙皮**，
//        demo.html 的 `updateSkinBones` 每帧调它）。
//   ① 在 ①G（2026-09-14）被修成"官方逐行同址、不回绕"；② **没跟上**，仍是旧式
//   `((frame + posShift) % totalFrames)`（把"每骨行移位"折进帧号取模）。后果实测（本文件
//   的判据，见 tests/kaltsit-puppet-anchor-test.mjs A-3）：同一骨同一动画，① 的单帧最大步长
//   1.6u，② 在 6 骨模型上是 **699.4u @f0 bone5（头骨）**、14 骨模型上 **365.7u @f0 bone13**、
//   4 骨模型上 **157.4u @f298 bone3** —— 也就是 ② 把"轨 0 的**第 0 帧**"当成移位后的帧号读，
//   首帧就吃到邻轨/轨头垃圾。渲染网格走 ② ⇒ 头/眼/耳朵每次循环起点抽一下。
//   ⇒ ② 现在改为**直接调本函数**（`installPuppet` 的 `_sampleAnimRT` 只是转发），即"同一口径的
//     唯一实现"：改这里两边同时生效，不存在"改一处忘另一处"的第二次分叉。
//
// 语义（行主序/行向量，与 `sampleAnimRT` 的世界链、`bindWorldChain` 的 bind 世界链同空间）：
//   · **寻址（官方逐行同址）**：`anim.segs[b]` 是官方轨头前 `8b` 处，交错公式
//     `36·floor(2b/9) + 4·((2b)%9) === 8b` 恰好补上 b 个 8 字节轨头 ⇒
//     pos 读址 = `segs[b] + f·36 + 8b`（+0 = pos.x, +4 = pos.y），rot 读址 = 同址 +20。
//     第三方参考 wer-ref `WPPuppet.cpp:218-222` 直接采 `row ∈ [0, length)`，无行移位。
//   · **不回绕**：帧号先规约到 `[0, frameCount)`（负帧也安全），**绝不**把移位折进取模。
//     旧式回绕正是 RE-03 记录的"眼睛 [237,238,239]、主体 [178,179]、耳朵 [0,298,299] 坏帧"
//     的真身：数据没坏，寻址回绕读到了轨头/邻轨垃圾。
//   · **轨道作用域（官方 per-bone `HasAuthoredTrack`）**：某骨轨**所有帧**的
//     pos/angle 都 ≈0（<1e-6）⇒ 官方判定"该层对该骨不贡献"，该骨取 `local_bind`
//     （`bones[b].bind` 的局部位姿）；旧实现只在"数值非有限/超量级"时才回退 bind ⇒
//     "只驱动部分骨骼"的导出模型会把未 authored 的骨塌到父骨原点（结构性错位）。
//     逐位实现见 `isAuthoredTrack`（判定按**轨字节**算一次并缓存）。
//   · 数值非法（非有限/量级 >1e4）时同样回退 `bind`（不炸渲染的既有保险，保留）。
//
// 缓存：`_authoredCache` 按 `mesh` 身份（WeakMap）→ Map(anim) → Uint8Array(nb)。
//   demo.html 的 `puppetHelper._parseMdl` 每个 MDL 只解析一次并复用同一对象
//   （`l.__skin.mesh`），所以缓存命中；`sampleAnimRT` 是每帧每层调用的热路径，
//   "逐帧扫 240 帧 × 每骨"不能放在这里做。
const _authoredCache = new WeakMap()
// 导出仅为门禁断言「作用域判定本身」（RED-IF-REVERTED 把 authored 判定短路掉必须红）
export function isAuthoredTrack(mesh, anim, bones) {
  const nb = (bones && bones.length) || 0
  let perAnim = _authoredCache.get(mesh)
  if (!perAnim) { perAnim = new Map(); _authoredCache.set(mesh, perAnim) }
  let flags = perAnim.get(anim)
  if (flags && flags.length >= nb) return flags
  flags = new Uint8Array(nb)
  try {
    const raw = mesh.raw
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    const len = Math.max(1, anim.frameCount)
    for (let b = 0; b < nb; b++) {
      const segStart = anim.segs[b]
      if (!(segStart >= 0)) continue
      for (let f = 0; f < len; f++) {
        const o = segStart + f * 36 + 8 * b
        if (o + 24 > raw.length) break
        const px = dv.getFloat32(o, true), py = dv.getFloat32(o + 4, true), rot = dv.getFloat32(o + 20, true)
        if (Math.abs(px) > 1e-6 || Math.abs(py) > 1e-6 || Math.abs(rot) > 1e-6) { flags[b] = 1; break }
      }
    }
  } catch { /* 结构异常 ⇒ 全部当 authored（= 旧行为，最保守） */ flags.fill(1) }
  perAnim.set(anim, flags)
  return flags
}

/**
 * MDLA 采样：返回**每骨骼局部位姿** `{ angle, tx, ty }`（尚未做世界链合成）。
 * @param {object} mesh  `_parseMdl`/`parseMdl` 结果（需要 `raw` 与原 buffer 视图）
 * @param {object} anim  `mesh.animations[i]`（需要 `segs` / `frameCount`）
 * @param {number} frame 帧号（任意整数；内部规约到 `[0, frameCount)`，不回绕到轨外）
 * @param {number} nb    骨骼数
 * @param {Array}  bones `[{ parent, bind:[16] }]`
 * @returns {Array<{angle:number,tx:number,ty:number}>} 长度 nb，**局部位姿**（未合成世界链）
 */
export function sampleBoneLocalsRT(mesh, anim, frame, nb, bones) {
  const out = new Array(nb)
  if (!mesh || !mesh.raw || !anim || !anim.segs || !bones || !nb) return out
  const raw = mesh.raw
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const totalFrames = Math.max(1, anim.frameCount)
  let f = Math.floor(Number(frame) || 0) % totalFrames
  if (f < 0) f += totalFrames
  const authored = isAuthoredTrack(mesh, anim, bones)
  for (let b = 0; b < nb; b++) {
    const bm = bones[b] && bones[b].bind
    const segStart = anim.segs[b]
    let px = NaN, py = NaN, rotZ = NaN
    if (segStart >= 0) {
      const o = segStart + f * 36 + 8 * b
      if (o + 24 <= raw.length) {
        px = dv.getFloat32(o, true)
        py = dv.getFloat32(o + 4, true)
        rotZ = dv.getFloat32(o + 20, true)
      }
    }
    const usable = authored[b] && isFinite(px) && isFinite(py) && isFinite(rotZ) &&
      Math.abs(px) < 10000 && Math.abs(py) < 10000
    if (usable) out[b] = { angle: rotZ, tx: px, ty: py }
    else if (bm) out[b] = { angle: Math.atan2(bm[1], bm[0]), tx: bm[12], ty: bm[13] }
    else out[b] = { angle: 0, tx: 0, ty: 0 }
  }
  return out
}

/** 局部位姿 → 世界位姿（行主序：`W[b] = L_b × W[parent]`，与 `bindWorldChain` 同空间同序）。 */
export function localWorldChainRT(locals, bones, nb) {
  const out = new Array(nb)
  for (let b = 0; b < nb; b++) {
    const L = locals[b] || { angle: 0, tx: 0, ty: 0 }
    const parent = bones[b] ? bones[b].parent : -1
    if (parent >= 0 && parent < nb && out[parent]) {
      const pa = out[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa)
      out[b] = { angle: pa + L.angle, tx: out[parent].tx + L.tx * pc - L.ty * ps, ty: out[parent].ty + L.tx * ps + L.ty * pc }
    } else {
      out[b] = { angle: L.angle, tx: L.tx, ty: L.ty }
    }
  }
  return out
}

// ── 采样动画帧 → 每骨骼世界姿势 {angle, tx, ty}（elysia _sampleAnimRT 移植 + ①G 修正）──
// ①(P-139) 本体只剩"唯一实现处调用 + 世界链合成"两行：寻址/作用域/回绕口径全在
//   `sampleBoneLocalsRT`（渲染网格的 `puppet.js::_sampleAnimRT` 转发同一个函数）。
export function sampleAnimRT(mesh, anim, frame, nb, bones) {
  return localWorldChainRT(sampleBoneLocalsRT(mesh, anim, frame, nb, bones), bones, nb)
}

// ── puppet 骨骼最终世界位姿（elysia _puppetBoneFinal 移植；①G fps 定案见下）──
// bind 世界位姿 ⊕ animationlayers 增量（additive 参考 = 层动画帧0；普通层 mix）
// ①(G-1 2026-09-14) fps 口径定案 = **每动画自带**（第三方参考 wer-ref WPMdlParser.cpp:698
//   animation.fps = f.ReadFloat() → WPPuppet.cpp:92-93 frame_time=1/fps、max_time=length/fps，
//   :216-222 采样 cur=fmod(cur,max_time); rate=cur/frame_time → 帧=floor(t·fps·rate) mod length；
//   lwe-ref 不解析 MDLA 动画（渲染 bind 姿态），无第二口径来源）。
//   语料实测 48/48 动画 fps=30.0（107 容器 + mpkg_work/tmp 提取物全量）→ 两种口径在现存数据上
//   逐位一致；此改动只在遇到 fps≠30 的未来资产时生效。opts.fps 强制口径（=30 复现旧行为）。
export function puppetBoneFinal(mesh, t, layers = null, opts = null) {
  const bones = mesh.bones
  if (!bones || !bones.length) return null
  const nb = bones.length
  // ①(P-110 2026-09-17) bind 世界链改走唯一实现处 `core/puppet-skin.js::bindWorldChain`
  //   （**子先乘** `W[b] = L_b × W[parent]`，与 `sampleAnimRT` 同空间；见该函数头注释的判据）。
  //   旧写法 `matMulRow(bindWorld[parent], local)`（父先乘）只由 `opts.bindOrder === 'legacy'`
  //   （URL 侧 `?bindorder=legacy`）启用，作 A/B 回退与 bug 复现。
  const legacyBind = !!(opts && (opts.bindOrder === 'legacy' || opts.bindOrderLegacy === true))
  const bindWorld = bindWorldChain(bones, { legacy: legacyBind })
  const bindRT = bindWorldPolar(bindWorld)
  const final = bindRT.map((r) => ({ angle: r.angle, tx: r.tx, ty: r.ty }))
  if (!mesh.animations || !mesh.animations.length) return final
  if (!layers || !layers.length) layers = [{ animIdx: 0, blend: 1, rate: 1, additive: false }]
  const fpsOverride = opts && typeof opts.fps === 'number' && opts.fps > 0 ? opts.fps : null
  const refCache = new Map()
  const animRef = (anim) => {
    if (!refCache.has(anim)) refCache.set(anim, sampleAnimRT(mesh, anim, 0, nb, bones))
    return refCache.get(anim)
  }
  for (const layer of layers) {
    const anim = mesh.animations[layer.animIdx] || mesh.animations[0]
    if (!anim) continue
    const fps = fpsOverride || anim.fps || 30
    // ①(P-139) 帧号同样先规约到 [0, frameCount)（`%` 对负数会给负帧，旧式会把负帧当"回绕"读轨外）
    const fr = Math.floor(t * fps * layer.rate) % Math.max(1, anim.frameCount)
    const frame = fr < 0 ? fr + Math.max(1, anim.frameCount) : fr
    const lw = sampleAnimRT(mesh, anim, frame, nb, bones)
    const refRT = animRef(anim)
    for (let b = 0; b < nb; b++) {
      if (layer.additive) {
        const ref = refRT[b]
        let da = lw[b].angle - ref.angle
        while (da > Math.PI) da -= 2 * Math.PI
        while (da < -Math.PI) da += 2 * Math.PI
        final[b].angle += da * layer.blend
        final[b].tx += (lw[b].tx - ref.tx) * layer.blend
        final[b].ty += (lw[b].ty - ref.ty) * layer.blend
      } else {
        let da = lw[b].angle - final[b].angle
        while (da > Math.PI) da -= 2 * Math.PI
        while (da < -Math.PI) da += 2 * Math.PI
        final[b].angle += da * layer.blend
        final[b].tx += (lw[b].tx - final[b].tx) * layer.blend
        final[b].ty += (lw[b].ty - final[b].ty) * layer.blend
      }
    }
  }
  return final
}

// ── animationlayers 选择（elysia _attachmentOffset 内联逻辑逐字）──
// 仅"多动画 + 有 animationlayers"时做层合成；单动画 → layers=null → 默认动画0。
export function selectAnimLayers(parent, mesh) {
  if (!(mesh.animations && mesh.animations.length > 1) || !(parent.animationlayers && parent.animationlayers.length)) return null
  const ls = parent.animationlayers
    .filter((l) => (l.visible === true || (l.visible && typeof l.visible === 'object' && l.visible.value === true)))
    .map((l) => {
      const blend = typeof l.blend === 'number' && l.blend >= 0 && l.blend <= 1 ? l.blend : 1
      const rate = typeof l.rate === 'number' && l.rate > 0 ? l.rate : 1
      let idx = mesh.animations.findIndex((a) => a.name && l.name && a.name === l.name)
      if (idx < 0 && l.name) {
        const m = String(l.name).match(/(\d+)/)
        if (m) {
          const n = parseInt(m[1], 10)
          if (n >= 1 && n <= mesh.animations.length) idx = n - 1
        }
      }
      if (idx < 0) {
        const layerIdx = parent.animationlayers.indexOf(l)
        if (layerIdx >= 0 && layerIdx < mesh.animations.length) idx = layerIdx
      }
      if (idx < 0) idx = 0
      return { animIdx: idx, blend, rate, additive: !!l.additive }
    })
  return ls.length ? ls : null
}

// ── ①(P-139) 逐帧锚点**增量表**（demo 渲染前把层 origin 从 t=0 姿态搬到当前帧）──
// 为什么需要它（而不是让宿主编排 `buildAttachOffsets` 两次）：`parseScene` 只把**一个时刻**的锚点
//   烘进层 origin，之后宿主若自己再调 `buildAttachOffsets` 并"整体替换"就会**双重应用**锚点
//   —— 必须用**增量**：`origin -= delta(t0)`，其中 `t0` = parseScene 实际用的那个时刻、
//   delta(t) = `off_{ctx.time}(t) − off_{ctx.time}(0)`（把"每个层自己的锚点"平移**相对**起来，
//   与 ctx.time=0 时的绝对锚点无关）。本函数返回 `Map(id → Δ)`，`t0` 必须由**同一个 ctx**算出。
// ctx 与 `attachmentOffset` 同形状（readModelJson/readMdl/time/fps/bindOrder/_anchorCache/_mdlCache）。
export function attachOffsetDeltas(sceneObjects, readEntry, ctx) {
  const out = new Map()
  // 第二个参数 = `readEntry(path) -> Uint8Array`（与 `buildAttachOffsets` 同签名）。
  // ctx.time 允许是数字或取值器（与 parseScene 的 attachCtx 同约定）；**取值器的返回值**才是时刻。
  //   刻意不把取值器直接透传给 buildAttachOffsets（它会读到 undefined → `t*fps=NaN` → 静默不生效）。
  let t = ctx && ctx.time
  if (typeof t === 'function') { try { t = t() } catch { t = 0 } }
  t = Number(t)
  if (!isFinite(t)) t = 0
  const popts = (ctx && (ctx.fps || ctx.bindOrder)) ? { fps: ctx.fps, bindOrder: ctx.bindOrder } : null
  // ⚠ 唯一实现处仍走 `buildAttachOffsets`（**不要**在这里另写一份"逐层各建 ctx"的循环：
  //   那样每层都要重解 model.json，且与 parseScene 的共享 `_mdlCache` 口径分叉——实测差 1.9e3）。
  //   性能由**宿主**负责（demo.html 按"动画帧号"记忆化：1/30s 才重算一次）。
  if (typeof readEntry !== 'function') return out
  let a0 = null, at = null
  try {
    a0 = buildAttachOffsets(sceneObjects, readEntry, null, 0, popts)     // 基线恒为 t=0（parse 的冻结时钟）
    at = buildAttachOffsets(sceneObjects, readEntry, null, t, popts)
  } catch { return out }
  at.forEach((v, id) => {
    const b = a0.get(id)
    if (!b) return
    // 同时给出**基线锚点**：宿主逐帧跟随必须做增量（`origin += W(Δ) − W(Δ₀)`），
    //   只知道 Δ 而不知道 Δ₀ 会把"绝对值"当增量加进去（本改动第一版就是这个 bug）。
    out.set(id, { delta: [v[0] - b[0], v[1] - b[1]], base: [b[0], b[1]] })
  })
  return out
}

// ── 附件锚点偏移（elysia _attachmentOffset 逐字；y-up 空间，无 y 取反）──
// ctx: { readModelJson(path)->obj|null, readMdl(path)->Uint8Array|null, time, _anchorCache, _mdlCache }
export function attachmentOffset(child, parent, ctx) {
  if (!child || !parent || child.attachment == null) return [0, 0]
  const parentModel = parent.image ? ctx.readModelJson(parent.image) : null
  if (!parentModel || !parentModel.puppet) return [0, 0]
  let anchors = ctx._anchorCache && ctx._anchorCache.get(parentModel.puppet)
  if (!anchors) {
    const raw = ctx.readMdl(parentModel.puppet)
    anchors = raw ? parseMdatAnchors(raw) : []
    if (!ctx._anchorCache) ctx._anchorCache = new Map()
    ctx._anchorCache.set(parentModel.puppet, anchors)
  }
  const anch = anchors.find((a) => a.name === child.attachment)
  if (!anch) return [0, 0]
  let bx = 0, by = 0, ba = 0
  let mesh = ctx._mdlCache && ctx._mdlCache.get(parentModel.puppet)
  if (!mesh) {
    const raw = ctx.readMdl(parentModel.puppet)
    mesh = raw ? parseMdl(raw) : null
    if (mesh) {
      if (!ctx._mdlCache) ctx._mdlCache = new Map()
      ctx._mdlCache.set(parentModel.puppet, mesh)
    }
  }
  if (mesh && mesh.bones && anch.boneIdx < mesh.bones.length) {
    const layers = selectAnimLayers(parent, mesh)
    // ①(P-110 2026-09-17) bind 链序随 ctx 下传（`?bindorder=legacy` 的 A/B 回退；缺省 = 子先乘修正序）
    const popts = {}
    if (ctx.fps) popts.fps = ctx.fps
    if (ctx.bindOrder) popts.bindOrder = ctx.bindOrder
    const final = puppetBoneFinal(mesh, ctx.time || 0, layers, (popts.fps || popts.bindOrder) ? popts : null)
    if (final) {
      bx = final[anch.boneIdx].tx; by = final[anch.boneIdx].ty; ba = final[anch.boneIdx].angle
    }
  }
  const c = Math.cos(ba), s = Math.sin(ba)
  return [bx + anch.tx * c - anch.ty * s, by + anch.tx * s + anch.ty * c]
}

// ── 父链变换解析（elysia resolveTransform 逐字；弧度；y-up）──
// o/表均为**原始 scene.json 对象**；返回 { origin, scale, angle, angles }
export function resolveTransform(o, byId, ctx = {}) {
  const chain = [o]
  let cur = o
  let guard = 0
  while (cur.parent != null && guard < 32) {
    const parent = byId.get(cur.parent)
    if (!parent) break
    chain.push(parent)
    cur = parent
    guard++
  }
  const root = chain[chain.length - 1]
  let origin = parseVec3v(root, 'origin', [0, 0, 0])
  let scale = parseVec3v(root, 'scale', [1, 1, 1])
  let ang = parseVec3v(root, 'angles', [0, 0, 0])
  for (let i = chain.length - 2; i >= 0; i--) {
    const co = parseVec3v(chain[i], 'origin', [0, 0, 0])
    const ca = parseVec3v(chain[i], 'angles', [0, 0, 0])
    const cos = Math.cos(ang[2]), sin = Math.sin(ang[2])
    const ao = attachmentOffset(chain[i], chain[i + 1], ctx)
    if (ao[0] !== 0 || ao[1] !== 0) {
      const ax = ao[0] * scale[0], ay = ao[1] * scale[1]
      origin = [origin[0] + ax * cos - ay * sin, origin[1] + ax * sin + ay * cos, origin[2] || 0]
    }
    const rx = co[0] * scale[0], ry = co[1] * scale[1]
    const ox = rx * cos - ry * sin
    const oy = rx * sin + ry * cos
    origin = [origin[0] + ox, origin[1] + oy, 0]
    const cs = parseVec3v(chain[i], 'scale', [1, 1, 1])
    scale = [scale[0] * cs[0], scale[1] * cs[1], scale[2] * cs[2]]
    ang = [ang[0] + ca[0], ang[1] + ca[1], ang[2] + ca[2]]
  }
  return { origin, scale, angle: ang[2], angles: ang }
}

// ── 便捷封装：为整场景预计算"附件偏移表"（id → [x,y]，y-up，供 parseScene 合并使用）──
// readEntry(name)->Uint8Array：pkg 原始条目；readJson(path)->obj|null：BOM 容错 JSON。
// opts.fps：骨骼动画采样 fps 口径覆盖（缺省=每动画自带 fps，见 puppetBoneFinal 注释）
// opts.bindOrder：①(P-110) bind 世界链序覆盖（`'legacy'` = 父先乘旧写法，作 A/B；缺省=子先乘修正序）
export function buildAttachOffsets(sceneObjects, readEntry, readJson, time = 0, opts = null) {
  const ctx = {
    readModelJson: (p) => { try { const e = readEntry(p); return e ? JSON.parse(new TextDecoder().decode(e).replace(/^\uFEFF/, '')) : null } catch { return null } },
    readMdl: (p) => readEntry(p),
    time,
    fps: opts && typeof opts.fps === 'number' ? opts.fps : undefined,
    bindOrder: opts && typeof opts.bindOrder === 'string' ? opts.bindOrder : undefined,
    _anchorCache: new Map(),
    _mdlCache: new Map(),
  }
  const byId = new Map((sceneObjects || []).map((o) => [o.id, o]))
  const out = new Map()
  for (const o of sceneObjects || []) {
    if (o.attachment == null || o.parent == null) continue
    const parent = byId.get(o.parent)
    if (!parent) continue
    const off = attachmentOffset(o, parent, ctx)
    if (off[0] !== 0 || off[1] !== 0) out.set(o.id, off)
  }
  return out
}

// ── puppet 网格包围盒（模型空间；layer-rect-check 计算"实绘矩形"用）──
export function meshBounds(mesh) {
  if (!mesh || !mesh.positions || !mesh.positions.length) return null
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9
  for (const p of mesh.positions) {
    if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0]
    if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1]
  }
  return { minX: mnx, minY: mny, maxX: mxx, maxY: mxy, cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2, w: mxx - mnx, h: mxy - mny }
}

/**
 * dsh-mpkg-wallpaper —— scene.pkg 静态帧提取器。
 *
 * 本模块来自 elysia395/dsh-wallpaper-engine（MIT 许可）的 lib/pkg-extract.js，
 * 采用其经过实战验证的 Wallpaper Engine 格式解析（PKG 容器 + LZ4 块链 +
 * TEX 容器解码 + 主纹理候选评分 + 质量门控 + PNG 编码），并作少量适配。
 * 格式知识来源：RePKG / lwe 对 Wallpaper Engine 格式的公开逆向工程。
 * 上游：https://github.com/elysia395/dsh-wallpaper-engine （MIT）
 *
 * 导出：extractSceneMainImage(pkgBytes) / extractSceneMainImageFromDir(dir)
 * 成功返回 { mime, bytes, width, height, texturePath }；失败抛错。
 */

/**
 * dsh-wallpaper-engine — scene.pkg / scene.json static-frame extractor.
 *
 * Extracts the MAIN texture of a Wallpaper Engine scene wallpaper as a
 * standalone static image the browser can show behind the GUI:
 *
 *   - Packed scenes (`scene.pkg`, magic `PKGV####`) and `.mpkg` containers
 *     (`PKGM####`): both carry the SAME entry-table layout (see PKG_MAGIC_RE
 *     below — the container family differs, the directory table does not), so
 *     one parser serves both. The PKG entry index is parsed, entries are
 *     decompressed (LZ4 block chains, the format WE uses inside PKG
 *     containers), then the TEX container of each candidate texture is decoded.
 *   - Loose scenes (`scene.json` + plain .tex/.json files, e.g. WE
 *     defaultprojects): the same pipeline runs over a path-fenced directory
 *     access layer.
 *   - TEX containers (magic TEXV0005/TEXI0001) are parsed for metadata,
 *     mipmaps (TEXB0001..4, LZ4 or raw) and animated GIF frame tables
 *     (TEXS0001..3). The first mipmap of the first image is decoded to
 *     RGBA8888 for RGBA8888 / R8 / RG88 / DXT1 / DXT3 / DXT5.
 *   - **Embedded JPEG textures**: Wallpaper Engine stores photographic
 *     textures as a complete JPEG payload inside the TEX container (the mip
 *     data starts with FFD8 JFIF). Those are returned as-is — zero decoding,
 *     the most faithful and cheapest path for photographic scene wallpapers
 *     (the skin-center's extractor misses this variant and silently falls
 *     back to a mask texture; this module fixes that).
 *
 * Candidate selection: the first scene.json object carrying an `image`
 * property wins (its direct .tex reference, or the textures listed by the
 * material / instance it points at), then remaining .tex files are ranked by
 * pixel area with `mask`/`normal` paths penalized (they are grayscale /
 * normal-map helpers, never the wallpaper art). The first candidate that
 * decodes cleanly is returned.
 *
 * Zero runtime dependencies (node:zlib only). Format knowledge mirrors the
 * public RePKG / lwe reverse-engineering of the Wallpaper Engine formats.
 */

import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

/* ═══ MPW-WEJSON-BEGIN ═══ */
/* 官方随包 JSON 的**宽容解析**（WE 允许尾逗号；`JSON.parse` 不允许）——**宿主侧**实现。
 *
 * ── 为什么必须有（官方证据，2026-09-24 官方产物盘点；与渲染器仓同一轮定性）──────────────
 *   · 官方随包发布的 `wallpaper_engine/assets/effects/fluidsimulation/effect.json`（10,224 B）
 *     **自己就带尾逗号**：第 402 行 `"shaders/effects/fluidsimulation_normal.vert",` 后面紧跟 `}`
 *     ⇒ 标准 `JSON.parse` 报 `Expecting value: line 403 column 2`。WE 照发照用 ⇒ **官方容忍尾逗号**
 *     （引擎用 jsoncpp，二进制里带 `allowTrailingCommas`/`allowComments` 开关名）。
 *   · 宿主侧同样会**静默丢整份文件**：`scene.json`（音频 sound 层引用 / 主图提取 / 图层清单）、
 *     `model.json`、`material.json`（`access.readJson`）解析失败就是 `null` —— 少一层、少一条音轨、
 *     回退预览图，日志一行都没有。
 *   · 渲染器仓的对应修复编号 **P-177**（`core/we-scene-bundle.js` 的 `export function parseWeJson`
 *     + `weJsonStats()`）；插件**客户端**侧同一实现是 `lib/client.js` 的 `mpwParseWeJson`
 *     （`/* ═══ MPW-WEJSON-BEGIN ═══ *\/` 块）。两处是**同一语义的独立实现**（渲染器仓 GPL-3.0-or-later、
 *     本仓 MIT ⇒ 只做行为对照，不搬运代码），且 `tools/we-json-tolerance-test.mjs` 把两处切片后
 *     逐夹具对拍（解析值 + 计数增量全等）⇒ 防漂移。
 *
 * ── 口径（只做"官方明确容忍"的那两件事，其余照旧抛）──────────────────────────────────
 *   ① 尾逗号：`,` 后面（跳过空白）紧跟 `}` / `]` ⇒ 丢掉这个逗号；**字符串内的逗号一律不动**。
 *   ② 注释：**只在**"去掉尾逗号后仍解析失败"时才尝试剥 `//` 与 `/* *\/`（同样字符串内不动），单独计数。
 *   ③ BOM（U+FEFF）与官方一致地吃掉。
 *   **健康文件逐位等价于 `JSON.parse`**：先走 `JSON.parse(text)`，成功原样返回（plain +1）；
 *   真坏 JSON **仍然抛** ⇒ 调用点的 try/catch 语义与读量（如 audio-scan 规格的 sceneJsonRead 预算）不变，
 *   只是失败的那几处现在记账（计数 + 一行 console.warn，见 `mpwWeJsonSwallowed`），不再静默。
 *   计数：`mpwWeJsonStats()` 返回 `{ calls, plain, trailingComma, comments, failed, swallowed }`
 *   —— 前五项与渲染器 `weJsonStats()` / 客户端 `mpwWeJsonStats()` 同名同义。 */
const MPW_WEJSON = { calls: 0, plain: 0, trailingComma: 0, comments: 0, failed: 0, swallowed: 0 };
const MPW_WEJSON_SEEN = new Map();   // where|msg → 次数（诊断去重：同一个坏文件只吵一行）
/** 只读快照（对外只给这个，避免调用方改计数）。 */
function mpwWeJsonStats() { return Object.assign({}, MPW_WEJSON) }
/** 文本整形：一趟扫描，按需去掉**字符串外**的尾逗号（`withComments=false`）或尾逗号 + 注释
 *  （`withComments=true`）。**字符串里的一律照抄**（`"a,}"` / `"//"` / `"/*"` 一个字都不动）；
 *  注释替换成等长空白，行号与列号都保持可读；尾逗号判定会**越过空白与注释**看下一个有效字符
 *  （所以 `{"a":1, /* c *\/ }` 与不带注释的写法同解）。与客户端 `lib/client.js` 的同名函数同语义。 */
function mpwWeJsonRepair(src, withComments) {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (inStr) {                     // 字符串内：只跟 escape 状态，内容逐字照抄
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue }
    if (withComments && c === '/' && d === '/') {              // `//` 行注释 ⇒ 空白
      while (i < src.length && src[i] !== '\n') { out += ' '; i++ }
      out += '\n';
      continue;
    }
    if (withComments && c === '/' && d === '*') {              // `/* */` 块注释 ⇒ 空白
      out += '  '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += (src[i] === '\n' ? '\n' : ' '); i++ }
      out += '  '; i++;
      continue;
    }
    if (c === ',') {                 // 尾逗号：往后看下一个有效字符（可跨空白/注释）
      let j = i + 1;
      for (;;) {
        while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n' || src[j] === '\r')) j++;
        if (!withComments) break;
        if (src[j] === '/' && src[j + 1] === '/') { while (j < src.length && src[j] !== '\n') j++; continue }
        if (src[j] === '/' && src[j + 1] === '*') { j += 2; while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++; j += 2; continue }
        break;
      }
      if (src[j] === '}' || src[j] === ']') continue;          // 尾逗号 ⇒ 丢掉这个逗号
    }
    out += c;
  }
  return out;
}
/**
 * 解析官方随包 JSON（scene.json / project.json / materials / effects / models / combo 定义…）。
 * 与 `JSON.parse` 的差别只有两条：容忍尾逗号；再不行才容忍注释（外加吃掉 BOM）。
 * **其余一律照旧抛**（调用方的 try/catch 语义不变）。
 * @param {string} text
 * @returns {any}
 */
function mpwParseWeJson(text) {
  MPW_WEJSON.calls++;
  const s0 = (typeof text === 'string') ? text : String(text == null ? '' : text);
  const s = s0.charCodeAt(0) === 0xFEFF ? s0.slice(1) : s0;       // ① BOM：官方产物会带，JSON.parse 自己不认
  try { const v = JSON.parse(s); MPW_WEJSON.plain++; return v } catch (e) { /* 健康文件到此为止（逐位等价 JSON.parse） */ }
  try { const v = JSON.parse(mpwWeJsonRepair(s, false)); MPW_WEJSON.trailingComma++; return v } catch (e) { /* ② 尾逗号也不够 ⇒ 再试注释 */ }
  try { const v = JSON.parse(mpwWeJsonRepair(s, true)); MPW_WEJSON.comments++; return v }         // ③ 尾逗号 + 注释
  catch (e) { MPW_WEJSON.failed++; throw e }                                                      // 真坏 JSON：照旧抛
}
/** 包内 JSON 读取/解析失败、调用方**按原有语义吞掉**时的记账：计数 + 一行 console.warn（不静默）。
 *  （调用点的 try/catch 结构不动；返回值恒 null 方便 `catch { x = ... }` 写法。同 where+msg 只吵一次。） */
function mpwWeJsonSwallowed(where, e) {
  try { MPW_WEJSON.swallowed++ } catch (e2) {}
  try {
    const key = where + '|' + String((e && e.message) || e);
    const n = (MPW_WEJSON_SEEN.get(key) || 0) + 1;
    MPW_WEJSON_SEEN.set(key, n);
    if (n === 1) console.warn('[dsh-mpkg-wallpaper] 包内 JSON 读取/解析失败（按原语义吞掉）: ' + where + ' — ' + String((e && e.message) || e));
  } catch (e2) {}
  return null;
}
/* ═══ MPW-WEJSON-END ═══ */

/** Wallpaper Engine texture format ids (TEXI0001 header), per RePKG/lwe. */
const TexFormat = {
  RGBA8888: 0,
  RGB888: 1,
  RGB565: 2,
  DXT5: 4,
  DXT3: 6,
  DXT1: 7,
  RG88: 8,
  R8: 9,
  RG1616F: 10,
  R16F: 11,
  BC7: 12,
  RGBA1010102: 13,
  RGBA16161616F: 14,
  RGB161616F: 15,
};
const TEX_FORMAT_NAMES = {
  0: 'RGBA8888',
  1: 'RGB888',
  2: 'RGB565',
  4: 'DXT5',
  6: 'DXT3',
  7: 'DXT1',
  8: 'RG88',
  9: 'R8',
  10: 'RG1616F',
  11: 'R16F',
  12: 'BC7',
  13: 'RGBA1010102',
  14: 'RGBA16161616F',
  15: 'RGB161616F',
};
/** TEXI0001 flags bit marking an animated (sprite-sheet / gif) texture. */
const TEX_FLAG_IS_GIF = 4;

const textDecoder = new TextDecoder('utf-8');

/**
 * Bounds-checked little-endian binary reader. Every failed read throws an
 * Error prefixed with the reader label.
 */
class Reader {
  constructor(data, label) {
    this.data = data;
    this.label = label;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = 0;
  }
  get remaining() {
    return this.view.byteLength - this.pos;
  }
  need(n) {
    if (n < 0 || this.pos + n > this.view.byteLength) {
      throw new Error(this.label + ': unexpected end of data');
    }
  }
  u8() {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  i32() {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** Unsigned 64-bit integer; safe up to 2^53. */
  u64() {
    const lo = this.u32();
    return this.u32() * 4294967296 + lo;
  }
  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  bytes(n) {
    this.need(n);
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  /** int32-length-prefixed UTF-8 string (PKG magic and entry paths). */
  sizedString(maxLength) {
    const length = this.i32();
    if (length < 0 || length > maxLength) {
      throw new Error(this.label + ': invalid string length ' + length);
    }
    return textDecoder.decode(this.bytes(length));
  }
  /** NUL-terminated string (all TEX magics and the TEXB0004 json blob). */
  nstring(maxLength) {
    const start = this.pos;
    let end = start;
    const limit = Math.min(this.view.byteLength, start + maxLength);
    while (end < limit && this.view.getUint8(end) !== 0) end++;
    if (end >= limit) throw new Error(this.label + ': unterminated string');
    const out = textDecoder.decode(this.data.subarray(start, end));
    this.pos = end + 1;
    return out;
  }
}

/**
 * Decompress one raw LZ4 block (the format inside PKG entry chains and TEXB
 * mipmaps) following the official lz4 block format specification.
 *
 * @param src compressed block bytes
 * @param dstSize exact expected decompressed size
 */
function lz4DecompressBlock(src, dstSize) {
  const dst = new Uint8Array(dstSize);
  let ip = 0;
  let op = 0;
  while (ip < src.length) {
    const token = src[ip++];
    let literalLength = token >> 4;
    if (literalLength === 15) {
      let s = 0;
      do {
        if (ip >= src.length) throw new Error('lz4: truncated literal length');
        s = src[ip++];
        literalLength += s;
      } while (s === 255);
    }
    if (ip + literalLength > src.length || op + literalLength > dstSize) {
      throw new Error('lz4: literal run out of bounds');
    }
    dst.set(src.subarray(ip, ip + literalLength), op);
    ip += literalLength;
    op += literalLength;
    if (ip >= src.length) break;
    if (ip + 2 > src.length) throw new Error('lz4: truncated match offset');
    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (offset === 0 || offset > op) throw new Error('lz4: invalid match offset ' + offset);
    let matchLength = token & 15;
    if (matchLength === 15) {
      let s = 0;
      do {
        if (ip >= src.length) throw new Error('lz4: truncated match length');
        s = src[ip++];
        matchLength += s;
      } while (s === 255);
    }
    matchLength += 4;
    if (op + matchLength > dstSize) throw new Error('lz4: match run out of bounds');
    for (let i = 0; i < matchLength; i++) {
      dst[op] = dst[op - offset];
      op++;
    }
  }
  if (op !== dstSize) {
    throw new Error('lz4: decompressed size mismatch (got ' + op + ', expected ' + dstSize + ')');
  }
  return dst;
}

/**
 * Probe whether the entry data at [abs, abs+length) is an LZ4 block chain:
 * int64 original size followed by [int32 uncomp][int32 comp][block] entries
 * that reconstruct exactly originalSize bytes while consuming the entry to
 * the byte. Returns the original size when the chain fits perfectly.
 */
function probeCompressedEntry(data, abs, length) {
  if (length < 8) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const originalSize = view.getUint32(abs, true) + view.getUint32(abs + 4, true) * 4294967296;
  if (originalSize <= length || originalSize > 2147483647) return null;
  let pos = abs + 8;
  let total = 0;
  while (total < originalSize) {
    if (pos + 8 > abs + length) return null;
    const uncomp = view.getInt32(pos, true);
    const comp = view.getInt32(pos + 4, true);
    if (uncomp <= 0 || comp <= 0 || pos + 8 + comp > abs + length) return null;
    total += uncomp;
    pos += 8 + comp;
  }
  return total === originalSize && pos === abs + length ? originalSize : null;
}

/**
 * PKG 容器族的 magic：`PKGV####` = scene.pkg（场景包）/ `PKGM####` = .mpkg（视频壁纸 / 合集容器）。
 *
 * 为什么一个判据吃两种 magic（第一性原理：容器就是容器）：
 *   · **目录表同源**：`[i32 串长][magic][i32 条目数]{[i32 名字长][name][u32 offset][u32 size]}*`，
 *     offset 相对目录表末尾（dataStart），条目数据紧随其后 —— 真机抽样 `PKGV0022/0023`（scene.pkg）
 *     与 `PKGM0014`（.mpkg）在目录表上逐字段同构。同口径的旁证：渲染器
 *     `we-scene-demo/core/we-scene-bundle.js` 的 parsePkg 早已按 `^PKGV|^PKGM|^v\d` 认可，
 *     `we-scene-demo/packages/we-core/src/format.js` 的 `PKG_MAGIC_RE = /^PKG[VM]\d{4}$/`。
 *   · **差异点不在目录表**：本模块对**每条**条目都跑 probeCompressedEntry（`u64 原始长 +
 *     [i32 unc][i32 comp][block]*` 精确对齐到条目末尾才认 LZ4），不假设"哪种 magic 会压缩"。
 *     所以两种 magic 走**同一段**解析代码（不存在两套逻辑），版本号（####）也不参与判定。
 *   · 读不了就**如实报**：magic 不在此族仍抛原来的 `pkg: bad magic '<magic>'`，不伪造成功。
 *
 * 已知边界（不猜）：本机语料 PKGV 侧已整读的 5 个真包 508 条条目压缩数 0（G11）；PKGM 侧的大包
 * **未整包读过**，所以这里既不假设 PKGM 恒不压缩、也不假设 PKGM 有别的目录表布局 —— 逐条探测是唯一判据。
 *
 * 来历：G10（../docs/PKG-IMPORT-VERIFICATION-20260923.md §3）—— 此前只认 PKGV，`.mpkg` 在
 * `parsePkg` / `parsePkgIndex`（经 readPkgTable）与渲染器 `pkg-entry-index.tableFor` 三处全抛
 * `pkg: bad magic 'PKGM0014'`。
 */
const PKG_MAGIC_RE = /^PKG[VM]\d{4}$/;

/**
 * Parse a PKG container (magic `PKG[VM]xxxx`，见 PKG_MAGIC_RE) and return its entry index.
 * Entry offsets in the returned list are absolute positions inside data.
 */
function parsePkg(data) {
  const r = new Reader(data, 'pkg');
  const magic = r.sizedString(32);
  if (!PKG_MAGIC_RE.test(magic)) throw new Error("pkg: bad magic '" + magic + "'");
  const count = r.i32();
  if (count < 0 || count > 1048576) throw new Error('pkg: invalid entry count ' + count);
  const index = [];
  for (let i = 0; i < count; i++) {
    index.push({ path: r.sizedString(1024), offset: r.u32(), length: r.u32() });
  }
  const dataStart = r.pos;
  return index.map(({ path, offset, length }) => {
    const abs = dataStart + offset;
    if (abs + length > data.byteLength) throw new Error("pkg: entry '" + path + "' out of bounds");
    const originalSize = probeCompressedEntry(data, abs, length);
    return originalSize === null
      ? { path, offset: abs, compressedSize: length, size: length, flags: 0 }
      : { path, offset: abs, compressedSize: length, size: originalSize, flags: 1 };
  });
}

/**
 * Extract (and decompress, when the entry uses LZ4 block-chain storage) one
 * package entry. Returns a fresh buffer of exactly entry.size bytes.
 */
function readPkgEntry(data, entry) {
  const abs = entry.offset;
  if (abs < 0 || abs + entry.compressedSize > data.byteLength) {
    throw new Error("pkg: entry '" + entry.path + "' out of bounds");
  }
  if ((entry.flags & 1) === 0) return data.slice(abs, abs + entry.compressedSize);
  const r = new Reader(data.subarray(abs, abs + entry.compressedSize), 'pkg');
  if (r.u64() !== entry.size) throw new Error("pkg: entry '" + entry.path + "' size mismatch");
  const out = new Uint8Array(entry.size);
  let written = 0;
  while (written < entry.size) {
    const uncomp = r.i32();
    const comp = r.i32();
    if (uncomp <= 0 || comp <= 0 || written + uncomp > entry.size) {
      throw new Error("pkg: corrupt compressed entry '" + entry.path + "'");
    }
    out.set(lz4DecompressBlock(r.bytes(comp), uncomp), written);
    written += uncomp;
  }
  if (r.remaining !== 0) throw new Error("pkg: corrupt compressed entry '" + entry.path + "'");
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ①(2026-09-15 用户第 1 条反馈「扫描音频的速度能否快些」) 惰性音频索引
 *
 * **实现依据：docs/AUDIO-TRACK-SPEC.md**（后缀清单 §1 / 路径规范化 §2 / 容器规则表 §3 /
 * 收集与去重 §4 / 条目头读取 §5 / 返回结构 §6）。本模块是按该规格**独立实现**的：
 * 常量组织（后缀 Map + 容器规则表）、判定顺序（ISO-BMFF 优先、ADTS 先于 MPEG 同步）、
 * 函数命名与文案均取自规格本身，不沿用任何外部同功能代码（处置记录见 THIRD-PARTY.md）。
 *
 * 契约（为什么不是"把整包扫描写快一点"）：
 *   · PKG 的**目录表在文件开头**（magic + count + [nameLen,name,offset,size]…），
 *     条目 offset 相对 dataStart ⇒ "这个包里有哪几条音频"**不需要读任何条目数据**。
 *   · 音频条目通常只有 1–4 条，各读 ≤16 字节（规格 §5.3）做容器判定就够定 MIME。
 *   · 整包路径 = 读满整包 + 全量目录解析 + 逐条整条读；实测 22.5MB 的包光读盘就 ~35ms，
 *     235MB / 320MB 的包再翻十倍不止（tools/audio-scan-bench.mjs 的 A/D 阶段）。
 *   · 本路径 = 只读目录表（1 次 64KB read，不够则倍增）+ 仅候选条目各 ≤16 字节
 *     （readSync 定点读，整条音轨字节永不进内存）。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 规格 §5.3：容器判定只读这么多字节（够覆盖 R1 的偏移 4+4 与 R2 的偏移 8+4）。 */
const AUDIO_HEAD_BYTES = 16;

/** 规格 §1.2：后缀 → 音频兜底 MIME。
 *  用 Map 而不是正则：表外后缀（含 `constructor` 这类原型键）一律判为"不是音频"。 */
const AUDIO_SUFFIX_MIME = new Map([
  ['mp3', 'audio/mpeg'],
  ['ogg', 'audio/ogg'],
  ['oga', 'audio/ogg'],
  ['opus', 'audio/ogg'],
  ['wav', 'audio/wav'],
  ['flac', 'audio/flac'],
  ['m4a', 'audio/mp4'],
  ['aac', 'audio/mp4'],
]);

/** 规格 §3.2 的容器规则表：**表的先后即判定优先级**（R1…R7），第一条命中即返回。
 *  `ascii` = 若干 [偏移, ASCII 签名] 全部成立才命中；`sync`/`mask` = 头两字节位掩码判定。 */
const AUDIO_CONTAINER_RULES = [
  { mime: 'audio/mp4', ascii: [[4, 'ftyp']] },                 // R1 ISO-BMFF（MP4/M4A）
  { mime: 'audio/wav', ascii: [[0, 'RIFF'], [8, 'WAVE']] },    // R2 RIFF/WAVE
  { mime: 'audio/ogg', ascii: [[0, 'OggS']] },                 // R3 Ogg
  { mime: 'audio/flac', ascii: [[0, 'fLaC']] },                // R4 FLAC 原生流
  { mime: 'audio/mpeg', ascii: [[0, 'ID3']] },                 // R5 ID3v2 标签
  { mime: 'audio/aac', sync: 0xfff0, mask: 0xfff6 },           // R6 ADTS（先于 R7！规格 §3.4）
  { mime: 'audio/mpeg', sync: 0xffe0, mask: 0xffe0 },          // R7 MPEG-1/2/2.5 帧同步
];

/** 规格 §2：路径规范化（反斜杠→'/'、剥掉开头一层 './'）。 */
function canonicalAudioPath(raw) {
  let s = String(raw == null ? '' : raw).replace(/\\/g, '/');
  if (s.startsWith('./')) s = s.slice(2);
  return s;
}

/** 规格 §1.1：后缀查表判定"算不算音频"（无点 / 表外 → false）。 */
function isAudioPath(p) {
  const s = String(p == null ? '' : p);
  const dot = s.lastIndexOf('.');
  return dot >= 0 && AUDIO_SUFFIX_MIME.has(s.slice(dot + 1).toLowerCase());
}

/** 规格 §1.3：后缀兜底 MIME（表外返回 ''）。 */
function suffixAudioMime(p) {
  const s = String(p == null ? '' : p);
  const dot = s.lastIndexOf('.');
  return dot < 0 ? '' : (AUDIO_SUFFIX_MIME.get(s.slice(dot + 1).toLowerCase()) || '');
}

/** 规格 §3.2：bytes 偏移 at 起的 ASCII 是否逐字节等于 text（越界 = 不匹配）。 */
function asciiAt(bytes, at, text) {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

/** 规格 §3：条目头 → 容器 MIME；表中全部不命中返回 ''（调用方按后缀兜底）。
 *  规格 §3.5：判定内任何异常都吞掉（= 未命中），不得向上抛。 */
function sniffAudioMime(head) {
  const b = head;
  if (!b || b.length < 2) return '';
  try {
    for (const rule of AUDIO_CONTAINER_RULES) {
      if (rule.sync !== undefined) {
        if ((((b[0] << 8) | b[1]) & rule.mask) === rule.sync) return rule.mime;
        continue;
      }
      let matched = true;
      for (const [at, text] of rule.ascii) {
        if (!asciiAt(b, at, text)) { matched = false; break; }
      }
      if (matched) return rule.mime;
    }
  } catch { /* 规格 §3.5 */ }
  return '';
}

/**
 * 规格 §3 命中 → 容器 MIME；否则按 §1.2 后缀兜底 —— **全模块唯一的"路径+头字节 → 音频 MIME"入口**。
 *
 * 为什么要有这个入口：宿主路由（lib/index.js 的 /raw、/custom-media、pkg 条目 /media、
 * /library-media、/custom-folder 前缀）各自内联过一份扩展名三元链与一份魔数嗅探，
 * 两份表迟早与渲染器支持的 8 项后缀漂移（实测 .oga/.m4a/.aac 在 pkg 条目路由里缺失、
 * ISO-BMFF 分支把偏移 4 的 `ftyp` 写成偏移 0 的 `66427970` 永远不命中）。表只留 §1.2 一份。
 *
 * 特例（**只有这一条**是后缀与头字节联合判定）：ID3v2 头 + `.flac` 后缀 ⇒ `audio/flac`。
 * 来历：真实语料里有带 ID3v2 标签前缀的 FLAC（标签长度可变，16 字节内看不到 `fLaC`），
 * 而 §3.2 的 R5（ID3v2）在 R4（fLaC）之后、对纯 MP3 才是正确结论 —— 只看头字节会把这种
 * 文件误报成 `audio/mpeg`（浏览器按 MP3 解 FLAC 必失败）。这正是"扩展名 + magic 双判"的用处：
 * §3 命中优先，唯一例外是"R5 命中 + 后缀自己说是 flac"时改采后缀。
 *
 * 规格 §3.5：任何异常（head 不是字节序列、path 不是字符串…）都不得抛：返回 ''。
 */
function audioMimeFor(path, head) {
  try {
    const suffixMime = suffixAudioMime(path);
    const magicMime = sniffAudioMime(head);
    if (magicMime === 'audio/mpeg' && suffixMime === 'audio/flac') return 'audio/flac';   // 上面的特例
    return magicMime || suffixMime;
  } catch { /* 规格 §3.5 */ }
  return '';
}

/** 规格 §5.5：头 8 字节按 u64 小端读（高 32 位加权，避免 BigInt 与有符号位移陷阱）。 */
function readU64LE(bytes, at) {
  const lo = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24);
  const hi = bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24);
  return hi * 4294967296 + (lo >>> 0);
}

/** 规格 §6.2：按 path 码元序升序（确定性）。 */
function compareTrackByPath(a, b) {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** 只解析 PKG 目录表（`PKG[VM]` 两种 magic 同源，见 PKG_MAGIC_RE）：返回 { magic, dataStart, raw:[{path,offset(相对),length}] }。 */
function readPkgTable(data) {
  const r = new Reader(data, 'pkg');
  const magic = r.sizedString(32);
  if (!PKG_MAGIC_RE.test(magic)) throw new Error("pkg: bad magic '" + magic + "'");
  const count = r.i32();
  if (count < 0 || count > 1048576) throw new Error('pkg: invalid entry count ' + count);
  const raw = [];
  for (let i = 0; i < count; i++) {
    raw.push({ path: r.sizedString(1024), offset: r.u32(), length: r.u32() });
  }
  return { magic, dataStart: r.pos, raw };
}

/**
 * 只解析 PKG 目录表（**不碰条目数据**），返回与 parsePkg 同形的条目数组
 * （offset 已换算成绝对偏移）。
 * opts.tolerateTruncated=true 时允许 data 只覆盖目录表：内容不在 data 里的条目
 * 标 `partial:true`（size/flags 未经压缩探测），而不是抛 out of bounds——
 * 这正是"只读文件头"路径的前提。
 */
function parsePkgIndex(data, opts = {}) {
  const { magic, dataStart, raw } = readPkgTable(data);
  const entries = raw.map(({ path, offset, length }) => {
    const abs = dataStart + offset;
    const inside = length >= 0 && abs >= 0 && abs + length <= data.byteLength;
    if (!inside) {
      if (!opts.tolerateTruncated) throw new Error("pkg: entry '" + path + "' out of bounds");
      return { path, offset: abs, compressedSize: length, size: length, flags: 0, partial: true };
    }
    const originalSize = probeCompressedEntry(data, abs, length);
    return originalSize === null
      ? { path, offset: abs, compressedSize: length, size: length, flags: 0, partial: false }
      : { path, offset: abs, compressedSize: length, size: originalSize, flags: 1, partial: false };
  });
  return { magic, dataStart, entries };
}

/** 只从文件**读目录表**（64KB 起步，不够按 ×4 倍增到 maxHeadBytes）：
 *  返回 { magic, dataStart, entries, tableBytes, headBytes, fileSize }。
 *  条目内容一律不读（entries[].partial=true 表示其内容不在已读头里）。 */
function readPkgIndexFromFile(filePath, opts = {}) {
  const start = Math.max(1024, Number(opts.headBytes) || 65536);
  const maxHead = Math.max(start, Number(opts.maxHeadBytes) || 8 * 1024 * 1024);
  const st = statSync(filePath);
  const fd = openSync(filePath, 'r');
  try {
    let n = Math.min(start, st.size);
    for (;;) {
      const buf = Buffer.allocUnsafe(n);
      const got = readSync(fd, buf, 0, n, 0);
      const head = got === n ? buf : buf.subarray(0, got);
      let parsed = null;
      let needMore = false;
      try { parsed = parsePkgIndex(head, { tolerateTruncated: true }); }
      catch (e) {
        // 目录表本身被截断（连条目名都没读完）→ 读更多；magic/count 非法则真错
        if (/unexpected end of data/.test(String((e && e.message) || ''))) needMore = true;
        else throw e;
      }
      if (parsed) {
        return { magic: parsed.magic, dataStart: parsed.dataStart, entries: parsed.entries,
          tableBytes: parsed.dataStart, headBytes: got, fileSize: st.size };
      }
      if (needMore && n < st.size && n < maxHead) { n = Math.min(st.size, n * 4); continue; }
      throw new Error('pkg: 目录表读取失败（已读 ' + n + ' 字节，文件 ' + st.size + ' 字节）: ' + filePath);
    }
  } finally { closeSync(fd); }
}

/**
 * 规格 §4.4：递归收集 `scene.json` 的 sound 层引用 → [{ layer, path }]（顺序 = 出现顺序）。
 * layer 为空串表示该对象既无 name 也无 id（规格：不记 refs）；scene.json 结构损坏只当"没有引用"。
 */
function collectSoundLayerRefs(sceneJson) {
  const out = [];
  const visit = (list) => {
    for (const obj of list || []) {
      if (!obj || typeof obj !== 'object') continue;
      const raw = (obj.name !== undefined && obj.name !== null && obj.name !== '') ? obj.name : obj.id;
      const layer = (raw === undefined || raw === null) ? '' : String(raw);
      if (obj.sound !== undefined && obj.sound !== null) {
        const files = Array.isArray(obj.sound) ? obj.sound : [obj.sound];
        for (const f of files) if (typeof f === 'string') out.push({ layer, path: f });
      }
      if (obj.objects) visit(obj.objects);
    }
  };
  try { visit(sceneJson && sceneJson.objects); } catch { /* 规格 §4.4：坏 scene.json 不影响清单 */ }
  return out;
}

/**
 * 音轨枚举**核心**（规格 §4/§5/§6.3；纯逻辑：读字节的动作由调用方注入，便于桩测与浏览器复用）。
 * src = {
 *   entries,                            // parsePkgIndex / readPkgIndexFromFile 的条目
 *   readHead(entry, n) -> bytes|null,   // 只读该条目开头 n 字节（规格 §5）
 *   readEntry(entry) -> bytes|null,     // 读整条（只用于 scene.json）
 *   sceneJson,                          // 已解析的 scene.json（可选；缺省时读包内 scene.json 条目）
 *   withRefs = true,                    // false = 不读 scene.json（只要文件清单时省一次 JSON.parse）
 *   sniff = true                        // false = 不做容器判定（只用后缀兜底）
 * }
 * 返回 { tracks, headReads, sceneJsonRead }（规格 §6.1/§6.2/§6.3）。
 */
function enumerateAudioTracks(src) {
  const entries = (src && src.entries) || [];
  const readHead = (src && src.readHead) || (() => null);
  const readEntry = (src && src.readEntry) || (() => null);
  const sniff = !src || src.sniff !== false;
  const records = new Map();   // 规范化路径 → 记录（规格 §4.2：同路径只产出一条）
  const order = [];

  // 登记一条候选：去重键 = 规范化路径；size 取"最后一次出现的正数"；refs 按序去重。
  const note = (rawPath, layer, size) => {
    const path = canonicalAudioPath(rawPath);
    if (!path || !isAudioPath(path)) return null;
    let rec = records.get(path);
    if (!rec) { rec = { path, size: 0, entry: null, refs: [] }; records.set(path, rec); order.push(rec); }
    if (typeof size === 'number' && size > 0) rec.size = size;
    if (layer && rec.refs.indexOf(layer) < 0) rec.refs.push(layer);
    return rec;
  };

  for (const ent of entries) {
    if (!ent) continue;
    const rec = note(ent.path || ent.name, null, ent.size);
    if (rec && !rec.entry) rec.entry = ent;   // 规格 §4.3：同路径只有第一条参与读头
  }

  // 规格 §4.4/§4.5：refs 来自 scene.json 的 sound 层（引用包内不存在的路径也照样列出）。
  let sceneJson = src && src.sceneJson;
  let sceneJsonRead = false;
  if (sceneJson === undefined && (!src || src.withRefs !== false)) {
    const sjEntry = entries.find((e) => e && /(^|\/)scene\.json$/i.test(e.path || e.name || ''));
    if (sjEntry) {
      try {
        const bytes = readEntry(sjEntry);
        // ①(P-177 同口径) 包内 scene.json 走宽容解析（官方允许尾逗号）；原来解析失败就 null（静默丢 refs）
        if (bytes && bytes.length) { sceneJson = mpwParseWeJson(textDecoder.decode(bytes)); sceneJsonRead = true; }
      } catch (e) { sceneJson = mpwWeJsonSwallowed('enumerateAudioTracks:scene.json（容器内）', e); }
    }
  }
  for (const { layer, path } of collectSoundLayerRefs(sceneJson)) note(path, layer, 0);

  // 规格 §5.1/§5.2：只有候选条目读头，且每条最多读一次。
  let headReads = 0;
  const tracks = order.map((rec) => {
    let head = null;
    if (sniff && rec.entry) {
      head = readHead(rec.entry, AUDIO_HEAD_BYTES);
      if (head && head.length) headReads++;
    }
    // 头读不到（无条目 / 越界 / IO 失败）时 audioMimeFor 自然回落后缀 —— 规格 §5.4 不变。
    return { path: rec.path, size: rec.size, mime: audioMimeFor(rec.path, head), refs: rec.refs.slice() };
  });
  tracks.sort(compareTrackByPath);
  return { tracks, headReads, sceneJsonRead };
}

/** 松散 scene 目录的音频枚举（对照 findSceneVideoInDir 的遍历口径：
 *  深度 ≤ 4、跳过点目录、不跟随符号链接；每条只读 16 字节头）。 */
function collectDirAudioTracks(dir, opts = {}) {
  const maxFiles = Math.max(1, Number(opts.maxFiles) || 20000);
  const found = [];
  let files = 0;
  const walk = (sub, depth) => {
    if (depth > 4 || files >= maxFiles) return;
    let names = [];
    try { names = readdirSync(sub === '' ? dir : join(dir, sub)); } catch { return; }
    for (const name of names) {
      if (files >= maxFiles) return;
      const rel = sub === '' ? name : sub + '/' + name;
      let st = null;
      try { st = statSync(join(dir, rel)); } catch { continue; }
      if (st.isDirectory()) { if (!name.startsWith('.')) walk(rel, depth + 1); continue; }
      if (!st.isFile() || !isAudioPath(rel)) continue;
      files++;
      found.push({ path: rel, size: st.size, offset: 0 });
    }
  };
  walk('', 0);
  let sceneJson = null;
  try {
    const sj = join(dir, 'scene.json');
    // ①(P-177 同口径) 松散场景目录的 scene.json 也走宽容解析（原来解析失败静默 null）
    if (existsSync(sj)) sceneJson = mpwParseWeJson(readFileSync(sj, 'utf8'));
  } catch (e) { sceneJson = mpwWeJsonSwallowed('collectDirAudioTracks:' + join(dir, 'scene.json'), e); }
  const readHead = (entry, n) => {
    try {
      const len = Math.max(0, Math.min(n, entry.size));
      const b = Buffer.allocUnsafe(len);
      const fd = openSync(join(dir, entry.path), 'r');
      try { const got = readSync(fd, b, 0, len, 0); return got === len ? b : b.subarray(0, got); }
      finally { closeSync(fd); }
    } catch { return null; }
  };
  const out = enumerateAudioTracks({ entries: found, readHead, readEntry: () => null, sceneJson });
  return { tracks: out.tracks, headReads: out.headReads, sceneJsonRead: sceneJson !== null };
}

/** 进程内音频索引缓存（键 = 路径 + mtimeMs + size，插件既有 sceneVideoIndex 同款口径）。*/
const pkgAudioIndexCache = new Map();
const PKG_AUDIO_INDEX_CACHE_MAX = 64;
const pkgAudioIndexCounters = { hits: 0, misses: 0, headReads: 0, bytesRead: 0 };
function pkgAudioIndexStats() {
  return { entries: pkgAudioIndexCache.size, hits: pkgAudioIndexCounters.hits,
    misses: pkgAudioIndexCounters.misses, headReads: pkgAudioIndexCounters.headReads,
    bytesRead: pkgAudioIndexCounters.bytesRead, maxEntries: PKG_AUDIO_INDEX_CACHE_MAX };
}
function clearPkgAudioIndexCache() {
  pkgAudioIndexCache.clear();
  pkgAudioIndexCounters.hits = 0; pkgAudioIndexCounters.misses = 0;
  pkgAudioIndexCounters.headReads = 0; pkgAudioIndexCounters.bytesRead = 0;
}

/** 规格 §5.5：partial 条目（内容不在已读头里）是否为 LZ4 块链 —— 三个条件同时成立：
 *  ① 头 ≥ 8 字节；② 这 8 字节不是任何容器规则命中（真魔数优先）；
 *  ③ u64 原始长度 > 存储长度 且 < 2^31。 */
function looksLikeLz4AudioEntry(head, storedLength) {
  if (!head || head.length < 8) return false;
  if (sniffAudioMime(head)) return false;
  const original = readU64LE(head, 0);
  return original > storedLength && original < 2147483647;
}

/**
 * 扫描一个 scene 源（scene.pkg 文件或松散目录）里的音频条目。
 * @returns { tracks, source:'pkg'|'dir', cacheHit, indexEntries, headReads, bytesRead }
 * 缓存：同一 (路径, mtimeMs, size) 第二次调用 O(1)（整包字节数与条目数都不再增长）。
 */
function scanSceneAudio(dirOrPath, opts = {}) {
  const st0 = statSync(dirOrPath);
  const isDir = st0.isDirectory();
  const pkgPath = isDir ? join(dirOrPath, 'scene.pkg') : dirOrPath;
  if (isDir && !existsSync(pkgPath)) {
    const out = collectDirAudioTracks(dirOrPath, opts);
    return { tracks: out.tracks, source: 'dir', cacheHit: false, indexEntries: out.tracks.length, headReads: out.headReads, bytesRead: 0 };
  }
  const st = statSync(pkgPath);
  const key = pkgPath + '|' + st.mtimeMs + '|' + st.size;
  const useCache = opts.cache !== false;
  const hit = useCache ? pkgAudioIndexCache.get(key) : null;
  if (hit) {
    pkgAudioIndexCounters.hits++;
    pkgAudioIndexCache.delete(key); pkgAudioIndexCache.set(key, hit); // LRU touch
    return { tracks: hit.tracks, source: 'pkg', cacheHit: true, indexEntries: hit.indexEntries,
      headReads: 0, bytesRead: 0 };
  }
  pkgAudioIndexCounters.misses++;
  const t0 = process.hrtime.bigint();
  const idx = readPkgIndexFromFile(pkgPath, opts);
  let bytesRead = idx.headBytes;
  const fd = openSync(pkgPath, 'r');
  let headReads = 0;
  const heads = new Map();   // path → 已读头字节（候选条目各只读一次）
  const readAt = (entry, n) => {
    try {
      const len = Math.max(0, Math.min(n, entry.compressedSize == null ? entry.size : entry.compressedSize));
      if (len <= 0) return null;
      const b = Buffer.allocUnsafe(len);
      const got = readSync(fd, b, 0, len, Math.max(0, entry.offset));
      bytesRead += got; headReads++;
      return got === len ? b : b.subarray(0, got);
    } catch { return null; }
  };
  const readHead = (entry, n) => {
    const cached = heads.get(entry.path);
    if (cached) return cached.subarray(0, Math.min(n, cached.length));
    const b = readAt(entry, n);
    heads.set(entry.path, b || Buffer.alloc(0));
    return b;
  };
  const readEntry = (entry) => {
    try {
      const stored = Buffer.allocUnsafe(entry.compressedSize == null ? entry.size : entry.compressedSize);
      const got = readSync(fd, stored, 0, stored.length, Math.max(0, entry.offset));
      bytesRead += got;
      const buf = got === stored.length ? stored : stored.subarray(0, got);
      if (entry.flags & 1) {
        return readPkgEntry(buf, { path: entry.path, offset: 0, compressedSize: buf.length, size: entry.size, flags: 1 });
      }
      return buf;
    } catch { return null; }
  };
  try {
    // partial 条目（内容不在已读的 64KB 头里）先各读 ≤16 字节定口径：
    // LZ4 块链 → size 用块链头的原始长度（否则 size 只是压缩后字节数，规格 §5.5），
    // 且 MIME 必须回落后缀兜底（拿压缩字节做容器判定会说谎）；真魔数命中则照常判定。
    // 规格 §4.3/§5.2：同一路径在目录表里出现多次时，只有第一条参与读头。
    const sniffed = new Set();
    for (const ent of idx.entries) {
      if (!ent || !ent.partial || !isAudioPath(ent.path || '')) continue;
      const key = canonicalAudioPath(ent.path);
      if (sniffed.has(key)) continue;
      sniffed.add(key);
      const head = readHead(ent, AUDIO_HEAD_BYTES);
      if (head && looksLikeLz4AudioEntry(head, ent.compressedSize)) {
        ent.size = readU64LE(head, 0);
        ent.flags = 1;
      }
    }
    const out = enumerateAudioTracks({ entries: idx.entries, readHead, readEntry, sceneJson: opts.sceneJson, sniff: opts.sniff, withRefs: opts.withRefs });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    pkgAudioIndexCounters.headReads += headReads;
    pkgAudioIndexCounters.bytesRead += bytesRead;
    const rec = { tracks: out.tracks, indexEntries: idx.entries.length, ms };
    if (useCache) {
      pkgAudioIndexCache.set(key, rec);
      while (pkgAudioIndexCache.size > PKG_AUDIO_INDEX_CACHE_MAX) {
        const oldest = pkgAudioIndexCache.keys().next().value;
        pkgAudioIndexCache.delete(oldest);
      }
    }
    return { tracks: out.tracks, source: 'pkg', cacheHit: false, indexEntries: idx.entries.length,
      headReads, bytesRead, tableBytes: idx.tableBytes, ms };
  } finally { closeSync(fd); }
}

/** ①(修正) 只解压条目的前 maxBytes 字节（LZ4 块链逐个解压到够用为止）。
 *  打分循环只需 TEX 头部（宽高/格式），不必把 30-122MB 的视频纹理整块解压——
 *  平板内存有限，整块解压会 OOM → 提取失败 → 全部回退预览（用户实测）。 */
function readPkgEntryHead(data, entry, maxBytes) {
  const abs = entry.offset;
  if (abs < 0 || abs + entry.compressedSize > data.byteLength) {
    throw new Error("pkg: entry '" + entry.path + "' out of bounds");
  }
  if ((entry.flags & 1) === 0) return data.slice(abs, abs + Math.min(entry.compressedSize, maxBytes));
  const r = new Reader(data.subarray(abs, abs + entry.compressedSize), 'pkg');
  if (r.u64() !== entry.size) throw new Error("pkg: entry '" + entry.path + "' size mismatch");
  const want = Math.min(entry.size, maxBytes);
  const out = new Uint8Array(want);
  let written = 0;
  while (written < want) {
    const uncomp = r.i32();
    const comp = r.i32();
    if (uncomp <= 0 || comp <= 0) throw new Error("pkg: corrupt compressed entry '" + entry.path + "'");
    const block = lz4DecompressBlock(r.bytes(comp), uncomp);
    const take = Math.min(uncomp, want - written);
    out.set(block.subarray(0, take), written);
    written += take;
  }
  return out;
}

/** Read one mipmap record; containerVersion selects the TEXB layout. */
function readMipmap(r, containerVersion) {
  if (containerVersion === 4) {
    const param1 = r.i32();
    const param2 = r.i32();
    r.nstring(1 << 20);
    const param3 = r.i32();
    if (param1 !== 1 || param2 !== 2 || param3 !== 1) {
      throw new Error('tex: bad TEXB0004 mipmap params');
    }
  }
  const width = r.i32();
  const height = r.i32();
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
    throw new Error('tex: invalid mipmap dimensions ' + width + 'x' + height);
  }
  if (containerVersion === 1) {
    return { width, height, bytes: r.bytes(r.i32()) };
  }
  const isLz4 = r.i32() === 1;
  const decompressedCount = r.i32();
  const stored = r.bytes(r.i32());
  if (isLz4) {
    return { width, height, bytes: lz4DecompressBlock(stored, decompressedCount) };
  }
  return { width, height, bytes: stored };
}

/** ①(修正) 轻量 TEX 头部解析：只读 magic/格式/宽高/视频标志，不需要完整缓冲。
 *  打分循环用（只解压条目头部 512 字节），避免整块 LZ4 解压 30-122MB 纹理。 */
function parseTexHeader(data) {
  const r = new Reader(data, 'texhdr');
  const magic1 = r.nstring(16);
  if (magic1 !== 'TEXV0005') throw new Error("tex: bad magic '" + magic1 + "'");
  const magic2 = r.nstring(16);
  if (magic2 !== 'TEXI0001') throw new Error("tex: bad image-info magic '" + magic2 + "'");
  const format = r.i32();
  const flags = r.i32();
  const textureWidth = r.i32();
  const textureHeight = r.i32();
  const imageWidth = r.i32();
  const imageHeight = r.i32();
  r.u32();
  const containerMagic = r.nstring(16);
  const containerMatch = /^TEXB000([1-4])$/.exec(containerMagic);
  if (!containerMatch) throw new Error("tex: bad mipmap container magic '" + containerMagic + "'");
  let containerVersion = Number(containerMatch[1]);
  const imageCount = r.i32();
  if (imageCount <= 0 || imageCount > 256) throw new Error('tex: invalid image count ' + imageCount);
  let isVideoMp4 = false;
  if (containerVersion === 3) r.i32();
  else if (containerVersion === 4) {
    const freeImageFormat = r.i32();
    isVideoMp4 = r.i32() === 1 && freeImageFormat === -1;
  }
  return { format, flags, width: textureWidth, height: textureHeight, imageWidth, imageHeight, isVideoMp4 };
}

/** Parse a TEX container into metadata plus the first image's mipmaps. */
function parseTexInternal(data) {
  const r = new Reader(data, 'tex');
  const magic1 = r.nstring(16);
  if (magic1 !== 'TEXV0005') throw new Error("tex: bad magic '" + magic1 + "'");
  const magic2 = r.nstring(16);
  if (magic2 !== 'TEXI0001') throw new Error("tex: bad image-info magic '" + magic2 + "'");
  const format = r.i32();
  const flags = r.i32();
  const textureWidth = r.i32();
  const textureHeight = r.i32();
  const imageWidth = r.i32();
  const imageHeight = r.i32();
  r.u32();
  if (TEX_FORMAT_NAMES[format] === undefined) throw new Error('tex: unsupported format ' + format);
  const containerMagic = r.nstring(16);
  const containerMatch = /^TEXB000([1-4])$/.exec(containerMagic);
  if (!containerMatch) throw new Error("tex: bad mipmap container magic '" + containerMagic + "'");
  let containerVersion = Number(containerMatch[1]);
  const imageCount = r.i32();
  if (imageCount <= 0 || imageCount > 256) throw new Error('tex: invalid image count ' + imageCount);
  let isVideoMp4 = false;
  if (containerVersion === 3) r.i32();
  else if (containerVersion === 4) {
    const freeImageFormat = r.i32();
    isVideoMp4 = r.i32() === 1;
    if (!(freeImageFormat === -1 && isVideoMp4)) containerVersion = 3;
  }
  let firstImage = null;
  for (let i = 0; i < imageCount; i++) {
    const mipmapCount = r.i32();
    if (mipmapCount <= 0 || mipmapCount > 32) throw new Error('tex: invalid mipmap count ' + mipmapCount);
    const mipmaps = [];
    for (let j = 0; j < mipmapCount; j++) mipmaps.push(readMipmap(r, containerVersion));
    if (firstImage === null) firstImage = mipmaps;
  }
  const isAnimatedGif = (flags & TEX_FLAG_IS_GIF) !== 0;
  const frames = [];
  if (isAnimatedGif) {
    const frameMagic = r.nstring(16);
    const frameMatch = /^TEXS000([1-3])$/.exec(frameMagic);
    if (!frameMatch) throw new Error("tex: bad frame container magic '" + frameMagic + "'");
    const frameVersion = Number(frameMatch[1]);
    const frameCount = r.i32();
    if (frameCount < 0 || frameCount > 4096) throw new Error('tex: invalid frame count ' + frameCount);
    if (frameVersion === 3) {
      r.i32();
      r.i32();
    }
    for (let i = 0; i < frameCount; i++) {
      const imageId = r.i32();
      const frametime = r.f32();
      if (frameVersion === 1) {
        const x = r.i32();
        const y = r.i32();
        const width = r.i32();
        r.i32();
        r.i32();
        const height = r.i32();
        frames.push({ imageId, frametime, x, y, width, height });
      } else {
        const x = r.f32();
        const y = r.f32();
        const width = r.f32();
        r.f32();
        r.f32();
        const height = r.f32();
        frames.push({ imageId, frametime, x, y, width, height });
      }
    }
  }
  const mip0 = firstImage[0];
  const embedded =
    mip0.bytes.length >= 2 && mip0.bytes[0] === 0xff && mip0.bytes[1] === 0xd8
      ? 'jpeg'
      : mip0.bytes.length >= 8 && mip0.bytes[0] === 0x89 && mip0.bytes[1] === 0x50 && mip0.bytes[2] === 0x4e && mip0.bytes[3] === 0x47
        ? 'png'
        : null;
  return {
    format,
    flags,
    width: imageWidth > 0 ? imageWidth : textureWidth > 0 ? textureWidth : mip0.width,
    height: imageHeight > 0 ? imageHeight : textureHeight > 0 ? textureHeight : mip0.height,
    isAnimatedGif,
    isVideoMp4,
    frames,
    mipmaps: firstImage,
    embedded,
  };
}

/** Parse a TEX container and return its metadata (never throws on payload). */
function parseTex(data) {
  const parsed = parseTexInternal(data);
  const info = {
    width: parsed.width,
    height: parsed.height,
    format: parsed.format,
    formatName: TEX_FORMAT_NAMES[parsed.format] ?? 'unknown(' + parsed.format + ')',
    isAnimatedGif: parsed.isAnimatedGif,
    isVideoMp4: parsed.isVideoMp4,
    mipLevels: parsed.mipmaps.length,
    embedded: parsed.embedded,
  };
  if (parsed.isAnimatedGif) info.frames = parsed.frames;
  return info;
}

// ── Embedded JPEG support ───────────────────────────────────────────────────
// Wallpaper Engine stores photographic textures as a complete JPEG payload
// inside the TEX mip data (the JPEG starts right where raw pixels would).
// Detect by the FFD8 SOI marker and hand back the bytes untouched.

/**
 * Scan JPEG markers for the first SOF segment and return { width, height }.
 * Returns null when the payload is not a parseable JPEG.
 */
function jpegSofDims(bytes) {
  const len = bytes.length;
  let p = 2;
  while (p + 9 < len) {
    if (bytes[p] !== 0xff) { p++; continue; }
    const marker = bytes[p + 1];
    if (marker === 0xd8) { p += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before SOF
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (p + 9 > len) return null;
      return {
        height: ((bytes[p + 5] << 8) | bytes[p + 6]) & 0xffff,
        width: ((bytes[p + 7] << 8) | bytes[p + 8]) & 0xffff,
      };
    }
    const segLen = ((bytes[p + 2] << 8) | bytes[p + 3]) & 0xffff;
    if (segLen < 2) return null;
    p += 2 + segLen;
  }
  return null;
}

function rgb565(value) {
  const r = (value >> 11) & 31;
  const g = (value >> 5) & 63;
  const b = value & 31;
  return [r << 3 | r >> 2, g << 2 | g >> 4, b << 3 | b >> 2];
}

/** Build the 4-color BC palette; three-color + transparent when DXT1 c0 <= c1. */
function buildColorPalette(c0, c1, fourColor) {
  const palette = new Uint8Array(16);
  const [r0, g0, b0] = rgb565(c0);
  const [r1, g1, b1] = rgb565(c1);
  palette.set([r0, g0, b0, 255], 0);
  palette.set([r1, g1, b1, 255], 4);
  if (fourColor) {
    palette.set([((2 * r0 + r1) / 3) | 0, ((2 * g0 + g1) / 3) | 0, ((2 * b0 + b1) / 3) | 0, 255], 8);
    palette.set([((r0 + 2 * r1) / 3) | 0, ((g0 + 2 * g1) / 3) | 0, ((b0 + 2 * b1) / 3) | 0, 255], 12);
  } else {
    palette.set([((r0 + r1) / 2) | 0, ((g0 + g1) / 2) | 0, ((b0 + b1) / 2) | 0, 255], 8);
    palette.set([0, 0, 0, 0], 12);
  }
  return palette;
}

/** Shared BC1/BC2/BC3 block walker (blockStride 8 for BC1, 16 for BC2/BC3). */
function decodeColorBlocks(src, out, width, height, blockStride, colorOffset, dxt1Alpha) {
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const base = (by * blocksX + bx) * blockStride;
      const c0 = view.getUint16(base + colorOffset, true);
      const c1 = view.getUint16(base + colorOffset + 2, true);
      const palette = buildColorPalette(c0, c1, dxt1Alpha ? c0 > c1 : true);
      const indices = view.getUint32(base + colorOffset + 4, true);
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          const selector = (indices >> (2 * (py * 4 + px))) & 3;
          const dst = (y * width + x) * 4;
          out[dst] = palette[selector * 4];
          out[dst + 1] = palette[selector * 4 + 1];
          out[dst + 2] = palette[selector * 4 + 2];
          out[dst + 3] = palette[selector * 4 + 3];
        }
      }
    }
  }
}

/** BC1 (DXT1): 8-byte blocks, 4x4 pixels, optional 1-bit alpha. */
function decodeDxt1(src, width, height) {
  const out = new Uint8Array(width * height * 4);
  decodeColorBlocks(src, out, width, height, 8, 0, true);
  return out;
}

/** BC2 (DXT3): 16-byte blocks, 4-bit explicit alpha + BC1-style color. */
function decodeDxt3(src, width, height) {
  const out = new Uint8Array(width * height * 4);
  decodeColorBlocks(src, out, width, height, 16, 8, false);
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const base = (by * blocksX + bx) * 16;
      const alphaLo = view.getUint32(base, true);
      const alphaHi = view.getUint32(base + 4, true);
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i % 4);
        const y = by * 4 + ((i / 4) | 0);
        if (x >= width || y >= height) continue;
        const nibble = i < 8 ? (alphaLo >> (4 * i)) & 15 : (alphaHi >> (4 * (i - 8))) & 15;
        out[(y * width + x) * 4 + 3] = nibble * 17;
      }
    }
  }
  return out;
}

/** BC3 (DXT5): 16-byte blocks, interpolated 3-bit alpha + BC1-style color. */
function decodeDxt5(src, width, height) {
  const out = new Uint8Array(width * height * 4);
  decodeColorBlocks(src, out, width, height, 16, 8, false);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const base = (by * blocksX + bx) * 16;
      const a0 = src[base];
      const a1 = src[base + 1];
      const alphas = new Uint8Array(8);
      alphas[0] = a0;
      alphas[1] = a1;
      if (a0 > a1) {
        for (let k = 2; k < 8; k++) alphas[k] = (((8 - k) * a0 + (k - 1) * a1) / 7) | 0;
      } else {
        for (let k = 2; k < 6; k++) alphas[k] = (((6 - k) * a0 + (k - 2) * a1) / 5) | 0;
        alphas[6] = 0;
        alphas[7] = 255;
      }
      let bits =
        src[base + 2] +
        src[base + 3] * 256 +
        src[base + 4] * 65536 +
        src[base + 5] * 16777216 +
        src[base + 6] * 4294967296 +
        src[base + 7] * 1099511627776;
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i % 4);
        const y = by * 4 + ((i / 4) | 0);
        const index = bits % 8;
        bits = Math.floor(bits / 8);
        if (x >= width || y >= height) continue;
        out[(y * width + x) * 4 + 3] = alphas[index];
      }
    }
  }
  return out;
}

/**
 * When the declared mipmap size does not match the stored byte count, Wallpaper
 * Engine occasionally stores a downscaled mip while the container header keeps
 * the original dims. Derive the real dims from the data length when a clean
 * factorization exists; otherwise null.
 */
function deriveDims(storedBytes, width, height, bpp) {
  for (let w = width; w >= 16; w = Math.floor(w / 2)) {
    const bytesPerRow = w * bpp;
    if (storedBytes % bytesPerRow !== 0) continue;
    const h = storedBytes / bytesPerRow;
    if (Number.isInteger(h) && h > 0 && h <= height * 2) return { width: w, height: h };
  }
  return null;
}

/**
 * Decode the first (largest) mipmap of a TEX container.
 *
 * Returns `{ kind: 'jpeg', bytes, width, height }` / `{ kind: 'png-pass',
 * bytes, width, height }` when the mip payload is an embedded JPEG / PNG
 * (Wallpaper Engine stores photographic textures as complete JPEG/PNG files
 * inside the TEX container — returned untouched, zero decode, best fidelity),
 * or `{ kind: 'rgba', width, height, rgba }` for RGBA8888 / R8 / RG88 /
 * DXT1 / DXT3 / DXT5. Embedded MP4 textures and unknown formats throw a
 * descriptive error instead of failing silently.
 */
function decodeTex(data) {
  const parsed = parseTexInternal(data);
  if (parsed.isVideoMp4) {
    throw new Error('tex: video mp4 textures cannot be decoded to a static frame');
  }
  const mip0 = parsed.mipmaps[0];
  // Embedded JPEG texture — pass the payload through untouched.
  if (mip0.bytes.length >= 2 && mip0.bytes[0] === 0xff && mip0.bytes[1] === 0xd8) {
    const dims = jpegSofDims(mip0.bytes);
    return {
      kind: 'jpeg',
      bytes: mip0.bytes,
      width: dims ? dims.width : parsed.width,
      height: dims ? dims.height : parsed.height,
    };
  }
  // Embedded PNG texture (newer WE scenes; photographic art, incl. transparent
  // PNG sprites) — pass the payload through untouched. IHDR dims are
  // big-endian at bytes 16-23.
  if (
    mip0.bytes.length >= 24 &&
    mip0.bytes[0] === 0x89 && mip0.bytes[1] === 0x50 &&
    mip0.bytes[2] === 0x4e && mip0.bytes[3] === 0x47
  ) {
    const ihdrW = (mip0.bytes[16] << 24) | (mip0.bytes[17] << 16) | (mip0.bytes[18] << 8) | mip0.bytes[19];
    const ihdrH = (mip0.bytes[20] << 24) | (mip0.bytes[21] << 16) | (mip0.bytes[22] << 8) | mip0.bytes[23];
    return {
      kind: 'png-pass',
      bytes: mip0.bytes,
      width: ihdrW > 0 ? ihdrW : parsed.width,
      height: ihdrH > 0 ? ihdrH : parsed.height,
    };
  }
  let { width, height, bytes } = mip0;
  // Embedded MP4 / QuickTime video texture (WE "sync" animations flag the TEX
  // as RGBA8888 but store an MP4 file; TEXI flags 0x2000/0x2200 mark them).
  // MP4 boxes start with [u32 big-endian size]['ftyp' ...]. The size sanity
  // check matters: raw RGBA textures can coincidentally start with bytes that
  // spell 'ftyp' in a pixel, but their leading u32 is pixel data, not a box
  // length (raw RGBA at w*h*4 is far larger than any small pixel value).
  if (bytes.length >= 12) {
    const boxSize = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    if (
      boxSize >= 12 && boxSize <= bytes.length &&
      bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
    ) {
      throw new Error('tex: embedded mp4 video texture cannot be decoded to a static frame');
    }
  }
  switch (parsed.format) {
    case TexFormat.RGBA8888: {
      if (bytes.length < width * height * 4) {
        const derived = deriveDims(bytes.length, width, height, 4);
        if (!derived) throw new Error('tex: mipmap size mismatch for RGBA8888');
        width = derived.width;
        height = derived.height;
      }
      return { kind: 'rgba', width, height, rgba: bytes.slice(0, width * height * 4) };
    }
    case TexFormat.R8: {
      if (bytes.length < width * height) {
        const derived = deriveDims(bytes.length, width, height, 1);
        if (!derived) throw new Error('tex: mipmap size mismatch for R8');
        width = derived.width;
        height = derived.height;
      }
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = bytes[i];
        rgba[i * 4 + 1] = bytes[i];
        rgba[i * 4 + 2] = bytes[i];
        rgba[i * 4 + 3] = 255;
      }
      return { kind: 'rgba', width, height, rgba };
    }
    case TexFormat.RG88: {
      if (bytes.length < width * height * 2) {
        const derived = deriveDims(bytes.length, width, height, 2);
        if (!derived) throw new Error('tex: mipmap size mismatch for RG88');
        width = derived.width;
        height = derived.height;
      }
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = bytes[i * 2];
        rgba[i * 4 + 1] = bytes[i * 2 + 1];
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 255;
      }
      return { kind: 'rgba', width, height, rgba };
    }
    case TexFormat.DXT1: {
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
      if (bytes.length < expected) throw new Error('tex: mipmap size mismatch for DXT1');
      return { kind: 'rgba', width, height, rgba: decodeDxt1(bytes, width, height) };
    }
    case TexFormat.DXT3: {
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
      if (bytes.length < expected) throw new Error('tex: mipmap size mismatch for DXT3');
      return { kind: 'rgba', width, height, rgba: decodeDxt3(bytes, width, height) };
    }
    case TexFormat.DXT5: {
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
      if (bytes.length < expected) throw new Error('tex: mipmap size mismatch for DXT5');
      return { kind: 'rgba', width, height, rgba: decodeDxt5(bytes, width, height) };
    }
    default:
      throw new Error('tex: unsupported format ' + parsed.format);
  }
}

// ── PNG encoder (zero dependencies) ──────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 4294967295;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 4294967295) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encode RGBA8888 pixels as a minimal PNG (8-bit RGBA, filter type 0) using
 * node:zlib deflate and a hand-rolled CRC32. Zero dependencies.
 */
function encodePng(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('png: invalid dimensions ' + width + 'x' + height);
  }
  if (rgba.length !== width * height * 4) throw new Error('png: rgba buffer size mismatch');
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Scene pipeline ───────────────────────────────────────────────────────────

/** Extract .tex candidate paths referenced by one scene.json image object. */
function collectImageObjectTextures(imageObject, readJson) {
  const out = [];
  const pushTextureList = (list) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const name =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object' && typeof item.name === 'string'
            ? item.name
            : null;
      if (name && name.toLowerCase().endsWith('.tex')) out.push(name);
    }
  };
  const ref = imageObject.image;
  if (ref.toLowerCase().endsWith('.tex')) out.push(ref);
  else {
    const material = readJson(ref);
    if (material && Array.isArray(material.passes)) {
      for (const pass of material.passes) pushTextureList(pass && pass.textures);
    }
  }
  const instance = imageObject.instance;
  if (instance && typeof instance === 'object') pushTextureList(instance.textures);
  return out;
}

/** SceneAccess over a packed scene.pkg container (case-insensitive paths). */
function pkgSceneAccess(pkgData) {
  const entries = parsePkg(pkgData);
  const byPath = new Map(entries.map((entry) => [entry.path.toLowerCase(), entry]));
  const readFile = (path) => {
    const entry = byPath.get(path.toLowerCase());
    if (!entry) return null;
    return { path: entry.path, bytes: readPkgEntry(pkgData, entry) };
  };
  return {
    readJson: (path) => {
      const file = readFile(path);
      if (!file) return null;
      try {
        // ①(P-177 同口径) 容器内 scene.json / model.json / material.json 走宽容解析（官方允许尾逗号）
        return mpwParseWeJson(textDecoder.decode(file.bytes));
      } catch (e) {
        return mpwWeJsonSwallowed('pkgSceneAccess.readJson:' + path, e);   // 原来就吞；现在记账
      }
    },
    readFile,
    readFileHead: (path, n) => {
      const entry = byPath.get(path.toLowerCase());
      if (!entry) return null;
      return { path: entry.path, compressedSize: entry.compressedSize, bytes: readPkgEntryHead(pkgData, entry, n) };
    },
    listTexPaths: () => entries.filter((entry) => entry.path.toLowerCase().endsWith('.tex')).map((entry) => entry.path),
    // ①(new) scene-video：遍历全部条目（供 collectSceneVideoFiles 找内嵌视频）
    list: () => entries.map((entry) => ({ path: entry.path, read: () => readPkgEntry(pkgData, entry) })),
  };
}

/**
 * SceneAccess over a loose scene project directory (scene.json plus loose
 * .tex/.json files, e.g. WE defaultprojects). Reads are fenced inside the
 * directory; texture references escaping it resolve to null.
 */
function dirSceneAccess(dir) {
  const readFile = (path) => {
    const abs = resolve(dir, path);
    if (abs !== dir && !abs.startsWith(dir + sep)) return null;
    try {
      if (!statSync(abs).isFile()) return null;
      return { path, bytes: new Uint8Array(readFileSync(abs)) };
    } catch {
      return null;
    }
  };
  const listTexPaths = () => {
    const out = [];
    const walk = (sub, depth) => {
      if (depth > 4) return;
      let names = [];
      try {
        names = readdirSync(sub === '' ? dir : join(dir, sub));
      } catch {
        return;
      }
      for (const name of names) {
        const rel = sub === '' ? name : sub + '/' + name;
        let isDir = false;
        let isFile = false;
        try {
          const stat = statSync(join(dir, rel));
          isDir = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          continue;
        }
        if (isDir) walk(rel, depth + 1);
        else if (isFile && name.toLowerCase().endsWith('.tex')) out.push(rel);
      }
    };
    walk('', 0);
    return out;
  };
  const readFileHead = (path, n) => {
    const abs = resolve(dir, path);
    if (abs !== dir && !abs.startsWith(dir + sep)) return null;
    try {
      if (!statSync(abs).isFile()) return null;
      return { path, compressedSize: statSync(abs).size, bytes: new Uint8Array(readFileSync(abs).subarray(0, n)) };
    } catch {
      return null;
    }
  };
  // ①(new) scene-video：遍历目录全部文件（.tex/.mp4/.webm/.mov 等）
  const list = () => {
    const out = [];
    const walk = (sub, depth) => {
      if (depth > 4) return;
      let names = [];
      try {
        names = readdirSync(sub === '' ? dir : join(dir, sub));
      } catch {
        return;
      }
      for (const name of names) {
        const rel = sub === '' ? name : sub + '/' + name;
        let isDir = false;
        let isFile = false;
        try {
          const stat = statSync(join(dir, rel));
          isDir = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          continue;
        }
        if (isDir) {
          if (!name.startsWith('.')) walk(rel, depth + 1);
        } else {
          out.push({ path: rel, read: () => { try { return new Uint8Array(readFileSync(join(dir, rel))); } catch { return null; } } });
        }
      }
    };
    walk('', 0);
    return out;
  };
  return {
    readJson: (path) => {
      const file = readFile(path);
      if (!file) return null;
      try {
        // ①(P-177 同口径) 松散场景目录里的 scene.json / model.json / material.json 走宽容解析
        return mpwParseWeJson(textDecoder.decode(file.bytes));
      } catch (e) {
        return mpwWeJsonSwallowed('dirSceneAccess.readJson:' + path, e);   // 原来就吞；现在记账
      }
    },
    readFile,
    readFileHead,
    listTexPaths,
    list,
  };
}

/**
 * Shared scene pipeline over one access layer; label prefixes error text.
 *
 * Candidate order: textures referenced by the first scene object with an
 * `image` property first, then every other .tex ranked by a score that favors
 * wallpaper art — embedded JPEG/PNG payloads (WE only lossy-encodes
 * photographic art), full-color formats (RGBA8888/RGB888), and large areas —
 * while masks, depth/normal/effect helpers, R8/RG88 grayscale formats and
 * embedded workshop asset folders are heavily penalized.
 *
 * A post-decode quality gate rejects grayscale (>88% gray) and flat (near-zero
 * variance) frames — a mask/depth texture can never be the wallpaper — and
 * moves on to the next candidate. When nothing passes, the caller sees an
 * error and falls back to the project preview.
 *
 * Returns `{ mime, bytes, width, height, texturePath }`.
 */
const PATH_PENALTY_RE =
  /(^|[\\/])(masks?|effects?)([\\/]|$)|[\\/]workshop[\\/]|_mask|mask_|normal|depth|ripple|foliagesway|cloudmotion|shake|pulse|xray|opacity|lens|cursor|flow|grad|noise|particle|vignette|blur|sync|_anim|frame|seq/i;
/** Format → art-likelihood multiplier (embedded JPEG/PNG handled separately). */
const FORMAT_PENALTY = {
  0: 1, // RGBA8888
  1: 1, // RGB888
  7: 0.5, // DXT1
  6: 0.5, // DXT3
  4: 0.5, // DXT5
  8: 0.01, // RG88 — grayscale helper
  9: 0.01, // R8 — grayscale helper
  2: 0.1, // RGB565
  12: 0.05, // BC7
  13: 0.1, // RGBA1010102
  10: 0.05, 11: 0.05, 14: 0.05, 15: 0.05, // float formats
};

/** ①(修正) UI 覆盖层/辅助纹理关键词惩罚：提示框、赞助、文字、水印、按钮、图标等
 *  overlay 图层会被第一个 image 对象优先引用（用户实测：伊蕾娜提取到"提示框"纹理
 *  而不是主图）。这些永远不是壁纸主图。 */
const UI_PENALTY_RE =
  /提示框|赞助|水印|按钮|图标|边框|弹窗|文字|角标|鼠标|指针|网盘|箭头|prompt|text_|button|icon|logo|dialog|input|chat|badge|bubble|tooltip|border|sponsor|watermark|topbar|titlebar|headbar|notify|hud|overlay|panel|label|cursor|pointer|drive|arrow|hand/i;

/** Sample the decoded frame: grayscale ratio + mean channel variance. */
function frameQuality(width, height, rgba) {
  const total = width * height;
  const n = Math.min(2000, total);
  const seen = new Set();
  let gray = 0, sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    let idx;
    do { idx = (Math.random() * total) | 0; } while (seen.has(idx));
    seen.add(idx);
    const o = idx * 4;
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    sr += r; sg += g; sb += b;
    if (Math.max(r, g, b) - Math.min(r, g, b) <= 24) gray++;
  }
  const mr = sr / n, mg = sg / n, mb = sb / n;
  let v = 0;
  for (const idx of seen) {
    const o = idx * 4;
    v += Math.abs(rgba[o] - mr) + Math.abs(rgba[o + 1] - mg) + Math.abs(rgba[o + 2] - mb);
  }
  return { grayRatio: gray / n, meanVar: v / (n * 3) };
}

/** The quality gate: reject grayscale masks/depth and flat solid fills. */
function isAcceptableFrame(q) {
  if (q.grayRatio > 0.88) return false;
  if (q.meanVar < 3) return false;
  return true;
}

/**
 * Quality-check an embedded-PNG payload WITHOUT committing to it: decode
 * (8-bit RGB/RGBA only) and run the same grayscale/flat gate. Payloads larger
 * than PNG_GATE_MAX_PIXELS are trusted (bounding decode memory); returns null
 * then, or on any parse failure — the caller treats null as "accept".
 */
const PNG_GATE_MAX_PIXELS = 12 * 1024 * 1024;

function pngQuality(bytes) {
  const b = Buffer.from(bytes);
  if (!(b.length >= 33 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG')) return null;
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const ct = b[25];
  const channels = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (w <= 0 || h <= 0 || w > 16384 || h > 16384 || !channels || w * h > PNG_GATE_MAX_PIXELS) return null;
  const idats = [];
  let p = 8;
  while (p < b.length) {
    if (p + 12 > b.length) return null;
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    if (p + 12 + len > b.length) return null;
    if (type === 'IDAT') idats.push(b.subarray(p + 8, p + 8 + len));
    if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!idats.length) return null;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idats));
  } catch {
    return null;
  }
  const stride = w * channels + 1;
  if (raw.length < stride * h) return null;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * stride];
    const line = raw.subarray(y * stride + 1, (y + 1) * stride);
    for (let x = 0; x < w * channels; x++) {
      const a = x >= channels ? rgba[y * w * 4 + x - channels] : 0;
      const pr = y > 0 ? rgba[(y - 1) * w * 4 + x] : 0;
      const pc = y > 0 && x >= channels ? rgba[(y - 1) * w * 4 + x - channels] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + pr) & 255;
      else if (f === 3) v = (v + ((a + pr) >> 1)) & 255;
      else if (f === 4) {
        const q = a + pr - pc;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - pr);
        const pcv = Math.abs(q - pc);
        v = (v + (pa <= pb && pa <= pcv ? a : pb <= pcv ? pr : pc)) & 255;
      }
      rgba[y * w * 4 + x] = v;
    }
  }
  return frameQuality(w, h, rgba);
}

function extractSceneMainImageVia(access, label) {
  const scene = access.readJson('scene.json');
  if (!scene || !Array.isArray(scene.objects)) {
    throw new Error(label + ': scene.json not found or invalid');
  }
  // ①(修正) 统一打分排序：不再"第一个 image 对象无条件优先"（用户实测伊蕾娜场景
  // 第一个 image 对象引用的是"提示框"UI 纹理 → 提取出文字框而非主图）。
  // 打分 = 像素面积 × 格式系数 × 路径惩罚 × image 对象加成；UI 覆盖层纹理重罚。
  const imageObject = scene.objects.find(
    (o) => !!o && typeof o === 'object' && typeof o.image === 'string'
  );
  const imageObjectPaths = imageObject ? collectImageObjectTextures(imageObject, access.readJson).map((p) => p.toLowerCase()) : [];
  const MAX_CANDIDATE_AREA = 100 * 1024 * 1024; // 解码面积上限（防超巨纹理撑爆内存）
  const MAX_ENTRY_COMPRESSED = 64 * 1024 * 1024; // 压缩后超过 64MB 的条目 = 视频纹理/巨型图，不参与（打分+解码都跳过）
  const ranked = [];
  const seenPaths = new Set();
  for (const path of access.listTexPaths()) {
    const lower = path.toLowerCase();
    if (seenPaths.has(lower)) continue;
    seenPaths.add(lower);
    let score = 0;
    try {
      // ①(修正) 打分只看头部（readFileHead + parseTexHeader）：
      // 避免把 30-122MB 纹理整块 LZ4 解压（平板 OOM → 全部回退预览，用户实测）
      const headFile = typeof access.readFileHead === 'function' ? access.readFileHead(path, 512) : access.readFile(path);
      if (!headFile) { score = 0; }
      else if (headFile.compressedSize > MAX_ENTRY_COMPRESSED) { score = 0; }
      else {
        const info = parseTexHeader(headFile.bytes);
        if (info && !info.isVideoMp4) {
          const area = info.width * info.height;
          if (area > MAX_CANDIDATE_AREA) { score = 0; }
          else {
            const embedded = 1; // 头部解析拿不到内嵌 jpeg/png 标志，统一按 1（面积主导排序）
            let pathPenalty = PATH_PENALTY_RE.test(path) ? 0.02 : 1;
            if (UI_PENALTY_RE.test(path)) pathPenalty *= 0.02; // UI 覆盖层纹理重罚
            const imageBoost = imageObjectPaths.includes(lower) ? 2 : 1; // 引用加成而非独占
            score = area * embedded * pathPenalty * imageBoost;
          }
        }
      }
    } catch {
      score = 0;
    }
    if (score > 0) ranked.push({ path, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  // ①(修正) 候选分数下限：主图全是视频纹理（时间变化壁纸）时，剩下的
  // 粒子/流星等重惩罚候选分数极低 → 直接放弃（调用方回退官方预览动图），
  // 而不是把一条 256×832 的粒子拖尾当壁纸。
  const MIN_TOP_SCORE = 200000; // 像素面积 × 系数后的有效分数
  if (!ranked.length || ranked[0].score < MIN_TOP_SCORE) {
    throw new Error(label + ': no art-like texture candidate (best score ' + (ranked[0] ? ranked[0].score : 0) + ')');
  }
  const candidates = ranked.map((r) => r.path);
  if (candidates.length === 0) throw new Error(label + ': no texture candidates found');

  let lastError = null;
  let tried = 0;
  const MAX_TRIES = 14; // 最多尝试解码的候选数（大纹理解码慢，不无限试）
  for (const path of candidates) {
    if (tried >= MAX_TRIES) break;
    tried++;
    // ①(修正) UI 覆盖层纹理（提示框/赞助/文字/水印/按钮等）直接跳过——
    // 用户实测提取到"提示框"后壁纸显示一堆文字框；宁可回退预览图也不要文字框。
    if (UI_PENALTY_RE.test(path)) {
      lastError = new Error(label + ': UI overlay texture skipped (' + path + ')');
      continue;
    }
    // ①(修正) 巨条目（压缩 >64MB = 视频纹理/超巨型图）解码会 OOM/极慢 → 跳过
    const meta = typeof access.readFileHead === 'function' ? access.readFileHead(path, 1) : null;
    if (meta && meta.compressedSize > MAX_ENTRY_COMPRESSED) {
      lastError = new Error(label + ': oversized entry skipped (' + path + ')');
      continue;
    }
    const file = access.readFile(path);
    if (!file) {
      lastError = new Error(label + ": texture '" + path + "' not found in " + (label === 'pkg' ? 'package' : 'directory'));
      continue;
    }
    try {
      const decoded = decodeTex(file.bytes);
      // ①(修正) 极端宽高比 = 图集条带/粒子拖尾（时间变化壁纸多时段叠竖条、
      // 流星/星光粒子是窄条纹理）→ 不是壁纸主图，跳过。竖版手机壁纸 9:16≈0.56，
      // 超宽屏≈2.4 都保留；<0.45 或 >3 的窄条判定为辅助纹理。
      const ratio = decoded.width > 0 && decoded.height > 0 ? decoded.width / decoded.height : 0;
      if (ratio > 3 || (ratio > 0 && ratio < 0.45)) {
        lastError = new Error(label + ': atlas/particle strip rejected (' + file.path + '): ' + decoded.width + 'x' + decoded.height);
        continue;
      }
      if (decoded.kind === 'jpeg') {
        // Embedded JPEG payloads are photographic art by construction — WE
        // never stores masks/helpers as JPEG. Pass through untouched.
        return {
          mime: 'image/jpeg',
          bytes: decoded.bytes,
          width: decoded.width,
          height: decoded.height,
          texturePath: file.path,
        };
      }
      if (decoded.kind === 'png-pass') {
        // Embedded PNGs are usually art, but some scenes store grayscale
        // variants (b/w edits, gray backgrounds) — quality-gate when cheap.
        const q = pngQuality(decoded.bytes);
        if (q && !isAcceptableFrame(q)) {
          lastError = new Error(
            label + ': frame rejected (' + file.path + '): gray=' + Math.round(q.grayRatio * 100) + '% var=' + q.meanVar.toFixed(1)
          );
          continue;
        }
        return {
          mime: 'image/png',
          bytes: decoded.bytes,
          width: decoded.width,
          height: decoded.height,
          texturePath: file.path,
        };
      }
      // Raw RGBA — apply the quality gate before committing to it.
      const q = frameQuality(decoded.width, decoded.height, decoded.rgba);
      if (!isAcceptableFrame(q)) {
        lastError = new Error(
          label + ': frame rejected (' + file.path + '): gray=' + Math.round(q.grayRatio * 100) + '% var=' + q.meanVar.toFixed(1)
        );
        continue;
      }
      return {
        mime: 'image/png',
        bytes: encodePng(decoded.width, decoded.height, decoded.rgba),
        width: decoded.width,
        height: decoded.height,
        texturePath: file.path,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(label + ': no decodable texture found');
}

/** Extract the main static frame of a packed scene.pkg (Uint8Array/Buffer). */
function extractSceneMainImage(pkgData) {
  return extractSceneMainImageVia(pkgSceneAccess(pkgData), 'pkg');
}

/**
 * Loose-scene variant: decode the main texture of a scene project directory
 * that ships scene.json and textures as plain files instead of a packed
 * scene.pkg.
 */
function extractSceneMainImageFromDir(dir) {
  return extractSceneMainImageVia(dirSceneAccess(dir), 'scene');
}


// ═══════════════════════════════════════════════════════════════════════════
//  图层合成渲染（route B v1）：解析 scene.json 的全部 image 图层（model →
//  material → 纹理），输出图层清单；每个图层纹理可单独提取为 PNG 由浏览器
//  canvas 合成渲染（视差/呼吸/时间帧切换）。这是"类级别"方案：任何分层
//  场景（背景 + 主体 + 发丝/衣物分层角色）都按场景数据渲染，不是取单张纹理。
// ═══════════════════════════════════════════════════════════════════════════
const TIME_FRAME_RE = /清晨|白天|黄昏|夜晚|昼夜|day|night|dusk|dawn|morning|evening/i;
/** 按当前小时选时间帧关键词（WE 时间变化壁纸命名约定）。 */
function timeFrameKey(date) {
  const h = (date || new Date()).getHours();
  if (h < 6) return '清晨';
  if (h < 12) return '白天';
  if (h < 18) return '黄昏';
  return '夜晚';
}
/** 解析 "x y z" 向量。 */
function parseVec(s) {
  return String(s || '').trim().split(/\s+/).map(Number).filter((n) => !isNaN(n));
}
/**
 * 提取场景图层清单（不提取纹理数据，只给引用路径 + 几何）。
 * 时间变化场景按当前时段只保留对应帧的图层（名字含 清晨/白天/黄昏/夜晚）。
 * 返回 { w, h, layers: [{name, texPath, x, y, w, h, px, py}] }；无可用图层抛错。
 */
function extractSceneManifest(pkgData, date) {
  const access = pkgSceneAccess(pkgData);
  const scene = access.readJson('scene.json');
  if (!scene || !Array.isArray(scene.objects)) throw new Error('manifest: scene.json not found or invalid');
  const objs = scene.objects.filter((o) => !!o && typeof o === 'object' && typeof o.image === 'string');
  // 时间帧过滤：模型名含时间关键词的对象 >1 个 → 只留当前时段帧（昼夜变化图集跳过）
  const frameKey = timeFrameKey(date);
  const timeObjs = objs.filter((o) => TIME_FRAME_RE.test(o.image));
  let usable = objs;
  if (timeObjs.length >= 2) {
    usable = objs.filter((o) => {
      if (!TIME_FRAME_RE.test(o.image)) return true; // 非时间对象保留
      if (/昼夜变化|_anim|atlas|strip/i.test(o.image)) return false; // 图集条带跳过
      return TIME_FRAME_RE.test(o.image) && o.image.includes(frameKey);
    });
    if (!usable.length) usable = timeObjs.filter((o) => !/昼夜变化|_anim|atlas|strip/i.test(o.image));
  }
  const layers = [];
  const seen = new Set();
  const MAX_LAYERS = 24;
  for (const o of usable) {
    if (layers.length >= MAX_LAYERS) break;
    try {
      let texPath = null;
      let model = null;
      if (o.image.toLowerCase().endsWith('.tex')) {
        texPath = o.image;
      } else {
        model = access.readJson(o.image);
        if (!model || typeof model !== 'object') continue;
        const matPath = typeof model.material === 'string' ? model.material : null;
        if (matPath) {
          const mat = access.readJson(matPath);
          if (mat && Array.isArray(mat.passes)) {
            for (const pass of mat.passes) {
              if (pass && Array.isArray(pass.textures) && pass.textures.length) {
                const tn = pass.textures[0];
                texPath = String(tn).toLowerCase().endsWith('.tex')
                  ? String(tn)
                  : (matPath.includes('/') ? matPath.slice(0, matPath.lastIndexOf('/') + 1) : '') + String(tn) + '.tex';
                break;
              }
            }
          }
        }
      }
      if (!texPath) continue;
      // UI/辅助纹理跳过（提示框/赞助/粒子/遮罩等）
      if (UI_PENALTY_RE.test(o.image) || UI_PENALTY_RE.test(texPath)) continue;
      if (PATH_PENALTY_RE.test(texPath) && !/(^|[\\/])materials([\\/]|$)/i.test(texPath)) continue;
      const lower = texPath.toLowerCase();
      if (seen.has(lower)) continue;
      // 验证纹理存在且可解析（头部探测，避免把视频纹理/巨图当图层）
      const entryHead = access.readFileHead(texPath, 512);
      if (!entryHead || !entryHead.bytes || entryHead.bytes.length < 64) continue;
      let info = null;
      try { info = parseTexHeader(entryHead.bytes); } catch { /* 非 TEX 条目 */ }
      if (!info || info.isVideoMp4) continue;
      if (info.width * info.height > 100 * 1024 * 1024) continue;
      const size = parseVec(o.size);
      const origin = parseVec(o.origin);
      const scale = parseVec(o.scale);
      const par = parseVec(o.parallaxDepth);
      // ①(修正) autosize 模型：quad 尺寸 = 纹理像素尺寸 × scale（WE 语义），
      // 不能用 object.size（用户实测 Girl and Cat 人物下半身被裁剪——纹理被
      // 拉伸进错误的 quad，cropoffset 未处理导致裁掉下半身）。
      const autosize = model && model.autosize === true;
      const w = autosize ? (info.width || 0) * (scale[0] || 1) : (size[0] || 0) * (scale[0] || 1);
      const h = autosize ? (info.height || 0) * (scale[1] || 1) : (size[1] || 0) * (scale[1] || 1);
      if (!(w > 0) || !(h > 0)) continue;
      seen.add(lower);
      layers.push({
        name: o.image,
        texPath,
        x: origin[0] || 0,
        y: origin[1] || 0,
        w,
        h,
        px: par[0] || 0,
        py: par[1] || 0,
      });
    } catch { /* 单个图层失败不影响整体 */ }
  }
  if (!layers.length) throw new Error('manifest: no usable image layers');
  // 场景包围盒 → 归一化坐标
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const l of layers) {
    minX = Math.min(minX, l.x - l.w / 2);
    maxX = Math.max(maxX, l.x + l.w / 2);
    minY = Math.min(minY, l.y - l.h / 2);
    maxY = Math.max(maxY, l.y + l.h / 2);
  }
  const W = maxX - minX, H = maxY - minY;
  for (const l of layers) { l.x -= minX; l.y -= minY; }
  return { w: Math.max(1, W), h: Math.max(1, H), frameKey, layers };
}
/** 提取单个图层的 PNG（按清单里的 texPath）。 */
function extractSceneLayer(pkgData, texPath) {
  const access = pkgSceneAccess(pkgData);
  const file = access.readFile(texPath);
  if (!file) throw new Error('layer: texture not found: ' + texPath);
  const decoded = decodeTex(file.bytes);
  if (decoded.kind === 'jpeg') return { mime: 'image/jpeg', bytes: decoded.bytes };
  if (decoded.kind === 'png-pass') return { mime: 'image/png', bytes: decoded.bytes };
  return { mime: 'image/png', bytes: encodePng(decoded.width, decoded.height, decoded.rgba) };
}

// ═══════════════════════════════════════════════════════════════════════
//  scene 内嵌视频提取（scene-video 快路径，参考 elysia395 方案实证：
//  scene.pkg 作者常内嵌动画 MP4 → <video> 硬件解码播放最顺滑，优于
//  CPU 逐帧渲染/浏览器 WebGL context 实时渲染——后者实测冻结页面）。
//  视频来源两类：
//   1. TEX 容器内嵌 MP4（WE "sync" 视频纹理：TEXI 标记 isVideoMp4，或
//      mip0 直接以 MP4 ftyp box 开头）——extractTexVideoMp4
//   2. scene.pkg / 松散目录里的独立媒体文件（.mp4/.m4v/.webm/.mov）
//      ——collectSceneVideoFiles
// ═══════════════════════════════════════════════════════════════════════

const SCENE_VIDEO_EXT_RE = /\.(mp4|m4v|webm|mov)$/i;

/** 从 TEX 容器提取内嵌 MP4 负载（视频纹理），非视频返回 null。 */
function extractTexVideoMp4(raw) {
  try {
    const parsed = parseTexInternal(raw);
    if (!parsed || !parsed.mipmaps || !parsed.mipmaps.length) return null;
    if (parsed.isVideoMp4) return parsed.mipmaps[0].bytes;
    const bytes = parsed.mipmaps[0].bytes;
    if (bytes && bytes.length >= 12) {
      const boxSize = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
      if (
        boxSize >= 12 && boxSize <= bytes.length &&
        bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
      ) {
        return bytes;
      }
    }
  } catch { /* 非视频 TEX / 损坏 */ }
  return null;
}

/**
 * 在 scene 访问层里收集内嵌视频（独立媒体文件 + TEX 内嵌 MP4）。
 * access: pkgSceneAccess(pkgData) 或 dirSceneAccess(dir) 的兼容子集
 *   { list(): [{path, read(): Uint8Array}] }
 * 返回 [{ ref, bytes, isTexEmbedded }]，ref 是容器内路径。
 */
function collectSceneVideoFiles(access) {
  const videos = [];
  try {
    for (const e of access.list()) {
      const lower = String(e.path || '').toLowerCase();
      if (SCENE_VIDEO_EXT_RE.test(lower)) {
        let b = null;
        try { b = e.read(); } catch { /* 忽略 */ }
        if (b && b.length) videos.push({ ref: e.path, bytes: b, isTexEmbedded: false });
      } else if (lower.endsWith('.tex')) {
        let b = null;
        try { b = e.read(); } catch { /* 忽略 */ }
        if (!b) continue;
        const mp4 = extractTexVideoMp4(b);
        if (mp4 && mp4.length) videos.push({ ref: e.path, bytes: mp4, isTexEmbedded: true });
      }
    }
  } catch { /* 忽略 */ }
  return videos;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ①(2026-09-15 用户第 1 条反馈 ⑥c) **索引先行**的 scene 内嵌视频探测
 *
 * 旧路径（index.js `ensureSceneVideo` → `findSceneVideoInPkg`）：
 *   readFileSync(整包) → parsePkg → collectSceneVideoFiles 把**每个 .tex 整条读出并全量
 *   解析**（parseTexInternal 会把每张图、每个 mipmap 的 LZ4 全解压）→ 再按"独立视频优先 /
 *   恰好 1 条 TEX 内嵌才用"挑选。实测（真包）：hina 22.5MB ≈ 0.35s、凯尔希 69.5MB ≈ 1.0s、
 *   3470764447 320MB ≈ 0.55s、3326873240 235MB ≈ 0.48s。而客户端 `checkSceneVideo` 就在
 *   **应用壁纸的关键路径**上（4s 超时的那一步，探测完才决定静态帧还是视频）。
 *
 * 新路径：只读**目录表**（不读整包）+ 只读候选条目的**前缀**：
 *   · 独立视频条目存在 → 只读那几条（完全跳过全部 TEX，旧路径读了也会丢弃）；
 *   · TEX → 只走"头部 + 首图首 mipmap 记录"的字段，再读载荷前 12 字节判 ftyp
 *     （mip0 是 LZ4 时只解压第一个 sequence，不碰其余 mipmap/图像）。
 * 选择规则与旧路径**逐项一致**（独立视频取 bytes 最长；否则"恰好 1 条 TEX 内嵌"才采用，
 * 多条 = 时间变化 → null）。**任何不确定的情况一律回退整条读**（walk 失败 / 前缀不够 /
 * 条目级 LZ4 → 走原函数），所以最坏情况只是"和旧路径一样慢"，不会给出不同答案。
 * ═══════════════════════════════════════════════════════════════════════════ */

const TEX_PEEK_BYTES = 96 * 1024;        // 头部 + 首 mipmap 记录 + 载荷前缀（LZ4 只解压首段）
const TEX_LZ4_PREFIX_BYTES = 64 * 1024;  // mip0 为 LZ4 时最多读这么多压缩字节来取前 12 字节

/** 只解压 LZ4 流的前 want 字节（不要求 dstSize 精确：够嗅探即停）。
 *  与 lz4DecompressBlock 同一套 sequence 规则，只是**提前返回**。 */
function lz4Prefix(src, want) {
  const dst = new Uint8Array(want);
  let ip = 0; let op = 0;
  while (ip < src.length && op < want) {
    const token = src[ip++];
    let literalLength = token >> 4;
    if (literalLength === 15) {
      let s = 0;
      do { if (ip >= src.length) return null; s = src[ip++]; literalLength += s; } while (s === 255);
    }
    if (ip + literalLength > src.length) {
      // 字面量段被截断（只读到了前 64KB 压缩数据）：前若干字节仍是原样的载荷前缀，
      // 够 want 就直接返回（LZ4 HC 的首段常是整块字面量，这条是"能判就判"的关键）。
      const take = Math.min(src.length - ip, want - op);
      if (take > 0) { dst.set(src.subarray(ip, ip + take), op); op += take; }
      return op >= want ? dst : null;
    }
    const take = Math.min(literalLength, want - op);
    dst.set(src.subarray(ip, ip + take), op);
    ip += literalLength; op += take;
    if (op >= want) return dst;
    if (ip >= src.length) break;
    if (ip + 2 > src.length) return null;
    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (offset === 0 || offset > op) return null;
    let matchLength = token & 15;
    if (matchLength === 15) {
      let s = 0;
      do { if (ip >= src.length) return null; s = src[ip++]; matchLength += s; } while (s === 255);
    }
    matchLength += 4;
    for (let i = 0; i < matchLength && op < want; i++) { dst[op] = dst[op - offset]; op++; }
  }
  return op >= want ? dst : null;
}

/** TEX 头部 + **首图首 mipmap** 记录的字段走位（不碰其余图像/mipmap 的载荷）。
 *  字段顺序与 parseTexInternal 逐条对齐；任何不符合预期一律抛错（调用方回退整条读）。 */
function walkTexFirstMipmap(b) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 0;
  const nstr = (max) => {
    const start = p;
    const limit = Math.min(b.length, start + max);
    while (p < limit && b[p] !== 0) p++;
    if (p >= limit) throw new Error('tex: unterminated string');
    const out = textDecoder.decode(b.subarray(start, p));
    p += 1;
    return out;
  };
  const i32 = () => { if (p + 4 > b.length) throw new Error('tex: short'); const v = view.getInt32(p, true); p += 4; return v; };
  const u32 = () => { if (p + 4 > b.length) throw new Error('tex: short'); const v = view.getUint32(p, true); p += 4; return v; };
  if (nstr(16) !== 'TEXV0005') throw new Error('tex: bad magic');
  if (nstr(16) !== 'TEXI0001') throw new Error('tex: bad image-info magic');
  const format = i32();
  i32(); i32(); i32(); i32(); i32(); u32();
  if (TEX_FORMAT_NAMES[format] === undefined) throw new Error('tex: unsupported format');
  const cm = /^TEXB000([1-4])$/.exec(nstr(16));
  if (!cm) throw new Error('tex: bad mipmap container magic');
  let version = Number(cm[1]);
  const imageCount = i32();
  if (imageCount <= 0 || imageCount > 256) throw new Error('tex: invalid image count');
  let videoFlag = false;
  if (version === 3) i32();
  else if (version === 4) {
    const freeImageFormat = i32();
    videoFlag = i32() === 1;
    if (!(freeImageFormat === -1 && videoFlag)) version = 3;
  }
  const mipmapCount = i32();
  if (mipmapCount <= 0 || mipmapCount > 32) throw new Error('tex: invalid mipmap count');
  if (version === 4) {
    const a = i32(); const bb = i32(); nstr(1 << 20); const c = i32();
    if (!(a === 1 && bb === 2 && c === 1)) throw new Error('tex: bad TEXB0004 mipmap params');
  }
  const width = i32();
  const height = i32();
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384) throw new Error('tex: invalid mipmap dimensions');
  if (version === 1) {
    const len = i32();
    if (len < 0) throw new Error('tex: bad mip len');
    return { version, videoFlag, isLz4: false, payloadOff: p, payloadLen: len, storedLen: len };
  }
  const isLz4 = i32() === 1;
  const decompressedCount = i32();
  const storedLen = i32();
  // 与 readMipmap 同口径：非 LZ4 的 mipmap 里 decompressedCount 是**未使用字段**（实测为 0），
  // 不能当成错误；只有 isLz4 时它才是解压后长度（≤0 时旧解析必抛 → 交回退处理）。
  if (storedLen < 0 || (isLz4 && decompressedCount <= 0)) throw new Error('tex: bad mip sizes');
  return { version, videoFlag, isLz4, payloadOff: p, payloadLen: isLz4 ? decompressedCount : storedLen, storedLen };
}

/** 一个 TEX 条目是否为内嵌 MP4：'video' | 'none' | 'unknown'（unknown → 调用方整条读兜底）。
 *  readAt(off, len) 读**条目内相对偏移** off 的字节（可为 null）；prefetch 是 [0, n) 的前缀。 */
function probeTexVideoDecision(readAt, prefetch, entryLabel) {
  const info = (() => { try { return walkTexFirstMipmap(prefetch); } catch { return null; } })();
  if (!info) return 'unknown';
  if (info.videoFlag) return 'video';            // TEXB0004 显式视频标志（旧路径据此直接取 mip0）
  let prefix = null;
  if (!info.isLz4) {
    prefix = readAt(info.payloadOff, 12);
  } else {
    const want = Math.min(info.storedLen, TEX_LZ4_PREFIX_BYTES);
    const stored = readAt(info.payloadOff, want);
    if (stored && stored.length) prefix = lz4Prefix(stored, Math.min(12, info.payloadLen));
  }
  if (!prefix || prefix.length < 12) return 'unknown';
  const boxSize = (prefix[0] << 24) | (prefix[1] << 16) | (prefix[2] << 8) | prefix[3];
  // 与 extractTexVideoMp4 的 ftyp 分支同条件（含 boxSize <= 载荷长度）
  if (boxSize >= 12 && boxSize <= info.payloadLen &&
      prefix[4] === 0x66 && prefix[5] === 0x74 && prefix[6] === 0x79 && prefix[7] === 0x70) return 'video';
  return 'none';
}

/** 进程内 scene 视频索引缓存（键 = 路径 + mtimeMs + size，与音频索引同款口径）。
 *
 *  ①(2026-09-23 资源审计 #1，docs/RESOURCE-AUDIT-20260923.md §2.1) 这个缓存里躺着的是
 *  **整段视频字节**（`video.bytes`，真机单条 30–150MB），而原来只有"条数 64"一道闸门
 *  ⇒ 宿主的常驻内存 = Σ(被缓存视频体积)，最坏 64 × 单条体积（数 GB 级），且只增不减。
 *  现在三道闸门 + 两条"只增不减"的解药：
 *   · 字节预算 `MAX_BYTES`（默认 **64MB**，与 `lib/index.js` 的 `mpkgPreviewCache` 48MB /
 *     `sceneFrameCache` 96MB 同一量级；本机总内存 15GB、可用 ~4GB，够用又不至于把堆顶满）；
 *   · 单条上限 `MAX_ITEM_BYTES = MAX_BYTES / 2`——一条就能吃光预算的条目**不入缓存**
 *     （仍正常返回给调用方，由调用方落盘），与 `index.js` 的 `SCENE_FRAME_MAX_ITEM_BYTES` 同款纪律；
 *   · 条数上限 `MAX_ITEMS`（原 `SCENE_VIDEO_SCAN_CACHE_MAX = 64`，保留，但不再是唯一闸门）；
 *   · **逐出**：超预算/超条数按 LRU（Map 插入序，命中即重插到末尾）逐出；逐出 = `Map.delete`
 *     ——那就是缓存对 `bytes` 的**唯一强引用**，删掉即让 GC 能收。**不**在逐出时就地
 *     `bytes = null`：调用方（或测试）可能仍持有同一个 video 对象，就地改写会把它的数据抽走。
 *   · **读前腾位置**：整条读进堆**之前**先按预测字节腾位置（`sceneVideoCacheMakeRoom`），
 *     避免"先整段读进来、再淘汰旧条目"造成的瞬时双倍峰值。
 *   · **时间戳过期**：每条记录带 `at`（最后访问），超过 `TTL_MS` 在下次访问时清掉。
 *
 *  预算可用环境变量 `MPW_SCENE_VIDEO_CACHE_BYTES` 覆盖（门禁要在 1MB 预算下秒级验证逐出；
 *  与 `lib/index.js` 的 `DSH_WE_*` 环境变量同一惯例），下限 1MB / 上限 1GB 防手滑。
 *  真实调用点：`lib/index.js` `ensureSceneVideo()` 换 scene 目录时调 `clearSceneVideoScanCache()`。 */
const sceneVideoScanCache = new Map();
const SCENE_VIDEO_SCAN_CACHE_MAX_ITEMS = 64;
const SCENE_VIDEO_SCAN_CACHE_MAX_BYTES = Math.min(1024 * 1024 * 1024,
  Math.max(1024 * 1024, Number(process.env.MPW_SCENE_VIDEO_CACHE_BYTES) || 64 * 1024 * 1024));
const SCENE_VIDEO_SCAN_CACHE_MAX_ITEM_BYTES = Math.floor(SCENE_VIDEO_SCAN_CACHE_MAX_BYTES / 2);
const SCENE_VIDEO_SCAN_CACHE_TTL_MS = 10 * 60 * 1000;
let sceneVideoScanBytes = 0;
const sceneVideoScanCounters = { hits: 0, misses: 0, entriesRead: 0, bytesRead: 0,
  evictions: 0, preReadEvictions: 0, oversize: 0, expired: 0 };
function sceneVideoScanStats() {
  return { entries: sceneVideoScanCache.size, bytes: sceneVideoScanBytes,
    hits: sceneVideoScanCounters.hits,
    misses: sceneVideoScanCounters.misses, entriesRead: sceneVideoScanCounters.entriesRead,
    bytesRead: sceneVideoScanCounters.bytesRead, maxEntries: SCENE_VIDEO_SCAN_CACHE_MAX_ITEMS,
    // ①(2026-09-23 审计 #1) 新增字段（既有字段一个没动）：bytes 让"已驻留字节"可见
    // （审计 U2 说原来只能看条数、看不到字节），evictions/preReadEvictions/oversize/expired 让
    // "为什么没驻留"可归因（oversize = 单条超上限未入缓存；expired = 过了 TTL 被清）。
    maxBytes: SCENE_VIDEO_SCAN_CACHE_MAX_BYTES, maxItemBytes: SCENE_VIDEO_SCAN_CACHE_MAX_ITEM_BYTES,
    ttlMs: SCENE_VIDEO_SCAN_CACHE_TTL_MS,
    evictions: sceneVideoScanCounters.evictions, preReadEvictions: sceneVideoScanCounters.preReadEvictions,
    oversize: sceneVideoScanCounters.oversize, expired: sceneVideoScanCounters.expired };
}
/** 缓存快照（诊断 / 门禁用）：只报"缓存**现在**真持有什么"。
 *  ①(2026-09-23 审计 #1) 带 `video` 活引用是为了能证明"逐出后旧引用不再被缓存持有"；
 *  也正因为它持活引用，**不要**直接塞进 `/diag` 的 JSON（不可序列化），要走也只取数值字段。 */
function sceneVideoScanCacheSnapshot() {
  const out = [];
  for (const [key, rec] of sceneVideoScanCache) {
    out.push({ key, bytes: rec.bytes || 0, at: rec.at || 0, video: rec.video || null,
      indexEntries: rec.indexEntries });
  }
  return out;
}
/** 逐出 Map 头部（= 最久未访问）那一条。返回是否真的逐出了。 */
function sceneVideoCacheDropOldest() {
  const key = sceneVideoScanCache.keys().next().value;
  if (key === undefined) return false;
  const rec = sceneVideoScanCache.get(key);
  sceneVideoScanBytes -= (rec && rec.bytes) || 0;
  sceneVideoScanCache.delete(key);
  return true;
}
/** 超预算 / 超条数 ⇒ 逐出到合规。`size > 1` 的护栏与 `mpkgPreviewCache`/`sceneFrameCache` 同款；
 *  因为单条上限 ≤ 预算的一半，"只剩一条"时字节数必然仍 ≤ 预算，不会漏出闸门。 */
function sceneVideoCacheEvict() {
  while ((sceneVideoScanBytes > SCENE_VIDEO_SCAN_CACHE_MAX_BYTES ||
          sceneVideoScanCache.size > SCENE_VIDEO_SCAN_CACHE_MAX_ITEMS) &&
         sceneVideoScanCache.size > 1) {
    if (!sceneVideoCacheDropOldest()) break;
    sceneVideoScanCounters.evictions++;
  }
}
/** 【整条读之前】按预测字节腾位置。`predicted` 是上界（文件/条目 size，TEX 内嵌的 mp4 只会更小）。
 *  预测 > 单条上限 ⇒ 本次结果**不会**入缓存，此时**不动**现有条目（否则"浏览大视频"会把
 *  小视频的缓存白白清空，缓存等于没有）；代价是这一读的瞬时峰值 = 现缓存(≤预算) + 本条视频，
 *  仍有界。返回 true = 本次预测有可能入缓存。 */
function sceneVideoCacheMakeRoom(predicted) {
  if (!(predicted > 0) || predicted > SCENE_VIDEO_SCAN_CACHE_MAX_ITEM_BYTES) return false;
  while (sceneVideoScanBytes + predicted > SCENE_VIDEO_SCAN_CACHE_MAX_BYTES &&
         sceneVideoScanCache.size > 0) {
    if (!sceneVideoCacheDropOldest()) break;
    sceneVideoScanCounters.preReadEvictions++;
  }
  return true;
}
/** 落缓存：先减掉同键旧记录，再按单条上限决定"入/不入"，最后统一逐出到合规。 */
function sceneVideoCacheSet(key, video, indexEntries) {
  const prev = sceneVideoScanCache.get(key);
  if (prev) { sceneVideoScanBytes -= prev.bytes || 0; sceneVideoScanCache.delete(key); }
  const len = (video && video.bytes && video.bytes.length) || 0;
  if (len > SCENE_VIDEO_SCAN_CACHE_MAX_ITEM_BYTES || len > SCENE_VIDEO_SCAN_CACHE_MAX_BYTES) {
    sceneVideoScanCounters.oversize++;   // 单条过大 ⇒ 不入缓存（结果照常返回给调用方落盘）
  } else {
    sceneVideoScanCache.set(key, { video, indexEntries, bytes: len, at: Date.now() });
    sceneVideoScanBytes += len;
  }
  sceneVideoCacheEvict();
}
/** 访问时按时间戳清过期条目（宿主长驻时，"好久没人要"的场景字节不再一直挂着）。 */
function sceneVideoCacheSweep(now) {
  if (!sceneVideoScanCache.size) return;
  for (const [key, rec] of sceneVideoScanCache) {
    if (now - (rec.at || 0) > SCENE_VIDEO_SCAN_CACHE_TTL_MS) {
      sceneVideoScanBytes -= rec.bytes || 0;
      sceneVideoScanCache.delete(key);
      sceneVideoScanCounters.expired++;
    }
  }
}
function clearSceneVideoScanCache() {
  sceneVideoScanCache.clear();
  sceneVideoScanBytes = 0;
  sceneVideoScanCounters.hits = 0; sceneVideoScanCounters.misses = 0;
  sceneVideoScanCounters.entriesRead = 0; sceneVideoScanCounters.bytesRead = 0;
  sceneVideoScanCounters.evictions = 0; sceneVideoScanCounters.preReadEvictions = 0;
  sceneVideoScanCounters.oversize = 0; sceneVideoScanCounters.expired = 0;
}

/** 在 [dir] 内按旧口径遍历（深度 ≤4、跳过点目录）。**两遍**：先独立视频文件（有就直接用
 *  最大的那条，完全跳过 TEX），再 .tex（只读前缀判 ftyp，判定 'none' 不整条读；
 *  已确认 2 条内嵌视频即可停——多条 = 时间变化 → 结果必为 null）。 */
function scanSceneVideoDir(dir, opts, stats) {
  const listFiles = (pred) => {
    const out = [];
    const walk = (sub, depth) => {
      if (depth > 4) return;
      let names = [];
      try { names = readdirSync(sub === '' ? dir : join(dir, sub)); } catch { return; }
      for (const name of names) {
        const rel = sub === '' ? name : sub + '/' + name;
        let st = null;
        try { st = statSync(join(dir, rel)); } catch { continue; }
        if (st.isDirectory()) { if (!name.startsWith('.')) walk(rel, depth + 1); continue; }
        if (!st.isFile()) continue;
        if (pred(rel.toLowerCase())) out.push({ rel, size: st.size });
      }
    };
    walk('', 0);
    return out;
  };
  const useCache = opts.cache !== false;
  // ①(2026-09-23 审计 #1) `predicted` = 上界（stat 出来的文件体积；TEX 内嵌的 mp4 只会更小）：
  //   整条读**之前**先腾位置，别等读完再淘汰旧条目。
  const readFull = (rel, predicted) => {
    try {
      if (useCache) sceneVideoCacheMakeRoom(predicted);
      const b = new Uint8Array(readFileSync(join(dir, rel)));
      stats.entriesRead++; stats.bytesRead += b.length;
      return b;
    } catch { return null; }
  };
  const standalone = [];
  for (const f of listFiles((n) => SCENE_VIDEO_EXT_RE.test(n))) {
    const b = readFull(f.rel, f.size);
    if (b && b.length) standalone.push({ ref: f.rel, bytes: b, isTexEmbedded: false });
  }
  if (standalone.length) {
    standalone.sort((a, b) => (b.bytes.length || 0) - (a.bytes.length || 0));
    return standalone[0];
  }
  const texVideos = [];
  for (const f of listFiles((n) => n.endsWith('.tex'))) {
    let pre = null;
    try {
      const n = Math.min(f.size, TEX_PEEK_BYTES);
      if (n > 0) {
        const buf = Buffer.allocUnsafe(n);
        const fd = openSync(join(dir, f.rel), 'r');
        try { const got = readSync(fd, buf, 0, n, 0); pre = got === n ? buf : buf.subarray(0, got); }
        finally { closeSync(fd); }
        stats.bytesRead += pre.length;
      }
    } catch { pre = null; }
    const decision = pre && pre.length ? probeTexVideoDecision((off, len) => {
      if (off + len > pre.length) return null;
      return pre.subarray(off, off + len);
    }, pre, f.rel) : 'unknown';
    if (decision === 'none') continue;
    const b = readFull(f.rel, f.size);
    if (!b) continue;
    const mp4 = extractTexVideoMp4(b);
    if (mp4 && mp4.length) texVideos.push({ ref: f.rel, bytes: mp4, isTexEmbedded: true });
    if (texVideos.length >= 2) break;   // 已确认 ≥2 条 → 旧规则必为 null，其余不必再读
  }
  return texVideos.length === 1 ? texVideos[0] : null;
}

/**
 * 索引先行的 scene 内嵌视频探测（scene.pkg 文件或松散目录）。
 * 返回 { video: {ref, bytes, isTexEmbedded} | null, source, cacheHit, indexEntries,
 *        entriesRead, bytesRead, tableBytes, ms }
 * video 与旧路径（collectSceneVideoFiles + findSceneVideoInPkg / findSceneVideoInDir）
 * 的选择结果**逐项一致**。
 */
function scanSceneVideo(dirOrPath, opts = {}) {
  const st0 = statSync(dirOrPath);
  const isDir = st0.isDirectory();
  const pkgPath = isDir ? join(dirOrPath, 'scene.pkg') : dirOrPath;
  const target = isDir && !existsSync(pkgPath) ? dirOrPath : pkgPath;
  const source = target === pkgPath ? 'pkg' : 'dir';
  const st = statSync(target);
  const key = target + '|' + st.mtimeMs + '|' + st.size + '|' + source;
  const useCache = opts.cache !== false;
  // ①(2026-09-23 审计 #1) 访问时先按时间戳清过期条目（本键的旧记录也在此被顺带清掉）。
  if (useCache) sceneVideoCacheSweep(Date.now());
  const hit = useCache ? sceneVideoScanCache.get(key) : null;
  if (hit) {
    sceneVideoScanCounters.hits++;
    hit.at = Date.now();
    sceneVideoScanCache.delete(key); sceneVideoScanCache.set(key, hit);
    return { video: hit.video, source, cacheHit: true, indexEntries: hit.indexEntries, entriesRead: 0, bytesRead: 0 };
  }
  sceneVideoScanCounters.misses++;
  const t0 = process.hrtime.bigint();
  let video = null;
  let indexEntries = 0;
  let entriesRead = 0;
  let bytesRead = 0;
  if (source === 'dir') {
    const stats = { entriesRead: 0, bytesRead: 0 };
    // scanSceneVideoDir 内部已按旧规则挑好（独立视频优先取最大；否则恰好 1 条 TEX 内嵌）
    video = scanSceneVideoDir(target, opts, stats);
    entriesRead = stats.entriesRead; bytesRead = stats.bytesRead;
    indexEntries = video ? 1 : 0;
  } else {
    const idx = readPkgIndexFromFile(pkgPath, opts);
    indexEntries = idx.entries.length;
    bytesRead += idx.headBytes;
    // 与旧口径对齐：parsePkg 对"任一条目越界"是**硬抛**（→ ensureSceneVideo 记无视频）。
    // 新路径容忍截断（partial），所以这里显式补上同一道闸门：越界则抛，由调用方回退整包口径。
    if (idx.entries.some((e) => e.offset < 0 || e.offset + (e.compressedSize == null ? e.size : e.compressedSize) > idx.fileSize)) {
      throw new Error('pkg: entry out of bounds（回退整包口径）');
    }
    const fd = openSync(pkgPath, 'r');
    try {
      const readEntry = (e) => {
        try {
          if (useCache) sceneVideoCacheMakeRoom(e.compressedSize == null ? e.size : e.compressedSize);
          const stored = Buffer.allocUnsafe(e.compressedSize == null ? e.size : e.compressedSize);
          const got = readSync(fd, stored, 0, stored.length, Math.max(0, e.offset));
          bytesRead += got; entriesRead++;
          const buf = got === stored.length ? stored : stored.subarray(0, got);
          if (e.flags & 1) {
            const w = { path: e.path, offset: 0, compressedSize: buf.length, size: e.size, flags: 1 };
            return readPkgEntry(buf, w);
          }
          return new Uint8Array(buf);
        } catch { return null; }
      };
      // ① 独立视频条目：只读它们（旧路径读了全部 TEX 也会丢弃这些结果）
      const standaloneEntries = idx.entries.filter((e) => SCENE_VIDEO_EXT_RE.test(String(e.path || '').toLowerCase()));
      const standalone = [];
      for (const e of standaloneEntries) {
        const b = readEntry(e);
        if (b && b.length) standalone.push({ ref: e.path, bytes: b, isTexEmbedded: false });
      }
      if (standalone.length) {
        standalone.sort((a, b) => (b.bytes.length || 0) - (a.bytes.length || 0));
        video = standalone[0];
      } else {
        // ② TEX：先前缀判定，只有 'video'/'unknown' 才整条读
        const texEntries = idx.entries.filter((e) => String(e.path || '').toLowerCase().endsWith('.tex'));
        const found = [];
        for (const e of texEntries) {
          let pre = null;
          try {
            const storedLen = e.compressedSize == null ? e.size : e.compressedSize;
            const n = Math.min(storedLen, TEX_PEEK_BYTES);
            if (n > 0) {
              const buf = Buffer.allocUnsafe(n);
              const got = readSync(fd, buf, 0, n, Math.max(0, e.offset));
              bytesRead += got;
              let head = got === n ? buf : buf.subarray(0, got);
              if (e.flags & 1) {
                // 条目级 LZ4：只解压前缀（readPkgEntryHead 逐块解压到够用为止）
                const w = { path: e.path, offset: 0, compressedSize: head.length, size: e.size, flags: 1 };
                try { head = readPkgEntryHead(head, w, TEX_PEEK_BYTES); } catch { head = null; }
              }
              pre = head;
            }
          } catch { pre = null; }
          if (!pre || !pre.length) { /* 前缀读不到 → 走整条读兜底 */ }
          const decision = pre && pre.length ? probeTexVideoDecision((off, len) => {
            if (off + len > pre.length) return null;
            return pre.subarray(off, off + len);
          }, pre, e.path) : 'unknown';
          if (decision === 'none') continue;
          const b = readEntry(e);
          if (!b) continue;
          const mp4 = extractTexVideoMp4(b);
          if (mp4 && mp4.length) found.push({ ref: e.path, bytes: mp4, isTexEmbedded: true });
          if (found.length >= 2) break;   // 已确认 ≥2 条 → 旧规则必为 null，其余 TEX 不必再读
        }
        if (found.length === 1) video = found[0];
      }
    } finally { closeSync(fd); }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  sceneVideoScanCounters.entriesRead += entriesRead;
  sceneVideoScanCounters.bytesRead += bytesRead;
  // ①(2026-09-23 审计 #1) 入缓存走统一闸门：字节记账 + 单条上限 + LRU/条数逐出（原来是裸 set +
  //   只按条数淘汰，整段视频字节因此无上限常驻）。
  if (useCache) sceneVideoCacheSet(key, video, indexEntries);
  return { video, source, cacheHit: false, indexEntries, entriesRead, bytesRead, tableBytes: source === 'pkg' ? undefined : 0, ms };
}

export { extractSceneMainImage, extractSceneMainImageFromDir, extractSceneManifest, extractSceneLayer, extractTexVideoMp4, collectSceneVideoFiles, parsePkg, readPkgEntry, parseTex, PKG_MAGIC_RE };
// ①(2026-09-15 音频扫描提速 / 2026-09-16 洁净室重写) 惰性音频索引：只读目录表 + 仅候选头 ≤16 字节。
//   名字与结构依据 docs/AUDIO-TRACK-SPEC.md（后缀判定 / 容器判定 / 枚举核心里外三层）。
export {
  isAudioPath, suffixAudioMime, sniffAudioMime, audioMimeFor, AUDIO_SUFFIX_MIME, AUDIO_CONTAINER_RULES,
  parsePkgIndex, readPkgIndexFromFile, enumerateAudioTracks, collectDirAudioTracks,
  scanSceneAudio, clearPkgAudioIndexCache, pkgAudioIndexStats,
};
// ①(2026-09-15 用户第 1 条反馈 ⑥c) 索引先行的 scene 内嵌视频探测（选择规则与旧路径逐项一致）。
//   ①(2026-09-23 资源审计 #1) 追加 `sceneVideoScanCacheSnapshot`（字节预算/逐出的可取证明）。
export {
  scanSceneVideo, sceneVideoScanStats, sceneVideoScanCacheSnapshot, clearSceneVideoScanCache,
  probeTexVideoDecision, walkTexFirstMipmap, lz4Prefix,
};

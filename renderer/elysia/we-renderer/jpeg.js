// WE 渲染引擎 — baseline JPEG 解码 (TEX 内嵌照片纹理)
// 支持 SOF0/SOF1 (baseline/extended sequential), 4:4:4 / 4:2:2 / 4:2:0 采样,
// 完整 Huffman + 反量化 + 浮点 IDCT + YCbCr→RGB, restart markers (RST0-7).
// 输入为完整 JPEG 字节 (FF D8 起), 输出 { width, height, rgba }.

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
];

// 预计算 8 点 IDCT 矩阵: M[x][u] = C(u)/2 * cos((2x+1)u*PI/16)
const IDCT_M = (() => {
  const m = [];
  for (let x = 0; x < 8; x++) {
    const row = [];
    for (let u = 0; u < 8; u++) {
      const c = u === 0 ? Math.SQRT1_2 : 1;
      row.push(0.5 * c * Math.cos(((2 * x + 1) * u * Math.PI) / 16));
    }
    m.push(row);
  }
  return m;
})();

// [P-67 提速] 复用临时缓冲 (idct2d 顺序调用、结果随即拷入平面, 无重入)
const IDCT_TMP = new Float64Array(64);
const IDCT_OUT = new Float64Array(64);
function idct2d(block /* Float64Array 64, zigzag order 已重排到自然序 */) {
  // 行列分离: tmp[x][v] = sum_u M[x][u] * block[u][v]; out[x][y] = sum_v tmp[x][v] * M[y][v]
  const tmp = IDCT_TMP;
  const out = IDCT_OUT;
  for (let x = 0; x < 8; x++) {
    for (let v = 0; v < 8; v++) {
      let s = 0;
      const mx = IDCT_M[x];
      for (let u = 0; u < 8; u++) s += mx[u] * block[u * 8 + v];
      tmp[x * 8 + v] = s;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0;
      const my = IDCT_M[y];
      for (let v = 0; v < 8; v++) s += tmp[x * 8 + v] * my[v];
      out[x * 8 + y] = s;
    }
  }
  return out;
}

// 位读取器 (大端), 处理 FF00 填充与 RST restart
// [P-67 修复] 旧实现在 0xFF 0x00 处 `continue`, 把**数据字节 0xFF 本身丢了**
// (JPEG B.1.1.5: 熵流里的 0xFF 编码为 FF 00, 解码时 00 是填充、FF 是数据),
// 每遇一次就少喂 8 bit → 位流错位 → DC 预测器发散 → 顶部若干 MCU 行正常、
// 其余近黑/花屏, 且**不报错**。三份真机截图与 2 张 FIF=JPEG 贴图实证。
class BitReader {
  constructor(bytes, start) {
    this.b = bytes;
    this.pos = start;
    this.bitBuf = 0;
    this.bitCnt = 0;
    this.restartPending = undefined; // 读到 RST 时 = 0..7
    this.restartPos = -1;            // RST 标记 0xFF 所在偏移
    this.outOfData = false;          // 位流提前耗尽 (字节用尽/撞到非 RST 标记)
  }
  // 读 n 位 (n<=16); 0xFF 后 0x00 为填充 (数据即 0xFF), D0-D7 为 restart (停止, 外层处理)
  read(n) {
    while (this.bitCnt < n) {
      if (this.pos >= this.b.length) { this.outOfData = true; break; }
      let byte = this.b[this.pos++];
      if (byte === 0xff) {
        if (this.pos >= this.b.length) { this.pos = this.b.length; this.outOfData = true; break; }
        let nxt = this.b[this.pos++];
        while (nxt === 0xff && this.pos < this.b.length) nxt = this.b[this.pos++]; // 标记前填充字节
        if (nxt === 0x00) {
          byte = 0xff; // 填充: 数据字节就是 0xFF (旧实现丢了它 —— 根因)
        } else if (nxt >= 0xd0 && nxt <= 0xd7) {
          this.pos -= 2;
          this.restartPos = this.pos;
          this.restartPending = nxt - 0xd0;
          break;
        } else {
          this.pos -= 2;
          this.outOfData = true; // EOI/SOS/DHT 等真标记: 熵流到此为止
          break;
        }
      }
      this.bitBuf = (this.bitBuf << 8) | byte;
      this.bitCnt += 8;
    }
    if (this.bitCnt < n) {
      // 数据不足 (restart 或 EOF): 返回已攒到的位并左对齐补 0。
      // 调用方在 restart/耗尽情形下会丢弃该值 (读到位流尽头一律判截断)。
      const got = this.bitCnt;
      const v = got > 0 ? this.bitBuf & ((1 << got) - 1) : 0;
      this.bitCnt = 0;
      this.bitBuf = 0;
      return v << (n - got);
    }
    this.bitCnt -= n;
    return (this.bitBuf >>> this.bitCnt) & ((1 << n) - 1);
  }
  peek(n) {
    while (this.bitCnt < n) {
      if (this.pos >= this.b.length) { this.outOfData = true; break; }
      let byte = this.b[this.pos++];
      if (byte === 0xff) {
        if (this.pos >= this.b.length) { this.pos = this.b.length; this.outOfData = true; break; }
        let nxt = this.b[this.pos++];
        while (nxt === 0xff && this.pos < this.b.length) nxt = this.b[this.pos++];
        if (nxt === 0x00) byte = 0xff;
        else if (nxt >= 0xd0 && nxt <= 0xd7) { this.pos -= 2; this.restartPos = this.pos; this.restartPending = nxt - 0xd0; break; }
        else { this.pos -= 2; this.outOfData = true; break; }
      }
      this.bitBuf = (this.bitBuf << 8) | byte;
      this.bitCnt += 8;
    }
    return this.bitCnt >= n ? (this.bitBuf >>> (this.bitCnt - n)) & ((1 << n) - 1) : -1;
  }
  skip(n) {
    while (n > 0) {
      if (this.bitCnt === 0) {
        if (this.pos >= this.b.length) { this.outOfData = true; break; }
        let byte = this.b[this.pos++];
        if (byte === 0xff) {
          if (this.pos >= this.b.length) { this.pos = this.b.length; this.outOfData = true; break; }
          let nxt = this.b[this.pos++];
          while (nxt === 0xff && this.pos < this.b.length) nxt = this.b[this.pos++];
          if (nxt === 0x00) byte = 0xff;
          else if (nxt >= 0xd0 && nxt <= 0xd7) { this.pos -= 2; this.restartPos = this.pos; this.restartPending = nxt - 0xd0; break; }
          else { this.pos -= 2; this.outOfData = true; break; }
        }
        this.bitBuf = byte;
        this.bitCnt = 8;
      }
      const take = Math.min(n, this.bitCnt);
      this.bitBuf = (this.bitBuf << take) & 0xff;
      this.bitCnt -= take;
      n -= take;
    }
  }
  atRestart() {
    return this.restartPending != null;
  }
  // [P-67 修复] 旧实现只清位缓冲、**不跳过 RST 标记本身** → pos 永远停在 0xFF 上,
  // 之后每个 read() 都再次撞到同一个 RST, 熵解码从此全垃圾 (无 DRI 时不会触发,
  // 带 DRI 的 JPEG 必坏). 现改为 libjpeg process_restart 语义: 定位到 RSTn 之后。
  consumeRestart() {
    this.syncToRestart();
  }
  // 跳到下一个 RSTn 标记之后, 清空位缓冲 (调用方需同时复位 DC 预测器)
  syncToRestart() {
    let p;
    if (this.restartPending != null && this.restartPos >= 0) {
      p = this.restartPos + 2; // read() 已探到标记, 本次只需跨过它
    } else {
      p = this.pos;
      while (p + 1 < this.b.length) {
        if (this.b[p] !== 0xff) { p++; continue; }
        const m = this.b[p + 1];
        if (m === 0x00) { p += 2; continue; }        // 熵流里被填充的 0xFF 数据
        if (m >= 0xd0 && m <= 0xd7) { p += 2; break; } // RSTn
        break;                                        // 其他标记: 没有 RST 可对齐
      }
      if (p + 1 >= this.b.length) p = this.b.length;
    }
    this.pos = p;
    this.bitCnt = 0;
    this.bitBuf = 0;
    this.restartPending = undefined;
    this.restartPos = -1;
  }
}

// Huffman 表: counts[16] + symbols[] → 解码
function buildHuffTable(counts, symbols) {
  // 标准 JPEG 规范附录 C 的 canonical 码: 同时导出 mincode/maxcode/valptr 供 O(1) 查表
  // [P-67 提速] 旧实现每读 1 bit 就线性扫全表 (4:4:4 大图 155 符号 × 每系数 10+ 次) → 3897x2400
  // 贴图要 8.9 s; 改 min/maxcode 后见 PATCHES.md P-67 的测时。
  const table = [];
  const mincode = new Int32Array(17);
  const maxcode = new Int32Array(17).fill(-1);
  const valptr = new Int32Array(17).fill(-1);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    const n = counts[len - 1];
    for (let i = 0; i < n; i++) {
      table.push({ code, len, symbol: symbols[k++] });
      code++;
    }
    if (n > 0) { mincode[len] = code - n; maxcode[len] = code - 1; valptr[len] = k - n; }
    code <<= 1;
  }
  table._mincode = mincode;
  table._maxcode = maxcode;
  table._valptr = valptr;
  table._symbols = symbols;
  return table;
}

function huffDecode(reader, table) {
  let code = 0;
  let len = 0;
  const maxLen = table._maxLen;
  const mincode = table._mincode;
  const maxcode = table._maxcode;
  const valptr = table._valptr;
  const syms = table._symbols;
  for (;;) {
    const bit = reader.read(1);
    if (reader.restartPending != null) return -1; // restart 打断
    code = (code << 1) | bit;
    len++;
    if (len > 16) throw new Error('jpeg: huffman code overflow');
    const mx = maxcode[len];
    if (code <= mx && code >= mincode[len]) return syms[valptr[len] + code - mincode[len]];
    // 未定义码 (熵流与码表不匹配, 非标准 JPEG): 模拟 libjpeg fake-huffman
    // (插入 1 位保持同步), 返回 -2 由调用方按无效系数处理; 标准 JPEG 的
    // 前缀码表在 maxLen 内必匹配, 不会走到这里 — 花壁纸 2934788040 背景
    // JPEG 实证 (熵流 28 a2 80 0a 周期重复, sharp/Windows 解出全 0 黑).
    if (len >= maxLen) return -2;
  }
}

// 读 1-16 位差值 (DC/AC 幅度): 值为 v, 若 v < 2^(n-1) 则 v -= 2^n - 1
function readSigned(reader, n) {
  if (n === 0) return 0;
  if (n < 0 || n > 16) throw new Error('jpeg: bad magnitude bits ' + n);
  let v = reader.read(n);
  if (reader.restartPending != null) return 0;
  if (v < (1 << (n - 1))) v -= (1 << n) - 1;
  return v;
}

export function decodeJpeg(bytes) {
  // [P-67] 不再吞异常: 旧实现在此处把一切 `jpeg:` 错误变成**全黑图**, 掩盖了
  // FF00 错位 (2 张 FIF=JPEG 贴图 100% 透明) 与截断 (半张图) 两类真实故障。
  // 现在只有「显式判定的周期性占位熵流」走纯黑 (见 decodeJpegInner 的周期检测),
  // 其余结构性/熵流/截断错误一律带明确信息抛出, 由 core.js:175 记日志并回退。
  return decodeJpegInner(bytes);
}

// 熵流周期检测: 存在周期 ≤ 64 字节且自重复率 ≥ 0.95 的扫描数据视为无效
// (真实 JPEG 熵流接近随机, 不会周期重复; WE 损坏/占位 JPEG 表现为周期熵流)
function isPeriodicEntropy(scan) {
  const n = scan.length;
  const maxPeriod = Math.min(64, n >> 2);
  for (let period = 1; period <= maxPeriod; period++) {
    let match = 0;
    let samples = 0;
    for (let i = period; i < n; i += 4) {
      samples++;
      if (scan[i] === scan[i - period]) match++;
    }
    if (samples > 64 && match / samples > 0.95) return true;
  }
  return false;
}

// 熵扫描解码: 逐 MCU 解出各分量块系数写入平面
// [P-67] 新增: ① DRI restart 间隔边界跳 RSTn + 复位 DC 预测器; ② 位流提前耗尽
// (截断/撞 EOI) 显式抛错 —— 旧实现零填充接着解, 静默产出"顶部一条 + 其余全黑";
// ③ 无效熵流抛错不再被 decodeJpeg 吞成黑图。
function decodeScan(reader, planes, scanComps, huffDC, huffAC, quantTables, block, prevDC, mcusX, mcusY, restartInterval) {
  let invalidCodes = 0;
  let mcuCount = 0;
  const invalid = (v) => v === -2;
  const totalMcus = mcusX * mcusY;
  for (let mcuY = 0; mcuY < mcusY; mcuY++) {
    for (let mcuX = 0; mcuX < mcusX; mcuX++) {
      // restart 间隔边界 (JPEG B.2.1): 跨过 RSTn 标记并复位 DC 预测器
      if (restartInterval > 0 && mcuCount > 0 && mcuCount % restartInterval === 0) {
        reader.syncToRestart();
        prevDC.fill(0);
      } else if (reader.atRestart()) {
        reader.consumeRestart();
        prevDC.fill(0);
      }
      for (let ci = 0; ci < scanComps.length; ci++) {
        const sc = scanComps[ci];
        const comp = planes[sc.pi];
        const huffD = huffDC[sc.td];
        const huffA = huffAC[sc.ta];
        const qtab = quantTables[comp.tq];
        if (!huffD || !huffA || !qtab) throw new Error('jpeg: missing huff/quant table');
        for (let by = 0; by < comp.v; by++) {
          for (let bx = 0; bx < comp.h; bx++) {
            block.fill(0);
            // DC
            let s = huffDecode(reader, huffD);
            if (invalid(s)) invalidCodes++;
            if (s === -1) { // 间隔中途撞到 RST: 重新对齐并复位该分量预测器
              reader.syncToRestart();
              prevDC[sc.pi] = 0;
              s = huffDecode(reader, huffD);
              if (s === -1) throw new Error('jpeg: restart desync in DC at MCU ' + mcuCount);
            }
            const dcDiff = readSigned(reader, s);
            prevDC[sc.pi] += dcDiff;
            block[0] = prevDC[sc.pi];
            // AC
            let k = 1;
            while (k < 64) {
              let rs = huffDecode(reader, huffA);
              if (invalid(rs)) invalidCodes++;
              if (rs === -1) {
                reader.syncToRestart();
                prevDC[sc.pi] = 0;
                rs = huffDecode(reader, huffA);
                if (rs === -1) throw new Error('jpeg: restart desync in AC at MCU ' + mcuCount);
              }
              const r = rs >> 4, ss = rs & 15;
              if (ss === 0) {
                if (r === 0) break; // EOB
                if (r === 15) { k += 16; continue; } // ZRL
              }
              k += r;
              if (k >= 64) break;
              const v = readSigned(reader, ss);
              block[k] = v;
              k++;
              // 无效熵流检测: 前若干块内未定义码过多 → 整图判定无效
              if (invalidCodes > 12) throw new Error('jpeg: invalid entropy stream');
            }
            // 反量化 + zigzag → 自然序
            const nat = new Float64Array(64);
            for (let i = 0; i < 64; i++) nat[ZIGZAG[i]] = block[i] * qtab[i];
            // IDCT
            const idct = idct2d(nat);
            // 写入平面
            const px = mcuX * comp.h + bx;
            const py = mcuY * comp.v + by;
            const planeW = mcusX * comp.h * 8;
            const off = py * 8 * planeW + px * 8;
            for (let y = 0; y < 8; y++) {
              for (let x = 0; x < 8; x++) {
                comp.data[off + y * planeW + x] = idct[y * 8 + x];
              }
            }
          }
        }
      }
      mcuCount++;
      // [P-67] 截断检测: 位流在 MCU 解完前耗尽/撞到真标记 → 明确报错, 不静默半张图
      if (reader.outOfData && mcuCount < totalMcus) {
        throw new Error('jpeg: truncated entropy stream (' + mcuCount + '/' + totalMcus + ' MCU)');
      }
    }
  }
  if (reader.outOfData && mcuCount < totalMcus) {
    throw new Error('jpeg: truncated entropy stream (' + mcuCount + '/' + totalMcus + ' MCU)');
  }
  return mcuCount;
}

function decodeJpegInner(bytes) {
  const len = bytes.length;
  if (len < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('jpeg: bad SOI');
  let p = 2;
  // 解析段
  const quantTables = []; // id → Int16Array 64 (自然序)
  let width = 0, height = 0, comps = null; // [{id, h, v, tq, huffDC, huffAC}]
  const huffDC = {}; // key `${classId}-${id}` → table
  const huffAC = {};
  let sosComp = null;
  let scanDataStart = -1;
  let progressive = false;
  let restartInterval = 0; // DRI (marker 0xDD), 0 = 无重启间隔
  let sofMarker = 0;

  while (p + 1 < len) {
    if (bytes[p] !== 0xff) { p++; continue; }
    const marker = bytes[p + 1];
    p += 2;
    if (marker === 0xd9) break; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // TEM / RST
    if (marker === 0xda) {
      // SOS
      const segLen = (bytes[p] << 8) | bytes[p + 1];
      const ns = bytes[p + 2];
      sosComp = [];
      for (let i = 0; i < ns; i++) {
        const cs = bytes[p + 3 + i * 2];
        const t = bytes[p + 4 + i * 2];
        sosComp.push({ cs, td: t >> 4, ta: t & 15 });
      }
      // Ss Se AhAl 在 baseline 为 0 63 0; 我们跳过
      scanDataStart = p + 3 + ns * 2 + 3;
      break;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // SOF0/SOF1/...: 结构相同 (SOF2 progressive 不支持)
      sofMarker = marker;
      if (marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce) progressive = true;
      const segLen = (bytes[p] << 8) | bytes[p + 1];
      const prec = bytes[p + 2];
      height = (bytes[p + 3] << 8) | bytes[p + 4];
      width = (bytes[p + 5] << 8) | bytes[p + 6];
      const n = bytes[p + 7];
      comps = [];
      for (let i = 0; i < n; i++) {
        const id = bytes[p + 8 + i * 3];
        const hv = bytes[p + 9 + i * 3];
        const tq = bytes[p + 10 + i * 3];
        comps.push({ id, h: hv >> 4, v: hv & 15, tq });
      }
      if (prec !== 8) throw new Error('jpeg: unsupported precision ' + prec);
      p += segLen;
      continue;
    }
    if (marker === 0xdd) {
      // [P-67] DRI: 重启间隔 (MCU 数). 旧实现把它当"其他段"跳过, 于是带 RSTn 的
      // JPEG 在第一个重启边界后位流彻底错位 (consumeRestart 也不跨过标记).
      restartInterval = (bytes[p + 2] << 8) | bytes[p + 3];
      p += (bytes[p] << 8) | bytes[p + 1];
      continue;
    }
    if (marker === 0xdb) {
      // DQT: p 指向长度字段, 段含 2 字节长度 → 数据区 [p+2, p+segLen)
      const segLen = (bytes[p] << 8) | bytes[p + 1];
      let q = p + 2;
      const end = p + segLen;
      while (q < end) {
        const pq = bytes[q] >> 4;
        const tq = bytes[q] & 15;
        const table = new Int16Array(64);
        for (let i = 0; i < 64; i++) {
          table[i] = pq === 0 ? bytes[q + 1 + i] : (bytes[q + 1 + i * 2] << 8) | bytes[q + 2 + i * 2];
        }
        quantTables[tq] = table;
        q += 1 + (pq === 0 ? 64 : 128);
      }
      p += segLen;
      continue;
    }
    if (marker === 0xc4) {
      // DHT: 段数据区 [p+2, p+segLen)
      const segLen = (bytes[p] << 8) | bytes[p + 1];
      let q = p + 2;
      const end = p + segLen;
      while (q < end) {
        const tc = bytes[q] >> 4;
        const th = bytes[q] & 15;
        const counts = [];
        let total = 0;
        for (let i = 0; i < 16; i++) { counts.push(bytes[q + 1 + i]); total += bytes[q + 1 + i]; }
        const symbols = [];
        for (let i = 0; i < total; i++) symbols.push(bytes[q + 17 + i]);
        const table = buildHuffTable(counts, symbols);
        // 预计算最大码长 (huffDecode 未定义码检测用)
        table._maxLen = counts.reduce((m, c, i) => (c > 0 ? i + 1 : m), 1);
        if (tc === 0) huffDC[th] = table; else huffAC[th] = table;
        q += 1 + 16 + total;
      }
      p += segLen;
      continue;
    }
    // 其他段 (APPn/COM/DRI...): 跳过
    if (p + 1 >= len) break;
    const segLen = (bytes[p] << 8) | bytes[p + 1];
    if (segLen < 2) break;
    p += segLen;
  }

  if (!comps || scanDataStart < 0) throw new Error('jpeg: missing SOF/SOS');
  if (progressive) {
    throw new Error('jpeg: progressive (SOF' + (sofMarker - 0xc0) + ') not supported'
      + ' [' + width + 'x' + height + ']');
  }
  // [P-67] 多扫描 / 非交织扫描 (baseline 里每个分量各一个 SOS) 未实现 → 显式报错。
  // 旧实现只解第一个 SOS 就返回, 其余分量平面全 0 → 静默半张图。
  if (sosComp.length !== comps.length) {
    throw new Error('jpeg: non-interleaved (multi-scan) baseline not supported'
      + ' (SOS ' + sosComp.length + ' comps, SOF ' + comps.length + ')');
  }
  const scanComps = sosComp.map((sc) => {
    const pi = comps.findIndex((c) => c.id === sc.cs);
    if (pi < 0) throw new Error('jpeg: SOS component id ' + sc.cs + ' not in SOF');
    return { pi, td: sc.td, ta: sc.ta };
  });

  // 熵流有效性检测: 高度周期重复的扫描数据 = 无效熵流 (真实照片熵流随机,
  // 花壁纸 2934788040 背景 JPEG 熵流 28 a2 80 0a 周期 4 重复 4.7 万次,
  // sharp/Windows/libjpeg 解出全 0 黑) → 提前 fallback 纯黑
  {
    let eoi = bytes.length - 1;
    for (let i = bytes.length - 2; i >= 0; i--) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) { eoi = i; break; }
    }
    const scan = bytes.subarray(scanDataStart, eoi);
    if (scan.length > 64 && isPeriodicEntropy(scan)) {
      // 唯一被保留的"纯黑兜底": 已显式判定为 WE 占位/损坏 JPEG 的周期性熵流
      // (花壁纸 2934788040 实证). 这是**整幅**故意黑, 不是解了一半的图。
      return { width, height, rgba: new Uint8Array(width * height * 4) };
    }
  }

  // 采样因子 → MCU 尺寸
  const maxH = Math.max(...comps.map((c) => c.h));
  const maxV = Math.max(...comps.map((c) => c.v));
  const mcuW = maxH * 8, mcuH = maxV * 8;
  const mcusX = Math.ceil(width / mcuW);
  const mcusY = Math.ceil(height / mcuH);

  // 分量平面 (浮点, 自然序)
  const planes = comps.map((c) => ({
    ...c,
    data: new Float64Array(mcusX * maxH * 8 * (mcusY * maxV * 8)),
    blocksX: mcusX * c.h,
    blocksY: mcusY * c.v,
  }));

  // 熵解码: 逐 MCU, 每分量 h*v 块
  const reader = new BitReader(bytes, scanDataStart);
  const block = new Float64Array(64);
  const prevDC = new Array(comps.length).fill(0);
  // [P-67] 不再带 _dims 抛错求外层吞成黑图: 错误原样上抛, 由调用方决定回退方式
  decodeScan(reader, planes, scanComps, huffDC, huffAC, quantTables, block, prevDC, mcusX, mcusY, restartInterval);

  // 色彩转换: YCbCr → RGB, 上采样 Cb/Cr
  const yComp = planes[0];
  const rgb = new Uint8Array(width * height * 4);
  const planeW = mcusX * maxH * 8;
  const gray = planes.length < 3;
  const getPlane = (ci, x, y) => {
    const c = planes[ci];
    // 上采样: 块放大 c.h/c.v 倍
    const sx = Math.floor((x * c.h) / maxH);
    const sy = Math.floor((y * c.v) / maxV);
    const pw = mcusX * c.h * 8;
    return c.data[sy * pw + sx];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // IDCT 输出为 -128..127, +128 还原到 0..255
      const Y = yComp.data[y * planeW + x] + 128;
      const o = (y * width + x) * 4;
      if (gray) { // [P-67] 灰度 JPEG (Nf=1): 旧实现取 planes[1] 直接 TypeError
        const g = Y < 0 ? 0 : Y > 255 ? 255 : Y | 0;
        rgb[o] = g; rgb[o + 1] = g; rgb[o + 2] = g; rgb[o + 3] = 255;
        continue;
      }
      const Cb = getPlane(1, x, y) + 128;
      const Cr = getPlane(2, x, y) + 128;
      const r = Y + 1.402 * (Cr - 128);
      const g = Y - 0.344136 * (Cb - 128) - 0.714136 * (Cr - 128);
      const b = Y + 1.772 * (Cb - 128);
      rgb[o] = r < 0 ? 0 : r > 255 ? 255 : r | 0;
      rgb[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g | 0;
      rgb[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b | 0;
      rgb[o + 3] = 255;
    }
  }
  return { width, height, rgba: rgb };
}

// tools/scene-video-verdict-test.mjs —— ①(2026-10-04) **「只判不取」的 scene 视频 verdict** 门禁
//
// 背景与读数（对应上游 issue #136 的同类问题；对比报告 ../docs/reverse/ELYSIA-COMPARE-ABSORB-20261004.md）：
//   `ensureSceneVideo`（lib/index.js）是"判定 + 提取"一体的：客户端在**卡片/清单阶段**只问
//   `{has, mime}`（lib/client.js 的 sceneVideoCheckUrl 只读 d.has），却会把整段内嵌视频读进内存并落盘。
//   本机实测：792MB 的容器，全量扫描读 791.6MB / 446ms；而只读目录表 + 候选前缀的 verdict 读
//   **64KB / 0.4ms**（差 ~12000× 读量）。本文件把这个"只判不取"的契约钉住。
//
// 判据（自造夹具为主，不依赖语料；语料段缺语料即 SKIP，不假红）：
//   A 自造 PKG：单条独立视频 ⇒ `has:true, decided:true`，且**读量 < 载荷**（只判不取）
//   B 自造 PKG：两条独立视频 ⇒ `decided:false`（谁最大要看解压后长度 ⇒ 交回慢路径）
//   C 自造 PKG：无视频条目 ⇒ `has:false, decided:true`
//   D **压缩条目**（手搓 LZ4 链：literal-only 块）⇒ 整包口径 `readPkgEntry` 与索引先行的
//     `scanSceneVideo` **都能还原出原始字节**（`decodeStoredEntry` 的加固：头解析的条目 flags 恒 0，
//     不能把压缩条目当 raw 用）—— 变异体"去掉压缩判定"必须变红
//   E 结构棘轮：`lib/index.js` 的 `probeSceneVideo` 路由必须先试 verdict；`scanSceneVideo` 的条目读取
//     必须走 `decodeStoredEntry`（不许再有裸 `new Uint8Array(buf)` 返回）
//   F 语料段（可选）：抽 6 个容器，verdict（decided 时）与全量扫描判定必须一致；最大视频容器的
//     verdict 读量 ≤ 512KB
//
// 复现: node tools/scene-video-verdict-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, '..', 'lib');
const { probeSceneVideoVerdict, scanSceneVideo, parsePkg, readPkgEntry } = await import(pathToFileURL(path.join(LIB, 'pkg-extract.js')).href);

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); } else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); } };
const bad = (name, detail) => { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); };

/* ── 自造 PKG 容器（格式照 lib/pkg-extract.js 的 parsePkg：magic 长度+magic、条目数、[名字长度,名字,offset,length]…）── */
function buildPkg(entries) {
  const enc = new TextEncoder();
  const magic = enc.encode('PKGV0024');
  let indexLen = 4 + magic.length + 4;
  for (const e of entries) indexLen += 4 + enc.encode(e.path).length + 8;
  const chunks = [];
  let off = 0;
  for (const e of entries) { chunks.push(Buffer.from(e.bytes)); e.__off = off; off += e.bytes.length; }
  const head = Buffer.alloc(indexLen);
  let p = 0;
  head.writeUInt32LE(magic.length, p); p += 4;
  Buffer.from(magic).copy(head, p); p += magic.length;
  head.writeUInt32LE(entries.length, p); p += 4;
  for (const e of entries) {
    const name = enc.encode(e.path);
    head.writeUInt32LE(name.length, p); p += 4;
    Buffer.from(name).copy(head, p); p += name.length;
    head.writeUInt32LE(e.__off, p); p += 4;
    head.writeUInt32LE(e.bytes.length, p); p += 4;
  }
  return Buffer.concat([head, ...chunks]);
}
/** 手搓一条 LZ4**块链**条目（合法块：1 个字面量 + 一条长 match ⇒ 链长远小于原始长度） */
function lz4ChainEntryRle(byte, totalLen) {
  if (totalLen < 8) throw new Error('totalLen too small');
  const matchLen = totalLen - 1;                 // 字面量 1 字节，其余靠 match 复制
  let low = matchLen - 4;                        // LZ4 match 长度基数 4
  const token = (1 << 4) | Math.min(15, low);
  const ext = [];
  if (low >= 15) { let n = low - 15; while (n >= 255) { ext.push(255); n -= 255; } ext.push(n); }
  const block = Buffer.concat([Buffer.from([token, byte, 1, 0]), Buffer.from(ext)]);   // offset=1（回退到自己）
  const header = Buffer.alloc(16);
  header.writeBigUInt64LE(BigInt(totalLen), 0);  // 原始长度（probeCompressedEntry 读它）
  header.writeInt32LE(totalLen, 8);              // 本块解压后长度
  header.writeInt32LE(block.length, 12);         // 本块压缩后长度
  return { chain: Buffer.concat([header, block]), original: Buffer.alloc(totalLen, byte) };
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-verdict-'));
const write = (name, buf) => { const p = path.join(tmp, name); fs.writeFileSync(p, buf); return p; };
const MP4A = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(1 << 20, 7)]);   // 1MB 假视频
const MP4B = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(2 << 20, 9)]);   // 2MB 假视频

console.log('── A 单条独立视频：只判不取');
const pkgA = write('single.mpkg', buildPkg([{ path: 'clip.mp4', bytes: MP4A }, { path: 'project.json', bytes: Buffer.from('{"title":"t"}') }]));
const vA = probeSceneVideoVerdict(pkgA);
ok('A1 verdict 判定为"有视频"且 decided', vA.has === true && vA.decided === true, JSON.stringify({ has: vA.has, decided: vA.decided, ref: vA.ref }));
ok('A2 verdict 读量只含头+前缀（< 载荷的 1/8）', vA.bytesRead * 8 < MP4A.length, `bytesRead=${vA.bytesRead} 载荷=${MP4A.length}`);

console.log('── B 两条独立视频：不赌，交回慢路径');
const pkgB = write('two.mpkg', buildPkg([{ path: 'a.mp4', bytes: MP4A }, { path: 'b.mp4', bytes: MP4B }]));
const vB = probeSceneVideoVerdict(pkgB);
ok('B1 verdict decided=false（谁最大要看解压后长度）', vB.decided === false && vB.reason === 'multi-standalone', JSON.stringify({ decided: vB.decided, reason: vB.reason }));
const sB = scanSceneVideo(pkgB, { cache: false });
ok('B2 慢路径仍给出唯一答案（取最大者 b.mp4）', !!(sB.video && /b\.mp4$/.test(sB.video.ref)) && sB.video.bytes.length === MP4B.length, sB.video && sB.video.ref);

console.log('── C 无视频条目：decided 且 has=false');
const pkgC = write('none.mpkg', buildPkg([{ path: 'project.json', bytes: Buffer.from('{"title":"x"}') }, { path: 'preview.jpg', bytes: Buffer.alloc(1024, 3) }]));
const vC = probeSceneVideoVerdict(pkgC);
ok('C1 has=false 且 decided=true', vC.has === false && vC.decided === true, JSON.stringify({ has: vC.has, decided: vC.decided }));

console.log('── D 压缩条目（LZ4 链）：两条路径都必须还原原始字节');
const rle = lz4ChainEntryRle(0x41, 4096);
// ⚠ 关键：压缩条目必须落在**索引头（64KB）之外** —— 否则头解析就能就地判出 flags&1，
//   变异体（去掉压缩判定）会变成 no-op，判据失去分辨力。前面垫 128KB 的 padding 条目把它挤出去。
const pkgD = write('compressed.mpkg', buildPkg([
  { path: 'padding.bin', bytes: Buffer.alloc(128 * 1024, 0x5a) },
  { path: 'clip.mp4', bytes: rle.chain },
  { path: 'project.json', bytes: Buffer.from('{"title":"z"}') },
]));
const parsedD = parsePkg(new Uint8Array(fs.readFileSync(pkgD)));
const entryD = parsedD.find((e) => e.path === 'clip.mp4');
ok('D1 parsePkg 认出该条为压缩条目（flags&1）', !!(entryD && (entryD.flags & 1)), entryD ? `flags=${entryD.flags} size=${entryD.size}` : 'none');
const whole = readPkgEntry(new Uint8Array(fs.readFileSync(pkgD)), entryD);
ok('D2 整包口径解压 == 原始载荷', whole.length === rle.original.length && Buffer.compare(Buffer.from(whole), rle.original) === 0, `len=${whole.length} 链=${rle.chain.length}`);
const sD = scanSceneVideo(pkgD, { cache: false });
ok('D3 索引先行口径也拿到同一条视频（decodeStoredEntry 生效）', !!(sD.video && sD.video.bytes && sD.video.bytes.length === rle.original.length) && Buffer.compare(Buffer.from(sD.video.bytes), rle.original) === 0, sD.video ? `len=${sD.video.bytes.length} ref=${sD.video.ref}` : 'null');

console.log('── D′ 变异体：把 decodeStoredEntry 的压缩判定去掉 ⇒ D3 必红');
try {
  const farm = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-verdict-mut-'));
  let src = fs.readFileSync(path.join(LIB, 'pkg-extract.js'), 'utf8');
  const before = src;
  const needle = [
    'if ((entry.flags & 1) === 0) {',
    '    // 头解析出来的条目 `size` 是**存储长度**（partial），不能拿它当原始长度：链头 u64 才是真值',
    '    try { original = probeCompressedEntry(raw, 0, raw.length) } catch { original = null }',
    '    if (original === null) return raw',
    '  }',
  ].join('\n');
  src = src.replace(needle, 'if ((entry.flags & 1) === 0) return raw   // 变异体：不判压缩，直接当 raw');
  if (src === before) bad('D′0 变异体注入点没匹配上（说明实现的形状变了，本判据需要同步）');
  else {
    fs.writeFileSync(path.join(farm, 'pkg-extract.js'), src);
    const mut = await import(pathToFileURL(path.join(farm, 'pkg-extract.js')).href + '?t=' + Date.now());
    const sM = mut.scanSceneVideo(pkgD, { cache: false });
    const mutBytes = sM.video && sM.video.bytes ? Buffer.from(sM.video.bytes) : null;
    const sameAsSource = mutBytes && Buffer.compare(mutBytes, rle.original) === 0;
    ok('D′1 变异体下 D3 会红（拿不到原始字节 / 或长度不符）', !sameAsSource, mutBytes ? `len=${mutBytes.length}` : 'video=null');
  }
} catch (e) { bad('D′ 变异体没跑起来', String(e && e.message || e)); }

console.log('── E 结构棘轮（源码形状）');
const idxSrc = fs.readFileSync(path.join(LIB, 'index.js'), 'utf8');
const pkgSrc = fs.readFileSync(path.join(LIB, 'pkg-extract.js'), 'utf8');
const routeAt = idxSrc.indexOf('const probeSceneVideo = (req, res, dir) => {');
const routeBody = routeAt >= 0 ? idxSrc.slice(routeAt, routeAt + 2600) : '';
ok('E1a probeSceneVideo 路由里 verdict 出现在 ensureSceneVideo 之前',
  routeBody.indexOf('probeSceneVideoVerdict(dir)') >= 0 && routeBody.indexOf('probeSceneVideoVerdict(dir)') < routeBody.indexOf('ensureSceneVideo(dir)'));
ok('E1b verdict 只挂在 `?has=1` 上（默认路径与既有契约逐位不变）',
  /wantHasOnly\s*=\s*\(\(\)\s*=>/.test(routeBody) && /verdict\s*=\s*wantHasOnly\s*\?\s*probeSceneVideoVerdict\(dir\)\s*:\s*null/.test(routeBody));
const cliSrc = fs.readFileSync(path.join(LIB, 'client.js'), 'utf8');
ok('E1c 客户端两条 check URL 都带 has=1', /library-scene-video-check\?has=1&ltoken=/.test(cliSrc) && /custom-scene-video-check\?has=1&folder=/.test(cliSrc));
ok('E2 scanSceneVideo 的条目读取走 decodeStoredEntry', /return decodeStoredEntry\(buf, e\);/.test(pkgSrc));
const scanFn = pkgSrc.slice(pkgSrc.indexOf('function scanSceneVideo('), pkgSrc.indexOf('function probeSceneVideoVerdict('));
ok('E3 scanSceneVideo 内不再有裸 `return new Uint8Array(buf)`（旧的 flags-only 分支）', scanFn.indexOf('return new Uint8Array(buf)') < 0);
ok('E4 decodeStoredEntry 的压缩判定用的是唯一口径 probeCompressedEntry', /function decodeStoredEntry[\s\S]{0,400}probeCompressedEntry\(raw, 0, raw\.length\)/.test(pkgSrc));

console.log('── F 语料段（缺语料 ⇒ SKIP，不假红）');
const WS = process.env.MPW_WS || path.join(HERE, '..', '..');
const roots = ['0917', '0923', 'dd', 'wallpaperE'].map((r) => path.join(WS, 'allwallpaper', r));
const found = [];
for (const root of roots) {
  if (!fs.existsSync(root) || found.length >= 6) continue;
  const walk = (dir, depth) => {
    if (depth > 3 || found.length >= 6) return;
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (found.length >= 6) return;
      const p = path.join(dir, n);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) { const sp = path.join(p, 'scene.pkg'); if (fs.existsSync(sp)) found.push(sp); else walk(p, depth + 1); }
      else if (/\.mpkg$/i.test(n) && st.size > 20 * 1048576) found.push(p);
    }
  };
  walk(root, 0);
}
if (found.length < 3) console.log('  ⊘ SKIP 语料段：可用容器 <3（' + found.length + '）');
else {
  let mismatch = 0, checked = 0, maxRead = 0, maxLabel = '', maxTexPeeked = 0;
  for (const f of found) {
    const v = probeSceneVideoVerdict(f);
    if (v.bytesRead > maxRead) { maxRead = v.bytesRead; maxLabel = path.basename(f); maxTexPeeked = v.texPeeked || 0; }
    if (!v.decided) continue;
    const s = scanSceneVideo(f, { cache: false });
    const has = !!(s.video && s.video.bytes && s.video.bytes.length);
    checked++;
    if (has !== v.has) { mismatch++; console.log('      不一致: ' + f + ' verdict=' + v.has + ' scan=' + has); }
  }
  ok('F1 语料：verdict（decided 时）与全量扫描判定一致', mismatch === 0, `checked=${checked} mismatch=${mismatch}`);
  const bound = 64 * 1024 + 96 * 1024 * (maxTexPeeked || 0) + 64 * 1024;   // 头 + TEX_PEEK_BYTES×前缀条数（+余量）
  ok('F2 语料：verdict 读量 ≤ 头 + 96KB×前缀条数（结构性上界）', maxRead <= bound, `${maxLabel} → ${(maxRead / 1024).toFixed(1)}KB ≤ ${(bound / 1024).toFixed(0)}KB（前缀 ${maxTexPeeked} 条）`);
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录删不掉不影响判据 */ }
console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过') + '  （pass=' + pass + ' fail=' + fail + '）');
process.exit(fail ? 1 : 0);

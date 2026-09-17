// tools/scene-video-test.mjs —— 用户第 1 条反馈 ⑥c：`ensureSceneVideo` 改「索引先行」的回归门禁
//
// 为什么重要：`ensureSceneVideo` 在**应用壁纸的关键路径**上（client.js `applySceneWallpaper`
// → `checkSceneVideo(key)` 先探测、再决定静态帧还是视频；客户端给了 4s 超时就是因为它曾达 1–3s）。
// 本文件证明"快了"且"答案一字不变"：
//   A 自造夹具（永远跑）：独立视频 / TEX 内嵌 / TEXB0004 视频标志 / 无视频 / 多视频 /
//     mip0 为 LZ4 / 条目级 LZ4 / 独立视频与 TEX 视频并存 / 前缀不可判定（回退整条读）
//     —— 每条都与**旧实现**（readFileSync 整包 + collectSceneVideoFiles + 旧选择规则，逐字复刻）比 ref 与 sha256
//   B 真包（allwallpaper/dd 存在时）：11 个包同样逐项比对，并打印四类分布
//   C 逐个 TEX 的"前缀判定"不许说谎：对语料**每一个** .tex 断言
//     probeTexVideoDecision(前缀) 与 extractTexVideoMp4(整条) 的结论一致（'none' 不可能是视频、
//     'video' 不可能不是视频）
//   D 缓存：同 (path,mtime,size) 第二次 O(1)、读 0 字节、返回同一对象；mtime 变即失效
//   E 路由：/custom-scene-video-check 的 {has,mime,size} 与旧实现一致；落盘缓存文件**内容 sha256 一致**
//     且**文件名（hash）与旧公式一致**（升级后不重抽）；二次探测走缓存
//
// 复现: node tools/scene-video-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import {
  parsePkg, readPkgEntry, collectSceneVideoFiles, extractTexVideoMp4,
  scanSceneVideo, sceneVideoScanStats, clearSceneVideoScanCache,
  probeTexVideoDecision, walkTexFirstMipmap, lz4Prefix,
} from '../lib/pkg-extract.js';

// ①(2026-09-17 夹具纪律) 断言中途抛异常也要清理：两处临时目录都挂到 exit 上。
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
let pass = 0, fail = 0, skip = 0;
// ①(2026-09-17 假绿修复轮) **这里原来是 `const ok = (n, d) => { pass++; … }`：第二参（真条件）只当
//   展示细节打印，恒真 ⇒ 本文件永远不会红**（与 scene-audio-route-test.mjs 同款，同一轮一起修）。
//   现在条件放第一位：不满足即 fail++、打 ✗ 与真实值，进程非零退出。
const ok = (cond, n, d) => { if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); } else { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')); } };
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')); };
const sk = (n) => { skip++; console.log('  ⊘ SKIP ' + n); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const VEXT = /\.(mp4|m4v|webm|mov)$/i;

/* ═══════════ 旧实现（改前）——index.js findSceneVideoInPkg / findSceneVideoInDir 逐字复刻 ═══════════ */
function oldFindInPkg(pkgData) {
  const videos = collectSceneVideoFiles({ list: () => parsePkg(pkgData).map((e) => ({ path: e.path, read: () => readPkgEntry(pkgData, e) })) });
  if (!videos.length) return null;
  const standalone = videos.filter((v) => !v.isTexEmbedded);
  if (standalone.length) { standalone.sort((a, b) => (b.bytes.length || 0) - (a.bytes.length || 0)); return standalone[0]; }
  if (videos.length === 1) return videos[0];
  return null;
}
function oldFindInDir(dir) {
  const videos = collectSceneVideoFiles({
    list: () => {
      const out = [];
      const walk = (sub, depth) => {
        if (depth > 4) return;
        let names = [];
        try { names = readdirSyncSafe(sub === '' ? dir : path.join(dir, sub)); } catch { return; }
        for (const name of names) {
          const rel = sub === '' ? name : sub + '/' + name;
          let isDir = false, isFile = false;
          try { const s = fs.statSync(path.join(dir, rel)); isDir = s.isDirectory(); isFile = s.isFile(); } catch { continue; }
          if (isDir) { if (!name.startsWith('.')) walk(rel, depth + 1); }
          else out.push({ path: rel, read: () => { try { return new Uint8Array(fs.readFileSync(path.join(dir, rel))); } catch { return null; } } });
        }
      };
      walk('', 0);
      return out;
    },
  });
  if (!videos.length) return null;
  const standalone = videos.filter((v) => !v.isTexEmbedded);
  if (standalone.length) { standalone.sort((a, b) => (b.bytes.length || 0) - (a.bytes.length || 0)); return standalone[0]; }
  if (videos.length === 1) return videos[0];
  return null;
}
const readdirSyncSafe = (d) => fs.readdirSync(d);

/* ═══════════ 夹具：PKG 容器 + TEX 容器 + LZ4 ═══════════ */
const dec = new TextDecoder();
function be32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }
function i32(n) { const b = Buffer.alloc(4); b.writeInt32LE(n | 0, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function s8(s) { return Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]); }
function mp4Payload(len) { const b = Buffer.alloc(len); be32(len).copy(b, 0); b.write('ftyp', 4, 'latin1'); for (let i = 8; i < len; i++) b[i] = 0x11; return b; }
function plainPayload(len) { const b = Buffer.alloc(len, 0x5a); b.write('PLAI', 0, 'latin1'); return b; }

/** 按 parseTexInternal 的字段顺序造 TEX。
 *  opts: { version, videoFlag, mip0, mip0Lz4, extraMipmap } */
function buildTex(opts) {
  const version = opts.version || 3;
  const mip0 = opts.mip0;
  const body = [s8('TEXV0005'), s8('TEXI0001'), i32(0), i32(0), i32(1024), i32(1024), i32(1024), i32(1024), u32(0)];
  body.push(s8('TEXB000' + version), i32(1));
  if (version === 3) body.push(i32(0));
  if (version === 4) body.push(i32(-1), i32(opts.videoFlag ? 1 : 0));
  const mipmapCount = opts.extraMipmap ? 2 : 1;
  body.push(i32(mipmapCount));
  const mip = (payload, lz4) => {
    const parts = [];
    if (version === 4) parts.push(i32(1), i32(2), s8('{}'), i32(1));
    parts.push(i32(64), i32(64));
    if (version === 1) { parts.push(i32(payload.length), payload); return parts; }
    if (lz4) {
      const stored = lz4Literal(payload);
      parts.push(i32(1), i32(payload.length), i32(stored.length), stored);
    } else {
      parts.push(i32(0), i32(0), i32(payload.length), payload);
    }
    return parts;
  };
  body.push(...mip(mip0, opts.mip0Lz4));
  if (opts.extraMipmap) body.push(...mip(plainPayload(256), false));
  return Buffer.concat(body);
}

/** 纯字面量 LZ4（无 match）：解压结果与输入逐字节相同（供 mip0 LZ4 用）。 */
function lz4Literal(buf) {
  const parts = [];
  const n = buf.length;
  if (n >= 15) {
    parts.push(Buffer.from([0xf0]));
    let r = n - 15; const ext = [];
    while (r >= 255) { ext.push(255); r -= 255; }
    ext.push(r); parts.push(Buffer.from(ext));
  } else parts.push(Buffer.from([n << 4]));
  parts.push(buf);
  return Buffer.concat(parts);
}

/** 一个 sequence 的 LZ4：[前缀字面量] + [offset 处 matchLen 长 match]（用于造**条目级 LZ4**）。 */
function lz4LitThenRepeat(prefix, offset, matchLen) {
  const litLen = prefix.length; const ml = matchLen - 4;
  const parts = [Buffer.from([((litLen >= 15 ? 15 : litLen) << 4) | (ml >= 15 ? 15 : ml)])];
  if (litLen >= 15) { let r = litLen - 15; const ext = []; while (r >= 255) { ext.push(255); r -= 255; } ext.push(r); parts.push(Buffer.from(ext)); }
  parts.push(prefix);
  const off = Buffer.alloc(2); off.writeUInt16LE(offset, 0); parts.push(off);
  if (ml >= 15) { let r = ml - 15; const ext = []; while (r >= 255) { ext.push(255); r -= 255; } ext.push(r); parts.push(Buffer.from(ext)); }
  return Buffer.concat(parts);
}

/** 造 PKG：entries = [{name, data}]；entryLz4 标记的条目走"块链"存储（探针需 origSize > stored）。 */
function buildPkg(entries) {
  const magic = 'PKGV0022';
  const stored = [];
  let off = 0;
  for (const e of entries) {
    let s = Buffer.from(e.data);
    if (e.entryLz4) {
      // 内容形如 [字面量前缀][周期重复] 才能被这种最小压缩器压小：前缀取 body[0..L]，余下用 offset=16 重复
      const body = Buffer.from(e.data);
      const L = body.length >= 64 ? 64 : body.length;
      const block = lz4LitThenRepeat(body.subarray(0, L), 16, body.length - L);
      const head = Buffer.alloc(16);
      head.writeUInt32LE(body.length, 0); head.writeUInt32LE(0, 4);
      head.writeInt32LE(body.length, 8); head.writeInt32LE(block.length, 12);
      s = Buffer.concat([head, block]);
    }
    stored.push({ name: e.name, offset: off, size: s.length, data: s });
    off += s.length;
  }
  const head = Buffer.concat([u32(magic.length), Buffer.from(magic, 'latin1'), u32(stored.length)]);
  const table = Buffer.concat(stored.map((t) => Buffer.concat([u32(Buffer.byteLength(t.name)), Buffer.from(t.name, 'utf8'), u32(t.offset), u32(t.size)])));
  return Buffer.concat([head, table, ...stored.map((t) => t.data)]);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-sv-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ } });
const cases = [
  { name: '独立视频（2 条，取最大的）', entries: [
      { name: 'scene.json', data: Buffer.from('{"objects":[]}') },
      { name: 'movies/small.mp4', data: Buffer.alloc(4096, 1) },
      { name: 'movies/big.webm', data: Buffer.alloc(9001, 2) },
      { name: 'textures/a.tex', data: buildTex({ mip0: plainPayload(2048) }) },
    ], expect: 'movies/big.webm', kind: 'standalone' },
  { name: 'TEX 内嵌（唯一 1 条，mip0 裸 ftyp）', entries: [
      { name: 'scene.json', data: Buffer.from('{"objects":[]}') },
      { name: 'textures/plain.tex', data: buildTex({ mip0: plainPayload(4096) }) },
      { name: 'textures/movie.tex', data: buildTex({ mip0: mp4Payload(8192) }) },
    ], expect: 'textures/movie.tex', kind: 'tex' },
  { name: 'TEX 内嵌（mip0 为 LZ4，解压后才是 ftyp）', entries: [
      { name: 'textures/plain.tex', data: buildTex({ mip0: plainPayload(4096) }) },
      { name: 'textures/lz4video.tex', data: buildTex({ mip0: mp4Payload(4096), mip0Lz4: true }) },
    ], expect: 'textures/lz4video.tex', kind: 'tex-lz4mip' },
  { name: 'TEXB0004 视频标志（isVideoMp4=1）', entries: [
      { name: 'textures/flag.tex', data: buildTex({ version: 4, videoFlag: true, mip0: mp4Payload(2048) }) },
    ], expect: 'textures/flag.tex', kind: 'tex-v4flag' },
  { name: '无视频（只有普通 TEX/json）', entries: [
      { name: 'scene.json', data: Buffer.from('{"objects":[]}') },
      { name: 'textures/a.tex', data: buildTex({ mip0: plainPayload(1500) }) },
      { name: 'textures/b.tex', data: buildTex({ mip0: plainPayload(1500), extraMipmap: true }) },
    ], expect: null, kind: 'none' },
  { name: '多视频（2 条 TEX 内嵌 → 旧规则 null）', entries: [
      { name: 'textures/one.tex', data: buildTex({ mip0: mp4Payload(4096) }) },
      { name: 'textures/two.tex', data: buildTex({ mip0: mp4Payload(4096) }) },
      { name: 'textures/three.tex', data: buildTex({ mip0: mp4Payload(4096) }) },
    ], expect: null, kind: 'multi' },
  { name: '独立视频 + TEX 视频并存（独立优先，TEX 不必读）', entries: [
      { name: 'movies/a.mp4', data: Buffer.alloc(1234, 3) },
      { name: 'textures/one.tex', data: buildTex({ mip0: mp4Payload(4096) }) },
      { name: 'textures/two.tex', data: buildTex({ mip0: mp4Payload(4096) }) },
    ], expect: 'movies/a.mp4', kind: 'standalone+tex' },
  { name: '条目级 LZ4（TEX 内容被块链压缩，含视频）', entries: [
      { name: 'textures/entrylz4.tex', data: (() => {
        // 让"前 64 字节 + offset16 周期重复"能还原：payload 用 16 字节周期
        const body = buildTex({ mip0: Buffer.alloc(16384) });
        const unit = body.subarray(48, 64);
        for (let i = 64; i < body.length; i++) body[i] = unit[(i - 64) % 16];
        for (let i = 0; i < 12 && i < body.length; i++) body[i] = body[i];  // 头部保持原样
        return body;
      })(), entryLz4: true },
    ], expect: null, kind: 'entry-lz4' },
  { name: 'TEX 损坏（前缀不可判定 → 整条读兜底）', entries: [
      { name: 'textures/broken.tex', data: Buffer.concat([Buffer.from('TEXV0005\0TEXI0001\0'), Buffer.alloc(200, 0x7f)]) },
      { name: 'textures/plain.tex', data: buildTex({ mip0: plainPayload(2048) }) },
    ], expect: null, kind: 'broken' },
];

console.log('== A 自造夹具（旧实现 vs 索引先行，逐项比对 ref + sha256）==');
for (const c of cases) {
  const buf = buildPkg(c.entries);
  const p = path.join(tmp, 'case-' + c.kind + '.pkg');
  fs.writeFileSync(p, buf);
  clearSceneVideoScanCache();
  let out = null, err = '';
  try { out = scanSceneVideo(p); } catch (e) { err = e.message; }
  const oldV = oldFindInPkg(new Uint8Array(buf));
  const gotRef = out && out.video ? out.video.ref : null;
  const oldRef = oldV ? oldV.ref : null;
  const sameBytes = (oldV ? sha(oldV.bytes) : null) === (out && out.video ? sha(out.video.bytes) : null);
  const okAll = gotRef === c.expect && oldRef === c.expect && sameBytes;
  if (okAll) ok(true, c.name, 'ref=' + gotRef + ' read=' + (out ? out.bytesRead : 0) + 'B entriesRead=' + (out ? out.entriesRead : 0));
  else bad(c.name, 'expect=' + c.expect + ' old=' + oldRef + ' new=' + gotRef + ' bytesEqual=' + sameBytes + (err ? ' err=' + err : ''));
}
// 独立视频 + TEX 视频：TEX 不应被整条读（旧路径读了也丢弃）
{
  const buf = buildPkg(cases[6].entries);
  const p = path.join(tmp, 'case-standalone2.pkg');
  fs.writeFileSync(p, buf);
  clearSceneVideoScanCache();
  const out = scanSceneVideo(p);
  ok(out.entriesRead === 1, '独立视频在时 0 个 TEX 被整条读', 'entriesRead=' + out.entriesRead);
  ok(out.bytesRead < 70000 + 1234 + 4096, '整条读字节只有那条 mp4（1234B）+ 索引头', 'bytesRead=' + out.bytesRead);
}
// 多视频：确认 2 条即停（第 3 个 TEX 不读）
{
  const buf = buildPkg(cases[5].entries);
  const p = path.join(tmp, 'case-multi2.pkg');
  fs.writeFileSync(p, buf);
  clearSceneVideoScanCache();
  const out = scanSceneVideo(p);
  ok(out.entriesRead === 2 && out.video === null, '多视频：确认 2 条即停（entriesRead=2，不是 3）', 'entriesRead=' + out.entriesRead);
}
// 松散目录：旧口径一致
{
  const dir = path.join(tmp, 'loose');
  fs.mkdirSync(path.join(dir, 'textures'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'textures', 'plain.tex'), buildTex({ mip0: plainPayload(2048) }));
  fs.writeFileSync(path.join(dir, 'textures', 'movie.tex'), buildTex({ mip0: mp4Payload(4096) }));
  clearSceneVideoScanCache();
  const outDir = scanSceneVideo(dir);
  const oldDir = oldFindInDir(dir);
  ok((outDir.video && outDir.video.ref) === (oldDir && oldDir.ref) && sha(outDir.video.bytes) === sha(oldDir.bytes), '松散目录：ref/sha 与旧口径一致', 'ref=' + (outDir.video && outDir.video.ref) + ' source=' + outDir.source);
  ok(outDir.entriesRead === 1, '松散目录：普通 TEX 不被整条读', 'entriesRead=' + outDir.entriesRead);
}

console.log('\n== D 缓存（同 path+mtime+size 第二次 O(1)）==');
{
  const p = path.join(tmp, 'case-tex.pkg');
  clearSceneVideoScanCache();
  const c1 = scanSceneVideo(p);
  const c2 = scanSceneVideo(p);
  ok(c1.cacheHit === false, '第一次未命中');
  ok(c2.cacheHit === true && c2.bytesRead === 0 && c2.entriesRead === 0, '第二次命中且读 0 字节');
  ok(c1.video === c2.video && sha(c2.video.bytes) === sha(c1.video.bytes), '命中返回同一 video 对象（含 bytes）');
  const st = sceneVideoScanStats();
  ok(st.hits === 1 && st.misses === 1, '计数器 hits=' + st.hits + ' misses=' + st.misses);
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(p, past, past);
  ok(scanSceneVideo(p).cacheHit === false, 'mtime 变化 → 失效重扫');
}

console.log('\n== B 真包（11 个 scene.pkg，旧实现 vs 索引先行）==');
const corpusRoots = [process.env.MPW_SCENE_ROOT, '/root/Desktop/DSHarea/allwallpaper/dd', path.join(ROOT, 'samples', 'wallpapers')].filter(Boolean);
const corpus = corpusRoots.find((d) => { try { return fs.existsSync(d) && fs.statSync(d).isDirectory(); } catch { return false; } });
let corpusPkgs = [];
if (!corpus) sk('真包语料');
else {
  corpusPkgs = fs.readdirSync(corpus).map((d) => path.join(corpus, d, 'scene.pkg')).filter((p) => fs.existsSync(p)).sort();
  const dist = { standalone: 0, tex: 0, multi: 0, none: 0 };
  let allSame = true;
  for (const p of corpusPkgs) {
    const buf = new Uint8Array(fs.readFileSync(p));
    const oldV = oldFindInPkg(buf);
    clearSceneVideoScanCache();
    const out = scanSceneVideo(p);
    const id = path.basename(path.dirname(p));
    const same = (oldV ? oldV.ref : null) === (out.video ? out.video.ref : null) && (oldV ? sha(oldV.bytes) : null) === (out.video ? sha(out.video.bytes) : null);
    if (!same) { allSame = false; bad(id + ' 与旧实现不一致', 'old=' + (oldV && oldV.ref) + ' new=' + (out.video && out.video.ref)); continue; }
    // 分类：无独立视频条目 → 看 TEX 命中数
    const texHits = collectSceneVideoFiles({ list: () => parsePkg(buf).map((e) => ({ path: e.path, read: () => readPkgEntry(buf, e) })) }).filter((v) => v.isTexEmbedded).length;
    const standaloneHits = parsePkg(buf).filter((e) => VEXT.test(e.path)).length;
    const kind = standaloneHits ? 'standalone' : texHits === 0 ? 'none' : texHits === 1 ? 'tex' : 'multi';
    dist[kind]++;
    console.log('  ✓ ' + id.padEnd(11) + ' ' + kind.padEnd(10) + ' ref=' + String(out.video && out.video.ref).slice(0, 40) + ' read=' + (out.bytesRead / 1048576).toFixed(2) + 'MB entriesRead=' + out.entriesRead);
  }
  ok(allSame, '真包逐项一致 ' + corpusPkgs.length + '/' + corpusPkgs.length + '（' + JSON.stringify(dist) + '）', allSame ? '' : '见上面的 ✗');
}

console.log('\n== C 前缀判定不许说谎（语料每个 .tex 都与整条解析比）==');
if (!corpusPkgs.length) sk('逐 TEX 前缀判定');
else {
  let n = 0, lie = 0, noneN = 0, videoN = 0, lz4mip = 0, rawMip = 0, v4 = 0;
  for (const p of corpusPkgs) {
    const buf = new Uint8Array(fs.readFileSync(p));
    for (const e of parsePkg(buf)) {
      if (!/\.tex$/i.test(e.path)) continue;
      const full = readPkgEntry(buf, e);
      const truth = extractTexVideoMp4(full) ? 'video' : 'none';
      const pre = full.subarray(0, Math.min(full.length, 96 * 1024));
      const decd = probeTexVideoDecision((off, len) => (off + len > pre.length ? null : pre.subarray(off, off + len)), pre, e.path);
      n++;
      if (truth === 'video') videoN++; else noneN++;
      let info = null; try { info = walkTexFirstMipmap(pre); } catch { /* 不可判定 */ }
      if (info) { if (info.isLz4) lz4mip++; else rawMip++; if (info.version === 4) v4++; }
      if (decd !== truth) { lie++; if (lie < 4) bad('前缀判定与整条解析不符: ' + e.path, 'prefix=' + decd + ' full=' + truth); }
    }
  }
  ok(lie === 0, n + ' 个 TEX 前缀判定无谎（video=' + videoN + ' none=' + noneN + '；mip0 LZ4=' + lz4mip + ' 裸=' + rawMip + ' TEXB0004=' + v4 + '）', lie ? lie + ' 处与整条解析不符' : '');
}

console.log('\n== E 路由 /custom-scene-video-check（关键路径上的那一步）==');
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-svh-'));
  process.on('exit', () => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* 忽略 */ } });
  const customDir = path.join(home, 'custom');
  const sceneDir = path.join(customDir, 'tex-scene');
  fs.mkdirSync(path.join(home, '.dsh-mpkg-wallpaper'), { recursive: true });
  fs.mkdirSync(sceneDir, { recursive: true });
  const src = corpusPkgs.find((p) => {
    const b = new Uint8Array(fs.readFileSync(p));
    const v = oldFindInPkg(b);
    return v && v.isTexEmbedded;
  }) || path.join(tmp, 'case-tex.pkg');
  // ①(2026-09-17 夹具纪律) 真包可能几百 MB：**符号链接**进夹具（<1MB），不拷贝；路由读同一份字节。
  fs.symlinkSync(src, path.join(sceneDir, 'scene.pkg'));
  fs.writeFileSync(path.join(home, '.dsh-mpkg-wallpaper', 'custom-dir.json'), JSON.stringify({ dir: customDir }));
  process.env.DSH_HOME = home;
  // ①(2026-09-17 假绿修复轮) 被测模块可换（变异自证：把 lib/ 拷到临时目录改坏一条路由 ⇒ 本文件必须红）
  const mi = process.argv.indexOf('--module');
  const MOD = (mi > 0 && process.argv[mi + 1]) ? process.argv[mi + 1] : (process.env.MPW_MODULE || '../lib/index.js');
  const { apply } = await import(MOD);
  const routes = [];
  apply({ webServer: { register: (r) => routes.push(r) }, loader: null, logger: { info() {}, warn() {}, error() {} } });
  class Res extends Writable {
    constructor() { super(); this.chunks = []; this.status = 0; this.headers = {}; }
    _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
    writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this; }
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
    get body() { return Buffer.concat(this.chunks); }
  }
  const call = async (url) => {
    const r = routes.find((x) => x.kind === 'exact' && x.path === '/api/mpkg-wallpaper/custom-scene-video-check');
    const res = new Res();
    const done = new Promise((resolve) => res.on('finish', resolve));
    await r.handler({ method: 'GET', url, headers: {} }, res);
    await Promise.race([done, new Promise((r2) => setTimeout(r2, 3000))]);
    return { status: res.status, body: JSON.parse(res.body.toString('utf8') || '{}') };
  };
  clearSceneVideoScanCache();
  const r1 = await call('/api/mpkg-wallpaper/custom-scene-video-check?folder=tex-scene');
  const st = fs.statSync(path.join(sceneDir, 'scene.pkg'));
  const buf = new Uint8Array(fs.readFileSync(path.join(sceneDir, 'scene.pkg')));
  const oldV = oldFindInPkg(buf);
  ok(r1.body.has === !!oldV && r1.body.size === (oldV ? oldV.bytes.length : undefined) && (!oldV || r1.body.mime === 'video/mp4'), '探测路由 {has,mime,size} 与旧实现一致', JSON.stringify(r1.body));
  const hash = crypto.createHash('sha256').update(sceneDir + '|' + st.mtimeMs + '|' + oldV.ref).digest('hex').slice(0, 24);
  const cacheFile = path.join(home, '.dsh-mpkg-wallpaper', 'scene-videos', hash + '.mp4');
  ok(fs.existsSync(cacheFile), '落盘缓存文件名 = 旧 hash 公式（升级后不重抽）', hash + '.mp4');
  if (fs.existsSync(cacheFile)) ok(sha(fs.readFileSync(cacheFile)) === sha(oldV.bytes), '落盘缓存内容 sha256 = 旧实现提取结果');
  const r2 = await call('/api/mpkg-wallpaper/custom-scene-video-check?folder=tex-scene');
  ok(JSON.stringify(r2.body) === JSON.stringify(r1.body), '二次探测结果不变（走缓存）');
  const videoRoute = routes.find((x) => x.kind === 'exact' && x.path === '/api/mpkg-wallpaper/custom-scene-video');
  ok(!!videoRoute, '/custom-scene-video 路由在位且能 200 给出 mp4');
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过') + '  （pass=' + pass + ' fail=' + fail + ' skip=' + skip + '）');
process.exit(fail ? 1 : 0);

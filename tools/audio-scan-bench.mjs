// tools/audio-scan-bench.mjs —— 用户第 1 条反馈「扫描音频的速度能否快些」的**计时台**
//
// 用途：把"音频扫描"拆成可比较的阶段，对真包给出一张耗时表。
//       基准（对照量）**按 docs/AUDIO-TRACK-SPEC.md 的表格字面量写**，不取自任何外部仓库/
//       渲染器文件；生产路径 = lib/pkg-extract.js 的惰性音频索引 scanSceneAudio。
//       （2026-09-16 洁净室重写前的版本自述"逐字复刻 demo.html"，已按规格改写 —— 见 THIRD-PARTY.md。）
// 复现：node tools/audio-scan-bench.mjs [--root <wallpaperRoot>] [--runs 3] [--json]
//
// 阶段（每个阶段取 --runs 次的**中位数**，单位 ms）：
//   A readFull       整包 fs.readFileSync（整包路径的第一刀）
//   B parsePkgFull   parsePkg(全量 buffer)：解析整张目录表
//   C enumSpecRef    规格参考枚举：遍历条目 → 后缀筛（规格 §1）→ 头 ≤16 字节 → 容器规则表 R1…R7（§3）
//                    （压缩条目按 §5.5 回落后缀；零拷贝 subarray，故意用最笨的"全表遍历"）
//   D inflateAll     逐条读满（.tex + 视频条目全读）—— 说明"整包解压"到底有多贵
//                    （插件自身的 scene 视频探测走的就是它）
//   E parseTexAll    parseTex 全部 .tex（"纹理全解析"的代理量，本机对照量）
//   F indexOnly      新路径冷启动：只读目录表 + 仅候选条目 ≤16 字节头
//   G indexOnlyWarm  新路径第二次（同 mtime+size → 进程内缓存命中）
//
// 退出码：0 = 跑完（不判优劣）；1 = 连语料都没有（无法测量）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePkg, readPkgEntry, parseTex, scanSceneAudio, clearPkgAudioIndexCache, pkgAudioIndexStats,
} from '../lib/pkg-extract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (k, dv) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : dv; };
const RUNS = Math.max(1, Number(argOf('--runs', 3)) || 3);
const AS_JSON = argv.includes('--json');

function pickRoot() {
  const cands = [
    argOf('--root', ''),
    process.env.MPW_SCENE_ROOT || '',
    '/root/Desktop/DSHarea/allwallpaper/dd',
    path.join(here, '..', 'samples', 'wallpapers'),
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c } catch { /* 下一个 */ } }
  return null;
}

/* ── 规格字面量（docs/AUDIO-TRACK-SPEC.md §1.2 后缀表 / §3.2 容器规则表）── */
const SPEC_SUFFIX_FALLBACK = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/mp4' };
const specSuffix = (p) => { const i = String(p).lastIndexOf('.'); return i < 0 ? '' : (SPEC_SUFFIX_FALLBACK[String(p).slice(i + 1).toLowerCase()] || '') };
const specSniff = (b) => {
  const ascii = (at, s) => { if (b.length < at + s.length) return false; for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false; return true };
  if (ascii(4, 'ftyp')) return 'audio/mp4';                                    // R1
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';                 // R2
  if (ascii(0, 'OggS')) return 'audio/ogg';                                     // R3
  if (ascii(0, 'fLaC')) return 'audio/flac';                                    // R4
  if (ascii(0, 'ID3')) return 'audio/mpeg';                                     // R5
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'audio/aac';              // R6（先于 R7）
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';             // R7
  return '';
};

const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)] };
function timeIt(fn) { const t = process.hrtime.bigint(); const out = fn(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, out } }

/** 规格参考枚举（**对照量**，只按 docs/AUDIO-TRACK-SPEC.md 的表格字面量写）：
 *  全表遍历 → 后缀筛（§1）→ 零拷贝取 ≤16 字节头 → 容器规则表（§3）；
 *  压缩条目按 §5.5 回落后缀（拿压缩字节做容器判定会说谎）。 */
function enumBySpec(buf, pkgEntries) {
  const tracks = [];
  for (const e of pkgEntries) {
    const p = e.path || e.name || '';
    const fallback = specSuffix(p);
    if (!fallback) continue;
    let mime = '';
    if (!(e.flags & 1)) {
      const head = buf.subarray(e.offset, Math.min(e.offset + 16, e.offset + e.compressedSize));
      mime = head.length ? specSniff(head) : '';
    }
    tracks.push({ path: p, size: e.size, mime: mime || fallback });
  }
  tracks.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return tracks;
}

function benchOne(pkgPath) {
  const n = (p) => path.basename(path.dirname(p));
  const stages = { readFull: [], parsePkgFull: [], enumSpecRef: [], inflateAll: [], parseTexAll: [], indexOnly: [], indexOnlyWarm: [] };
  let meta = null;
  for (let r = 0; r < RUNS; r++) {
    const A = timeIt(() => new Uint8Array(fs.readFileSync(pkgPath)));
    const buf = A.out;
    const B = timeIt(() => parsePkg(buf));
    const entries = B.out;
    const C = timeIt(() => enumBySpec(buf, entries));
    const D = timeIt(() => {
      let bytes = 0;
      for (const e of entries) {
        if (!/\.tex$/i.test(e.path) && !/\.(mp4|m4v|webm|mov)$/i.test(e.path)) continue;
        bytes += readPkgEntry(buf, e).length;
      }
      return bytes;
    });
    const E = timeIt(() => {
      let tex = 0;
      for (const e of entries) {
        if (!/\.tex$/i.test(e.path)) continue;
        try { parseTex(buf.slice(e.offset, e.offset + e.compressedSize)); tex++ } catch { /* 非 TEX/损坏 */ }
      }
      return tex;
    });
    clearPkgAudioIndexCache();
    const F = timeIt(() => scanSceneAudio(pkgPath));
    const G = timeIt(() => scanSceneAudio(pkgPath));
    stages.readFull.push(A.ms); stages.parsePkgFull.push(B.ms); stages.enumSpecRef.push(C.ms);
    stages.inflateAll.push(D.ms); stages.parseTexAll.push(E.ms);
    stages.indexOnly.push(F.ms); stages.indexOnlyWarm.push(G.ms);
    if (!meta) {
      const audio = entries.filter((e) => specSuffix(e.path));
      meta = {
        id: n(pkgPath), file: pkgPath, sizeMB: +(fs.statSync(pkgPath).size / 1048576).toFixed(1),
        entries: entries.length, audio: audio.length,
        audioMB: +(audio.reduce((a, e) => a + e.size, 0) / 1048576).toFixed(2),
        lz4: entries.filter((e) => e.flags & 1).length,
        inflateBytes: D.out, texAll: E.out,
        specRef: C.out, index: F.out.tracks,
        indexStats: { headReads: F.out.headReads, bytesRead: F.out.bytesRead, tableBytes: F.out.tableBytes, indexEntries: F.out.indexEntries },
        warmCacheHit: G.out.cacheHit,
        same: JSON.stringify(C.out) === JSON.stringify(F.out.tracks.map((t) => ({ path: t.path, size: t.size, mime: t.mime }))),
      };
    }
  }
  const med = {}; for (const k of Object.keys(stages)) med[k] = +median(stages[k]).toFixed(2);
  return { meta, med };
}

const root = pickRoot();
if (!root) { console.error('找不到壁纸语料（--root / MPW_SCENE_ROOT / allwallpaper/dd / samples/wallpapers）'); process.exit(1) }
const pkgs = [];
for (const d of fs.readdirSync(root).sort()) {
  const p = path.join(root, d, 'scene.pkg');
  if (fs.existsSync(p)) pkgs.push(p);
}
if (!pkgs.length) { console.error('语料里没有 scene.pkg: ' + root); process.exit(1) }

const results = pkgs.map(benchOne);
if (AS_JSON) { console.log(JSON.stringify(results, null, 2)); process.exit(0) }

console.log('语料: ' + root + '   runs=' + RUNS + '（每格 = 中位数 ms）');
console.log('对照实现 = docs/AUDIO-TRACK-SPEC.md 的规格字面量（后缀表 + 容器规则表），不取自渲染器\n');
console.log('id            pkgMB  entries  audio  A.readFull  B.parsePkg  C.enumSpecRef  D.inflateAll  E.parseTexAll  F.indexOnly  G.warm  F读字节  headReads');
for (const r of results) {
  const m = r.meta; const s = r.med;
  console.log(
    `${m.id.padEnd(13)} ${String(m.sizeMB).padStart(5)} ${String(m.entries).padStart(8)} ${String(m.audio).padStart(6)}` +
    `  ${String(s.readFull).padStart(10)}  ${String(s.parsePkgFull).padStart(10)}  ${String(s.enumSpecRef).padStart(13)}` +
    `  ${String(s.inflateAll).padStart(11)}  ${String(s.parseTexAll).padStart(12)}  ${String(s.indexOnly).padStart(11)}` +
    `  ${String(s.indexOnlyWarm).padStart(5)}  ${String(m.indexStats.bytesRead).padStart(7)}  ${String(m.indexStats.headReads).padStart(9)}`
  );
}
const bad = results.filter((r) => !r.meta.same || !r.meta.warmCacheHit);
console.log('\n与规格参考实现逐项一致: ' + (bad.length ? '✗ ' + bad.map((b) => b.meta.id).join(',') : '✓ ' + results.length + '/' + results.length) +
  '   二次扫描命中缓存: ' + (bad.length ? '✗' : '✓ ' + results.length + '/' + results.length));
console.log('（A/D/E 为对照量：整包读 / 全量解压 / 全量纹理解析各付多少；F/G 为音频索引本身）');

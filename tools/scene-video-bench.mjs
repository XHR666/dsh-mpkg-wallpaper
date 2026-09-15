// tools/scene-video-bench.mjs —— 用户第 1 条反馈 ⑥c 的计时台：`ensureSceneVideo` 改前/改后
//
// 这条路径为什么关键：client.js `applySceneWallpaper` 会 **await `checkSceneVideo(key)`**
// （→ 宿主 `/custom-scene-video-check` → `ensureSceneVideo`）**之后**才决定走静态帧还是内嵌视频——
// 也就是说它是"点使用 → 画面出来"之间的同步一步，客户端专门给它挂了 4s 超时
// （注释原话："host 端首查需同步读包/落盘（可达 1-3s）"）。
//
// 列：
//   oldCold  改前：readFileSync 整包 + parsePkg + collectSceneVideoFiles（每个 .tex 全量解析/LZ4 全解压）
//   newCold  改后：只读目录表 + 仅候选条目前缀（lib/pkg-extract.js scanSceneVideo）
//   newWarm  同一包第二次（同 path+mtime+size → 进程内缓存，读 0 字节）
//   oldRead/newRead 各路径实际读字节；entriesRead = 整条读取的条目数
//
// 复现: node tools/scene-video-bench.mjs [--root <dir>] [--runs 3] [--json]
//
// ⚠ 口径：这里量的是**插件侧那一步**（宿主探测 + 提取），不含渲染器 iframe 加载 / 浏览器解码 /
//   用户设备的磁盘冷启动——那几段本机量不到，报告中按"未定"标注。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePkg, readPkgEntry, collectSceneVideoFiles, scanSceneVideo, clearSceneVideoScanCache,
} from '../lib/pkg-extract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (k, dv) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : dv; };
const RUNS = Math.max(1, Number(argOf('--runs', 3)) || 3);
const AS_JSON = argv.includes('--json');
const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const timeIt = (fn) => { const t = process.hrtime.bigint(); const out = fn(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, out }; };
const VEXT = /\.(mp4|m4v|webm|mov)$/i;

/** 改前实现（index.js findSceneVideoInPkg 逐字复刻）。 */
function oldFindInPkg(pkgData) {
  const videos = collectSceneVideoFiles({ list: () => parsePkg(pkgData).map((e) => ({ path: e.path, read: () => readPkgEntry(pkgData, e) })) });
  if (!videos.length) return null;
  const standalone = videos.filter((v) => !v.isTexEmbedded);
  if (standalone.length) { standalone.sort((a, b) => (b.bytes.length || 0) - (a.bytes.length || 0)); return standalone[0]; }
  if (videos.length === 1) return videos[0];
  return null;
}

function pickRoot() {
  const cands = [argOf('--root', ''), process.env.MPW_SCENE_ROOT || '', '/root/Desktop/DSHarea/allwallpaper/dd', path.join(here, '..', 'samples', 'wallpapers')].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c; } catch { /* 下一个 */ } }
  return null;
}

const root = pickRoot();
if (!root) { console.error('找不到壁纸语料（--root / MPW_SCENE_ROOT / allwallpaper/dd / samples/wallpapers）'); process.exit(1); }
const pkgs = fs.readdirSync(root).map((d) => path.join(root, d, 'scene.pkg')).filter((p) => fs.existsSync(p)).sort();
if (!pkgs.length) { console.error('语料里没有 scene.pkg: ' + root); process.exit(1); }

const rows = [];
for (const p of pkgs) {
  const sizeMB = +(fs.statSync(p).size / 1048576).toFixed(1);
  const buf = new Uint8Array(fs.readFileSync(p));
  const entries = parsePkg(buf);
  const tex = entries.filter((e) => /\.tex$/i.test(e.path));
  const oldMs = [], newMs = [], warmMs = [];
  let meta = null;
  for (let r = 0; r < RUNS; r++) {
    const A = timeIt(() => oldFindInPkg(new Uint8Array(fs.readFileSync(p))));
    clearSceneVideoScanCache();
    const B = timeIt(() => scanSceneVideo(p));
    const C = timeIt(() => scanSceneVideo(p));
    oldMs.push(A.ms); newMs.push(B.ms); warmMs.push(C.ms);
    if (!meta) {
      const texHits = collectSceneVideoFiles({ list: () => entries.map((e) => ({ path: e.path, read: () => readPkgEntry(buf, e) })) }).filter((v) => v.isTexEmbedded).length;
      const standalone = entries.filter((e) => VEXT.test(e.path)).length;
      meta = {
        id: path.basename(path.dirname(p)), sizeMB, entries: entries.length, tex: tex.length,
        texMB: +(tex.reduce((a, e) => a + e.size, 0) / 1048576).toFixed(1),
        kind: standalone ? 'standalone' : texHits === 0 ? 'none' : texHits === 1 ? 'tex' : 'multi',
        ref: (B.out.video && B.out.video.ref) || null,
        newReadMB: +(B.out.bytesRead / 1048576).toFixed(2), entriesRead: B.out.entriesRead,
        warmBytes: C.out.bytesRead, same: (A.out ? A.out.ref : null) === (B.out.video ? B.out.video.ref : null),
      };
    }
  }
  rows.push({ meta, old: +median(oldMs).toFixed(1), cold: +median(newMs).toFixed(1), warm: +median(warmMs).toFixed(2) });
}

if (AS_JSON) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
console.log('语料: ' + root + '   runs=' + RUNS + '（每格 = 中位数 ms）\n');
console.log('id            pkgMB  entries  tex(TEX MB)  类别       改前 oldCold  改后 newCold  newWarm  改前读MB  改后读MB  entriesRead');
for (const r of rows) {
  const m = r.meta;
  console.log(
    `${m.id.padEnd(13)} ${String(m.sizeMB).padStart(5)} ${String(m.entries).padStart(8)}  ${String(m.tex + '(' + m.texMB + ')').padStart(11)}  ${m.kind.padEnd(10)}` +
    ` ${String(r.old).padStart(11)} ${String(r.cold).padStart(12)} ${String(r.warm).padStart(8)} ${String(m.sizeMB).padStart(9)} ${String(m.newReadMB).padStart(9)} ${String(m.entriesRead).padStart(11)}`
  );
}
const tot = (k) => +rows.reduce((a, r) => a + (k === 'old' ? r.old : k === 'cold' ? r.cold : r.warm), 0).toFixed(1);
const sum = (arr, k) => +arr.reduce((a, r) => a + r[k], 0).toFixed(1);
const byKind = (kind) => rows.filter((r) => r.meta.kind === kind);
console.log('\n合计（应用壁纸关键路径上、插件侧那一步）：改前 ' + tot('old') + 'ms → 改后 ' + tot('cold') + 'ms（冷）/ ' + tot('warm') + 'ms（热）');
for (const [kind, label] of [['none', '无内嵌视频（旧路径最亏：读满整包+全解压后判 null）'], ['multi', '多 TEX 视频（时间变化，旧规则 null；改后确认 2 条即停）'], ['tex', '唯一 TEX 内嵌（必须整条取出该 mp4，改动只在"不必读别的 TEX"）'], ['standalone', '独立视频条目']]) {
  const g = byKind(kind);
  if (!g.length) continue;
  console.log('  ' + label + '：' + g.length + ' 个包  ' + sum(g, 'old') + 'ms → ' + sum(g, 'cold') + 'ms（冷）/ ' + sum(g, 'warm') + 'ms（热）  读字节 ' + sum(g.map((r) => ({ v: r.meta.sizeMB })), 'v').toFixed(1) + 'MB → ' + sum(g.map((r) => ({ v: r.meta.newReadMB })), 'v').toFixed(1) + 'MB');
}
console.log('  逐项一致: ' + (rows.every((r) => r.meta.same) ? '✓ ' + rows.length + '/' + rows.length : '✗') + '   二次扫描读 0 字节: ' + (rows.every((r) => r.meta.warmBytes === 0) ? '✓' : '✗'));
console.log('（口径：插件侧那一步 = /custom-scene-video-check → ensureSceneVideo；不含渲染器 iframe/浏览器解码/真机冷盘）');

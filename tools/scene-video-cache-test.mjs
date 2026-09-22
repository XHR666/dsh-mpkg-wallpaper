// tools/scene-video-cache-test.mjs —— ①(2026-09-23 资源审计 #1) `sceneVideoScanCache` 的
//   **字节预算 / 逐出 / 回收 / 接线**门禁（docs/RESOURCE-AUDIT-20260923.md §2.1、主表第 1 行）。
//
// 为什么单开一个文件（而不是并进 tools/scene-video-test.mjs）：
//   既有那份 `scene-video-test.mjs` 的 B/C 段会**整包读**它发现的语料（本机 `../allwallpaper/dd`
//   是 2.3GB / 11 个 scene.pkg）——本机刚因内存压力自动重启（总 15GB、可用 ~4GB），
//   常驻门禁不能依赖那份语料。本文件**只用自造夹具**（全部夹具合计 3.71MiB、峰值堆 <64MB、
//   无浏览器 / 无网络 / 无 ffmpeg / 不读语料；实测 297ms），挂在 tools/check.sh 的**同一个
//   step（8/12）**下，不新增 step 编号。
//
// 判据（每条都能在"把修复改回去"时变红，见第 E 节四个变异体）：
//   A 默认闸门常量：字节预算 64MB / 单条上限 32MB / 条数 64 / TTL 10min（`sceneVideoScanStats()` 可读）
//   B 预算内小条目行为与改前一致：第一次未命中→第二次命中且读 0 字节→同一 video 对象→
//     hits/misses 计数、返回结构逐键不变、mtime 变化即失效、无视频负缓存仍在
//   C 超预算：每写一条后总字节 ≤ 预算、逐出真的发生（preReadEvictions + evictions）
//   D 逐出后旧引用不再被缓存持有（快照身份比对）+ 逐出后重扫必须重读；单条超上限不入缓存但仍完整返回
//   E TTL：超时条目在下次访问被清（过期后重扫未命中）；命中会刷新时间戳（TTL = 最后访问）
//   F 读前腾位置（preReadEvictions > 0 且 evictions == 0 ⇒ 逐出发生在整条读之前）
//   G 接线：换 scene 目录 ⇒ 缓存只剩当前场景（`lib/index.js` 的 `clearSceneVideoScanCache()` 真实调用点）
//   H 变异自证：① 去掉字节预算/单条上限 ② 去掉"读前腾位置" ③ 去掉 TTL sweep ④ 删掉 index.js 的清理调用
//     —— 四个变异体各自必须让上面某条判据变红（不是"看着像在守"，是真的有分辨力）
//
// 复现: node tools/scene-video-cache-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const LIB = path.join(ROOT, 'lib');
const PKG_EXTRACT = path.join(LIB, 'pkg-extract.js');
const INDEX_JS = path.join(LIB, 'index.js');
const BASE_ROUTE = '/api/mpkg-wallpaper';
const MIB = 1024 * 1024;
const TINY_BUDGET = 1 * MIB;          // 门禁预算：1MB（默认 64MB 跑同样的场景要写 70MB+ 字节，本机不合适）
const SMALL = 300 * 1024;             // 300KiB：3 条装得下，第 4 条触发逐出
const BIG_ITEM = 700 * 1024;          // 700KiB > 单条上限（预算的一半 = 512KiB）⇒ 不入缓存
const MID_ITEM = 400 * 1024;          // 400KiB ≤ 单条上限 ⇒ 读前腾位置那条路径

let pass = 0, fail = 0;
const ok = (cond, n, d) => { if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); } else { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')); } };
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* 夹具纪律：临时目录挂到 exit 上清理（断言中途抛异常也不留垃圾）。 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-svc-'));
const homes = [];
process.on('exit', () => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
  for (const h of homes) { try { fs.rmSync(h, { recursive: true, force: true }); } catch { /* 忽略 */ } }
});

/** 造一个"松散 scene 目录"：作者内嵌的独立视频文件（`SCENE_VIDEO_EXT_RE` 命中，不做容器校验，
 *  所以内容无关紧要；这里仍写一个像样的 ftyp 头，避免夹具误导后来人）。 */
function mkLooseScene(name, files) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, size] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const buf = Buffer.alloc(size, 0x40);
    Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).copy(buf, 0);
    fs.writeFileSync(p, buf);
  }
  return dir;
}
/** 与 `scanSceneVideo` 同款的键（scene 目录 = target，无 scene.pkg ⇒ source='dir'）。 */
function cacheKey(dir) {
  const st = fs.statSync(dir);
  return dir + '|' + st.mtimeMs + '|' + st.size + '|dir';
}

/* ═══════════ 夹具 ═══════════ */
const regDir = mkLooseScene('reg-small', { 'movies/a.mp4': 1024 });
const regNone = mkLooseScene('reg-none', { 'scene.json': 64 });
const budgetDirs = [0, 1, 2, 3, 4, 5].map((i) => mkLooseScene('budget-' + i, { 'movies/v.mp4': SMALL }));
const overDir = mkLooseScene('budget-oversize', { 'movies/big.mp4': BIG_ITEM });
const roomDirs = [0, 1, 2].map((i) => mkLooseScene('room-' + i, { 'movies/v.mp4': SMALL }));
const roomBig = mkLooseScene('room-mid', { 'movies/m.mp4': MID_ITEM });
const ttlDirs = [0, 1].map((i) => mkLooseScene('ttl-' + i, { 'movies/v.mp4': 1024 }));

/* ═══════════ 实例 ═══════════
 * `PLAIN` = 无 query 的常规实例（=> `lib/index.js` 内部 import 的**同一个**实例，G 节靠它观测）；
 * `DFLT` / `TINY` = 各带 query 的独立实例（ESM 按 URL 缓存 ⇒ 各自独立缓存与计数器）。
 * 预算在模块求值时读环境变量，所以顺序必须是：先 import 默认档，再设环境变量 import 小预算档。 */
const PLAIN = await import('../lib/pkg-extract.js');
const DFLT = await import('../lib/pkg-extract.js?budget=default');
process.env.MPW_SCENE_VIDEO_CACHE_BYTES = String(TINY_BUDGET);
const TINY = await import('../lib/pkg-extract.js?budget=tiny');

/* ═══════════ A 默认闸门常量 ═══════════ */
console.log('== A 默认闸门（生产档：64MB 字节预算 / 单条 32MB / 64 条 / TTL 10min）==');
{
  const st = DFLT.sceneVideoScanStats();
  ok(st.maxBytes === 64 * MIB, '字节预算 = 64MB', 'maxBytes=' + st.maxBytes);
  ok(st.maxItemBytes === 32 * MIB, '单条上限 = 预算的一半 = 32MB', 'maxItemBytes=' + st.maxItemBytes);
  ok(st.maxEntries === 64, '条数上限保留（但不再是唯一闸门）', 'maxEntries=' + st.maxEntries);
  ok(st.ttlMs === 10 * 60 * 1000, 'TTL = 10min', 'ttlMs=' + st.ttlMs);
  ok(st.bytes === 0 && st.entries === 0, '空缓存：bytes=0 / entries=0', JSON.stringify({ bytes: st.bytes, entries: st.entries }));
  ok(st.evictions === 0 && st.preReadEvictions === 0 && st.oversize === 0 && st.expired === 0,
    '新增计数器初值全 0（诊断字段）', JSON.stringify({ ev: st.evictions, pre: st.preReadEvictions, over: st.oversize, exp: st.expired }));
  const tinySt = TINY.sceneVideoScanStats();
  ok(tinySt.maxBytes === TINY_BUDGET && tinySt.maxItemBytes === TINY_BUDGET / 2,
    'MPW_SCENE_VIDEO_CACHE_BYTES 覆盖生效（门禁档 1MB / 单条 512KiB）',
    JSON.stringify({ maxBytes: tinySt.maxBytes, maxItemBytes: tinySt.maxItemBytes }));
}

/* ═══════════ B 回归：预算内小条目行为与改前一致 ═══════════ */
console.log('\n== B 回归：预算内的小条目（默认 64MB 档）行为与改前逐项一致 ==');
{
  DFLT.clearSceneVideoScanCache();
  const KEYS = ['bytesRead', 'cacheHit', 'entriesRead', 'indexEntries', 'ms', 'source', 'tableBytes', 'video'];
  const v1 = DFLT.scanSceneVideo(regDir);
  ok(Object.keys(v1).sort().join(',') === KEYS.join(','), '返回结构逐键不变（对外行为）', Object.keys(v1).join(','));
  ok(v1.cacheHit === false && v1.source === 'dir' && v1.indexEntries === 1 && v1.tableBytes === 0, '第一次未命中，source/indexEntries/tableBytes 不变', JSON.stringify({ source: v1.source, indexEntries: v1.indexEntries, tableBytes: v1.tableBytes }));
  ok(!!v1.video && v1.video.bytes.length === 1024 && sha(v1.video.bytes) === sha(fs.readFileSync(path.join(regDir, 'movies/a.mp4'))), '返回整段视频字节且内容一致（sha256）');
  const v2 = DFLT.scanSceneVideo(regDir);
  ok(v2.cacheHit === true && v2.entriesRead === 0 && v2.bytesRead === 0, '第二次命中且读 0 字节（缓存语义不变）', 'entriesRead=' + v2.entriesRead + ' bytesRead=' + v2.bytesRead);
  ok(v1.video === v2.video && sha(v2.video.bytes) === sha(v1.video.bytes), '命中返回同一 video 对象（含 bytes）');
  const st = DFLT.sceneVideoScanStats();
  ok(st.hits === 1 && st.misses === 1 && st.entries === 1 && st.bytes === 1024, '计数器与字节记账一致', JSON.stringify({ hits: st.hits, misses: st.misses, entries: st.entries, bytes: st.bytes }));
  const snap = DFLT.sceneVideoScanCacheSnapshot();
  ok(snap.length === 1 && snap[0].key === cacheKey(regDir) && snap[0].bytes === 1024 && snap[0].video === v1.video, '快照键/字节/引用与刚写入的一致');
  // 无视频负缓存（改前就有，必须保留）
  DFLT.clearSceneVideoScanCache();
  const n1 = DFLT.scanSceneVideo(regNone);
  const n2 = DFLT.scanSceneVideo(regNone);
  ok(n1.video === null && n1.cacheHit === false && n2.cacheHit === true, '无视频也负缓存（video=null，第二次命中）', JSON.stringify({ c1: n1.cacheHit, c2: n2.cacheHit }));
  // mtime 变化即失效（改前行为）
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(regDir, past, past);
  const v3 = DFLT.scanSceneVideo(regDir);
  ok(v3.cacheHit === false && v3.video.bytes.length === 1024, 'mtime 变化 → 失效重扫（行为不变）');
  fs.utimesSync(regDir, past, past);   // 后面的场景也用这个目录：保持 mtime 稳定
}

/* ═══════════ C/D 字节预算 + 逐出 + 旧引用释放（1MB 档） ═══════════ */
console.log('\n== C/D 超预算（1MB 预算；6 × 300KiB ⇒ 必须逐出）==');
function budgetScenario(mod) {
  mod.clearSceneVideoScanCache();
  const refs = [], series = [];
  for (const d of budgetDirs) { const r = mod.scanSceneVideo(d); refs.push(r.video); series.push(mod.sceneVideoScanStats().bytes); }
  const st = mod.sceneVideoScanStats();
  const snap = mod.sceneVideoScanCacheSnapshot();
  const again = mod.scanSceneVideo(budgetDirs[0]);
  return { refs, series, st, snap, again };
}
const bReal = budgetScenario(TINY);
ok(Math.max(...bReal.series) <= TINY_BUDGET, '每写入一条之后总字节 ≤ 预算', '逐条 bytes=[' + bReal.series.join(',') + '] 预算=' + TINY_BUDGET);
ok(bReal.st.evictions + bReal.st.preReadEvictions >= 3, '逐出真的发生（6 条 300KiB 写进 1MB 预算）', JSON.stringify({ evictions: bReal.st.evictions, preReadEvictions: bReal.st.preReadEvictions }));
ok(bReal.snap.reduce((s, e) => s + e.bytes, 0) === bReal.st.bytes && bReal.st.bytes <= TINY_BUDGET, '快照字节和 = 记账字节且 ≤ 预算', 'snapshot=' + bReal.snap.reduce((s, e) => s + e.bytes, 0) + ' stats=' + bReal.st.bytes);
ok(bReal.snap.length === Math.min(3, budgetDirs.length) && !bReal.snap.some((e) => e.video === bReal.refs[0]), '★ 被逐出的第 1 条 video 引用不再被缓存持有（快照身份比对）', 'snapshot entries=' + bReal.snap.length);
ok(bReal.snap.every((e) => e.video === null || e.video.bytes.length === SMALL) && !bReal.snap.some((e) => e.video === null), '★ 存活条目 = 最后几条（LRU/插入序）', bReal.snap.map((e) => e.key.split('|')[0].split('/').pop()).join(','));
ok(bReal.again.cacheHit === false && bReal.again.bytesRead === SMALL, '★ 逐出后重扫未命中（必须重读 = 缓存真的没扣着它）', 'cacheHit=' + bReal.again.cacheHit + ' bytesRead=' + bReal.again.bytesRead);

console.log('\n== D2 单条超上限：不入缓存，但仍完整返回给调用方 ==');
{
  TINY.clearSceneVideoScanCache();
  const r = TINY.scanSceneVideo(overDir);
  const st = TINY.sceneVideoScanStats();
  ok(!!r.video && r.video.bytes.length === BIG_ITEM, '超上限条目仍完整返回（调用方要落盘，行为不能变）', 'bytes=' + (r.video && r.video.bytes.length));
  ok(st.oversize === 1 && st.bytes === 0 && st.entries === 0, '单条 >预算/2 ⇒ 不入缓存（oversize=1，bytes=0）', JSON.stringify({ oversize: st.oversize, bytes: st.bytes, entries: st.entries }));
  ok(!TINY.sceneVideoScanCacheSnapshot().some((e) => e.key === cacheKey(overDir)), '快照里没有它（常驻 0 字节）');
  ok(TINY.scanSceneVideo(overDir).cacheHit === false, '重扫仍重读（没有偷偷驻留）');
}

/* ═══════════ F 读前腾位置 ═══════════ */
console.log('\n== F 整条读**之前**先腾位置（避免"先读进堆再淘汰"的双倍峰值）==');
{
  TINY.clearSceneVideoScanCache();
  for (const d of roomDirs) TINY.scanSceneVideo(d);          // 3 × 300KiB = 900KiB（未逐出）
  const before = TINY.sceneVideoScanStats();
  const r = TINY.scanSceneVideo(roomBig);                    // 400KiB：900KiB + 400KiB > 1MB ⇒ 读前必须腾
  const after = TINY.sceneVideoScanStats();
  ok(before.bytes === 3 * SMALL && before.evictions + before.preReadEvictions === 0, '前置状态：3 条 900KiB 未逐出', 'bytes=' + before.bytes);
  ok(after.preReadEvictions >= 1 && after.evictions === 0, '★ 读前腾位置生效（preReadEvictions=' + after.preReadEvictions + '，没有走"读完再淘汰"）', JSON.stringify({ pre: after.preReadEvictions, ev: after.evictions }));
  ok(after.bytes <= TINY_BUDGET && r.cacheHit === false && r.video.bytes.length === MID_ITEM, '腾完刚好装下且总字节 ≤ 预算', 'bytes=' + after.bytes);
}

/* ═══════════ E TTL 过期 ═══════════ */
console.log('\n== E TTL：超时条目在下次访问时被清；命中刷新时间戳 ==');
{
  TINY.clearSceneVideoScanCache();
  TINY.scanSceneVideo(ttlDirs[0]); TINY.scanSceneVideo(ttlDirs[1]);
  const base = Date.now();
  const realNow = Date.now;
  let hitAt9 = null, at18 = null, rescan8 = null, st = null, snap = null;
  try {
    Date.now = () => base + 9 * 60 * 1000;
    hitAt9 = TINY.scanSceneVideo(ttlDirs[0]);                        // 9min：都还活着，顺带把 [0] 的时间戳刷新
    Date.now = () => base + 18 * 60 * 1000;
    at18 = TINY.scanSceneVideo(ttlDirs[0]);                          // 18min：[1] 是插入时间（18min）⇒ 该过期；[0] 是 9min ⇒ 活着
    st = TINY.sceneVideoScanStats();
    snap = TINY.sceneVideoScanCacheSnapshot();                       // 必须在重扫 [1] 之前取：重扫本身会把它重新写回缓存
    Date.now = () => base + 19 * 60 * 1000;
    rescan8 = TINY.scanSceneVideo(ttlDirs[1]);                       // 被清掉的那条：必须重读
  } finally { Date.now = realNow; }
  ok(hitAt9.cacheHit === true && at18.cacheHit === true, '★ TTL 按"最后访问"算：9min 命中刷新后 18min 仍命中', JSON.stringify({ at9: hitAt9.cacheHit, at18: at18.cacheHit }));
  ok(st.expired >= 1, '★ 超 TTL 的条目（18min 没动过）在下次访问时被清', 'expired=' + st.expired);
  ok(!snap.some((e) => e.key === cacheKey(ttlDirs[1])), '快照里不再有它（字节已归还记账）');
  ok(rescan8.cacheHit === false && rescan8.bytesRead === 1024, '过期后重扫未命中（要重读 1KiB）', 'cacheHit=' + rescan8.cacheHit + ' bytesRead=' + rescan8.bytesRead);
}

/* ═══════════ G 接线：换 scene 目录 ⇒ 清缓存 ═══════════ */
console.log('\n== G 接线：`lib/index.js` 换 scene 目录时调用 clearSceneVideoScanCache() ==');
/** 起一套假宿主夹具（DSH_HOME + custom-dir.json + 两个松散 scene 目录），驱动真路由两次（A → B）。 */
async function wiringScenario(indexPath, query) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-svw-'));
  homes.push(home);
  fs.mkdirSync(path.join(home, '.dsh-mpkg-wallpaper'), { recursive: true });
  const customDir = path.join(home, 'custom');
  const dirA = path.join(customDir, 'scene-a'), dirB = path.join(customDir, 'scene-b');
  for (const [d, name] of [[dirA, 'a.mp4'], [dirB, 'b.mp4']]) {
    fs.mkdirSync(path.join(d, 'movies'), { recursive: true });
    fs.writeFileSync(path.join(d, 'movies', name), Buffer.alloc(1024, 0x40));
  }
  fs.writeFileSync(path.join(home, '.dsh-mpkg-wallpaper', 'custom-dir.json'), JSON.stringify({ dir: customDir }));
  process.env.DSH_HOME = home;                       // DATA_DIR 在模块求值时读它 ⇒ 每个实例各起一次
  // ①(夹具纪律) `apply()` 会调 `pruneDiagDir('启动')`，而 DIAG_DIR 的兜底是 **os.homedir()**
  //   （不是 DSH_HOME）⇒ 不重定向就会去动用户真实的 ~/.dsh/.dsh-mpkg-wallpaper/diag。
  //   `lib/index.js:1595` 明确为这种事留了 DSH_WE_DIAG_DIR（"换目录才能在不碰用户真实目录的前提下验清理路径"）。
  process.env.DSH_WE_DIAG_DIR = path.join(home, 'diag');
  const mod = await import(pathToFileURL(indexPath).href + '?' + query);
  const routes = [];
  mod.apply({ webServer: { register: (r) => routes.push(r) }, loader: null, logger: { info() {}, warn() {}, error() {} } });
  class Res extends Writable {
    constructor() { super(); this.chunks = []; this.status = 0; }
    _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
    writeHead(code) { this.status = code; return this; }
    setHeader() { return this; }
    get body() { return Buffer.concat(this.chunks); }
  }
  const route = routes.find((x) => x.kind === 'exact' && x.path === BASE_ROUTE + '/custom-scene-video-check');
  if (!route) throw new Error('路由 /custom-scene-video-check 没注册');
  const call = async (folder) => {
    const res = new Res();
    const done = new Promise((r) => res.on('finish', r));
    await route.handler({ method: 'GET', url: BASE_ROUTE + '/custom-scene-video-check?folder=' + folder, headers: {} }, res);
    await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
    return { status: res.status, body: JSON.parse(res.body.toString('utf8') || '{}') };
  };
  PLAIN.clearSceneVideoScanCache();
  const ra = await call('scene-a');
  const keysA = PLAIN.sceneVideoScanCacheSnapshot().map((e) => e.key);
  const rb = await call('scene-b');
  const keysB = PLAIN.sceneVideoScanCacheSnapshot().map((e) => e.key);
  return { home, dirA, dirB, ra, rb, keysA, keysB };
}
{
  const real = await wiringScenario(INDEX_JS, 'wiring=real');
  ok(real.ra.body.has === true && real.ra.body.size === 1024 && real.rb.body.has === true, '路由探测行为不变（has/size）', JSON.stringify({ a: real.ra.body, b: real.rb.body }));
  ok(real.keysA.length === 1 && real.keysA[0].startsWith(real.dirA + '|'), '场景 A 的扫描结果进了缓存（本测试与 lib/index.js 共用同一 pkg-extract 实例）', real.keysA.join(','));
  ok(real.keysB.length === 1 && real.keysB[0].startsWith(real.dirB + '|'), '★ 换到场景 B ⇒ 缓存只剩 B（A 的整段字节被清掉/可回收）', real.keysB.map((k) => k.split('|')[0].split('/').pop()).join(','));
}

/* ═══════════ H 变异自证（把修复改回去必须变红） ═══════════ */
console.log('\n== H 变异自证（判据的分辨力）==');
/** 按锚点替换生成变异体源码；锚点命中数不符（= 源码形状变了）直接判红，避免"变异没生效=假绿"。
 *  `dir` 决定变异体落在哪：pkg-extract 的变异体只 import node 内建模块，随便放；
 *  index.js 的变异体要落在"lib/ 符号链接农场"里才能解析它那一堆相对 import（见 mutantLibFarm）。 */
function mutateText(src, label, edits) {
  let out = src;
  for (const e of edits) {
    const n = out.split(e.find).length - 1;
    if (n !== 1) throw new Error('锚点命中 ' + n + ' 次（期望 1）：' + e.find.slice(0, 70));
    out = out.split(e.find).join(e.replace);
  }
  if (out === src) throw new Error('没有改动源码');
  return out;
}
function mutateSource(src, label, edits, dir = tmp) {
  const p = path.join(dir, 'mutant-' + label + '.mjs');
  fs.writeFileSync(p, mutateText(src, label, edits), 'utf8');
  return p;
}
/** lib/ 的符号链接农场：除 index.js 换成变异体外，其余条目全是符号链接（0 字节、秒级）。
 *  Node 默认对 ESM 做 realpath ⇒ 农场里的 `./pkg-extract.js` 解析回真文件、与 PLAIN 是同一实例。 */
function mutantLibFarm(mutatedIndexSrc) {
  const dir = path.join(tmp, 'mutant-lib');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(LIB)) {
    const link = path.join(dir, name);
    if (name === 'index.js') continue;
    try { fs.symlinkSync(path.join(LIB, name), link); } catch { /* 已存在 */ }
  }
  fs.writeFileSync(path.join(dir, 'index.js'), mutatedIndexSrc, 'utf8');
  const pkg = path.join(tmp, 'package.json');                 // index.js 里有 new URL('../package.json', import.meta.url)
  if (!fs.existsSync(pkg)) { try { fs.symlinkSync(path.join(ROOT, 'package.json'), pkg); } catch { /* 已存在 */ } }
  return dir;
}
const pkgSrc = fs.readFileSync(PKG_EXTRACT, 'utf8');
const idxSrc = fs.readFileSync(INDEX_JS, 'utf8');
process.env.MPW_SCENE_VIDEO_CACHE_BYTES = String(TINY_BUDGET);   // 变异体一律走 1MB 档
// ① 去掉整套字节闸门（= 改回"只按条数 64"的旧实现：set 侧不设限、evict 侧不看字节、读前也不腾位置）
try {
  const p = mutateSource(pkgSrc, 'no-byte-budget', [
    { find: '(sceneVideoScanBytes > SCENE_VIDEO_SCAN_CACHE_MAX_BYTES ||', replace: '(false ||' },
    { find: 'if (len > SCENE_VIDEO_SCAN_CACHE_MAX_ITEM_BYTES || len > SCENE_VIDEO_SCAN_CACHE_MAX_BYTES) {', replace: 'if (false) {' },
    { find: 'if (useCache) sceneVideoCacheMakeRoom(predicted);', replace: '/* 变异体：读前不腾位置 */' },
  ]);
  const M = await import(pathToFileURL(p).href);
  const m = budgetScenario(M);
  ok(Math.max(...m.series) > TINY_BUDGET && m.st.evictions + m.st.preReadEvictions === 0,
    '★ 变异体「去掉整套字节闸门」变红（修复前语义：6×300KiB 全驻留，超预算、零逐出）',
    '逐条 bytes=[' + m.series.join(',') + '] 预算=' + TINY_BUDGET + ' 逐出=' + (m.st.evictions + m.st.preReadEvictions));
} catch (e) { bad('变异体「去掉整套字节闸门」没跑起来', String(e && e.message || e)); }
// ② 只去掉"整条读之前腾位置"（set 侧闸门仍在 ⇒ 预算是"读完再淘汰"，瞬时峰值回来了）
try {
  const p = mutateSource(pkgSrc, 'no-make-room', [
    { find: 'if (useCache) sceneVideoCacheMakeRoom(predicted);', replace: '/* 变异体：读前不腾位置 */' },
  ]);
  const M = await import(pathToFileURL(p).href);
  M.clearSceneVideoScanCache();
  for (const d of roomDirs) M.scanSceneVideo(d);
  const r = M.scanSceneVideo(roomBig);
  const st = M.sceneVideoScanStats();
  ok(st.preReadEvictions === 0 && st.evictions >= 1 && r.video.bytes.length === MID_ITEM,
    '★ 变异体「去掉读前腾位置」变红（逐出退化成"读完再淘汰"）', JSON.stringify({ pre: st.preReadEvictions, ev: st.evictions }));
} catch (e) { bad('变异体「去掉读前腾位置」没跑起来', String(e && e.message || e)); }
// ③ 去掉 TTL sweep
try {
  const p = mutateSource(pkgSrc, 'no-ttl-sweep', [
    { find: 'if (useCache) sceneVideoCacheSweep(Date.now());', replace: '/* 变异体：不清过期 */' },
  ]);
  const M = await import(pathToFileURL(p).href);
  M.clearSceneVideoScanCache();
  M.scanSceneVideo(ttlDirs[0]); M.scanSceneVideo(ttlDirs[1]);
  const base = Date.now(); const realNow = Date.now;
  let st = null, snap = [];
  try {
    Date.now = () => base + 18 * 60 * 1000;
    M.scanSceneVideo(ttlDirs[0]);
    st = M.sceneVideoScanStats();
    snap = M.sceneVideoScanCacheSnapshot();
  } finally { Date.now = realNow; }
  ok(st.expired === 0 && snap.some((e) => e.key === cacheKey(ttlDirs[1])),
    '★ 变异体「去掉 TTL sweep」变红（18min 没动过的条目还扣在缓存里）', 'expired=' + st.expired + ' entries=' + snap.length);
} catch (e) { bad('变异体「去掉 TTL sweep」没跑起来', String(e && e.message || e)); }
// ④ 删掉 lib/index.js 里的清理调用（= 回到"清理函数零调用"的审计现场）
try {
  const farm = mutantLibFarm(mutateText(idxSrc, 'no-wiring', [
    { find: 'clearSceneVideoScanCache();', replace: '/* 变异体：不调用清理 */' },
  ]));
  const mut = await wiringScenario(path.join(farm, 'index.js'), 'wiring=mutant');
  ok(mut.keysB.some((k) => k.startsWith(mut.dirA + '|')) && mut.keysB.length === 2,
    '★ 变异体「删掉清理调用」变红（换场景后 A、B 两条整段字节都还驻留）',
    mut.keysB.map((k) => k.split('|')[0].split('/').pop()).join(','));
} catch (e) { bad('变异体「删掉清理调用」没跑起来', String(e && e.message || e)); }

console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过') + '  （pass=' + pass + ' fail=' + fail + '）');
process.exit(fail ? 1 : 0);

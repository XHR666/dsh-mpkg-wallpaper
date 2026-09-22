// tools/scene-video-probe-fail-test.mjs —— ①(2026-09-23 静默失败审计 #3)
//   `lib/index.js` 的 `ensureSceneVideo()` **三态判定**门禁（../docs/SILENT-FAILURE-AUDIT-20260923.md
//   §A-3 表 #3/#4：`753`/`756`/`3002` 与 `763`/`766`/`767`，行号会漂，以函数名+判据为准）。
//
// 为什么单开一条（而不是并进 tools/scene-video-test.mjs / scene-video-cache-test.mjs）：
//   那两份的语义分别是"真包逐项一致"与"整段字节缓存的预算/逐出/接线"；本条的语义是**失败态的分辨力**：
//   `ensureSceneVideo` 改前把三种状态压成同一个 `null`，两条路由于是给出同一个答案 ——
//     ① 真·无内嵌视频（探测成功、结论就是"没有"）⇒ 200 `has:false` / 404（**正确，必须保留**）；
//     ② 探测抛异常（快路径 `scanSceneVideo` 抛 **且** 兜底口径 `findSceneVideoInPkg/Dir` 也抛）
//        ⇒ 改前落进 `catch { video = null }`，再写 `{hash:null}` 负缓存 ⇒ 答案永久粘死成 200 `has:false`；
//     ③ 提取成功但**落盘失败** ⇒ 改前静默吞掉，照写 `{hash}` 索引 + 照返回 `{path}`
//        ⇒ `/custom-scene-video-check` 回 200 `has:true`，客户端却拿到必然 404 的 scene-video URL。
//   本文件只做**纯 Node 自造夹具**（合计 <8KiB、峰值堆 <16MB、无浏览器 / 无网络 / 无 ffmpeg /
//   不读 ../allwallpaper/dd 语料 —— 本机总内存 15GB、可用 ~4GB 且刚因内存压力自动重启，
//   常驻门禁不能依赖那份 2.3GB 语料；整轮实测 <300ms）。
//
// 断言组标签约定（**变异自证靠它 grep，改前缀 = 改判据契约**）：
//   每条断言的标签以「组字母 + 空格」开头（`A …` / `B …` / `C …` / `D …`），失败行因此长成 `✗ B …`；
//   E 节的变异自证只 grep 目标组的前缀（`✗ B` 证明"删掉探测失败的抛错"这一变异被抓住，`✗ C` 同理），
//   并断言**只有**目标组变红（变异不该顺手打红别的判据）。所以标签前缀是判据的一部分，不要改。
//
// 复现: node tools/scene-video-probe-fail-test.mjs
//       node tools/scene-video-probe-fail-test.mjs --no-mutations   # 只跑主体（变异子进程用的就是它）
//       node tools/scene-video-probe-fail-test.mjs --module <path>  # 对副本跑（同 scene-video-test.mjs 的
//                                                                   # `--module`，默认 ../lib/index.js）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const LIB = path.join(ROOT, 'lib');
const INDEX_JS = path.join(LIB, 'index.js');
const BASE_ROUTE = '/api/mpkg-wallpaper';
const VIDEO_LEN = 1024;
// ①(同 tools/scene-video-test.mjs `--module`) 被测模块可换：变异自证把改坏的副本喂进来。
const mi = process.argv.indexOf('--module');
const MODULE = (mi > 0 && process.argv[mi + 1]) ? path.resolve(process.cwd(), process.argv[mi + 1]) : INDEX_JS;
const NO_MUT = process.argv.includes('--no-mutations');

let pass = 0, fail = 0;
const ok = (cond, n, d) => { if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); } else { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')); } };
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* 夹具纪律：临时目录挂 `exit` 上清理（断言中途抛异常也不留垃圾）。 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-svpf-'));
const homes = [];
process.on('exit', () => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
  for (const h of homes) { try { fs.rmSync(h, { recursive: true, force: true }); } catch { /* 忽略 */ } }
});

/** 松散 scene 目录夹具（同 tools/scene-video-cache-test.mjs 的 mkLooseScene）：作者内嵌的独立视频文件
 *  （`SCENE_VIDEO_EXT_RE` 命中，不做容器校验，所以内容无关紧要；仍写一个像样的 ftyp 头，避免误导后来人）。 */
function mkLooseScene(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  const made = {};
  for (const [rel, size] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const buf = Buffer.alloc(size, 0x40);
    Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).copy(buf, 0);
    fs.writeFileSync(p, buf);
    made[rel] = buf;
  }
  return made;
}

/* ═══════════ 夹具（全部自造；customDir = tmp，各 case 是它的子目录） ═══════════ */
// A：真·无视频（只有 scene.json）
const dirNone = path.join(tmp, 'case-none');
mkLooseScene(dirNone, { 'scene.json': 64 });
// B：探测必抛 —— `scene.pkg` 是**目录** ⇒ 兜底口径 `readFileSync(pkgPath)` 必抛 EISDIR。
//   ⚠ 只放一个目录还不够：快路径 `scanSceneVideo(pkgPath)` 会把"目录"当松散目录走（source='dir'，
//   内部 readdir/stat 全 catch）⇒ 它**返回 null 而不是抛**，B 就退化成"真·无视频"了
//   （本机实测：空目录 → fast OK video=null source=dir）。所以再往里放一个垃圾 `scene.pkg/scene.pkg`，
//   让快路径走 'pkg' 分支（目录里有 scene.pkg ⇒ target=那个文件）并在解析目录表时抛
//   `pkg: invalid string length …`（本机实测）。这样**两级都抛** = 审计 §A-3 的第 ② 态。
const dirDetect = path.join(tmp, 'case-detect');
fs.mkdirSync(path.join(dirDetect, 'scene.pkg'), { recursive: true });
fs.writeFileSync(path.join(dirDetect, 'scene.pkg', 'scene.pkg'), Buffer.alloc(64, 0x40));
// C / D：真的含内嵌视频的松散 scene（唯一的区别是宿主侧 scene-videos 能不能写）
const dirWrite = path.join(tmp, 'case-write');
const bytesWrite = mkLooseScene(dirWrite, { 'movies/a.mp4': VIDEO_LEN });
const dirOk = path.join(tmp, 'case-ok');
const bytesOk = mkLooseScene(dirOk, { 'movies/a.mp4': VIDEO_LEN });
const REF = 'movies/a.mp4';

/** 被测函数的落盘文件名公式（lib/index.js 内联：sha256(dir|mtimeMs|ref).slice(0,24) + '.mp4'）。
 *  无 scene.pkg ⇒ `st = statSync(dir)`（目录）。夹具在探测前后都没被写过，mtime 稳定。 */
function wouldBeCacheFile(dataDir, sceneDir, ref) {
  const st = fs.statSync(sceneDir);
  const h = crypto.createHash('sha256').update(sceneDir + '|' + st.mtimeMs + '|' + ref).digest('hex').slice(0, 24);
  return path.join(dataDir, 'scene-videos', h + '.mp4');
}

/* ═══════════ 路由桩夹具（模型：tools/scene-video-cache-test.mjs 的 wiringScenario） ═══════════
 * 每个 home 一份独立实例（DATA_DIR 在模块求值时读 DSH_HOME ⇒ 必须换 import query 才能换 home）。 */
let harnessSeq = 0;
async function harness(indexPath, opts = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-svpf-home-'));
  homes.push(home);
  const dataDir = path.join(home, '.dsh-mpkg-wallpaper');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'custom-dir.json'), JSON.stringify({ dir: tmp }));
  // ①(夹具纪律) `apply()` 会调 `pruneDiagDir('启动')`，而 DIAG_DIR 的兜底是 **os.homedir()**（不是
  //   DSH_HOME）⇒ 不重定向就会去动用户真实的 ~/.dsh/.dsh-mpkg-wallpaper/diag（同 scene-video-cache-test）。
  process.env.DSH_HOME = home;
  process.env.DSH_WE_DIAG_DIR = path.join(home, 'diag');
  // C 的前提：宿主缓存目录位置被一个**普通文件**占住 ⇒ 提取产物必然写不进去（ENOTDIR）。
  if (opts.brokenSceneVideos) fs.writeFileSync(path.join(dataDir, 'scene-videos'), 'not a directory');
  const mod = await import(pathToFileURL(indexPath).href + '?svpf=' + (++harnessSeq));
  const routes = [];
  mod.apply({ webServer: { register: (r) => routes.push(r) }, loader: null, logger: { info() {}, warn() {}, error() {} } });
  class Res extends Writable {
    constructor() { super(); this.chunks = []; this.status = 0; this.headers = {}; }
    _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
    writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this; }
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
    get body() { return Buffer.concat(this.chunks); }
  }
  const call = async (routePath, folder) => {
    const route = routes.find((x) => x.kind === 'exact' && x.path === BASE_ROUTE + routePath);
    if (!route) throw new Error('路由没注册: ' + routePath);
    const res = new Res();
    const done = new Promise((r) => res.on('finish', r));
    await route.handler({ method: 'GET', url: BASE_ROUTE + routePath + '?folder=' + folder, headers: {} }, res);
    await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
    const text = res.body.toString('utf8');
    let body = null;
    try { body = JSON.parse(text); } catch { body = { __raw: text.slice(0, 200) }; }
    return { status: res.status, body, bytes: res.body, headers: res.headers };
  };
  return { home, dataDir, call };
}

/* 与 `lib/index.js` 内部 import 的**同一个** pkg-extract 实例（ESM 按 URL 缓存；变异体在"符号链接农场"
 * 里，Node 对 ESM 默认 realpath ⇒ 也解析回真文件、仍是同一实例）。用它证明"没有重探"：
 * 索引缓存命中时 `scanSceneVideo` 根本不会被调用 ⇒ 清空后它不会被写回去。 */
const PLAIN = await import('../lib/pkg-extract.js');

const hMain = await harness(MODULE);                                  // A / B / D：正常可写的 home
const hBadWrite = await harness(MODULE, { brokenSceneVideos: true }); // C：scene-videos 被普通文件占位

/* ═══════════ A 真·无视频：200 has:false + 负缓存（第二次不许重探） ═══════════ */
console.log('== A 真·无视频（只探测成功、结论就是"没有"）⇒ 200 {ok:true,has:false} + 负缓存 ==');
{
  const r1 = await hMain.call('/custom-scene-video-check', 'case-none');
  ok(r1.status === 200 && r1.body && r1.body.ok === true && r1.body.has === false,
    'A 真·无视频 ⇒ 200 {ok:true,has:false}（保持改前语义）', 'status=' + r1.status + ' body=' + JSON.stringify(r1.body));
  PLAIN.clearSceneVideoScanCache();   // 清掉快路径自己的扫描缓存：第二次若"重探"就必然再写回一条
  const r2 = await hMain.call('/custom-scene-video-check', 'case-none');
  ok(r2.status === 200 && r2.body && r2.body.has === false,
    'A 第二次仍是 200 has:false（负缓存答案不变）', 'status=' + r2.status + ' body=' + JSON.stringify(r2.body));
  const entries = PLAIN.sceneVideoScanCacheSnapshot().length;
  ok(entries === 0,
    'A 第二次**没有重探**（清空后 pkg-extract 扫描缓存仍为 0 条 ⇒ 走的是 sceneVideoIndex 的负缓存）',
    'entries=' + entries);
}

/* ═══════════ B 探测错误（两级都抛）：必须 500，且不许写负缓存 ═══════════ */
console.log('\n== B 探测错误（快路径抛 + 兜底口径也抛）⇒ 500，且第二次不许被负缓存洗白 ==');
{
  const r1 = await hMain.call('/custom-scene-video-check', 'case-detect');
  ok(r1.status === 500,
    'B 探测失败 ⇒ 500（不是 200 has:false）', 'status=' + r1.status + ' body=' + JSON.stringify(r1.body));
  const msg = String((r1.body && r1.body.error) || '');
  ok(/探测失败/.test(msg) && msg.includes(dirDetect) && /EISDIR|invalid string length|目录表/.test(msg),
    'B 500 的原因里带目录 + 真实异常（不是空错误 / 不是"没有视频"）', msg.slice(0, 220));
  const r2 = await hMain.call('/custom-scene-video-check', 'case-detect');
  ok(r2.status === 500,
    'B 第二次调用**仍** 500（错误没被写成粘死的负缓存）', 'status=' + r2.status + ' body=' + JSON.stringify(r2.body));
}

/* ═══════════ C 落盘失败（scene-videos 是普通文件）：必须 500，不许写索引 / 返回 path ═══════════ */
console.log('\n== C 提取成功但落盘失败（DATA_DIR/scene-videos 是普通文件）⇒ 500，不许回 has:true ==');
{
  const r1 = await hBadWrite.call('/custom-scene-video-check', 'case-write');
  ok(r1.status === 500,
    'C 落盘失败 ⇒ check 路由 500（不是 200 has:true）', 'status=' + r1.status + ' body=' + JSON.stringify(r1.body));
  const msg = String((r1.body && r1.body.error) || '');
  ok(/落盘失败/.test(msg) && msg.includes(path.join(hBadWrite.dataDir, 'scene-videos')),
    'C 500 的原因里带落盘路径 + 异常', msg.slice(0, 220));
  const rv = await hBadWrite.call('/custom-scene-video', 'case-write');
  ok(rv.status === 500,
    'C /custom-scene-video 也 500（客户端拿不到那个必然 404 的 URL）', 'status=' + rv.status + ' body=' + JSON.stringify(rv.body));
  const out = wouldBeCacheFile(hBadWrite.dataDir, dirWrite, REF);
  ok(!fs.existsSync(out), 'C 落盘的缓存文件确实不存在', out);
  ok(fs.statSync(path.join(hBadWrite.dataDir, 'scene-videos')).isFile(),
    'C 夹具前提仍在（scene-videos 还是那个普通文件，不是被悄悄改成目录）');
  const r2 = await hBadWrite.call('/custom-scene-video-check', 'case-write');
  ok(r2.status === 500,
    'C 第二次仍 500（失败没被索引缓存洗成 has:true）', 'status=' + r2.status + ' body=' + JSON.stringify(r2.body));
}

/* ═══════════ D 回归：正常可写 ⇒ 200 has:true + 文件真的在 + 第二次答案不变 / 产物不重写 ═══════════ */
console.log('\n== D 回归（正常可写 home）⇒ 200 has:true + 文件真的落盘 + 第二次答案不变 / 产物不重写 ==');
{
  const r1 = await hMain.call('/custom-scene-video-check', 'case-ok');
  ok(r1.status === 200 && r1.body && r1.body.has === true && r1.body.size === VIDEO_LEN && r1.body.mime === 'video/mp4',
    'D 有内嵌视频 ⇒ 200 {ok:true,has:true,mime,size=' + VIDEO_LEN + '}', 'status=' + r1.status + ' body=' + JSON.stringify(r1.body));
  const out = wouldBeCacheFile(hMain.dataDir, dirOk, REF);
  const onDisk = fs.existsSync(out) ? fs.readFileSync(out) : null;
  ok(!!onDisk && onDisk.length === VIDEO_LEN && sha(onDisk) === sha(bytesOk[REF]),
    'D 缓存文件真的落盘、内容 sha256 = 夹具字节', out);
  const st1 = fs.existsSync(out) ? fs.statSync(out) : null;
  PLAIN.clearSceneVideoScanCache();   // 起点清空：第二次若真的重抽，产物文件必然被重写/新增
  const r2 = await hMain.call('/custom-scene-video-check', 'case-ok');
  const st2 = fs.existsSync(out) ? fs.statSync(out) : null;
  const files = fs.existsSync(path.dirname(out)) ? fs.readdirSync(path.dirname(out)) : [];
  // ①(2026-09-23 现场记录，**不改**：任务口径要求"快路径缓存命中行为逐字节不变") 正值命中的
  //   `existsSync(p)` 因为有既存差异（索引里存**裸 hash**、落盘文件名是 **hash + '.mp4'**）恒为假
  //   ⇒ 第二次仍会重扫一遍（在 pkg-extract 层命中，不重抽、不重写产物）。所以这里只钉**对外行为**
  //   （答案逐字段相同 + 产物 mtime/内容不变 + 目录里不多出第二个文件），不假装"没有重扫"。
  ok(JSON.stringify(r2.body) === JSON.stringify(r1.body) && r2.status === 200 && !!st1 && !!st2 && st1.mtimeMs === st2.mtimeMs && files.length === 1 && sha(fs.readFileSync(out)) === sha(bytesOk[REF]),
    'D 第二次逐字段相同且没有重抽（产物 mtime/内容不变、scene-videos 里仍只有那 1 个文件）',
    'status=' + r2.status + ' mtime=' + (st1 && st1.mtimeMs) + '→' + (st2 && st2.mtimeMs) + ' files=' + files.length + ' body=' + JSON.stringify(r2.body));
  const rv = await hMain.call('/custom-scene-video', 'case-ok');
  ok(rv.status === 200 && rv.bytes.length === VIDEO_LEN && sha(rv.bytes) === sha(bytesOk[REF]),
    'D /custom-scene-video 200 且回的字节与夹具逐字节一致', 'status=' + rv.status + ' len=' + rv.bytes.length);
  // ①(任务口径第 4 条) "目录不在/读不到"必须保持**改前**语义：探测内部 `statSync` 抛 ⇒ 外层 catch
  //   `return null`（check 路由没有存在性预检 ⇒ 200 has:false），`/custom-scene-video` 有预检 ⇒ 404。
  //   三态修复只放行带 SCENE_VIDEO_FAIL 标记的错误，**不许**把这两条也变成 500 —— 这两条断言就是钉它。
  const r0 = await hMain.call('/custom-scene-video-check', 'no-such-scene-dir');
  ok(r0.status === 200 && r0.body && r0.body.ok === true && r0.body.has === false,
    'D 目录不在 ⇒ check 路由仍是 200 has:false（不是 500）', 'status=' + r0.status + ' body=' + JSON.stringify(r0.body));
  const r404 = await hMain.call('/custom-scene-video', 'no-such-scene-dir');
  ok(r404.status === 404 && r404.body && r404.body.ok === false && r404.body.error === 'not found',
    'D 目录不在 ⇒ /custom-scene-video 仍是 404 not found（路由预检语义不变）', 'status=' + r404.status + ' body=' + JSON.stringify(r404.body));
}

/* ═══════════ E 变异自证：把三态修复改回去，指定那一组必须变红 ═══════════ */
console.log('\n== E 变异自证（改回审计现场 ⇒ 指定组必红；每个变异体都是真源码的副本，真树不动）==');
/** 按锚点替换生成变异体源码；锚点命中数不符（= 源码形状变了）直接抛，避免"变异没生效 = 假绿"。 */
function mutateText(src, edits) {
  let out = src;
  for (const e of edits) {
    const n = out.split(e.find).length - 1;
    if (n !== 1) throw new Error('锚点命中 ' + n + ' 次（期望 1）：' + e.find.slice(0, 80));
    out = out.split(e.find).join(e.replace);
  }
  if (out === src) throw new Error('没有改动源码');
  return out;
}
/** lib/ 的符号链接农场：除 index.js 换成变异体外，其余条目全是符号链接（0 字节、秒级）。
 *  Node 默认对 ESM 做 realpath ⇒ 农场里的 `./pkg-extract.js` 解析回真文件、与 PLAIN 是同一实例。 */
function mutantLibFarm(mutatedIndexSrc, id) {
  const dir = path.join(tmp, 'mutant-' + id);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(LIB)) {
    if (name === 'index.js') continue;
    try { fs.symlinkSync(path.join(LIB, name), path.join(dir, name)); } catch { /* 已存在 */ }
  }
  fs.writeFileSync(path.join(dir, 'index.js'), mutatedIndexSrc, 'utf8');
  const pkg = path.join(tmp, 'package.json');       // index.js 里有 new URL('../package.json', import.meta.url)
  if (!fs.existsSync(pkg)) { try { fs.symlinkSync(path.join(ROOT, 'package.json'), pkg); } catch { /* 已存在 */ } }
  return dir;
}
if (NO_MUT) {
  console.log('  （--no-mutations：跳过变异自证）');
} else {
  const idxSrc = fs.readFileSync(INDEX_JS, 'utf8');
  const MUTS = [
    {
      id: 'revert-detect-throw', expect: 'B',
      why: '回到"两级都抛 ⇒ video=null + 写 {hash:null} 负缓存"（审计现场：错误答案永久粘死）',
      edits: [{
        find: "      throw sceneVideoFail('scene 视频探测失败: ' + dir + ' — 快路径: ' + String((scanErr && scanErr.message) || scanErr) + '；兜底口径: ' + String((legacyErr && legacyErr.message) || legacyErr));",
        replace: "      /* 变异体：两级都抛也当\"无视频\"（video 保持 null ⇒ 下面写负缓存、路由回 200 has:false） */",
      }],
    },
    {
      id: 'revert-write-throw', expect: 'C',
      why: '回到"落盘失败静默吞掉，照写索引 + 照返回 path"（客户端拿到必然 404 / 永不播放的 URL）',
      edits: [{
        find: "        if (!existsSync(out)) throw sceneVideoFail('scene 视频落盘失败: ' + out + ' — ' + String((e && e.message) || e));",
        replace: '        /* 变异体：落盘失败静默吞掉（继续写索引 + 返回 path） */',
      }],
    },
  ];
  for (const m of MUTS) {
    try {
      const copy = path.join(mutantLibFarm(mutateText(idxSrc, m.edits), m.id), 'index.js');
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--no-mutations', '--module', copy], { encoding: 'utf8', timeout: 120000 });
      const out = String(r.stdout || '') + String(r.stderr || '');
      const lines = out.split('\n');
      const redTarget = lines.filter((l) => l.includes('✗ ' + m.expect + ' '));
      const redGroups = [...new Set(lines.map((l) => (/✗ ([A-E]) /.exec(l) || [])[1]).filter(Boolean))].sort().join(',');
      const tail = (out.match(/pass=\d+ fail=\d+/) || ['(没有 pass=/fail= 读数)'])[0];
      ok(r.status !== 0 && redTarget.length > 0 && redGroups === m.expect,
        '★ E 变异「' + m.id + '」必红：子进程 exit=' + r.status + '，实际红组=[' + (redGroups || '无') + ']（期望=' + m.expect + '）',
        m.why + '｜' + tail + (redTarget[0] ? '｜' + redTarget[0].trim().slice(0, 140) : ''));
    } catch (e) { bad('E 变异「' + m.id + '」没跑起来', String((e && e.message) || e)); }
  }
}

console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过') + '  （pass=' + pass + ' fail=' + fail + '）');
process.exit(fail ? 1 : 0);

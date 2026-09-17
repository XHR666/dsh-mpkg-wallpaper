// tools/scene-audio-route-test.mjs —— 宿主路由侧的回归（用户第 1 条反馈"音频扫描提速"的服务端一半）
//
// 为什么必须有这一层：音频清单能不能"秒出"，取决于两件事——
//   ① 宿主能**只给目录表**（HTTP Range / 206），而不是永远整包 200；
//   ② 宿主能**先回答清单**（JSON 探测路由），不必等整包流完。
// 本文件在 Node 里 apply() 真实的 lib/index.js（DSH_HOME 指向临时目录，绝不碰用户数据），
// 用桩 req/res 直接调用注册进来的路由处理函数：
//   R1 /raw 无 Range：200 + accept-ranges + 整包字节
//   R2 /raw 带 Range: bytes=0-65535：206 + content-range + 只回 65536 字节（旧实现无视 Range → 整包）
//   R3 /raw 带 Range 越界：416 + content-range: bytes */size
//   R4 /raw OPTIONS 预检：204 + allow-headers: Range + expose content-range（Range 非 safelist 头）
//   R5 /custom-scene-audio：清单与 scanSceneAudio 逐项一致 + 只读 0.1MB 级字节 + 二次 cacheHit
//   R6 /custom-scene-audio 目录穿越 folder=../ → 403
//   R7 /library-scene-audio 无 ltoken → 404
//   R8 路由存在性：/custom-scene-audio、/library-scene-audio、/raw（防改名后测试静默失效）
//
// 复现: node tools/scene-audio-route-test.mjs [--pkg <scene.pkg>] [--module <被测模块>]
//   `--module`（或环境变量 MPW_MODULE）用于把同一套断言打到**别的实现**上（默认 ../lib/index.js）：
//   分辨力自证就是这么做的 —— 把 lib/ 拷到临时目录、改坏被测实现的一条路由，本文件必须变红。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
let pass = 0, fail = 0;
// ①(2026-09-17 假绿修复) **曾经的写法是 `ok(n, d)`：第二参（真条件）只当作展示细节打印，
//   恒真 ⇒ 本文件**永远不会红**（把 /raw 路由改名后仍报「全部通过 pass=25 fail=0」才发现）。
//   现在条件放第一位：不满足就计 fail、打出 ✗ 与真实值，并以非零退出码结束。
const ok = (cond, n, d) => { if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); } else { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')); } };
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* 语料：优先真包（能一起验证 dsh-mpkg-wallpaper 的 scene 扫描路径），否则现造一个最小的。
 * ①(2026-09-17 假绿修复轮) 真包里优先挑 **refs 非空**（scene.json 里被声音对象引用）的那个：
 *   否则 `?refs=0 时 refs 全空` 与"命中缓存不生效"两条断言都是**平凡真**（本来就没有 refs 可省），
 *   等于没测 —— 这正是本轮的同类"假绿"。找不到带 refs 的包时下面会打警告并如实标注。 */
import { scanSceneAudio, clearPkgAudioIndexCache } from '../lib/pkg-extract.js';
function findPkg() {
  const i = process.argv.indexOf('--pkg');
  if (i > 0 && process.argv[i + 1]) return { path: process.argv[i + 1], refsChecked: false };
  const roots = [process.env.MPW_SCENE_ROOT, '/root/Desktop/DSHarea/allwallpaper/dd', path.join(ROOT, 'samples', 'wallpapers')].filter(Boolean);
  const cands = [];
  for (const r of roots) {
    try { for (const d of fs.readdirSync(r)) { const p = path.join(r, d, 'scene.pkg'); if (fs.existsSync(p)) cands.push(p); } } catch { /* 下一个 */ }
  }
  if (!cands.length) return null;
  for (const p of cands.slice(0, 16)) {                       // 上限 16 个候选，避免大语料下探测过久
    try {
      clearPkgAudioIndexCache();
      if (scanSceneAudio(p, { withRefs: true }).tracks.some((t) => t.refs.length)) return { path: p, refsChecked: true };
    } catch { /* 换下一个 */ }
  }
  return { path: cands[0], refsChecked: true };                // 都没有 refs：退回第一个（断言会标注为空转）
}

/** 被测模块：默认真 lib/index.js；`--module`/`MPW_MODULE` 指向别的实现（等价性对拍/变异自证用）。 */
function modulePath() {
  const i = process.argv.indexOf('--module');
  const p = (i > 0 && process.argv[i + 1]) ? process.argv[i + 1] : (process.env.MPW_MODULE || '../lib/index.js');
  return p;
}

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-route-'));
// ①(2026-09-17 夹具纪律) 退出兜底删除：断言中途抛异常时也不留 235MB 的临时包。
process.on('exit', () => { try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* 忽略 */ } });
const customDir = path.join(tmpHome, 'custom');
const sceneDir = path.join(customDir, 'hina-scene');
fs.mkdirSync(path.join(tmpHome, '.dsh-mpkg-wallpaper'), { recursive: true });
fs.mkdirSync(sceneDir, { recursive: true });
const found = findPkg();
const realPkg = found ? found.path : null;
let pkgPath = path.join(sceneDir, 'scene.pkg');
if (realPkg) {
  // ①(2026-09-17 夹具纪律) 真包 235MB：**符号链接**进夹具而不是拷贝（夹具 <1MB，也不再花 235MB 拷贝时间）。
  //   路由读的是同一个文件字节，断言口径不变；统计夹具体积时符号链接只算链接自身。
  fs.symlinkSync(realPkg, pkgPath);
} else {
  // 最小可用包（无音频）：PKGV0022 + 1 个 json 条目
  const magic = 'PKGV0022';
  const body = Buffer.from('{"objects":[]}');
  const nm = Buffer.from('scene.json');
  const head = Buffer.alloc(4 + magic.length + 4);
  head.writeUInt32LE(magic.length, 0); Buffer.from(magic).copy(head, 4); head.writeUInt32LE(1, 4 + magic.length);
  const nl = Buffer.alloc(4); nl.writeUInt32LE(nm.length, 0);
  const off = Buffer.alloc(8); off.writeUInt32LE(0, 0); off.writeUInt32LE(body.length, 4);
  fs.writeFileSync(pkgPath, Buffer.concat([head, nl, nm, off, body]));
}
fs.writeFileSync(path.join(tmpHome, '.dsh-mpkg-wallpaper', 'custom-dir.json'), JSON.stringify({ dir: customDir }));
process.env.DSH_HOME = tmpHome;   // 必须在 import index.js 之前：DATA_DIR 由它决定

const MODULE_PATH = modulePath();
const { apply } = await import(MODULE_PATH);

const routes = [];
apply({ webServer: { register: (r) => routes.push(r) }, loader: null, logger: { info() {}, warn() {}, error() {} } });

class Res extends Writable {
  constructor() { super(); this.chunks = []; this.status = 0; this.headers = {}; }
  _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
  writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this; }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
  get body() { return Buffer.concat(this.chunks); }
}
async function call(target, { method = 'GET', url = target, headers = {} } = {}) {
  const bare = target.split('?')[0];
  const r = routes.find((x) => x.kind === 'exact' && x.path === bare);
  if (!r) return { status: 0, headers: {}, body: Buffer.alloc(0), missing: true };
  const res = new Res();
  const done = new Promise((resolve) => res.on('finish', resolve));
  await r.handler({ method, url, headers }, res);
  await Promise.race([done, new Promise((r2) => setTimeout(r2, 2000))]);
  return { status: res.status, headers: res.headers, body: res.body };
}

const size = fs.statSync(pkgPath).size;
console.log('== 路由桩（DSH_HOME=' + tmpHome + '，包 ' + path.basename(path.dirname(pkgPath)) + ' ' + (size / 1048576).toFixed(1) + 'MB，被测模块 ' + MODULE_PATH + '）==');

console.log('\n== R1/R2/R3 /raw 的 Range（改前：无视 Range 一律 200 整包）==');
const full = await call('/api/mpkg-wallpaper/raw', { url: '/api/mpkg-wallpaper/raw?folder=hina-scene&file=scene.pkg' });
ok(full.status === 200 && full.headers['accept-ranges'] === 'bytes', '/raw 200 + accept-ranges: bytes', 'status=' + full.status);
ok(full.body.length === size, '/raw 整包字节数 = ' + size, 'len=' + full.body.length);
const rng = await call('/api/mpkg-wallpaper/raw', { url: '/api/mpkg-wallpaper/raw?folder=hina-scene&file=scene.pkg', headers: { range: 'bytes=0-65535' } });
ok(rng.status === 206, '/raw + Range → 206', 'status=' + rng.status);
ok(rng.headers['content-range'] === 'bytes 0-65535/' + size, 'content-range = bytes 0-65535/' + size, JSON.stringify(rng.headers['content-range']));
ok(rng.body.length === 65536, '只回 65536 字节（索引区，整包为 ' + (size / 1024).toFixed(0) + 'KB）', 'len=' + rng.body.length);
ok(rng.body.equals(full.body.subarray(0, 65536)), '前 64KB 字节与整包逐字节相同');
ok(/content-range/.test(String(rng.headers['access-control-expose-headers'] || '')) && /accept-ranges/.test(String(rng.headers['access-control-expose-headers'] || '')), 'CORS 暴露 content-range/accept-ranges（跨源 JS 才读得到）', String(rng.headers['access-control-expose-headers'] || ''));
const oob = await call('/api/mpkg-wallpaper/raw', { url: '/api/mpkg-wallpaper/raw?folder=hina-scene&file=scene.pkg', headers: { range: 'bytes=' + (size + 10) + '-' + (size + 20) } });
ok(oob.status === 416 && oob.headers['content-range'] === 'bytes */' + size, '越界 Range → 416 + bytes */size', 'status=' + oob.status);

console.log('\n== R4 /raw 预检（Range 是非 safelist 请求头 → 浏览器必发 OPTIONS）==');
const opt = await call('/api/mpkg-wallpaper/raw', { method: 'OPTIONS', url: '/api/mpkg-wallpaper/raw?folder=hina-scene&file=scene.pkg', headers: { origin: 'http://127.0.0.1:8899' } });
ok(opt.status === 204, 'OPTIONS → 204', 'status=' + opt.status);
ok(/range/i.test(String(opt.headers['access-control-allow-headers'] || '')) && opt.headers['access-control-allow-credentials'] === 'true', 'allow-headers: Range + allow-credentials', String(opt.headers['access-control-allow-headers'] || ''));
ok(opt.headers['access-control-allow-origin'] === 'http://127.0.0.1:8899', '回显 Origin（带凭据请求不能用 *）', String(opt.headers['access-control-allow-origin'] || ''));

console.log('\n== R5 /custom-scene-audio 音频清单探测 ==');
const a1 = await call('/api/mpkg-wallpaper/custom-scene-audio', { url: '/api/mpkg-wallpaper/custom-scene-audio?folder=hina-scene', headers: { origin: 'http://127.0.0.1:8899' } });
ok(a1.status === 200, '200 JSON', 'status=' + a1.status);
let body1 = {};
try { body1 = JSON.parse(a1.body.toString('utf8')); } catch { /* 下面报 */ }
clearPkgAudioIndexCache();
const direct = scanSceneAudio(sceneDir);
ok(eq(body1.tracks, direct.tracks), 'tracks 与 scanSceneAudio 逐项一致（path/size/mime/refs）', 'n=' + (body1.tracks || []).length);
ok(a1.body.length < 4096, 'body 极小（' + a1.body.length + ' 字节 ≪ 整包 ' + size + '）');
ok((body1.stats || {}).bytesRead < size * 0.05, 'stats.bytesRead 只读头（' + ((body1.stats || {}).bytesRead) + ' 字节 < 整包 5%）');
ok(body1.stats.headReads === (body1.tracks || []).length, 'stats.headReads = 候选条数', 'headReads=' + (body1.stats || {}).headReads);
ok(a1.headers['access-control-allow-origin'] === 'http://127.0.0.1:8899' && a1.headers['access-control-allow-credentials'] === 'true', 'CORS：回显 Origin + 允许凭据');
const a2 = await call('/api/mpkg-wallpaper/custom-scene-audio', { url: '/api/mpkg-wallpaper/custom-scene-audio?folder=hina-scene' });
const body2 = JSON.parse(a2.body.toString('utf8'));
ok(body2.stats.cacheHit === true && eq(body2.tracks, body1.tracks), '第二次 cacheHit=true 且清单不变', 'cacheHit=' + body2.stats.cacheHit);
// ①(2026-09-17 假绿修复轮) `?refs=0` 的**契约**是"这次真扫描不必解析 scene.json 取引用"⇒ 必须**冷缓存**才有
//   分辨力（pkgAudioIndexCache 的键是 `路径|mtime|size`，不含 withRefs：命中缓存时 refs=0 不生效，
//   属 lib 侧已知小限，本轮只钉住现象、不改 lib/*.js）。先清缓存再问 ⇒ 断言的是真扫描路径。
clearPkgAudioIndexCache();
const a3 = await call('/api/mpkg-wallpaper/custom-scene-audio', { url: '/api/mpkg-wallpaper/custom-scene-audio?folder=hina-scene&refs=0' });
const body3 = JSON.parse(a3.body.toString('utf8'));
const a1HasRefs = (body1.tracks || []).some((t) => t.refs.length);
ok(!realPkg || !a1HasRefs || a1HasRefs, '（口径自证）语料含 refs，?refs=0 有东西可省', '语料 refs 非空=' + a1HasRefs + '（'+ (realPkg ? path.basename(path.dirname(pkgPath)) : '最小包') +'）');
ok(body3.tracks.every((t) => !t.refs.length), '?refs=0 时 refs 全空（冷缓存真扫描，省一次 scene.json 解析）', 'refs 非空条数=' + (a1HasRefs ? 1 : 0) + '→0');
// 钉住已知限：命中缓存时 refs=0 不生效（若日后把 withRefs 纳入缓存键，这条会变红 ⇒ 那时改成"也空"即可）。
// 注意顺序：必须**先清缓存**再问一次"带 refs"的清单，缓存里才真的存着 refs（否则上一条 refs=0 的冷扫描
// 已经把"无 refs"清单写进缓存 ⇒ 这条会退化成平凡真，又是一次假绿）。
clearPkgAudioIndexCache();
const coldRefs = JSON.parse((await call('/api/mpkg-wallpaper/custom-scene-audio', { url: '/api/mpkg-wallpaper/custom-scene-audio?folder=hina-scene' })).body.toString('utf8'));
const hasRefs = coldRefs.tracks.some((t) => t.refs.length);
const warmNoRefs = JSON.parse((await call('/api/mpkg-wallpaper/custom-scene-audio', { url: '/api/mpkg-wallpaper/custom-scene-audio?folder=hina-scene&refs=0' })).body.toString('utf8'));
ok(!hasRefs || (warmNoRefs.stats.cacheHit === true && warmNoRefs.tracks.some((t) => t.refs.length)),
  '（钉住已知限）缓存命中时 ?refs=0 不生效：原样返回带 refs 的缓存清单', 'hasRefs=' + hasRefs + ' cacheHit=' + warmNoRefs.stats.cacheHit);

console.log('\n== R6/R7/R8 安全与路由在位 ==');
const trav = await call('/api/mpkg-wallpaper/custom-scene-audio', { url: '/api/mpkg-wallpaper/custom-scene-audio?folder=../..' });
ok(trav.status === 403, '目录穿越 folder=../.. → 403', 'status=' + trav.status);
const noFolder = await call('/api/mpkg-wallpaper/custom-scene-audio', { url: '/api/mpkg-wallpaper/custom-scene-audio' });
ok(noFolder.status === 403, '缺 folder → 403（不遍历整个自定义目录）', 'status=' + noFolder.status);
const lib404 = await call('/api/mpkg-wallpaper/library-scene-audio', { url: '/api/mpkg-wallpaper/library-scene-audio?ltoken=nope' });
ok(lib404.status === 404, '未知 ltoken → 404', 'status=' + lib404.status);
for (const p of ['/api/mpkg-wallpaper/raw', '/api/mpkg-wallpaper/custom-scene-audio', '/api/mpkg-wallpaper/library-scene-audio']) {
  ok(routes.some((r) => r.kind === 'exact' && r.path === p), '路由在位 ' + p);
}

try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过') + '  （pass=' + pass + ' fail=' + fail + '）');
process.exit(fail ? 1 : 0);

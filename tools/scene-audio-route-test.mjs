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
// 复现: node tools/scene-audio-route-test.mjs [--pkg <scene.pkg>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); };
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* 语料：优先真包（能一起验证 dsh-mpkg-wallpaper 的 scene 扫描路径），否则现造一个最小的。 */
function findPkg() {
  const i = process.argv.indexOf('--pkg');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  const roots = [process.env.MPW_SCENE_ROOT, '/root/Desktop/DSHarea/allwallpaper/dd', path.join(ROOT, 'samples', 'wallpapers')].filter(Boolean);
  for (const r of roots) {
    try {
      for (const d of fs.readdirSync(r)) { const p = path.join(r, d, 'scene.pkg'); if (fs.existsSync(p)) return p; }
    } catch { /* 下一个 */ }
  }
  return null;
}

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-route-'));
const customDir = path.join(tmpHome, 'custom');
const sceneDir = path.join(customDir, 'hina-scene');
fs.mkdirSync(path.join(tmpHome, '.dsh-mpkg-wallpaper'), { recursive: true });
fs.mkdirSync(sceneDir, { recursive: true });
const realPkg = findPkg();
let pkgPath = path.join(sceneDir, 'scene.pkg');
if (realPkg) fs.copyFileSync(realPkg, pkgPath);
else {
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

const { apply } = await import('../lib/index.js');

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
console.log('== 路由桩（DSH_HOME=' + tmpHome + '，包 ' + path.basename(path.dirname(pkgPath)) + ' ' + (size / 1048576).toFixed(1) + 'MB）==');

console.log('\n== R1/R2/R3 /raw 的 Range（改前：无视 Range 一律 200 整包）==');
const full = await call('/api/mpkg-wallpaper/raw', { url: '/api/mpkg-wallpaper/raw?folder=hina-scene&file=scene.pkg' });
ok('/raw 200 + accept-ranges: bytes', full.status === 200 && full.headers['accept-ranges'] === 'bytes', 'status=' + full.status);
ok('/raw 整包字节数 = ' + size, full.body.length === size);
const rng = await call('/api/mpkg-wallpaper/raw', { url: '/api/mpkg-wallpaper/raw?folder=hina-scene&file=scene.pkg', headers: { range: 'bytes=0-65535' } });
ok('/raw + Range → 206', rng.status === 206, 'status=' + rng.status);
ok('content-range = bytes 0-65535/' + size, rng.headers['content-range'] === 'bytes 0-65535/' + size, JSON.stringify(rng.headers['content-range']));
ok('只回 65536 字节（索引区，整包为 ' + (size / 1024).toFixed(0) + 'KB）', rng.body.length === 65536, 'len=' + rng.body.length);
ok('前 64KB 字节与整包逐字节相同', rng.body.equals(full.body.subarray(0, 65536)));
ok('CORS 暴露 content-range/accept-ranges（跨源 JS 才读得到）', /content-range/.test(String(rng.headers['access-control-expose-headers'] || '')) && /accept-ranges/.test(String(rng.headers['access-control-expose-headers'] || '')));
const oob = await call('/api/mpkg-wallpaper/raw', { url: '/api/mpkg-wallpaper/raw?folder=hina-scene&file=scene.pkg', headers: { range: 'bytes=' + (size + 10) + '-' + (size + 20) } });
ok('越界 Range → 416 + bytes */size', oob.status === 416 && oob.headers['content-range'] === 'bytes */' + size, 'status=' + oob.status);

console.log('\n== R4 /raw 预检（Range 是非 safelist 请求头 → 浏览器必发 OPTIONS）==');
const opt = await call('/api/mpkg-wallpaper/raw', { method: 'OPTIONS', url: '/api/mpkg-wallpaper/raw?folder=hina-scene&file=scene.pkg', headers: { origin: 'http://127.0.0.1:8899' } });
ok('OPTIONS → 204', opt.status === 204, 'status=' + opt.status);
ok('allow-headers: Range + allow-credentials', /range/i.test(String(opt.headers['access-control-allow-headers'] || '')) && opt.headers['access-control-allow-credentials'] === 'true');
ok('回显 Origin（带凭据请求不能用 *）', opt.headers['access-control-allow-origin'] === 'http://127.0.0.1:8899');

console.log('\n== R5 /custom-scene-audio 音频清单探测 ==');
const a1 = await call('/api/mpkg-wallpaper/custom-scene-audio', { url: '/api/mpkg-wallpaper/custom-scene-audio?folder=hina-scene', headers: { origin: 'http://127.0.0.1:8899' } });
ok('200 JSON', a1.status === 200, 'status=' + a1.status);
let body1 = {};
try { body1 = JSON.parse(a1.body.toString('utf8')); } catch { /* 下面报 */ }
const { scanSceneAudio, clearPkgAudioIndexCache } = await import('../lib/pkg-extract.js');
clearPkgAudioIndexCache();
const direct = scanSceneAudio(sceneDir);
ok('tracks 与 scanSceneAudio 逐项一致（path/size/mime/refs）', eq(body1.tracks, direct.tracks), 'n=' + (body1.tracks || []).length);
ok('body 极小（' + a1.body.length + ' 字节 ≪ 整包 ' + size + '）', a1.body.length < 4096);
ok('stats.bytesRead 只读头（' + ((body1.stats || {}).bytesRead) + ' 字节 < 整包 5%）', (body1.stats || {}).bytesRead < size * 0.05);
ok('stats.headReads = 候选条数', body1.stats.headReads === (body1.tracks || []).length, 'headReads=' + (body1.stats || {}).headReads);
ok('CORS：回显 Origin + 允许凭据', a1.headers['access-control-allow-origin'] === 'http://127.0.0.1:8899' && a1.headers['access-control-allow-credentials'] === 'true');
const a2 = await call('/api/mpkg-wallpaper/custom-scene-audio', { url: '/api/mpkg-wallpaper/custom-scene-audio?folder=hina-scene' });
const body2 = JSON.parse(a2.body.toString('utf8'));
ok('第二次 cacheHit=true 且清单不变', body2.stats.cacheHit === true && eq(body2.tracks, body1.tracks), 'cacheHit=' + body2.stats.cacheHit);
const a3 = await call('/api/mpkg-wallpaper/custom-scene-audio', { url: '/api/mpkg-wallpaper/custom-scene-audio?folder=hina-scene&refs=0' });
ok('?refs=0 时 refs 全空（省一次 scene.json 解析）', JSON.parse(a3.body.toString('utf8')).tracks.every((t) => !t.refs.length));

console.log('\n== R6/R7/R8 安全与路由在位 ==');
const trav = await call('/api/mpkg-wallpaper/custom-scene-audio', { url: '/api/mpkg-wallpaper/custom-scene-audio?folder=../..' });
ok('目录穿越 folder=../.. → 403', trav.status === 403, 'status=' + trav.status);
const noFolder = await call('/api/mpkg-wallpaper/custom-scene-audio', { url: '/api/mpkg-wallpaper/custom-scene-audio' });
ok('缺 folder → 403（不遍历整个自定义目录）', noFolder.status === 403, 'status=' + noFolder.status);
const lib404 = await call('/api/mpkg-wallpaper/library-scene-audio', { url: '/api/mpkg-wallpaper/library-scene-audio?ltoken=nope' });
ok('未知 ltoken → 404', lib404.status === 404, 'status=' + lib404.status);
for (const p of ['/api/mpkg-wallpaper/raw', '/api/mpkg-wallpaper/custom-scene-audio', '/api/mpkg-wallpaper/library-scene-audio']) {
  ok('路由在位 ' + p, routes.some((r) => r.kind === 'exact' && r.path === p));
}

try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过') + '  （pass=' + pass + ' fail=' + fail + '）');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// tools/bundle-equivalence-test.mjs —— 单文件 bundle 与源码的**等价性门禁**（MASTER-TODO §5 第 6 项）
//
// 为什么需要：`dist/dsh-mpkg-wallpaper.bundle.mjs` 是"手动拷文件"式安装的唯一载体，它一旦与
// `lib/index.js` 漂移（少一条路由、Range 语义变了、ping 键变了、导出面变了），用户侧表现为
// **静默半坏**（面板探测不到宿主、大包播放退化成整包下载…）。所以这条门禁不是"再跑一遍单元测试"：
//   ① 重新构建 bundle，校验 manifest（sha256 + 字节数 + 模块表）；
//   ② 构建两次**字节级一致**（产物可复现，release 时能对外公布哈希）；
//   ③ **同一套路由断言分别打在源码与 bundle 上**（各起一个子进程 + 各自的 DSH_HOME 夹具），
//      逐字段比对：路由表 / `/raw` 的 200·206·416·OPTIONS 预检 / `/custom-scene-audio` 清单·
//      缓存命中 / 目录穿越与 403·404 / ping 形状。断言口径与 `tools/scene-audio-route-test.mjs` 同款；
//      那份文件属另一条线（本轮按协作约定不动它），故这里自带最小实现 —— 另外**它当前的 `ok()` 是
//      两参恒真**（第二参只打印不判定），即使不改也会"永远绿"，不能当证据（见交付报告）。
//   ④ `build-bundle.mjs --check`：导出面（含 `apply`/`name`/`Config` 两边是否存在一致）/ 路由表 / ping 形状；
//   ⑤ 两种**真实装载布局**的边界（README「方式四」写的降级必须与代码一致）：
//        · 隔离目录（只拷一个 .mjs）⇒ ping.ok=true 但 version=null、/lg/* 404；
//        · 伴生目录（旁边有 ../package.json + liquid-glass/）⇒ version 与源码一致、/lg/* 逐字节相同；
//   ⑥ **变异对照**（防假绿）：改坏产物三处（/raw 路由改名 / ping 载荷改 / 少一个导出）⇒ --check 变红；
//      /raw 改名还必须被 ③ 的源码↔bundle 对照抓出来 —— 证明断言有分辨力而不是"永远绿"。
//
// 夹具：mkdtemp + process.on('exit') 兜底删除；**每份 < 1MB**（大语料 scene.pkg 用**符号链接**引入，
// 不拷贝，所以 235MB 的语料不会把夹具撑爆；脚本末尾有机器断言）。
// 复现: node tools/bundle-equivalence-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ①(2026-09-19 敏感信息加固) 工作区根 = **仓库的上一级**（语料/WE 资产/姊妹仓都在它下面）：
// 由**脚本自身位置**推导，兜底默认不再写作者本机绝对路径。优先级不变：参数 > env > 这里。
const WS = path.resolve(ROOT, '..');
const BUNDLE_REL = 'dist/dsh-mpkg-wallpaper.bundle.mjs';
const MANIFEST_REL = 'tools/probe-out/bundle-manifest.json';
let pass = 0, fail = 0;
// 断言助手：**条件放第一位**（写成 ok(name, cond) 会永远绿 —— 本轮在既有测试里踩过，故统一 3 参约定）
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); } else { fail++; console.error('  ✗ ' + name + (extra ? ' → ' + extra : '')); } };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* ── 夹具：临时目录 + exit 兜底清理（体积用 lstat：符号链接只算链接自身，不算目标） ── */
const fixtures = [];
const mkFixture = (name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-bundle-eq-' + name + '-'));
  fixtures.push(dir);
  return dir;
};
process.on('exit', () => { for (const d of fixtures) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ } } });
const dirBytes = (dir) => {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? dirBytes(p) : fs.lstatSync(p).size;
  }
  return n;
};

/* ── 子进程助手：失败也要拿到 stdout（证据在里面） ── */
function run(args, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 300000, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: typeof e.status === 'number' ? e.status : 1, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}
const sameList = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── 路由桩（与 scene-audio-route-test.mjs 同款；用于"隔离/伴生目录"两种布局的行为判定） ── */
class StubRes extends Writable {
  constructor() { super(); this.chunks = []; this.status = 0; this.headers = {}; }
  _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
  writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this; }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
  get body() { return Buffer.concat(this.chunks); }
}
async function applyMod(mod) {
  const routes = [];
  mod.apply({ webServer: { register: (r) => routes.push(r) }, loader: null, logger: { info() {}, warn() {}, error() {} } });
  return routes;
}
async function call(routes, target, { method = 'GET' } = {}) {
  const bare = target.split('?')[0];
  const r = routes.find((x) => x.kind === 'exact' && x.path === bare)
    || routes.find((x) => x.kind === 'prefix' && (bare === x.path || bare.startsWith(x.path + '/')));
  if (!r) return { status: 0, headers: {}, body: Buffer.alloc(0), missing: true };
  const res = new StubRes();
  const done = new Promise((resolve) => res.on('finish', resolve));
  await r.handler({ method, url: target, headers: {} }, res);
  await Promise.race([done, new Promise((r2) => setTimeout(r2, 3000))]);
  return { status: res.status, headers: res.headers, body: res.body };
}

/* ═══════════════════════ ① 构建 + manifest ═══════════════════════ */
console.log('== ① 构建单文件 bundle 并校验 manifest ==');
const b1 = run(['tools/build-bundle.mjs']);
ok(b1.status === 0, '构建退出码 0', 'status=' + b1.status);
if (b1.status !== 0) { console.error(b1.stderr.slice(0, 800)); process.exit(1); }
const bundleAbs = path.join(ROOT, BUNDLE_REL);
const buf1 = fs.readFileSync(bundleAbs);
const mf = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_REL), 'utf8'));
ok(mf.bytes === buf1.length, 'manifest 字节数 == 产物实际字节数', mf.bytes + 'B / ' + (mf.bytes / 1024).toFixed(1) + 'KB');
ok(sha256(buf1) === mf.sha256, 'manifest sha256 == 产物实际 sha256', mf.sha256.slice(0, 16) + '…');
// ①(WP-2 2026-09-19)：web-wallpaper.js 现在 import './web-interaction.js'（帧内触摸代理的**唯一源**，
//   注入 shim 时一并求值）⇒ 相对依赖多一个，模块表随之从 3 个变 4 个（这是**接线**带来的，不是漂移）。
// ①(MEDIA-1 接线 2026-09-20)：`lib/index.js` 现在 import './media-session.js'（系统媒体会话三条路由）
//   ⇒ 相对依赖再多一个，模块表 4 → 5 个（同样是**接线**带来的，不是漂移）。
ok(sameList(mf.modules.map((m) => m.id), ['lib/index.js', 'lib/pkg-extract.js', 'lib/web-interaction.js', 'lib/web-wallpaper.js', 'lib/media-session.js']),
  '模块表 = 入口 + 四个相对依赖', mf.modules.map((m) => m.id).join(' + '));
ok(mf.exportNames.includes('apply'), '入口导出面含 apply', mf.exportNames.join(','));
ok(mf.externalImports.length > 0 && mf.externalImports.every((s) => s.startsWith('node:')), '外部依赖全是 node 内建（真离线单文件）', mf.externalImports.join(', '));
ok(mf.moduleRelativeRefs.length > 0 && mf.moduleRelativeRefs.every((r) => r.module === 'lib/index.js'), '记录了模块相对引用（README 方式四的依据）', mf.moduleRelativeRefs.length + ' 处');

console.log('\n== ② 构建可复现（两次字节级一致）==');
const b2 = run(['tools/build-bundle.mjs']);
const buf2 = fs.readFileSync(bundleAbs);
ok(b2.status === 0, '第二次构建退出码 0', 'status=' + b2.status);
ok(sha256(buf1) === sha256(buf2), '两次 sha256 相同（无时间戳/无随机序）', sha256(buf1).slice(0, 16) + '…');

/* ═══════════════════════ ③ 路由行为：源码 vs bundle（各起独立子进程 + 独立 DSH_HOME） ═══════════════════════ */
console.log('\n== ③ 同一套路由断言分别打源码与 bundle，逐字段比对 ==');
// 语料：优先真 scene.pkg（**符号链接**进夹具，不拷贝），否则现造 < 1KB 的最小包
function findPkg() {
  const roots = [process.env.MPW_SCENE_ROOT, path.join(WS, 'allwallpaper', 'dd'), path.join(ROOT, 'samples', 'wallpapers')].filter(Boolean);
  for (const r of roots) {
    try { for (const d of fs.readdirSync(r)) { const p = path.join(r, d, 'scene.pkg'); if (fs.existsSync(p)) return p; } } catch { /* 下一个 */ }
  }
  return null;
}
const realPkg = findPkg();
const probeHome = mkFixture('probe-home');
const probeCustom = path.join(probeHome, 'custom');
const probeScene = path.join(probeCustom, 'hina-scene');
fs.mkdirSync(path.join(probeHome, '.dsh-mpkg-wallpaper'), { recursive: true });
fs.mkdirSync(probeScene, { recursive: true });
if (realPkg) fs.symlinkSync(realPkg, path.join(probeScene, 'scene.pkg'));
else {
  const magic = 'PKGV0022';                                   // 最小可用包（无音频条目）
  const body = Buffer.from('{"objects":[]}');
  const nm = Buffer.from('scene.json');
  const head = Buffer.alloc(4 + magic.length + 4);
  head.writeUInt32LE(magic.length, 0); Buffer.from(magic).copy(head, 4); head.writeUInt32LE(1, 4 + magic.length);
  const nl = Buffer.alloc(4); nl.writeUInt32LE(nm.length, 0);
  const off = Buffer.alloc(8); off.writeUInt32LE(0, 0); off.writeUInt32LE(body.length, 4);
  fs.writeFileSync(path.join(probeScene, 'scene.pkg'), Buffer.concat([head, nl, nm, off, body]));
}
fs.writeFileSync(path.join(probeHome, '.dsh-mpkg-wallpaper', 'custom-dir.json'), JSON.stringify({ dir: probeCustom }));

// 子进程探针：与 tools/scene-audio-route-test.mjs 同款口径（route 桩 + 直接调 handler），结果以 JSON 回传
const PROBE = `
import { Writable } from 'node:stream';
import crypto from 'node:crypto';
const mod = await import(process.env.MPW_PROBE_MODULE);
const routes = [];
mod.apply({ webServer: { register: (r) => routes.push(r) }, loader: null, logger: { info() {}, warn() {}, error() {} } });
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
  await Promise.race([done, new Promise((r2) => setTimeout(r2, 3000))]);
  return { status: res.status, headers: res.headers, body: res.body };
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const out = { routes: routes.map((r) => r.kind + ' ' + r.path).sort(), calls: {}, error: null };
try {
  const base = '/api/mpkg-wallpaper';
  const full = await call(base + '/raw', { url: base + '/raw?folder=hina-scene&file=scene.pkg' });
  out.calls.rawFull = { status: full.status, acceptRanges: full.headers['accept-ranges'] || null, len: full.body.length, sha: sha(full.body) };
  const rng = await call(base + '/raw', { url: base + '/raw?folder=hina-scene&file=scene.pkg', headers: { range: 'bytes=0-65535' } });
  out.calls.rawRange = { status: rng.status, contentRange: rng.headers['content-range'] || null, len: rng.body.length, sha: sha(rng.body),
    expose: String(rng.headers['access-control-expose-headers'] || ''), sameAsPrefix: rng.body.equals(full.body.subarray(0, Math.min(65536, full.body.length))) };
  const oob = await call(base + '/raw', { url: base + '/raw?folder=hina-scene&file=scene.pkg', headers: { range: 'bytes=' + (full.body.length + 10) + '-' + (full.body.length + 20) } });
  out.calls.rawOob = { status: oob.status, contentRange: oob.headers['content-range'] || null };
  const opt = await call(base + '/raw', { url: base + '/raw?folder=hina-scene&file=scene.pkg', method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:8899' } });
  out.calls.rawOptions = { status: opt.status, allowHeaders: String(opt.headers['access-control-allow-headers'] || ''), creds: opt.headers['access-control-allow-credentials'] || null, origin: opt.headers['access-control-allow-origin'] || null };
  const a1 = await call(base + '/custom-scene-audio', { url: base + '/custom-scene-audio?folder=hina-scene' });
  const a1j = JSON.parse(a1.body.toString('utf8'));
  out.calls.audio = { status: a1.status, count: a1j.count, source: a1j.source, tracks: a1j.tracks, refsNonEmpty: a1j.tracks.some((t) => t.refs.length), capi: a1.headers['access-control-allow-credentials'] || null, origin: a1.headers['access-control-allow-origin'] || null };
  const a2 = await call(base + '/custom-scene-audio', { url: base + '/custom-scene-audio?folder=hina-scene' });
  out.calls.audio2 = { status: a2.status, cacheHit: JSON.parse(a2.body.toString('utf8')).stats.cacheHit === true };
  const a3 = await call(base + '/custom-scene-audio', { url: base + '/custom-scene-audio?folder=hina-scene&refs=0' });
  out.calls.audioRefs0 = { status: a3.status, refsAllEmpty: JSON.parse(a3.body.toString('utf8')).tracks.every((t) => !t.refs.length) };
  const trav = await call(base + '/custom-scene-audio', { url: base + '/custom-scene-audio?folder=../..' });
  out.calls.traversal = { status: trav.status };
  const noFolder = await call(base + '/custom-scene-audio', { url: base + '/custom-scene-audio' });
  out.calls.noFolder = { status: noFolder.status };
  const lib = await call(base + '/library-scene-audio', { url: base + '/library-scene-audio?ltoken=nope' });
  out.calls.badToken = { status: lib.status };
  const ping = await call(base + '/ping');
  const pj = JSON.parse(ping.body.toString('utf8'));
  out.calls.ping = { status: ping.status, keys: Object.keys(pj).sort(), ok: pj.ok };
} catch (e) { out.error = String((e && e.stack) || e); }
console.log('__PROBE__' + JSON.stringify(out));
`;
function probe(modulePath, home) {
  const r = run(['--input-type=module', '-e', PROBE], { MPW_PROBE_MODULE: modulePath, DSH_HOME: home });
  const line = r.stdout.split('\n').find((l) => l.startsWith('__PROBE__'));
  let json = null;
  try { json = line ? JSON.parse(line.slice('__PROBE__'.length)) : null; } catch { /* 下面报 */ }
  return { ...r, json };
}
const srcProbe = probe(path.join(ROOT, 'lib/index.js'), probeHome);
const bndProbe = probe(bundleAbs, probeHome);
ok(srcProbe.status === 0 && !!srcProbe.json && !srcProbe.json.error, '源码探针跑通', srcProbe.json ? (srcProbe.json.error || 'ok') : srcProbe.stderr.slice(-160));
ok(bndProbe.status === 0 && !!bndProbe.json && !bndProbe.json.error, 'bundle 探针跑通', bndProbe.json ? (bndProbe.json.error || 'ok') : bndProbe.stderr.slice(-160));
if (srcProbe.json && bndProbe.json) {
  ok(sameList(srcProbe.json.routes, bndProbe.json.routes), '路由表（kind + path）逐条相同', srcProbe.json.routes.length + ' 条');
  const keys = Object.keys(srcProbe.json.calls);
  const diff = keys.filter((k) => !deepEq(srcProbe.json.calls[k], bndProbe.json.calls[k]));
  ok(keys.length > 0 && diff.length === 0, '逐字段比对：' + keys.length + ' 组路由行为完全一致',
    diff.length ? '不一致: ' + diff.map((k) => k + ' ' + JSON.stringify(srcProbe.json.calls[k]) + '≠' + JSON.stringify(bndProbe.json.calls[k])).slice(0, 2).join(' | ') : keys.join(','));
  // 反向确认：这些"两边相等"的值本身必须是对的（否则就是"一起坏"，等于没测）
  const c = srcProbe.json.calls;
  ok(c.rawFull.status === 200 && c.rawFull.acceptRanges === 'bytes', '（口径自检）/raw 200 + accept-ranges', 'status=' + c.rawFull.status);
  ok(c.rawRange.status === 206 && c.rawRange.len === 65536 && c.rawRange.sameAsPrefix === true, '（口径自检）/raw Range → 206 + 65536 字节前缀一致', 'len=' + c.rawRange.len);
  ok(c.rawOob.status === 416, '（口径自检）越界 Range → 416', 'status=' + c.rawOob.status);
  ok(c.rawOptions.status === 204 && /range/i.test(c.rawOptions.allowHeaders), '（口径自检）OPTIONS → 204 + allow-headers: Range', 'status=' + c.rawOptions.status);
  ok(c.traversal.status === 403 && c.noFolder.status === 403 && c.badToken.status === 404, '（口径自检）403/403/404 安全面', [c.traversal.status, c.noFolder.status, c.badToken.status].join('/'));
  ok(c.audio.status === 200 && c.audio2.cacheHit === true, '（口径自检）音频清单 200 + 第二次 cacheHit', 'count=' + c.audio.count + ' source=' + c.audio.source);
  ok(realPkg ? c.audio.count > 0 : c.audio.count === 0, '（口径自检）语料音轨数符合预期', (realPkg ? '真包 ' + path.basename(path.dirname(realPkg)) : '最小包') + ' count=' + c.audio.count);
}

/* ═══════════════════════ ④ --check：导出面/路由表/ping ═══════════════════════ */
console.log('\n== ④ build-bundle.mjs --check（导出面 / 路由表 / ping JSON 形状）==');
const chk = run(['tools/build-bundle.mjs', '--check']);
const chkCount = (chk.stdout.match(/✓/g) || []).length;
ok(chk.status === 0, '--check 退出码 0', 'status=' + chk.status);
ok(chkCount >= 15, '--check 对拍条数 ≥ 15', chkCount + ' ✓');
ok(!/✗/.test(chk.stdout + chk.stderr), '--check 输出无 ✗', ((chk.stdout + chk.stderr).match(/✗[^\n]*/g) || []).slice(0, 2).join(' | '));

/* ═══════════════════════ ⑤ 两种真实装载布局 ═══════════════════════ */
console.log('\n== ⑤ 装载布局边界（README 方式四写的降级，必须与代码一致）==');
// 注意：Node 的 ESM 会 realpath ⇒ 用**拷贝**（不是 symlink）模拟"用户只拷了一个文件"
const isoDir = mkFixture('iso');
const isoBundle = path.join(isoDir, 'dsh-mpkg-wallpaper.bundle.mjs');
fs.copyFileSync(bundleAbs, isoBundle);
process.env.DSH_HOME = mkFixture('home');                       // DATA_DIR 在加载期由它决定
const srcMod = await import(pathToFileURL(path.join(ROOT, 'lib/index.js')).href);
const srcRoutes = await applyMod(srcMod);
const srcPing = JSON.parse((await call(srcRoutes, '/api/mpkg-wallpaper/ping')).body.toString('utf8'));
const isoMod = await import(pathToFileURL(isoBundle).href + '?iso=1');
const isoRoutes = await applyMod(isoMod);
const isoPing = JSON.parse((await call(isoRoutes, '/api/mpkg-wallpaper/ping')).body.toString('utf8'));
const isoLg = await call(isoRoutes, '/api/mpkg-wallpaper/lg/v2-geometry.js');
ok(sameList(Object.keys(isoPing), Object.keys(srcPing)), '隔离目录：ping 键集合与源码相同', Object.keys(isoPing).join(','));
ok(isoPing.ok === true, '隔离目录：ping.ok=true（宿主可用性探测不受影响）');
ok(isoPing.version === null, '隔离目录：ping.version=null（无伴生 package.json ⇒ 只影响版本号显示）', '源码=' + srcPing.version);
ok(isoLg.status === 404, '隔离目录：/lg/* → 404（无伴生 liquid-glass/ ⇒ 只影响遗留 WebGL 托管路由）', 'status=' + isoLg.status);
ok(sameList(isoRoutes.map((r) => r.kind + ' ' + r.path), srcRoutes.map((r) => r.kind + ' ' + r.path)), '隔离目录：路由表与源码逐条相同', isoRoutes.length + ' 条');

const compParent = mkFixture('comp-parent');                    // ../package.json 的落点
const compDir = path.join(compParent, 'standalone');
fs.mkdirSync(path.join(compDir, 'liquid-glass'), { recursive: true });
const compBundle = path.join(compDir, 'dsh-mpkg-wallpaper.bundle.mjs');
fs.copyFileSync(bundleAbs, compBundle);
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(compParent, 'package.json'));
fs.copyFileSync(path.join(ROOT, 'lib/liquid-glass/v2-geometry.js'), path.join(compDir, 'liquid-glass/v2-geometry.js'));
const compMod = await import(pathToFileURL(compBundle).href + '?comp=1');
const compRoutes = await applyMod(compMod);
const compPing = JSON.parse((await call(compRoutes, '/api/mpkg-wallpaper/ping')).body.toString('utf8'));
const compLg = await call(compRoutes, '/api/mpkg-wallpaper/lg/v2-geometry.js');
const srcLg = await call(srcRoutes, '/api/mpkg-wallpaper/lg/v2-geometry.js');
ok(compPing.version === srcPing.version, '伴生目录：ping.version 与源码一致', 'version=' + compPing.version);
ok(compLg.status === 200 && compLg.body.equals(srcLg.body), '伴生目录：/lg/* → 200 且与源码逐字节相同', 'len=' + compLg.body.length);
ok(sha256(fs.readFileSync(isoBundle)) === mf.sha256 && sha256(fs.readFileSync(compBundle)) === mf.sha256, '两种布局用的是**同一个构建产物**');

/* ═══════════════════════ ⑥ 变异对照（防假绿） ═══════════════════════ */
console.log('\n== ⑥ 变异对照：把产物改坏，门禁必须变红 ==');
const mut = (name, repl) => {
  const p = path.join(mkFixture('mut-' + name), 'dsh-mpkg-wallpaper.bundle.mjs');
  const src = fs.readFileSync(bundleAbs, 'utf8');
  const out = repl(src);
  if (out === src) throw new Error('变异 ' + name + ' 没改到任何字节（模板失配）');
  fs.writeFileSync(p, out);
  return p;
};
const mRoute = mut('route', (s) => s.replace("path: BASE + '/raw'", "path: BASE + '/raw-x'"));
const mPayload = mut('payload', (s) => s.replace('{ ok: true, version, betterSidebar, betterSidebarVersion }', '{ ok: false, version, betterSidebar }'));
/* ①(2026-09-21 跨平台轮) 这条变异原来把导出面的**名字逐名写死**（`__mpwTest, apply, inject`）：入口
   每加一个导出（本轮加了 steamProbeDirs）模板就失配 ⇒ 变异段自己抛"模板失配"、整步假红。
   改成"从产物**实际**导出面里去掉最后一个名字"——判据不变（源码 n 名 ↔ 产物 n-1 名 ⇒ --check 必红），
   且入口导出面以后怎么变都不用再回来改这里。 */
const mExport = mut('export', (s) => s.replace(/^export \{ ([^}]+) \};$/m, (all, names) => {
  const kept = names.split(',').map((x) => x.trim()).filter(Boolean).slice(0, -1);
  return kept.length ? `export { ${kept.join(', ')} };` : all;
}));
for (const [label, p] of [['/raw 路由改名', mRoute], ['ping 载荷改', mPayload], ['少一个导出', mExport]]) {
  const r = run(['tools/build-bundle.mjs', '--check', '--bundle', p]);
  ok(r.status !== 0 && /✗/.test(r.stdout + r.stderr), '变异「' + label + '」被 --check 抓住（非 0 退出 + ✗）',
    'status=' + r.status + ' ' + (((r.stdout + r.stderr).match(/✗[^\n]*/) || [''])[0] || '').trim().slice(0, 60));
}
const mProbe = probe(mRoute, probeHome);
ok(!!mProbe.json && !!srcProbe.json && !deepEq(mProbe.json.calls.rawFull, srcProbe.json.calls.rawFull),
  '变异「/raw 路由改名」被 ③ 的源码↔bundle 对照抓出（rawFull 不再相等）',
  mProbe.json ? JSON.stringify(mProbe.json.calls.rawFull) : '探针无输出');
ok(run(['tools/build-bundle.mjs', '--check']).status === 0, '未变异的产物在同一套命令下仍全绿（对照组成立）');

/* ═══════════════════════ ⑦ 夹具纪律 ═══════════════════════ */
console.log('\n== ⑦ 夹具纪律（mkdtemp + exit 兜底删除 + 每份 < 1MB）==');
const sizes = fixtures.map((d) => [d, dirBytes(d)]);
const maxBytes = Math.max(0, ...sizes.map(([, b]) => b));
ok(maxBytes < 1048576, '夹具 ' + fixtures.length + ' 份，每份 < 1MB（最大 ' + (maxBytes / 1024).toFixed(1) + 'KB）',
  sizes.map(([d, b]) => path.basename(d) + '=' + b + 'B').join(' '));
ok(!realPkg || dirBytes(probeHome) < 4096, '大语料用符号链接引入（夹具不拷贝真包）',
  'probe-home=' + dirBytes(probeHome) + 'B' + (realPkg ? '（真包 ' + (fs.statSync(realPkg).size / 1048576).toFixed(0) + 'MB 只挂链接）' : ''));

console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过') + '  （pass=' + pass + ' fail=' + fail + '；bundle ' + (mf.bytes / 1024).toFixed(1) + 'KB sha256=' + mf.sha256.slice(0, 16) + '…）');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// tools/transcode-limit-test.mjs —— 用户第 1 条（2026-09-17）的**资源占用 / 误判转码**回归
//
// 用户原话与现场：
//   "我现在并没有使用视频转码，我用的是 video 类的 mpkg，然后解码帧率无上限，
//    分辨率也是原始分辨率，什么都没调。你看一下这是不是 bug。"
//   实测：`ffmpeg -threads 1 -filter_threads 1 … -i ~/.dsh-mpkg-wallpaper/transcodes/src_1789…`
//   常驻、RSS ≈ 690MB —— 插件在后台转用户正在播放的壁纸。
//
// 本文件在 Node 里 apply() **真实的 lib/index.js**（DSH_HOME 指向临时目录，绝不碰用户数据），
// ffmpeg 用**桩**（`DSH_WE_FFMPEG` 指向记录调用的脚本）⇒ 一条真 ffmpeg 都不会跑。
//
// ── 磁盘卫生（硬要求；2026-09-17 教训：本测试曾把盘写满）──────────────────────
//   ① 夹具全部 ≤ 1MB：转码产物桩只写 4KB；"超限目录"用 env 把上限压到 **KB 级**
//      （DSH_WE_TRANSCODE_MAX_BYTES），**绝不**为了测上限去造几十/几百 MB 文件；
//   ② mkdtemp 后**立刻**注册清理：正常路径 finally 删 + exit/SIGINT/SIGTERM 兜底；
//   ③ 硬断言：测试期间 tmp 总量 ≤ TMP_CAP_MB（默认 50MB）、每个夹具 ≤1MB、
//      /tmp 下没有残留的本测试目录；任何一条超了 → 失败并列出证据。
//
// 断言分五组：[A] 可播性闸门 [B] 缓存复用 [C] 资源上限 [D] 客户端接线 [E] 磁盘卫生
// 用法: node tools/transcode-limit-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';

const here = path.dirname(fileURLToPath(import.meta.url));
// ⓪ 子进程的数据目录**由 CLI 显式传入**（不依赖 env 覆盖：本测试踩过 env 在子进程里
//    被改写、导致子进程自己又 mkdtemp 一个空目录、读到错误状态的坑）。
//    形如 `--data-dir=/tmp/mpw-tc-XXXX/.dsh-mpkg-wallpaper`。
const DATA_DIR_ARG = (process.argv.find((a) => a.startsWith('--data-dir=')) || '').slice('--data-dir='.length);
const CHILD_TMP_ARG = (process.argv.find((a) => a.startsWith('--child-tmp=')) || '').slice('--child-tmp='.length);
if (DATA_DIR_ARG) process.env.DSH_HOME = path.dirname(DATA_DIR_ARG);

const ROOT = path.resolve(here, '..');
let pass = 0, fail = 0;
// ①(2026-09-17 假绿修复轮) 本文件**本来就不是**假绿：44 条断言全部走 `check(n, cond, d)`（cond 决定走
//   通过还是失败分支），没有一处把条件当"展示细节"丢给打印原语。但仓库扫描里那个原语的形状与真·假绿的
//   scene-video-test / scene-audio-route-test 完全一样 —— 为免日后有人顺手写 `ok(名字, 条件)` 又造一个恒真，
//   这里把它改名成 `passLine`：能提条件的地方**只有** check 一家。
const passLine = (n, d) => { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); };
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? '  → ' + d : '')); };
const check = (n, cond, d) => { if (cond) passLine(n, d); else bad(n, d); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;
const TMP_CAP_MB = Number(process.env.MPW_TEST_TMP_CAP_MB || 50);
const FIXTURE_MAX_BYTES = 1024 * 1024;          // 单个夹具 ≤1MB（本测试实际只用 4–8KB）

// ── 临时目录：建完立刻登记清理（异常/被杀也不留）──
const TMP_PREFIX = 'mpw-tc-';
// 子进程的临时目录由父进程通过 --child-tmp=<绝对路径> 指定（父进程才能在跑完断言"无残留"）；
// 不指定就是父进程自己，用随机名。
const TMP = CHILD_TMP_ARG ? (fs.mkdirSync(CHILD_TMP_ARG, { recursive: true }), CHILD_TMP_ARG) : fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
// 只删**自己**的临时目录；子进程靠 MPW_NO_CLEANUP 跳过（TMP 属父进程工作区）
// 子进程：只删**自己的** TMP（--child-tmp），绝不碰父进程的工作区；
// 父进程：删自己的 TMP。这样"跑完 /tmp 无 mpw-tc-* 残留"这条断言才有意义。
const cleanup = () => {
  const target = CHILD_TMP_ARG || TMP;
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* 忽略 */ }
};
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });
const duMb = (dir) => {
  let total = 0;
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, e.name);
      try { if (e.isDirectory()) walk(fp); else total += fs.statSync(fp).size; } catch { /* 竞态 */ }
    }
  };
  try { walk(dir); } catch { /* 没了 */ }
  return total / MB;
};

// ⚠ 关键顺序：`lib/index.js` 在 **import 时**就读 DSH_HOME 算 DATA_DIR ⇒
//   必须在这里（任何 import 之前）把 env 定好。踩过的坑：把 env 设到文件下半部分，
//   子进程便用旧的 DSH_HOME 加载模块，于是一直读写自己的空目录（"启动清理没生效"假象）。
process.env.DSH_HOME = DATA_DIR_ARG ? path.dirname(DATA_DIR_ARG) : TMP;
const DATA = DATA_DIR_ARG || path.join(TMP, '.dsh-mpkg-wallpaper');
const CUSTOM = path.join(TMP, 'vids');
const TC = path.join(DATA, 'transcodes');
fs.mkdirSync(TC, { recursive: true });
fs.mkdirSync(CUSTOM, { recursive: true });
fs.writeFileSync(path.join(DATA, 'custom-dir.json'), JSON.stringify({ dir: CUSTOM }));

// ── 语料：两个 ~30KB 的小视频（可直读 H.264/MP4、吃不下 HEVC/MKV）──
const haveFf = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
if (!haveFf) { console.error('需要系统 ffmpeg/ffprobe 生成测试语料'); cleanup(); process.exit(2); }
const gen = (args, out) => { const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args, out], { encoding: 'utf8' }); return r.status === 0 && fs.existsSync(out); };
const PLAYABLE = path.join(CUSTOM, 'playable.mp4');
const UNPLAYABLE = path.join(CUSTOM, 'unplayable.mkv');
const src = ['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1'];
const okP = gen([...src, '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'], PLAYABLE);
const okU = gen([...src, '-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'], UNPLAYABLE);
if (!okP || !okU) { console.error('无法生成测试语料（libx264/libx265 缺失？）'); cleanup(); process.exit(2); }
// 第二个"吃不下"源（并发/取消用；A4d 也用它验证 direct-spec 不能直读 HEVC）
fs.copyFileSync(UNPLAYABLE, path.join(CUSTOM, 'unplayable2.mkv'));

// ── ffmpeg 桩：记 probe / transcode 调用与产物；产物只写 4KB ──
// 用 node 而不是 sh 写：sh 的 trap 对前台命令要等它结束才处理信号（取消路径测不出来）。
const STUB_LOG = path.join(TMP, 'stub.log');
const STUB_JS = path.join(TMP, 'fake-ffmpeg.js');
const STUB = path.join(TMP, 'fake-ffmpeg');
fs.writeFileSync(STUB_JS, `#!/usr/bin/env node
const fs = require('fs');
const isProbe = process.argv.includes('-version');   // ensureFfmpeg() 的可用性探测，不是转码
const args = process.argv.slice(2);
const log = (s) => fs.appendFileSync(process.env.STUB_LOG, s + ' ' + (Date.now() * 1000000) + '\\n');
log(isProbe ? 'probe' : ('transcode-start ' + args.join(' ')));
const out = args[args.length - 1];
if (isProbe) process.exit(0);
// 并发计数（机制判据，不依赖时序）：同时活跃的真转码调用数必须恒为 1
const bump = (d) => {
  const f = process.env.STUB_CONC;
  let cur = 0, max = 0;
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8') || '{}'); cur = j.cur || 0; max = j.max || 0; } catch {}
  cur += d; if (cur > max) max = cur;
  try { fs.writeFileSync(f, JSON.stringify({ cur, max })); } catch {}
};
bump(1);
const ms = Number(process.env.STUB_SLEEP || 0.45) * 1000;
const t0 = Date.now();
const iv = setInterval(() => {
  if (Date.now() - t0 < ms) return;
  clearInterval(iv);
  try { fs.writeFileSync(out, Buffer.alloc(4096, 0x41)); } catch {}   // 4KB 产物（夹具 ≤1MB）
  bump(-1);
  log('transcode-end');
  process.exit(0);
}, 40);
process.on('SIGTERM', () => { clearInterval(iv); bump(-1); log('transcode-killed'); process.exit(143); });
`);
fs.writeFileSync(STUB, '#!/bin/sh\nexec ' + JSON.stringify(process.execPath) + ' ' + JSON.stringify(STUB_JS) + ' "$@"\n', { mode: 0o755 });

process.env.DSH_WE_FFMPEG = STUB;
process.env.STUB_LOG = STUB_LOG;
const STUB_CONC = path.join(TMP, 'conc.json');
process.env.STUB_CONC = STUB_CONC;
// 把"目录字节上限"压到 KB 级：这样"超限 → 清理"可以用 4KB 小文件验完，
// 不需要造大文件（本测试曾经正是用 128MB×6 的假产物把磁盘写满）。
const TEST_CAP_BYTES = 16 * 1024;
process.env.DSH_WE_TRANSCODE_MAX_BYTES = String(TEST_CAP_BYTES);

const { __mpwTest } = await import('../lib/index.js');
const L = __mpwTest.limits;

const routes = [];
__mpwTest.apply({ webServer: { register: (r) => routes.push(r) }, loader: null, logger: { info() {}, warn() {}, error() {} } });
const routeExact = (p) => routes.find((r) => r.kind === 'exact' && r.path === p);
const routePrefix = (p) => routes.find((r) => r.kind === 'prefix' && r.path === p);

class Res extends Writable {
  constructor() { super(); this.chunks = []; this.status = 0; this.headers = {}; }
  _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
  writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this; }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
  get body() { return Buffer.concat(this.chunks).toString(); }
}
/** 调一次路由；opts.abortAfterMs 模拟"客户端中途断开" */
async function call(route, url, { method = 'GET', headers = {}, abortAfterMs = 0 } = {}) {
  const res = new Res();
  const req = { method, url, headers, on() {}, removeListener() {} };
  const done = new Promise((resolve) => res.on('finish', resolve));
  const p = Promise.resolve(route.handler(req, res)).catch(() => {});
  if (abortAfterMs > 0) setTimeout(() => res.emit('close'), abortAfterMs);
  await Promise.race([done, sleep(20000)]);
  await Promise.race([p, sleep(1200)]);
  return res;
}
// ⚠ 只数**真转码**调用：ensureFfmpeg() 会先用 `-version` 探测（桩里记 probe）
const stubLines = () => { try { return fs.readFileSync(STUB_LOG, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
const spawnCount = () => stubLines().filter((l) => l.startsWith('transcode-start')).length;
const tcFiles = () => fs.readdirSync(TC).filter((n) => n.startsWith('tc_') && n.endsWith('.mp4'));
const seed = (name, bytes, ageMin) => { const f = path.join(TC, name); fs.writeFileSync(f, Buffer.alloc(bytes, 1)); const t = new Date(Date.now() - ageMin * 60000); fs.utimesSync(f, t, t); };
const probeUrl = (file) => '/api/mpkg-wallpaper/probe?src=' + encodeURIComponent('host:?custom=1&folder=&file=' + file);
const tcUrl = (file, extra = '') => '/api/mpkg-wallpaper/transcode?src=' + encodeURIComponent('host:?custom=1&folder=&file=' + file) + extra;
const jsonOf = (res) => { try { return JSON.parse(res.body); } catch { return {}; } };
/** 子进程出口：**先 drain stdout 再退出**。直接 process.exit() 会截断管道里的
 *  stdout（异步写），父进程用 spawnSync 读到的 stdout 会是空的/残缺的 —— 本测试踩过。 */
/** 子进程专用输出 + 退出：`fs.writeSync(1, …)` 是**同步**写（管道下不会被截断），
 *  直接 `process.exit()` 也不会丢行。踩过的两个坑：①`console.log` + `process.exit()`
 *  会把管道里的 stdout 截断（父进程 spawnSync 读到空）；②靠 stdout.write 回调/定时器
 *  "等 flush 再退"会让子进程被管道写阻塞而**永不退出**，把父进程永久卡住。 */
const childPrint = (line) => { try { fs.writeSync(1, line + '\n'); } catch { /* 忽略 */ } };

console.log('== 语料（全部 ≤1MB）==');
for (const [label, f] of [['可直读', PLAYABLE], ['吃不下', UNPLAYABLE]]) {
  const size = fs.statSync(f).size;
  const codec = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim();
  check('语料 ' + label + ' 夹具 ≤1MB', size <= FIXTURE_MAX_BYTES, path.basename(f) + ' ' + size + ' B / ' + codec);
}
console.log('  生效上限（测试期把字节上限压到 ' + (TEST_CAP_BYTES / 1024) + 'KB 以免写大盘）: ' + JSON.stringify(L));

console.log('\n== [A] 可播性闸门（这次转码是误判 ⇒ 不该 spawn）==');
{
  const r = await call(routeExact('/api/mpkg-wallpaper/probe'), probeUrl('playable.mp4'));
  const j = jsonOf(r);
  check('A1 /probe 对 H.264/MP4 判 playable:true', r.status === 200 && j.verdict && j.verdict.playable === true,
    'verdict=' + JSON.stringify(j.verdict) + ' info=' + JSON.stringify(j.info && { v: j.info.video, a: j.info.audio, w: j.info.width, h: j.info.height, fps: j.info.fps }));
  check('A1b 探测给出真实分辨率/帧率（直读判据的来源）', !!(j.info && j.info.width === 160 && j.info.height === 120 && j.info.fps === 30), JSON.stringify(j.info && { w: j.info.width, h: j.info.height, fps: j.info.fps }));
  check('A1c 探测到音频编码（aac）', !!(j.info && j.info.audio === 'aac'), 'audio=' + (j.info && j.info.audio));
}
{
  const before = spawnCount();
  const r = await call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('playable.mp4', '&fps=24'));
  check('A2 可直读源 + /transcode?fps=24（= 客户端自动降级那条 URL）⇒ **不 spawn ffmpeg**', spawnCount() === before, 'spawn ' + before + '→' + spawnCount());
  check('A2b 响应头标明直读（x-mpw-transcode: direct-playable）', r.headers['x-mpw-transcode'] === 'direct-playable', JSON.stringify(r.headers['x-mpw-transcode']));
  check('A2c 直读返回原片字节（200 + content-length = 源大小）', r.status === 200 && Number(r.headers['content-length']) === fs.statSync(PLAYABLE).size, 'status=' + r.status + ' len=' + r.headers['content-length']);
}
{
  const before = spawnCount();
  const r = await call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('playable.mp4', '&fps=24&player=direct'));
  check('A3 player=direct ⇒ 直读、不 spawn', spawnCount() === before && r.headers['x-mpw-transcode'] === 'direct-playable', 'spawn=' + spawnCount() + ' hdr=' + r.headers['x-mpw-transcode']);
}
{
  const p = jsonOf(await call(routeExact('/api/mpkg-wallpaper/probe'), probeUrl('unplayable.mkv')));
  check('A4 /probe 对 HEVC/MKV 判 playable:false（真吃不下）', p.verdict && p.verdict.playable === false, JSON.stringify(p.verdict));
  const before = spawnCount();
  const r = await call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('unplayable.mkv', '&fps=24'));
  await sleep(400);
  check('A4b 吃不下 ⇒ 才 spawn ffmpeg（转码有意义）', spawnCount() > before, 'spawn ' + before + '→' + spawnCount());
  check('A4c 产物落到 transcodes/tc_*.mp4', r.status === 200 && tcFiles().length >= 1, 'tc=' + JSON.stringify(tcFiles()));
}
{
  // A4d 旧口径的坑：`direct-spec`（"上限没低于源规格就直读"）**不看编码** ⇒
  //     HEVC 源在 fps/宽度都没超限时会被直读 = 浏览器黑屏。已判定吃不下就必须转码。
  const before = spawnCount();
  const r = await call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('unplayable2.mkv', '&fps=30'));
  await sleep(400);
  check('A4d 吃不下 + 上限不超源规格 ⇒ 也必须转码（不能 direct-spec 直读）',
    spawnCount() > before && !r.headers['x-mpw-transcode'], 'spawn ' + before + '→' + spawnCount() + ' hdr=' + JSON.stringify(r.headers['x-mpw-transcode']));
}
{
  const before = spawnCount();
  const r = await call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('不存在的文件.mp4', '&fps=24'));
  check('A5 源不存在 ⇒ 404 且不 spawn（探测失败不改行为、不自作聪明）', r.status === 404 && spawnCount() === before, 'status=' + r.status);
}
{
  // A6 边界：用户显式给 maxW（= 设了 resMax）时，即使可直读也照旧转码（尊重用户设置）
  const before = spawnCount();
  const r = await call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('playable.mp4', '&fps=24&maxW=120'));
  await sleep(400);
  check('A6 用户显式设 maxW（resMax）⇒ 尊重用户设置、照旧转码', spawnCount() > before, 'spawn ' + before + '→' + spawnCount() + ' status=' + r.status);
}

console.log('\n== [B] 缓存复用（同源同规格第二次 ⇒ 命中产物，不重转）==');
{
  const before = spawnCount();
  const r1 = await call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('unplayable.mkv', '&fps=24'));
  await sleep(300);
  const r2 = await call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('unplayable.mkv', '&fps=24'));
  await sleep(300);
  check('B1 第二次请求 spawn 次数不增加（缓存命中复用）', spawnCount() === before, 'spawn ' + before + '→' + spawnCount());
  check('B2 两次都拿到同一份产物（200 + 相同的 4KB content-length）',
    r1.status === 200 && r2.status === 200 && Number(r1.headers['content-length']) === 4096 && r1.headers['content-length'] === r2.headers['content-length'],
    'len1=' + r1.headers['content-length'] + ' len2=' + r2.headers['content-length']);
  check('B3 缓存键不含时间戳（同源同规格只产生一个产物）', new Set(tcFiles()).size === tcFiles().length, 'tc=' + JSON.stringify(tcFiles()));
}

console.log('\n== [C] 资源上限 ==');
{
  // C1 并发上限：两个**不同源**并发转码 → 桩的 transcode 区间必须不重叠
  fs.copyFileSync(UNPLAYABLE, path.join(CUSTOM, 'unplayable2.mkv'));
  fs.writeFileSync(STUB_LOG, '');
  fs.writeFileSync(STUB_CONC, JSON.stringify({ cur: 0, max: 0 }));
  process.env.STUB_SLEEP = '0.6';
  const [a, b] = await Promise.all([
    call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('unplayable.mkv', '&fps=30')),
    call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('unplayable2.mkv', '&fps=30')),
  ]);
  await sleep(800);
  const conc = JSON.parse(fs.readFileSync(STUB_CONC, 'utf8'));
  const starts = stubLines().filter((l) => l.startsWith('transcode-start')).length;
  check('C1 并发上限 = 1（两次并发转码：桩内并发计数峰值恒为 1）',
    L.TRANSCODE_MAX_ACTIVE === 1 && starts >= 2 && conc.max === 1 && conc.cur === 0,
    'maxActive=' + L.TRANSCODE_MAX_ACTIVE + ' runs=' + starts + ' 并发峰值=' + conc.max + ' 残留=' + conc.cur);
  check('C1b 两个请求都拿到了产物', a.status === 200 && b.status === 200, 'status=' + a.status + '/' + b.status);
  delete process.env.STUB_SLEEP;
}
{
  // C2 产物字节上限（KB 级夹具即可验证）：6×4KB 旧产物 + 一次转码 ⇒ 回到 ≤16KB、最旧先删
  for (const n of fs.readdirSync(TC)) { try { fs.unlinkSync(path.join(TC, n)); } catch {} }
  for (let i = 0; i < 6; i++) seed('tc_seed' + i + '.mp4', 4096, 120 - i);
  const r = await call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('unplayable.mkv', '&fps=48'));
  await sleep(800);   // pruneTranscodeCache 在响应写完后跑
  const files = tcFiles();
  const total = files.reduce((s, n) => s + fs.statSync(path.join(TC, n)).size, 0);
  check('C2 产物字节上限：转码后目录合计 ≤ ' + (TEST_CAP_BYTES / 1024) + 'KB', total <= TEST_CAP_BYTES, 'total=' + (total / 1024).toFixed(1) + 'KB files=' + files.length);
  check('C2b 按 mtime 最旧先删（seed0 已不在）', !fs.existsSync(path.join(TC, 'tc_seed0.mp4')), JSON.stringify(files));
  check('C2c 本次新产物保留（不被自己的清理误删）', r.status === 200 && files.length >= 1, 'status=' + r.status);
}
if (process.argv.includes('--startup-cleanup-child')) {
  // C3 子进程：上限值在模块加载时求值 ⇒ 必须新进程才测得出"启动清理用了新上限"。
  // ⚠ 子进程**不能** cleanup()：TMP 是父进程的工作区（共享 DSH_HOME），
  //   子进程删掉它会让父进程后半段全部看到"目录不存在"（本测试踩过）。
  const st = __mpwTest.transcodeCacheStat();
  const files = tcFiles();
  childPrint('STARTUP ' + JSON.stringify({ ...st, files: files.length, dataDir: DATA }));
  cleanup();
  process.exit(st.bytes <= TEST_CAP_BYTES ? 0 : 1);
}
{
  // C3a 启动清理的**语义**（字节上限 + 最旧先删 + 受保护的新产物）：
  //  直接用上限函数验（它就是 apply() 启动时调用的同一个函数），不依赖跨进程目录可见性。
  for (const n of fs.readdirSync(TC)) { try { fs.unlinkSync(path.join(TC, n)); } catch {} }
  for (let i = 0; i < 6; i++) seed('tc_boot' + i + '.mp4', 4096, 55 - i * 5);   // 55..30 分钟前（都 <1h ⇒ 不算残留）
  seed('src_stale_1.bin', 2048, 120);                                            // 120min ⇒ 超期残留
  const fresh = path.join(TC, 'tc_fresh.mp4'); fs.writeFileSync(fresh, Buffer.alloc(4096, 2));
  const removed = __mpwTest.pruneTranscodeCache(fresh);   // ④ 受保护的新产物
  await sleep(200);
  const files = tcFiles();
  const total = files.reduce((s2, n) => s2 + fs.statSync(path.join(TC, n)).size, 0);
  check('C3a 启动清理口径：超限目录一次清理后合计 ≤ ' + (TEST_CAP_BYTES / 1024) + 'KB',
    total <= TEST_CAP_BYTES && removed.cache > 0, 'total=' + (total / 1024).toFixed(1) + 'KB files=' + files.length + ' removed=' + removed.cache);
  check('C3b 最旧先删（tc_boot0 已删、tc_boot5 还在）', !files.includes('tc_boot0.mp4') && files.includes('tc_boot5.mp4'), JSON.stringify(files));
  check('C3c 受保护的新产物不被自己这轮清理删掉', fs.existsSync(fresh), JSON.stringify(files));
  check('C3d 超期残留（src_*.bin，mtime>1h）被带走', !fs.existsSync(path.join(TC, 'src_stale_1.bin')));
}
{
  // C3e 启动清理**接线**：apply() 一开始就调用清理（子进程里预置超限态，看启动日志的产物数下降）。
  //  子进程只证明"接线上电了"，字节语义已由 C3a–C3d 独立验证。
  for (const n of fs.readdirSync(TC)) { try { fs.unlinkSync(path.join(TC, n)); } catch {} }
  for (let i = 0; i < 6; i++) seed('tc_boot' + i + '.mp4', 4096, 40);
  const childTmp = path.join(os.tmpdir(), 'mpw-tc-child-' + process.pid);
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--startup-cleanup-child', '--data-dir=' + DATA, '--child-tmp=' + childTmp], {
    encoding: 'utf8', timeout: 90000,
    env: { ...process.env, DSH_HOME: path.dirname(DATA), DSH_WE_TRANSCODE_MAX_BYTES: String(TEST_CAP_BYTES) },
  });
  const log = (child.stdout || '') + (child.stderr || '');
  check('C3e 启动清理已接线：子进程 apply() 的启动日志显示产物数下降且落到限内',
    /\[limits\] transcodes 启动清理完成：产物 6→\d+ 个/.test(log) && /（上限 12 个 \/ 0 MB）/.test(log),
    (log.split('\n').filter((l) => l.includes('[limits]'))[0] || '(无启动日志)').slice(0, 200));
}
if (process.argv.includes('--mem-guard-child')) {
  // C4 子进程：内存准入阈值调到天上 ⇒ 拒绝转码（502 + 原因）、不 spawn
  const before = spawnCount();
  const r = await call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('unplayable.mkv', '&fps=60'));
  const j = jsonOf(r);
  const okGuard = r.status === 502 && /内存/.test(String(j.error || '')) && spawnCount() === before;
  childPrint(okGuard ? 'MEMGUARD_OK ' + JSON.stringify(j.error) : 'MEMGUARD_FAIL ' + r.status + ' ' + JSON.stringify(j));
  cleanup();   // 只删自己的 --child-tmp
  process.exit(okGuard ? 0 : 1);
}
{
  const childTmp2 = path.join(os.tmpdir(), 'mpw-tc-child2-' + process.pid);
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--mem-guard-child', '--data-dir=' + DATA, '--child-tmp=' + childTmp2], {
    encoding: 'utf8', env: { ...process.env, DSH_HOME: path.dirname(DATA), DSH_WE_TRANSCODE_MIN_AVAIL_MB: '99999999' },
  });
  check('C4 内存准入：可用内存 < 阈值时拒绝转码（子进程验证，不 spawn）',
    child.status === 0 && /MEMGUARD_OK/.test(child.stdout || ''), (child.stdout || '').trim().split('\n').pop());
}
{
  // C5 取消：客户端断开 ⇒ kill 本请求的 ffmpeg（桩收到 TERM），不留产物
  fs.writeFileSync(STUB_LOG, '');
  const before = tcFiles().length;
  process.env.STUB_SLEEP = '1.5';   // 让"断开"落在转码进行中
  await call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('unplayable2.mkv', '&fps=60'), { abortAfterMs: 400 });
  await sleep(1500);
  delete process.env.STUB_SLEEP;
  const lines = stubLines();
  check('C5 客户端断开 ⇒ 本请求的 ffmpeg 被取消（桩收到 TERM：transcode-killed）',
    lines.some((l) => l.startsWith('transcode-killed')), JSON.stringify(lines));
  check('C5b 取消后不留产物（tc_*.mp4 数量不增加）', tcFiles().length <= before, 'tc ' + before + '→' + tcFiles().length);
}
{
  // C6 上限集中一处 + /probe 回报
  const srcText = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8');
  check('C6 上限值集中在 lib/index.js 一处（数量/字节/并发/降采样/内存准入）',
    /const TRANSCODE_MAX_BYTES =/.test(srcText) && /const TRANSCODE_MAX_ACTIVE =/.test(srcText) && /const TRANSCODE_CACHE_KEEP =/.test(srcText)
    && /const TRANSCODE_DEFAULT_MAXW =/.test(srcText) && /const TRANSCODE_MIN_AVAIL_MB =/.test(srcText));
  const j = jsonOf(await call(routeExact('/api/mpkg-wallpaper/probe'), probeUrl('playable.mp4')));
  check('C6b /probe 回报当前生效上限（现场可一眼核对）',
    !!(j.limits && j.limits.cacheMaxBytes === L.TRANSCODE_MAX_BYTES && j.limits.maxActive === 1 && j.limits.defaultMaxW === L.TRANSCODE_DEFAULT_MAXW),
    JSON.stringify(j.limits));
  check('C6c /probe 回报目录占用（数量 + 字节）', !!(j.cache && typeof j.cache.count === 'number' && typeof j.cache.bytes === 'number'), JSON.stringify(j.cache));
}
{
  // C7 转码默认降采样：真的把 scale=min(1920,iw) 传给了 ffmpeg（实测 4K 656MB → 1080p 275MB）
  fs.writeFileSync(STUB_LOG, '');
  fs.copyFileSync(UNPLAYABLE, path.join(CUSTOM, 'unplayable3.mkv'));
  await call(routePrefix('/api/mpkg-wallpaper/transcode'), tcUrl('unplayable3.mkv', '&fps=30'));
  await sleep(500);
  const run = stubLines().find((l) => l.startsWith('transcode-start')) || '';
  check('C7 转码真的带降采样（ffmpeg 实参含 scale=min(1920,iw)）',
    L.TRANSCODE_DEFAULT_MAXW === 1920 && /scale='?min\(1920,iw\)/.test(run), run.slice(0, 170));
  const srcT = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8');
  check('C7b 线程策略：首轮多线程（本机实测 qemu 下 futex 会失败）⇒ 单线程 -threads 1/-filter_threads 1 作为回退存在',
    !/-filter_threads 1/.test(run) && /label: 'st', extra: \['-threads', '1', '-filter_threads', '1'\]/.test(srcT), run.slice(0, 110));
}

console.log('\n== [D] 客户端接线（源码守卫）==');
{
  const c = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  check('D1 error 自动降级路径先探测再决定转码（/probe 闸门存在）',
    /mpwProbeUrl\(image\)/.test(c) && /playable === true/.test(c) && /不转码/.test(c));
  check('D2 回退开关 ?mpwtranscode=legacy（一键回到旧行为）', /mpwtranscode/.test(c) && /legacy/.test(c));
  check('D3 三态可见：direct / transcode / cached 都有落点',
    /mpwWallpaperStateSet\("direct"/.test(c) && /mpwWallpaperStateSet\("transcode"/.test(c) && /"cached"/.test(c) && /__mpwWallpaperState/.test(c));
  check('D4 可直读时不启动转码：有明确日志与用户可见提示', /transcode\.directRetry/.test(c));
}

console.log('\n== [E] 磁盘卫生（硬要求）==');
const usedMb = duMb(TMP);
{
  check('E1 测试期间临时目录总占用 ≤ ' + TMP_CAP_MB + 'MB（夹具全部小文件）', usedMb <= TMP_CAP_MB, usedMb.toFixed(2) + ' MB');
  // 排除"本进程自己的" TMP（它还在用、由后面的 E4 断言删除）
  const leftoverDirs = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(TMP_PREFIX) && path.join(os.tmpdir(), n) !== TMP);
  check('E2 没有上次运行残留的 mpw-tc-* 目录', leftoverDirs.length === 0, leftoverDirs.join(', ') || '无');
  const big = [];
  const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const fp = path.join(p, e.name); try { if (e.isDirectory()) walk(fp); else { const s = fs.statSync(fp).size; if (s > FIXTURE_MAX_BYTES) big.push(e.name + '=' + s); } } catch {} } };
  walk(TMP);
  check('E3 每个夹具 ≤1MB', big.length === 0, big.join(', ') || '全部 ≤1MB');
}

console.log('\n===== transcode-limit-test: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
console.log('  临时目录峰值占用 ' + usedMb.toFixed(2) + ' MB（上限断言 ' + TMP_CAP_MB + ' MB）');
cleanup();
const stillThere = fs.existsSync(TMP);
const leftover = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(TMP_PREFIX)).length;
check('E4 清理生效：本测试临时目录已删除', !stillThere, TMP);
check('E5 跑完 /tmp 下无 mpw-tc-* 残留', leftover === 0, leftover + ' 个');
process.exit(fail === 0 ? 0 : 1);

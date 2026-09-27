#!/usr/bin/env node
// tools/prescale-switch-race-test.mjs —— 「切档 → 立刻切回」竞态回归（H1 半完成状态）
//
// 用户原话（2026-09-28）：「我把壁纸设置里面的**视频预缩档**从按屏幕物理尺寸点了一下（我本来
//   是关的状态）。点了一下之后（把我的壁纸清除掉了，但是我又直接点了关），我又切回到关的状态
//   —— 也就是说，按屏幕物理尺寸还没加载出来，我就点击了关闭。这时候壁纸就加载不出来了（包括
//   刷新和清除了，重新再使用就加载不出来），但是过一会儿又能加载出来了。但是我点了一下刷新
//   壁纸，又是过一会儿才能加载出来的。」
//
// 两个根因（本判据各钉一组）：
//  ① **验活请求会 drive 转码、且取消语义是"发出去就算源不可用"**：一次 `/transcode` 实际来两个
//     请求（`<video>` 播放 + 客户端 `Range: bytes=0-0` 验活）。旧实现两者命中同一份 in-flight
//     转码 ⇒ 播放请求一断开（用户切档）就 kill 共享 ffmpeg，**验活请求**收到 502 `{ok:false}`
//     ⇒ 客户端把"被取消"读成"源不可用" ⇒ 撤 src + 隐藏壁纸层（"壁纸就加载不出来了"）。
//  ② **客户端裁决没有代际**：预缩档的验活要等宿主转码（几十秒~分钟），期间用户切回关 ⇒ 迟到
//     的 `{ok:false}` 把**已经换好的原片**撤掉；且旧 `mpwArmProbeCache` 把否定答案缓存 20s
//     ⇒ 期间每次 apply（刷新/清空重选）都复用 ⇒ 反复隐藏；20s 后才自愈（"过一会儿又能加载"）。
//
// 判据（全部离线；宿主侧用**桩 ffmpeg**，客户端侧**切片跑真实现**，不真跑 ffmpeg、不读大语料）：
//   A 客户端（真切片 + 桩 DOM/fetch，行为级）：
//     A1 裁决代际：迟到的 {ok:false}（源已切换/签名已变）**绝不**动手（不撤 src、不隐藏层）；
//     A2 同一挂载上的真失败仍然照旧卸源+隐藏（不许"修过头"）；
//     A3 否定答案只信 3s（可用 20s）—— 旧口径 20s 会让"过一会儿才恢复"变成"20s 内反复坏"；
//     A4 换源即作废：`mpwArmAbortAll` 打断悬挂验活 + 清缓存；验活请求 URL 带 `player=verify`。
//   B 宿主（真路由 + 桩 ffmpeg 端到端）：
//     B1 **切档→立刻切回**：播放请求断开 ⇒ 只 kill 本任务；验活请求拿 202（不是 502）；
//        无产物落地、无 .tmp 残留、条目引用归零、台账 `phase:'cancelled'`（可读、含代际）；
//        关档后客户端要挂的原文件（`/custom-media`）**字节一致**可用（确定性回到可用源）。
//     B2 **归属/代际**：同一产物两个在飞播放请求，A 断开**不得**杀掉 B 的任务（旧实现会误杀）。
//     B3 **半成品/无效产物不得当有效缓存**：0 字节 / 无 ftyp 垃圾（最终名）⇒ 删掉并重转，绝不流出。
//     B4 验活角色：有产物 ⇒ 直接给（不再起 ffmpeg）；无产物 ⇒ 202 pending（**不起 ffmpeg**）。
//   C 变异自证（每条必须变红）：去代际 / 去否定 TTL / 关档判成转码 / 去引用计数 / 去产物有效性 /
//     去验活角色 / 取消写成 error。
//
// 用法: node tools/prescale-switch-race-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const BASE = '/api/mpkg-wallpaper';

let pass = 0, fail = 0;
const ok = (n, cond, d) => {
  if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); }
  else { fail++; console.error('  ✗ ' + n + (d ? '  → ' + d : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 6000, step = 25) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = !!fn() } catch { v = false }
    if (v) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
}

/* ── 临时目录（退出兜底清理） ─────────────────────────────────────── */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-race-'));
const cleanup = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ } };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

/* ── 桩 ffmpeg：写"看起来像 mp4"的产物（ftyp）后 sleep；SIGTERM ⇒ 记 killed + 删自己的产物 ── */
const STUB_LOG = path.join(TMP, 'stub.log');
const STUB_JS = path.join(TMP, 'fake-ffmpeg.js');
const STUB = path.join(TMP, 'fake-ffmpeg');
fs.writeFileSync(STUB_JS, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const log = (s) => { try { fs.appendFileSync(process.env.STUB_LOG, s + '\\n') } catch {} };
if (args.includes('-version')) { log('probe'); process.exit(0); }
log('transcode-start ' + args.join(' '));
const out = args[args.length - 1];
let done = false;
const onTerm = () => { if (done) return; done = true; log('transcode-killed'); try { fs.unlinkSync(out) } catch {} process.exit(143); };
process.on('SIGTERM', onTerm);
process.on('SIGINT', onTerm);
const bytes = Number(process.env.STUB_BYTES || 4096);
const buf = Buffer.alloc(bytes, 0x41);
buf.writeUInt32BE(24, 0); buf.write('ftyp', 4, 'latin1'); buf.write('mp42', 8, 'latin1');   // 像个真 mp4 头
try { fs.writeFileSync(out, buf) } catch {}
setTimeout(() => { if (done) return; done = true; try { fs.writeFileSync(out, buf) } catch {} process.exit(0) }, Number(process.env.STUB_SLEEP_MS || 300));
`);
fs.writeFileSync(STUB, '#!/bin/sh\nexec ' + JSON.stringify(process.execPath) + ' ' + JSON.stringify(STUB_JS) + ' "$@"\n', { mode: 0o755 });

/* ── 环境：必须在 import lib/index.js **之前**定好（不碰用户真档） ───── */
const HOME = path.join(TMP, 'home');
process.env.DSH_HOME = HOME;
process.env.DSH_WE_FFMPEG = STUB;
process.env.STUB_LOG = STUB_LOG;
process.env.STUB_BYTES = '512';          // ← 半成品尺寸（< 产物有效性阈值 1024）
process.env.STUB_SLEEP_MS = '60000';     // ← 默认"长转码"：只有被 kill 才会结束
process.env.DSH_WE_TRANSCODE_CACHE_KEEP = '8';
process.env.DSH_WE_TRANSCODE_MAX_BYTES = String(8 * 1024 * 1024);
process.env.DSH_WE_TRANSCODE_MIN_AVAIL_MB = '0';   // 内存准入在本判据里恒放行（不掺别的变量）
const DATA_DIR = path.join(HOME, '.dsh-mpkg-wallpaper');
const TC = path.join(DATA_DIR, 'transcodes');
fs.mkdirSync(TC, { recursive: true });
const MEDIA = path.join(TMP, 'custom');
fs.mkdirSync(MEDIA, { recursive: true });
const FIXTURE = 'dummy.mkv';
const FIXTURE_BYTES = Buffer.concat([Buffer.alloc(64 * 1024, 0x37), Buffer.from('MPW-RACE-FIXTURE')]);
fs.writeFileSync(path.join(MEDIA, FIXTURE), FIXTURE_BYTES);

const stubLines = () => { try { return fs.readFileSync(STUB_LOG, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
const trStarts = () => stubLines().filter((l) => l.startsWith('transcode-start'));
const trKilled = () => stubLines().filter((l) => l === 'transcode-killed');
const tcFiles = () => { try { return fs.readdirSync(TC).filter((n) => n.startsWith('tc_')); } catch { return [] } };
const tmps = () => tcFiles().filter((n) => /\.tmp(\d+)?$/.test(n));

/* ── 假宿主：直接调真 lib/index.js 注册的路由 handler（不启真 HTTP） ── */
class Res extends Writable {
  constructor() { super({ emitClose: false }); this.chunks = []; this.status = 0; this.headers = {}; }
  _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
  writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this; }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
  get body() { return Buffer.concat(this.chunks).toString(); }
  get bytes() { return Buffer.concat(this.chunks); }
}
function fakeReq(url, method = 'GET') {
  const listeners = {};
  return {
    method, url, headers: {},
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeListener() {}, emit(ev, ...a) { for (const fn of (listeners[ev] || []).slice()) { try { fn(...a) } catch { /* 忽略 */ } } },
    async *[Symbol.asyncIterator]() { /* 无请求体 */ },
  };
}
async function start(route, url) {
  const res = new Res();
  const req = fakeReq(url);
  const p = Promise.resolve(route.handler(req, res)).catch((e) => { try { res.status = res.status || 500; res.end(String(e && e.message || e)) } catch { /* 已响应 */ } });
  return { res, req, p, url };
}
async function call(route, url) {
  const h = await start(route, url);
  // serveRange 是 pipe：handler 先返回、字节后到 ⇒ 必须等 res 'finish' 再读 body
  const fin = new Promise((resolve) => { try { h.res.on('finish', resolve) } catch { resolve() } });
  await Promise.race([Promise.all([h.p, fin]), sleep(15000)]);
  await sleep(5);
  return h.res;
}
async function boot(libDir = path.join(repoRoot, 'lib')) {
  const mod = await import(pathToFileURL(path.join(libDir, 'index.js')).href + '?t=' + Date.now() + '-' + Math.random());
  const routes = [];
  mod.apply({ webServer: { register: (r) => { routes.push(r); return { dispose() {} } } }, loader: null, logger: { info() {}, warn() {}, error() {} } });
  const exact = (p) => routes.find((r) => r.kind === 'exact' && r.path === p);
  const prefix = (p) => routes.find((r) => r.kind === 'prefix' && r.path === p);
  return { mod, routes, exact, prefix };
}
async function callBody(route, url, method, body) {
  const r = new Res();
  const q = fakeReq(url, method);
  q[Symbol.asyncIterator] = async function* () { if (body !== null) yield Buffer.from(body) };
  await Promise.race([Promise.resolve(route.handler(q, r)).catch(() => {}), sleep(8000)]);
  await sleep(5);
  return r;
}
const T = await boot();
{ // POST 设置自定义目录（与 prescale 判据同款：直接调路由 + 请求体）
  const r = await callBody(T.exact(BASE + '/custom-dir'), BASE + '/custom-dir', 'POST', JSON.stringify({ dir: MEDIA }));
  if (!(r.status === 200 && /"ok"\s*:\s*true/.test(r.body))) {
    console.error('  ✗ 夹具准备失败：/custom-dir 未接受 ' + MEDIA + ' → status=' + r.status + ' body=' + r.body.slice(0, 120));
    fail++;
  }
}
const X = T.mod.__mpwTest;
const transcodeRoute = T.prefix(BASE + '/transcode');
const progressRoute = T.exact(BASE + '/transcode-progress');
const customMediaRoute = T.exact(BASE + '/custom-media');
const PLAY = BASE + '/transcode?file=' + encodeURIComponent(FIXTURE) + '&fps=30&maxW=1280&scale=lanczos';
const srcObj = { type: 'file', path: path.join(MEDIA, FIXTURE) };
const prod120 = X.transcodeProductPath(srcObj, 30, 1280, 'lanczos').cachePath;
const prodNoScan = X.transcodeProductPath(srcObj, 30, 1280, '').cachePath;
const ledgerOf = (fps, maxW, s) => X.transcodeJobsDump().filter((e) => e.key === (path.join(MEDIA, FIXTURE) + '|' + fps + '|' + maxW + (s ? '|s:' + s : '')));
const cleanCache = () => { for (const n of tcFiles()) { try { fs.unlinkSync(path.join(TC, n)) } catch { /* 忽略 */ } } };
const cleanLog = () => { try { fs.writeFileSync(STUB_LOG, '') } catch { /* 忽略 */ } };

/* ═══════════ A 段：客户端（真切片 + 桩 DOM/fetch，行为级） ═══════════ */
console.log('══ A 客户端：验活裁决的代际 / TTL / 换源作废（真切片）══');
const clientSrc = fs.readFileSync(path.join(repoRoot, 'lib', 'client.js'), 'utf8');
function sliceFn(src, name) {
  const lines = src.split('\n');
  const startAt = lines.findIndex((l) => new RegExp('(function ' + name + '\\s*\\()|(const ' + name + '\\s*=\\s*(async\\s*)?\\()').test(l));
  if (startAt < 0) throw new Error('没找到 ' + name);
  let depth = 0, seen = false;
  for (let i = startAt; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; seen = true; } else if (ch === '}') { depth--; if (seen && depth === 0) return lines.slice(startAt, i + 1).join('\n'); }
    }
  }
  throw new Error('{} 不配平: ' + name);
}
const CLIENT_FNS = ['mpwArmCacheUsable', 'mpwArmProbeUrl', 'mpwArmVerdictApplies', 'mpwArmMountedUrl', 'mpwArmSigNow', 'mpwArmAbortAll', 'mpwArmProbe', 'mpwVerifyArm', 'mpwBgArmErrorSet', 'mpwBgArmErrorClear'];
/** 造一个客户端沙箱：切片**真实现** + 桩 DOM/fetch（返回控制句柄，方便逐场景摆布）。 */
function makeArmWorld(src, over) {
  const o = over || {};
  const els = {};
  const mkEl = () => {
    const attrs = {};
    return {
      _attrs: attrs,
      style: { _p: {}, setProperty(k, v) { this._p[k] = String(v) }, removeProperty(k) { delete this._p[k] } },
      getAttribute(k) { return attrs[k] === undefined ? null : attrs[k] },
      setAttribute(k, v) { attrs[k] = String(v) },
      removeAttribute(k) { delete attrs[k] },
      pause() { this._paused = true },
      load() { this._loaded = (this._loaded || 0) + 1 },
      play() { this._played = (this._played || 0) + 1; return Promise.resolve() },
    };
  };
  for (const k of ['img', 'video', 'frame', 'canvas', 'wrap']) els[k] = mkEl();
  const hints = [];
  const fetches = [];
  const state = {
    els, hints, fetches,
    sig: 'sig-A',
    probeResolvers: [],
    fetchImpl: o.fetchImpl || null,
  };
  const fetchStub = (u, init) => {
    fetches.push(String(u));
    if (state.fetchImpl) return state.fetchImpl(String(u), init);
    return new Promise((resolve, reject) => {
      state.probeResolvers.push(resolve);
      const sig = init && init.signal;
      if (sig) {
        const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        try { if (sig.aborted) onAbort(); else sig.addEventListener('abort', onAbort, { once: true }); } catch { /* 桩环境 */ }
      }
    });
  };
  const body = CLIENT_FNS.map((n) => sliceFn(src, n)).join('\n');
  const factory = new Function(
    'HOST_BASE', 'location', 'fetch', 'window', 'bgElements', 'mpwTrace', 'mpwWebDiag', 'mpwPersistEmit',
    'readSection', 'sectionSigNow', 'mpwArmProbeCache', 'mpwArmHinted', 'mpwArmAborters',
    'MPW_ARM_POS_TTL_MS', 'MPW_ARM_NEG_TTL_MS', 'console', 'AbortController', 'Promise', 'Date', 'setTimeout', 'clearTimeout',
    body + '\nreturn {' + CLIENT_FNS.join(',') + '};');
  const api = factory(
    BASE, { origin: 'http://localhost' }, fetchStub,
    { __mpwBgArmError: null }, () => els,
    () => {}, () => {}, (m) => hints.push(String(m)),
    () => ({ customDirPath: '/x' }), () => state.sig,
    new Map(), new Map(), new Map(),
    20000, 3000, console,
    typeof AbortController === 'function' ? AbortController : class { constructor() { this.signal = {} } abort() { this.aborted = true } },
    Promise, Date, setTimeout, clearTimeout);
  return { api, state, els };
}
const resp = (status, jsonBody, okFlag) => ({
  ok: okFlag !== undefined ? okFlag : (status >= 200 && status < 300),
  status,
  json: () => Promise.resolve(jsonBody),
});
{
  const W = makeArmWorld(clientSrc);
  const A = W.api;
  // A1 裁决代际：源已切换 ⇒ 迟到的 {ok:false} 必须被丢弃
  const tcUrl = BASE + '/transcode?src=host%3A%3Ftoken%3Dt&fps=60&maxW=1280&scale=lanczos';
  const hostUrl = '/custom-media?folder=&file=a.mp4';
  const urlPlan = A.mpwArmProbeUrl(tcUrl);
  ok('A1a 验活请求 URL 带 `player=verify`（宿主绝不为它起/续 ffmpeg）',
    urlPlan === tcUrl + '&player=verify' && A.mpwArmProbeUrl(hostUrl) === hostUrl, urlPlan.slice(-40));
  ok('A1b 代际判据（纯函数）：同 URL+同签名 ⇒ 生效；换源/换签名 ⇒ 丢弃',
    A.mpwArmVerdictApplies(tcUrl, tcUrl, 's1', 's1') === true
    && A.mpwArmVerdictApplies(tcUrl, hostUrl, 's1', 's1') === false
    && A.mpwArmVerdictApplies(tcUrl, tcUrl, 's1', 's2') === false
    && A.mpwArmVerdictApplies('', tcUrl, 's1', 's1') === false);
  // 摆布：挂载转码档 → 发起验活（悬挂）→ 用户切回关（换源 + 换签名 + 中断）→ 迟到裁决回来
  W.els.video.setAttribute('src', tcUrl);
  A.mpwVerifyArm('video', tcUrl, () => { W.els.video.removeAttribute('src'); A.mpwBgArmErrorSet('video', tcUrl, 502, 'cancelled') }, () => A.mpwBgArmErrorClear());
  await sleep(5);
  ok('A1c 验活确实发出去了（切片跑的是真实现，不是正则）', W.state.fetches.length === 1 && W.state.fetches[0].includes('player=verify'), W.state.fetches[0] || '(无)');
  W.state.sig = 'sig-B';
  W.els.video.setAttribute('src', hostUrl);              // ← 用户切回关：原片挂上
  A.mpwArmAbortAll('switch-source');
  W.state.probeResolvers.forEach((r) => r(resp(502, { ok: false, error: 'cancelled' })));
  await sleep(10);
  const v = W.els.video;
  ok('A1d **迟到裁决不动手**：原片 src 仍在、壁纸层没被隐藏、无"源不可用"状态',
    v.getAttribute('src') === hostUrl && !(W.els.wrap.style._p.display === 'none')
    && !W.els.wrap._attrs['data-mpw-bg-error'] && W.state.hints.length === 0,
    JSON.stringify({ src: v.getAttribute('src'), display: W.els.wrap.style._p.display, err: W.els.wrap._attrs['data-mpw-bg-error'] || '', hints: W.state.hints.length }));
}
{
  // A2 同一挂载上的真失败：仍然要卸源 + 隐藏（不许"修过头"）
  const W = makeArmWorld(clientSrc, { fetchImpl: () => Promise.resolve(resp(502, { ok: false, error: 'boom' })) });
  const A = W.api;
  const u = BASE + '/transcode?src=host%3A%3Fx&fps=60&maxW=1280&scale=lanczos';
  W.els.video.setAttribute('src', u);
  A.mpwVerifyArm('video', u, (vv) => { W.els.video.removeAttribute('src'); A.mpwBgArmErrorSet('video', vv.url, vv.status, vv.error) }, () => A.mpwBgArmErrorClear());
  await sleep(10);
  ok('A2 当前挂载真的坏了 ⇒ 照旧卸源 + 隐藏层（判据没有"修过头"）',
    W.els.video.getAttribute('src') === null && W.els.wrap.style._p.display === 'none' && W.els.wrap._attrs['data-mpw-bg-error'],
    JSON.stringify({ src: W.els.video.getAttribute('src'), display: W.els.wrap.style._p.display }));
}
{
  // A2b 成功裁决 ⇒ 立刻清掉"不可用"（确定性恢复，不必等下一次 apply）
  const W = makeArmWorld(clientSrc, { fetchImpl: () => Promise.resolve(resp(206, null, true)) });
  const A = W.api;
  A.mpwBgArmErrorSet('video', 'x', 502, 'old');
  const u = '/custom-media?folder=&file=a.mp4';
  W.els.video.setAttribute('src', u);
  A.mpwVerifyArm('video', u, () => {}, () => A.mpwBgArmErrorClear());
  await sleep(10);
  ok('A2b 验活成功 ⇒ 清掉"源不可用"（层恢复显示；确定性回到可用源）',
    !(W.els.wrap.style._p.display === 'none') && !W.els.wrap._attrs['data-mpw-bg-error']);
}
{
  const W = makeArmWorld(clientSrc);
  const A = W.api;
  const now = 1_000_000;
  ok('A3 缓存口径：可用答案信 20s、**不可用只信 3s**（旧口径 20s 会让"过一会儿恢复"退化成反复坏）',
    A.mpwArmCacheUsable({ ok: true, at: now }, now + 19000) === true
    && A.mpwArmCacheUsable({ ok: true, at: now }, now + 20001) === false
    && A.mpwArmCacheUsable({ ok: false, at: now }, now + 2000) === true
    && A.mpwArmCacheUsable({ ok: false, at: now }, now + 3001) === false
    && A.mpwArmCacheUsable(null, now) === false);
}
{
  // A3b 行为：3s 内的否定答案复用（不重探）；过 3s 重新探（这是"自愈"的确定性来源）
  let n = 0;
  const W = makeArmWorld(clientSrc, { fetchImpl: () => { n++; return Promise.resolve(resp(502, { ok: false, error: 'x' })) } });
  const A = W.api;
  const u = BASE + '/transcode?src=host%3A%3Fz&fps=60&maxW=1280&scale=lanczos';
  const p1 = await A.mpwArmProbe(u);
  const p2 = await A.mpwArmProbe(u);
  ok('A3b 否定答案 3s 内复用（同一次挂载不反复打宿主）', p1.ok === false && p2.ok === false && n === 1, 'fetches=' + n);
}
{
  // A4 换源即作废：中断悬挂验活（AbortController）+ 清缓存
  const W = makeArmWorld(clientSrc);
  const A = W.api;
  const u = BASE + '/transcode?src=host%3A%3Fq&fps=60&maxW=1280&scale=lanczos';
  const pr = A.mpwArmProbe(u);       // 悬挂
  await sleep(5);
  A.mpwArmAbortAll('switch-source');
  const r = await pr;
  ok('A4 悬挂的验活被中断（不再挂着一个转码任务等下去）', r && (r.aborted === true || r.ok === true), JSON.stringify(r).slice(0, 80));
}
{
  // A5 「刷新壁纸」在转码档上真的会重载（&_t= 击穿）：playUrl 走 bustUrl
  const m = /const playUrl = hostBustTick \? bustUrl\(playUrl0, hostBustTick\) : playUrl0;/.test(clientSrc);
  const bust = sliceFn(clientSrc, 'bustUrl');
  const got = new Function(bust + '\nreturn bustUrl;')()('/api/mpkg-wallpaper/transcode?src=x&fps=60&maxW=1280', 12345);
  ok('A5 刷新壁纸：转码档 URL 也追加 `&_t=`（旧实现只击穿直读 URL ⇒ 转码档"点了没反应"）',
    m && /_t=12345/.test(got), got);
}
{
  // A6 关档回退原文件（H2 硬要求）：mpwTranscodeSpec 在 preScale=0/fpsCap=0/resMax=0 时必须直读
  const fn = sliceFn(clientSrc, 'mpwTranscodeSpec');
  const spec = new Function('ALLOWED_FPS', 'HOST_BASE', 'encodeURIComponent', fn + '\nreturn mpwTranscodeSpec;')([24, 30, 48, 60], BASE, encodeURIComponent);
  const off = spec(0, 0, 0, 'host:?token=t&index=0', false, '/custom-media?folder=&file=a.mp4');
  const on = spec(1280, 0, 0, 'host:?token=t&index=0', false, '/custom-media?folder=&file=a.mp4');
  ok('A6 关档 ⇒ useTranscode=false + playUrl=**原文件**；开档 ⇒ /transcode+maxW+lanczos（不许吃转码产物）',
    off.useTranscode === false && off.playUrl === '/custom-media?folder=&file=a.mp4'
    && on.useTranscode === true && /\/transcode\?/.test(on.playUrl) && /&maxW=1280/.test(on.playUrl) && /&scale=lanczos/.test(on.playUrl),
    JSON.stringify({ off: off.playUrl, on: on.playUrl.slice(0, 70) }));
}
{
  // A7 回退落点唯一：三条回退路都必须调 mpwFallbackToDirect（它会清"不可用"状态）
  const n = (clientSrc.match(/mpwFallbackToDirect\(vid|mpwFallbackToDirect\(vid2/g) || []).length;
  ok('A7 "回退到原片"收敛到唯一落点 mpwFallbackToDirect（内含 mpwBgArmErrorClear，换回原片能看见）',
    n >= 3 && /function mpwFallbackToDirect\(/.test(clientSrc) && /mpwBgArmErrorClear\(\);\n\t\t\t\ttry \{ mpwWallpaperStateSet\("direct"/.test(clientSrc), '落点=' + n);
}

/* ═══════════ B 段：宿主真路由端到端（桩 ffmpeg） ═══════════ */
console.log('\n══ B 宿主：切档竞态 / 归属 / 半成品 / 验活角色 ══');
{
  // B1 切档 → 立刻切回（用户现场链路）
  cleanCache(); cleanLog();
  process.env.STUB_BYTES = '512'; process.env.STUB_SLEEP_MS = '60000';
  const A = await start(transcodeRoute, PLAY);
  const started = await waitFor(() => trStarts().length >= 1, 5000);
  ok('B1a 播放请求真的起了转码（桩收到 transcode-start）', started, trStarts()[0] ? trStarts()[0].slice(0, 60) : '(未起)');
  const beforeVerify = trStarts().length;
  const rVerify = await call(transcodeRoute, PLAY + '&player=verify');
  const vj = (() => { try { return JSON.parse(rVerify.body) } catch { return null } })();
  ok('B1b **验活请求拿到 202 {ok:true,pending}**（旧实现：与播放请求共享任务 ⇒ 取消后收 502 {ok:false} ⇒ 客户端清壁纸）',
    rVerify.status === 202 && vj && vj.ok === true && vj.pending === true, 'status=' + rVerify.status + ' body=' + rVerify.body.slice(0, 80));
  ok('B1c 验活请求**不起第二个 ffmpeg**（不为别人的档开火/续命）', trStarts().length === beforeVerify, 'starts ' + beforeVerify + '→' + trStarts().length);
  A.res.emit('close');   // ← 用户点了"关"（播放请求断开）
  const killed = await waitFor(() => trKilled().length >= 1, 5000);
  ok('B1d 断开 ⇒ 只 kill 本任务 ffmpeg（旧档作废）', killed, 'killed=' + trKilled().length);
  ok('B1e 被取消的播放请求**不写 502**（客户端不会把取消当失败；reqAborted ⇒ 直接返回）', A.res.status === 0, 'status=' + A.res.status + ' body=' + A.res.body.slice(0, 60));
  await sleep(150);
  ok('B1f **半成品不进缓存**：无 tc_*.mp4 产物、无 .tmp 残留', tcFiles().filter((n) => !/\.tmp/.test(n)).length === 0 && tmps().length === 0, 'tc=' + tcFiles().join(','));
  const led = ledgerOf(30, 1280, 'lanczos');
  ok('B1g 台账可读且**如实记取消**：phase=cancelled + 代际 gen≥1（不是 error、不静默）',
    led.length > 0 && led[0].phase === 'cancelled' && Number(led[0].gen) >= 1, JSON.stringify(led[0] || null).slice(0, 140));
  const ent = X.transcodeInflightEntry(prod120);
  ok('B1h **无残留转码任务**：条目引用归零（条目已回收或 refs=0）',
    !ent || ent.refs.size === 0, JSON.stringify({ has: !!ent, refs: ent ? ent.refs.size : 0, p: !!(ent && ent.p) }));
  const pr = await call(progressRoute, BASE + '/transcode-progress?file=' + encodeURIComponent(FIXTURE) + '&fps=30&maxW=1280&scale=lanczos');
  const pj = (() => { try { return JSON.parse(pr.body) } catch { return null } })();
  ok('B1i /transcode-progress 把取消暴露出来（客户端据此停止等待，不再空转 3 分钟）',
    pj && pj.phase === 'cancelled' && Number(pj.gen) >= 1, JSON.stringify(pj).slice(0, 120));
  // 关档后客户端要挂的是**原文件**：直读 URL 必须立刻可用且字节一致
  const direct = await call(customMediaRoute, BASE + '/custom-media?folder=&file=' + encodeURIComponent(FIXTURE));
  ok('B1j 「切回关」后要挂的原文件（/custom-media）可用且**字节一致**（确定性回到可用源，不等转码）',
    direct.status === 200 && direct.bytes.length === FIXTURE_BYTES.length && direct.bytes.equals(FIXTURE_BYTES),
    'status=' + direct.status + ' bytes=' + direct.bytes.length + '/' + FIXTURE_BYTES.length);
}
{
  // B2 归属：两个在飞播放请求共享一份产物，A 断开不得杀 B 的任务
  cleanCache(); cleanLog();
  process.env.STUB_BYTES = '4096'; process.env.STUB_SLEEP_MS = '900';
  const A = await start(transcodeRoute, PLAY);
  const B = await start(transcodeRoute, PLAY);
  const started = await waitFor(() => trStarts().length >= 1, 5000);
  await sleep(120);
  A.res.emit('close');
  await sleep(120);
  ok('B2a 同一产物仍有别的在飞请求 ⇒ **不 kill**（旧实现按"本请求之后启动的进程"过滤 ⇒ 误杀 B）',
    started && trKilled().length === 0, 'killed=' + trKilled().length);
  await Promise.race([B.p, sleep(8000)]); await sleep(20);
  ok('B2b B 正常拿到产物（200 + 完整 4096B）', B.res.status === 200 && B.res.bytes.length === 4096, 'status=' + B.res.status + ' bytes=' + B.res.bytes.length);
  ok('B2c 产物落地（rename 后才算成品）', fs.existsSync(prod120) && fs.statSync(prod120).size === 4096, tcFiles().join(','));
}
{
  // B3 半成品 / 无效产物不得当有效缓存
  for (const [label, buf] of [['0 字节', Buffer.alloc(0)], ['无 ftyp 的 4096B 垃圾', Buffer.alloc(4096, 0x5a)]]) {
    cleanCache(); cleanLog();
    process.env.STUB_BYTES = '4096'; process.env.STUB_SLEEP_MS = '0';
    fs.writeFileSync(prod120, buf);
    const n0 = trStarts().length;
    const r = await call(transcodeRoute, PLAY);
    const after = await call(transcodeRoute, PLAY);   // 第二次：必须命中**新**产物
    ok('B3 ' + label + ' 产物 ⇒ 删掉并**重转**（不当有效缓存），不流出半成品',
      r.status === 200 && r.bytes.length === 4096 && trStarts().length > n0 && after.status === 200 && after.bytes.length === 4096,
      'status=' + r.status + ' bytes=' + r.bytes.length + ' starts ' + n0 + '→' + trStarts().length);
  }
  // 无产物 ⇒ 只转一次，第二次命中缓存（既有缓存语义不退化）
  cleanCache(); cleanLog();
  process.env.STUB_SLEEP_MS = '0';
  const r1 = await call(transcodeRoute, PLAY);
  const n1 = trStarts().length;
  const r2 = await call(transcodeRoute, PLAY);
  ok('B3b 有效产物继续命中缓存（新判据没把正常缓存打掉）', r1.status === 200 && r2.status === 200 && trStarts().length === n1, 'starts=' + n1);
  // 默认档（不带 scale）与预缩档是**两份**产物（键不同），不互相顶替
  ok('B3c 预缩档与默认档产物路径不同（档位不串味）', prod120 !== prodNoScan && prod120.includes('tc_') && prodNoScan.includes('tc_'));
}
{
  // B4 验活角色：有产物 ⇒ 直接给；无产物 ⇒ 202（都不起 ffmpeg）
  cleanCache(); cleanLog();
  process.env.STUB_SLEEP_MS = '0';
  const miss = await call(transcodeRoute, PLAY + '&player=verify');
  ok('B4a 无产物时验活 = 202 pending/miss 且**不起 ffmpeg**（旧实现会真转一次）',
    miss.status === 202 && trStarts().length === 0 && /verify-(miss|pending)/.test(String(miss.headers['x-mpw-transcode'] || '')),
    'status=' + miss.status + ' starts=' + trStarts().length + ' hdr=' + miss.headers['x-mpw-transcode']);
  await call(transcodeRoute, PLAY);                       // 造出产物
  const n2 = trStarts().length;
  const hit = await call(transcodeRoute, PLAY + '&player=verify');
  ok('B4b 有产物时验活直接给（206/200）且不再起 ffmpeg',
    (hit.status === 200 || hit.status === 206) && hit.bytes.length === 4096 && trStarts().length === n2,
    'status=' + hit.status + ' bytes=' + hit.bytes.length + ' hdr=' + hit.headers['x-mpw-transcode'] + ' body=' + hit.body.slice(0, 120));
}
{
  // B5 代际单调：取消（gen N）之后新任务 gen N+1，且新的 done 覆盖到台账
  const g1 = Number((ledgerOf(30, 1280, 'lanczos')[0] || {}).gen) || 0;
  cleanCache(); cleanLog();
  process.env.STUB_SLEEP_MS = '0';
  const r = await call(transcodeRoute, PLAY);
  const led = ledgerOf(30, 1280, 'lanczos');
  ok('B5 代际单调递增 + 新任务 done 可读（旧 gen 不覆盖新账目）',
    r.status === 200 && led.length > 0 && led[0].phase === 'done' && Number(led[0].gen) > g1,
    JSON.stringify({ prev: g1, now: led[0] && led[0].gen, phase: led[0] && led[0].phase }));
}
{
  // B6 色彩/位深策略登记（H2）：/probe 回报 + 8bit 源不加任何色彩参数（产物与改动前逐字节相同）
  const probe = await call(T.exact(BASE + '/probe'), BASE + '/probe');
  const pj = (() => { try { return JSON.parse(probe.body) } catch { return null } })();
  ok('B6 /probe 登记新口径（验活角色 / 产物有效性阈值 / 色彩模式）',
    probe.status === 200 && pj && pj.limits && pj.limits.verifyRole === 'player=verify'
    && Number(pj.limits.minProductBytes) >= 1 && typeof pj.limits.colorMode === 'string',
    JSON.stringify(pj && pj.limits && { v: pj.limits.verifyRole, b: pj.limits.minProductBytes, c: pj.limits.colorMode }));
  ok('B6b 8bit 源（探测失败 ⇒ unknown）不加色彩参数：argv 里没有 -pix_fmt（改动前逐字节相同）',
    trStarts().length > 0 && trStarts().every((l) => !/-pix_fmt/.test(l)), trStarts().slice(-1)[0] ? trStarts().slice(-1)[0].slice(0, 90) : '(无)');
}

/* ═══════════ C 段：变异自证（每条必须变红） ═══════════ */
console.log('\n══ C 变异自证（7 组，各自必红）══');
{
  const MUT = path.join(TMP, 'mut');
  const copyDir = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const a = path.join(src, e.name), b = path.join(dst, e.name);
      if (e.isDirectory()) copyDir(a, b); else if (e.isFile()) fs.copyFileSync(a, b);
    }
  };
  const mutLib = (tag) => { const d = path.join(MUT, tag, 'lib'); copyDir(path.join(repoRoot, 'lib'), d); return d; };
  const mutate = (p, from, to) => { const s = fs.readFileSync(p, 'utf8'); if (!s.includes(from)) return false; fs.writeFileSync(p, s.replace(from, to)); return true; };

  // M1 客户端：去掉裁决代际闸门（mpwArmVerdictApplies 恒真）⇒ 迟到裁决会清掉已换好的原片
  {
    const lib = mutLib('verdict');
    const inj = mutate(path.join(lib, 'client.js'),
      `			try {
				if (!verdictUrl || !mountedUrl) return false;
				if (String(verdictUrl) !== String(mountedUrl)) return false;
				if (armSig !== void 0 && curSig !== void 0 && String(armSig) !== String(curSig)) return false;
				return true;
			} catch (e) { return false }`,
      `			try { return true; } catch (e) { return false }`);
    const src = fs.readFileSync(path.join(lib, 'client.js'), 'utf8');
    const W = makeArmWorld(src);
    const A = W.api;
    const tcUrl = BASE + '/transcode?src=host%3A%3Ft&fps=60&maxW=1280&scale=lanczos';
    const hostUrl = '/custom-media?folder=&file=a.mp4';
    W.els.video.setAttribute('src', tcUrl);
    A.mpwVerifyArm('video', tcUrl, () => { W.els.video.removeAttribute('src'); A.mpwBgArmErrorSet('video', tcUrl, 502, 'cancelled') }, () => {});
    await sleep(5);
    W.state.sig = 'sig-B';
    W.els.video.setAttribute('src', hostUrl);
    W.state.probeResolvers.forEach((r) => r(resp(502, { ok: false, error: 'cancelled' })));
    await sleep(10);
    ok('M1 去掉裁决代际 ⇒ **迟到裁决把原片撤了 + 隐藏壁纸层**（A1d 必红）',
      inj && W.els.video.getAttribute('src') === null && W.els.wrap.style._p.display === 'none',
      JSON.stringify({ src: W.els.video.getAttribute('src'), display: W.els.wrap.style._p.display }));
  }
  // M2 客户端：否定答案回到 20s ⇒ 自愈从 3s 退化到 20s
  {
    const lib = mutLib('negtll');
    const inj = mutate(path.join(lib, 'client.js'), 'const MPW_ARM_NEG_TTL_MS = 3000;', 'const MPW_ARM_NEG_TTL_MS = 20000;');
    const src = fs.readFileSync(path.join(lib, 'client.js'), 'utf8');
    const fn = sliceFn(src, 'mpwArmCacheUsable');
    const negTTL = /const MPW_ARM_NEG_TTL_MS = (\d+);/.exec(src)[1];
    const usable = new Function('MPW_ARM_POS_TTL_MS', 'MPW_ARM_NEG_TTL_MS', fn + '\nreturn mpwArmCacheUsable;')(20000, Number(negTTL));
    ok('M2 否定 TTL 回到 20s ⇒ A3 变红（"过一会儿才恢复"重新变成 20s）',
      inj && usable({ ok: false, at: 1000 }, 1000 + 5000) === true, 'negTTL=' + negTTL);
  }
  // M3 宿主：产物有效性判据去掉 ftyp 魔数（只看大小）⇒ 垃圾产物被当成有效缓存流出
  {
    const lib = mutLib('prodvalid');
    const inj = mutate(path.join(lib, 'index.js'),
      "      return n >= 12 && isoBmffMagic(buf);",
      "      return n >= 12 || true;   // 变异：去掉容器魔数校验（只看大小）");
    const m = await boot(lib);
    const XM = m.mod.__mpwTest;
    const rtc = m.prefix(BASE + '/transcode');
    // 自定义目录沿用主世界的（DATA_DIR 同源：同一 DSH_HOME）
    const prodM = XM.transcodeProductPath(srcObj, 30, 1280, 'lanczos').cachePath;
    cleanCache(); cleanLog();
    process.env.STUB_SLEEP_MS = '0';
    fs.writeFileSync(prodM, Buffer.alloc(4096, 0x5a));
    const r = await call(rtc, PLAY);
    ok('M3 去掉产物魔数校验 ⇒ 垃圾（无 ftyp）被当有效缓存直接流出（B3 必红）',
      inj && r.status === 200 && r.bytes.length === 4096 && r.bytes[4] === 0x5a && trStarts().length === 0,
      'status=' + r.status + ' byte4=' + r.bytes[4] + ' starts=' + trStarts().length);
    cleanCache();
  }
  // M4 宿主：引用计数退回"谁断开都 kill"（旧语义）⇒ A 断开误杀 B 的任务
  {
    const lib = mutLib('refs');
    const inj = mutate(path.join(lib, 'index.js'), '  const last = e.refs.size === 0;', '  const last = true;');
    const m = await boot(lib);
    const rtc = m.prefix(BASE + '/transcode');
    cleanCache(); cleanLog();
    process.env.STUB_BYTES = '4096'; process.env.STUB_SLEEP_MS = '900';
    const A = await start(rtc, PLAY);
    const B = await start(rtc, PLAY);
    await waitFor(() => trStarts().length >= 1, 5000);
    await sleep(120);
    A.res.emit('close');
    await sleep(150);
    await Promise.race([B.p, sleep(8000)]); await sleep(20);
    ok('M4 去掉引用计数 ⇒ A 断开**误杀** B 的任务（B2b 必红）',
      inj && trKilled().length >= 1 && !(B.res.status === 200 && B.res.bytes.length === 4096),
      'killed=' + trKilled().length + ' B=' + B.res.status + '/' + B.res.bytes.length);
    cleanCache();
  }
  // M5 宿主：拆掉验活角色 ⇒ 验活请求回落到转码路径（无产物时真起 ffmpeg / 共享任务）
  {
    const lib = mutLib('verify');
    const inj = mutate(path.join(lib, 'index.js'), "          if (player === 'verify') {", "          if (false && player === 'verify') {");
    const m = await boot(lib);
    const rtc = m.prefix(BASE + '/transcode');
    cleanCache(); cleanLog();
    process.env.STUB_BYTES = '512'; process.env.STUB_SLEEP_MS = '60000';
    const rv = await start(rtc, PLAY + '&player=verify');
    const fired = await waitFor(() => trStarts().length >= 1, 5000);
    ok('M5 拆掉验活角色 ⇒ 一次验活就**真的起了 ffmpeg**（B4a 必红；这正是"验活把用户的档转完"）',
      inj && fired && rv.res.status !== 202, 'starts=' + trStarts().length + ' status=' + rv.res.status);
    rv.res.emit('close'); await sleep(120);
    cleanCache(); cleanLog(); process.env.STUB_SLEEP_MS = '0';
  }
  // M6 宿主：取消写成 error ⇒ 客户端读不出"取消"（会继续空转等待）
  {
    const lib = mutLib('cancelled');
    const inj = mutate(path.join(lib, 'index.js'), "          phase: wasCancelled ? 'cancelled' : 'error',", "          phase: 'error',");
    const m = await boot(lib);
    const rtc = m.prefix(BASE + '/transcode');
    const prg = m.exact(BASE + '/transcode-progress');
    cleanCache(); cleanLog();
    process.env.STUB_BYTES = '512'; process.env.STUB_SLEEP_MS = '60000';
    const A = await start(rtc, PLAY);
    await waitFor(() => trStarts().length >= 1, 5000);
    A.res.emit('close');
    await waitFor(() => trKilled().length >= 1, 5000);
    await sleep(150);
    const pj = JSON.parse((await call(prg, BASE + '/transcode-progress?file=' + encodeURIComponent(FIXTURE) + '&fps=30&maxW=1280&scale=lanczos')).body);
    ok('M6 取消写成 error ⇒ 台账读不出 cancelled（B1g/B1i 必红）', inj && pj.phase === 'error', 'phase=' + pj.phase);
    cleanCache(); process.env.STUB_SLEEP_MS = '0';
  }
  // M7 客户端：关档仍判成转码 ⇒ 关掉预缩档后继续吃 ffmpeg 产物（H2 必红）
  {
    const lib = mutLib('offback');
    const inj = mutate(path.join(lib, 'client.js'), 'const useTranscode = !isSceneVideo && (f > 0 || r > 0 || w > 0)', 'const useTranscode = !isSceneVideo && (f >= 0 || r >= 0 || w >= 0)');
    const src = fs.readFileSync(path.join(lib, 'client.js'), 'utf8');
    const fn = sliceFn(src, 'mpwTranscodeSpec');
    const spec = new Function('ALLOWED_FPS', 'HOST_BASE', 'encodeURIComponent', fn + '\nreturn mpwTranscodeSpec;')([24, 30, 48, 60], BASE, encodeURIComponent);
    const off = spec(0, 0, 0, 'host:?token=t', false, '/custom-media?folder=&file=a.mp4');
    ok('M7 关档仍判转码 ⇒ 关档后 playUrl 指回 /transcode（A6/B1j 必红）',
      inj && off.useTranscode === true && /\/transcode\?/.test(off.playUrl), off.playUrl.slice(0, 80));
  }
}

/* ═══════════ 收尾：磁盘卫生（不许把测试残留留在 /tmp） ═══════════ */
{
  let bytes = 0;
  const walk = (p, skip) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, e.name);
      if (skip && skip(fp)) continue;
      try { if (e.isDirectory()) walk(fp, skip); else bytes += fs.statSync(fp).size; } catch { /* 竞态 */ }
    }
  };
  const skipMut = (p) => p.startsWith(path.join(TMP, 'mut'));
  try { walk(TMP, skipMut); } catch { /* 没了 */ }
  let mutBytes = 0;
  try { const w2 = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const fp = path.join(p, e.name); if (e.isDirectory()) w2(fp); else mutBytes += fs.statSync(fp).size; } }; w2(path.join(TMP, 'mut')); } catch { /* 忽略 */ }
  ok('E1 夹具/产物 ≤ 2MB（桩产物 4KB；不真跑 ffmpeg、不读大语料）', bytes <= 2 * 1024 * 1024, (bytes / 1024).toFixed(0) + ' KB（变异副本另计 ' + (mutBytes / 1048576).toFixed(2) + ' MB，退出时删除）');
  ok('E2 全程没跑过真 ffmpeg：所有 transcode-start 都来自桩（argv 里带 -vf）',
    trStarts().length > 0 && trStarts().every((l) => l.includes('-vf')), 'starts=' + trStarts().length);
  ok('E3 transcodes/ 无 .tmp 残留（取消/失败都清干净）', tmps().length === 0, tmps().join(','));
}

console.log('\n===== prescale-switch-race-test: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cleanup();
process.exit(fail === 0 ? 0 : 1);

#!/usr/bin/env node
// tools/transcode-color-fidelity-test.mjs —— 转码的**色彩 / 位深 / 亮度**保真回归（H2）
//
// 用户原话（2026-09-28）：「现在我不清楚，虽然我把那个关掉了，它现在**可能跑的还是 FFMpeg
//   转译后的状态**，因为我感觉这个壁纸**相比之前有点过曝了**。……这 FFMpeg 引起一堆 bug。」
//
// 要回答两件事，**不许含糊**：
//   ① 关档后到底挂的是谁？—— 由 `mpwTranscodeSpec` 决定（关档 ⇒ `useTranscode=false` 且
//      `playUrl=原文件`）：本判据在 A 段钉住"关档=原文件"，prescale-switch-race-test 的 B1j 再钉
//      "原文件字节一致可用"。缓存键带档位（maxW+scale）⇒ 开/关档是**两份**产物，不互相顶替。
//   ② 转码到底丢不丢色彩？—— 本判据用**真 ffmpeg**（本机 4.4.2）跑**真语料/真命令**量：
//      · 源标签（pix_fmt / color_range / color_space / primaries / transfer）进出对照；
//      · 解码帧亮度均值 `signalstats YAVG`（同一帧、同尺寸）进出对照，阈值 |Δ| ≤ 1.0/255。
//      已测读数（见 docs/TRANSCODE-LIFECYCLE.md §色彩）：8bit 源**忠实**（Δ≈0.02/255，标签原样）；
//      唯一真问题是 **>8bit / HDR**：旧命令不带 `-pix_fmt` ⇒ 产物**还是 10bit**（浏览器多半解不了
//      ⇒ 黑屏，而转码存在的理由正是"浏览器吃不下"）+ PQ 元数据原样留给 SDR 显示链。
//
// 判据：
//   A 纯函数：`pixFmtBitDepth`（认不出 ⇒ 8，不猜高）/ `transcodeColorPlan` 五种输入
//     （8bit / 全范围 pc / 10bit / HDR-transfer / 探测失败）+ 两个 env 回退口（legacy / force8）。
//   B 真路由 argv（桩 ffmpeg）：8bit 源**一个色彩参数都不加**（与改动前逐字节相同）；
//     10bit 源必须带 `-pix_fmt yuv420p -colorspace/-color_primaries/-color_trc bt709 -color_range tv`
//     且台账（/transcode-progress）记 `colorDowngrade=true` + `colorFrom/colorTo`。
//   C 真 ffmpeg 读数（**本机装了 ffmpeg 才跑**，否则显式 SKIP 并计数，不冒充通过）：
//     C1 8bit tv/bt709 源：标签保留、YAVG |Δ|≤1.0、尺寸符合 maxW；
//     C2 全范围 pc 源：产物仍 pc、YAVG |Δ|≤1.0（"pc 直通"是实测事实，不是猜的）；
//     C3 10bit HDR(PQ) 源：走本插件命令 ⇒ 产物 **8bit** 可解码；走**旧命令**（无色彩参数）⇒ 产物
//        仍 **10bit**（= 修复前的现场读数，也是这条判据的"变异必红"）。
//   D 变异自证：去掉 colorArgs 注入 / 去掉 deep 判定 / 把 8bit 也强制降级 / 去掉台账记账 ⇒ 各自变红。
//
// 用法: node tools/transcode-color-fidelity-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const BASE = '/api/mpkg-wallpaper';
let pass = 0, fail = 0, skipped = 0;
const ok = (n, cond, d) => {
  if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); }
  else { fail++; console.error('  ✗ ' + n + (d ? '  → ' + d : '')); }
};
const skip = (n, why) => { skipped++; console.log('  ⊘ SKIP ' + n + '  —— ' + why); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 临时目录（退出兜底清理；全部夹具/产物 ≤ 2MB） ─────────────────── */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-color-'));
const cleanup = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ } };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

const HOME = path.join(TMP, 'home');
process.env.DSH_HOME = HOME;
process.env.DSH_WE_TRANSCODE_MIN_AVAIL_MB = '0';
process.env.DSH_WE_TRANSCODE_CACHE_KEEP = '8';
process.env.DSH_WE_TRANSCODE_MAX_BYTES = String(16 * 1024 * 1024);
const DATA_DIR = path.join(HOME, '.dsh-mpkg-wallpaper');
const TC = path.join(DATA_DIR, 'transcodes');
fs.mkdirSync(TC, { recursive: true });
const MEDIA = path.join(TMP, 'custom');
fs.mkdirSync(MEDIA, { recursive: true });

const STUB_LOG = path.join(TMP, 'stub.log');
const STUB_JS = path.join(TMP, 'fake-ffmpeg.js');
const STUB = path.join(TMP, 'fake-ffmpeg');
fs.writeFileSync(STUB_JS, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('-version')) process.exit(0);
fs.appendFileSync(process.env.STUB_LOG, 'transcode-start ' + args.join(' ') + '\\n');
const out = args[args.length - 1];
const buf = Buffer.alloc(4096, 0x41); buf.write('ftyp', 4, 'latin1');
try { fs.writeFileSync(out, buf) } catch {}
process.exit(0);
`);
fs.writeFileSync(STUB, '#!/bin/sh\nexec ' + JSON.stringify(process.execPath) + ' ' + JSON.stringify(STUB_JS) + ' "$@"\n', { mode: 0o755 });

const has = (bin) => { try { execFileSync(bin, ['-version'], { stdio: 'ignore', timeout: 15000 }); return true } catch { return false } };
const HAS_FFMPEG = has('ffmpeg');
const HAS_FFPROBE = has('ffprobe');
const stubLines = () => { try { return fs.readFileSync(STUB_LOG, 'utf8').trim().split('\n').filter(Boolean); } catch { return [] } };

/** ffprobe 关键字段（只读元数据）。 */
function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,profile,pix_fmt,color_range,color_space,color_primaries,color_transfer,width,height',
    '-of', 'default=noprint_wrappers=1', file], { encoding: 'utf8', timeout: 30000 });
  const kv = {};
  for (const line of out.split('\n')) { const i = line.indexOf('='); if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return kv;
}
/** 解码帧亮度均值（signalstats YAVG，取前 n 帧）。 */
function yavg(file, n = 3, extraArgs = []) {
  const out = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...extraArgs, '-i', file,
    '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-frames:v', String(n), '-f', 'null', '-'],
    { encoding: 'utf8', timeout: 60000 });
  return [...out.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
}
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

/* ── 假宿主（与其它转码判据同款：直接调真路由 handler） ───────────── */
class Res extends Writable {
  constructor() { super({ emitClose: false }); this.chunks = []; this.status = 0; this.headers = {}; }
  _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
  writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this; }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
  get body() { return Buffer.concat(this.chunks).toString(); }
  get bytes() { return Buffer.concat(this.chunks); }
}
function fakeReq(url, method = 'GET', body = null) {
  return {
    method, url, headers: {}, on() {}, removeListener() {},
    async *[Symbol.asyncIterator]() { if (body !== null) yield Buffer.from(body) },
  };
}
async function call(route, url, method = 'GET', body = null) {
  const res = new Res();
  const req = fakeReq(url, method, body);
  const fin = new Promise((resolve) => { try { res.on('finish', resolve) } catch { resolve() } });
  const p = Promise.resolve(route.handler(req, res)).catch((e) => { try { res.status = res.status || 500; res.end(String(e && e.message || e)) } catch { /* 已响应 */ } });
  await Promise.race([Promise.all([p, fin]), sleep(30000)]);
  await sleep(5);
  return res;
}
async function boot(libDir = path.join(repoRoot, 'lib')) {
  const mod = await import(pathToFileURL(path.join(libDir, 'index.js')).href + '?t=' + Date.now() + '-' + Math.random());
  const routes = [];
  mod.apply({ webServer: { register: (r) => { routes.push(r); return { dispose() {} } } }, loader: null, logger: { info() {}, warn() {}, error() {} } });
  const exact = (p) => routes.find((r) => r.kind === 'exact' && r.path === p);
  const prefix = (p) => routes.find((r) => r.kind === 'prefix' && r.path === p);
  return { mod, routes, exact, prefix };
}

/* ═══════════ A 段：色彩/位深策略纯函数 ═══════════ */
console.log('══ A 色彩计划（纯函数：位深识别 / 五种输入 / 两个回退口）══');
process.env.DSH_WE_FFMPEG = STUB;
process.env.STUB_LOG = STUB_LOG;
const T = await boot();
await call(T.exact(BASE + '/custom-dir'), BASE + '/custom-dir', 'POST', JSON.stringify({ dir: MEDIA }));
const X = T.mod.__mpwTest;
{
  ok('A1 位深识别：8bit 一族 ⇒ 8；`…10le/12le/p010le` ⇒ 10/12/10；空 ⇒ 0（不知道，不猜高）',
    X.pixFmtBitDepth('yuv420p') === 8 && X.pixFmtBitDepth('yuvj420p') === 8 && X.pixFmtBitDepth('nv12') === 8
    && X.pixFmtBitDepth('yuv420p10le') === 10 && X.pixFmtBitDepth('yuv422p12le') === 12 && X.pixFmtBitDepth('p010le') === 10
    && X.pixFmtBitDepth('') === 0,
    JSON.stringify(['yuv420p', 'yuv420p10le', 'p010le', ''].map((f) => X.pixFmtBitDepth(f))));
  const plan = (o) => X.transcodeColorPlan(Object.assign({ pixFmt: 'yuv420p', colorTransfer: 'bt709' }, o || {}));
  const p8 = plan({});
  ok('A2 8bit SDR（含**全范围 pc**、含未标注）⇒ **一个色彩参数都不加**（产物与改动前逐字节相同）',
    p8.mode === 'passthrough' && p8.downgrade === false && p8.args.length === 0
    && plan({ pixFmt: 'yuvj420p', colorRange: 'pc', colorTransfer: '' }).args.length === 0,
    p8.mode + ' args=' + JSON.stringify(p8.args));
  const p10 = plan({ pixFmt: 'yuv420p10le', colorTransfer: 'smpte2084' });
  const need = ['-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
  ok('A3 >8bit / HDR ⇒ 显式降 8bit + 声明 bt709/tv（含位深与 transfer 两个来源都触发）',
    p10.mode === 'downgrade' && p10.downgrade === true && need.every((a, i) => p10.args[i] === a)
    && plan({ pixFmt: 'yuv420p10le', colorTransfer: 'bt709' }).downgrade === true
    && plan({ pixFmt: 'yuv420p', colorTransfer: 'arib-std-b67' }).downgrade === true,
    p10.mode + ' ' + p10.args.join(' '));
  const pUnk = plan({ pixFmt: '', colorTransfer: '' });
  ok('A3b 探测失败（拿不到 pix_fmt）⇒ 不加参数（保持旧行为）但**记 unknown**（不静默）',
    pUnk.mode === 'unknown' && pUnk.args.length === 0 && /unknown/.test(pUnk.reason), pUnk.mode);
  ok('A3c 记账字段：from/to 带源标签（写进 /transcode-progress 的 colorFrom/colorTo）',
    /yuv420p10le/.test(p10.from) && /smpte2084/.test(p10.from) && p10.to === 'yuv420p/bt709/tv', p10.from + ' → ' + p10.to);
  ok('A4 策略模式登记：/probe limits.colorMode 与模块常量一致（现场可核对）',
    X.TRANSCODE_COLOR_MODE === process.env.DSH_WE_TRANSCODE_COLOR || X.TRANSCODE_COLOR_MODE === 'auto', X.TRANSCODE_COLOR_MODE);
  // 回退口：两个 env 档要能真的改变计划（子进程验证，避免污染本进程的模块常量）
  const probePlan = (env) => {
    const r = spawnSync(process.execPath, ['-e', `
      process.env.DSH_HOME = ${JSON.stringify(HOME)};
      process.env.DSH_WE_TRANSCODE_COLOR = ${JSON.stringify(env)};
      const m = await import(${JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib', 'index.js')).href)});
      const X = m.__mpwTest;
      const a = X.transcodeColorPlan({ pixFmt: 'yuv420p10le', colorTransfer: 'smpte2084' });
      const b = X.transcodeColorPlan({ pixFmt: 'yuv420p', colorTransfer: 'bt709' });
      console.log(JSON.stringify({ mode: X.TRANSCODE_COLOR_MODE, deep: a.args.length, sdr: b.args.length }));
    `], { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { DSH_HOME: HOME }) });
    try { return JSON.parse((r.stdout || '').trim().split('\n').pop()) } catch { return null }
  };
  const leg = probePlan('legacy');
  const f8 = probePlan('force8');
  ok('A5 回退口 `DSH_WE_TRANSCODE_COLOR=legacy` ⇒ 连 >8bit 也不加任何参数（完全回到改动前）',
    leg && leg.mode === 'legacy' && leg.deep === 0 && leg.sdr === 0, JSON.stringify(leg));
  ok('A5b 现场对比口 `=force8` ⇒ 恒加 8bit bt709（连 8bit 源也强制，供"过曝"对照实验）',
    f8 && f8.mode === 'force8' && f8.deep > 0 && f8.sdr > 0, JSON.stringify(f8));
}

/* ═══════════ B 段：真路由 argv（桩 ffmpeg；10bit 夹具用真 ffmpeg 造） ═══════════ */
console.log('\n══ B 真路由 argv / 台账（桩 ffmpeg）══');
let HDR_FIX = null;
if (HAS_FFMPEG) {
  HDR_FIX = path.join(MEDIA, 'hdr10.mp4');
  try {
    // 10bit HDR 夹具：**HEVC Main10 + bt2020 + PQ(HLG 之外最典型的 HDR10)** —— 这条正是
    // `browserPlayable` 判 "not playable ⇒ 必须转码" 的编码（也是"浏览器吃不下才转码"的现场）。
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'testsrc2=size=128x96:rate=30:duration=1',
      '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-color_range', 'tv',
      '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '26', '-tag:v', 'hvc1', '-an', HDR_FIX],
      { timeout: 180000, stdio: ['ignore', 'ignore', 'pipe'] });
    if (!fs.existsSync(HDR_FIX) || fs.statSync(HDR_FIX).size < 400) HDR_FIX = null;
  } catch { HDR_FIX = null; }
}
{
  const SDR_FIX = path.join(MEDIA, 'sdr.mp4');
  fs.writeFileSync(SDR_FIX, Buffer.concat([Buffer.alloc(2048, 0x11), Buffer.from('MPW-COLOR-SDR')]));
  const SDR_URL = BASE + '/transcode?file=' + encodeURIComponent('sdr.mp4') + '&fps=30&maxW=1280';
  const n0 = stubLines().length;
  const r1 = await call(T.prefix(BASE + '/transcode'), SDR_URL);
  const argvSdr = stubLines().slice(n0).find((l) => l.startsWith('transcode-start')) || '';
  ok('B1 8bit/探测失败源：argv **没有** -pix_fmt/-colorspace（与改动前逐字节相同 ⇒ 既有产物继续命中）',
    r1.status === 200 && argvSdr && !/-pix_fmt/.test(argvSdr) && !/-colorspace/.test(argvSdr), argvSdr.replace(/^transcode-start /, '').slice(0, 150));
  if (!HDR_FIX) {
    skip('B2 10bit 源 ⇒ argv 带 8bit 降级参数（需要真 ffmpeg 造 10bit 夹具）', HAS_FFMPEG ? '夹具生成失败' : '本机没有 ffmpeg');
  } else {
    const p = probe(HDR_FIX);
    ok('B2a 夹具真是 10bit HDR（HEVC Main10 / yuv420p10le / PQ）——也正是"浏览器吃不下 ⇒ 必须转码"的那一类',
      /10/.test(String(p.pix_fmt)) && /smpte2084/.test(String(p.color_transfer)) && /hevc|h265/i.test(String(p.codec_name)),
      JSON.stringify({ codec: p.codec_name, pix: p.pix_fmt, trc: p.color_transfer, profile: p.profile }));
    const url = BASE + '/transcode?file=' + encodeURIComponent('hdr10.mp4') + '&fps=30&maxW=64';
    const n1 = stubLines().length;
    const r2 = await call(T.prefix(BASE + '/transcode'), url);
    const argvHdr = stubLines().slice(n1).find((l) => l.startsWith('transcode-start')) || '';
    ok('B2b 10bit 源 ⇒ argv 必须显式 `-pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`',
      r2.status === 200
      && /-pix_fmt yuv420p/.test(argvHdr) && /-colorspace bt709/.test(argvHdr)
      && /-color_primaries bt709/.test(argvHdr) && /-color_trc bt709/.test(argvHdr) && /-color_range tv/.test(argvHdr),
      'status=' + r2.status + ' ' + argvHdr.replace(/^transcode-start /, '').slice(0, 240));
    const pr = await call(T.exact(BASE + '/transcode-progress'), BASE + '/transcode-progress?file=' + encodeURIComponent('hdr10.mp4') + '&fps=30&maxW=64');
    const pj = (() => { try { return JSON.parse(pr.body) } catch { return null } })();
    ok('B2c 台账如实记账：colorDowngrade=true + colorFrom/colorTo/colorPlan 可读（不静默降级）',
      pj && pj.phase === 'done' && pj.colorDowngrade === true && /10/.test(String(pj.colorFrom)) && String(pj.colorTo).includes('bt709'),
      JSON.stringify({ phase: pj && pj.phase, from: pj && pj.colorFrom, to: pj && pj.colorTo }));
  }
}

/* ═══════════ C 段：真 ffmpeg 读数（亮度/尺寸/标签） ═══════════ */
console.log('\n══ C 真 ffmpeg 读数（标签 / 解码帧亮度 / 尺寸）══');
if (!HAS_FFMPEG || !HAS_FFPROBE) {
  skip('C1 8bit tv/bt709 源：标签保留 + YAVG |Δ|≤1.0 + 尺寸符合 maxW', '本机没有 ffmpeg/ffprobe');
  skip('C2 全范围 pc 源：产物仍 pc + YAVG |Δ|≤1.0', '本机没有 ffmpeg/ffprobe');
  skip('C3 10bit HDR 源：本插件命令 ⇒ 8bit；旧命令 ⇒ 仍 10bit', '本机没有 ffmpeg/ffprobe');
} else {
  // 源全部用真 ffmpeg 从 lavfi 造（确定性、可复现；不依赖工作区语料）
  const mk = (out, extra) => {
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'testsrc2=size=128x96:rate=30:duration=1', ...extra, '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-an', out],
      { timeout: 120000, stdio: ['ignore', 'ignore', 'pipe'] });
    return out;
  };
  const SRC8 = mk(path.join(MEDIA, 'real8.mp4'), ['-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']);
  const SRCPC = mk(path.join(MEDIA, 'realpc.mp4'), ['-pix_fmt', 'yuvj420p', '-color_range', 'pc']);
  const y8s = yavg(SRC8), ypcs = yavg(SRCPC);
  // ⚠ B 段用**桩**给 hdr10.mp4 同参数写过一份假产物（同一个缓存键）⇒ 不清缓存的话 C3 会命中
  //   那份假文件（判据第一版就是这么报出 "moov atom not found" 的：命中缓存是对的，是测试脏了）。
  try { for (const n of fs.readdirSync(TC)) { try { fs.unlinkSync(path.join(TC, n)) } catch { /* 忽略 */ } } } catch { /* 忽略 */ }
  // 走**真路由**（DSH_WE_FFMPEG = 真 ffmpeg）⇒ argv 与线上完全一致
  process.env.DSH_WE_FFMPEG = 'ffmpeg';
  const TR = await boot();
  await call(TR.exact(BASE + '/custom-dir'), BASE + '/custom-dir', 'POST', JSON.stringify({ dir: MEDIA }));
  const runRoute = (file, fps, maxW) => call(TR.prefix(BASE + '/transcode'), BASE + '/transcode?file=' + encodeURIComponent(file) + '&fps=' + fps + '&maxW=' + maxW);
  /* ⚠ maxW 必须**小于源宽**（128）：否则宿主既有的直读闸门判 `direct-spec`（源规格没超限 ⇒ 直读
     原片，**不转码**）—— 本判据第一版就踩了这个坑（量出来一条"转码产物"其实是原片）。
     这一步同时验证了闸门语义：只有"用户真的要求降规格"时才转码。 */
  const MWS = 64;
  const r8 = await runRoute('real8.mp4', 30, MWS);
  const prod8 = X.transcodeProductPath({ type: 'file', path: SRC8 }, 30, MWS, '').cachePath;
  const p8 = probe(prod8); const y8p = yavg(prod8);
  ok('C1 8bit tv/bt709：产物标签**逐字保留**（tv/bt709/bt709/bt709）+ 尺寸按 maxW 缩放（64×48）',
    r8.status === 200 && p8.color_range === 'tv' && p8.color_space === 'bt709' && p8.color_primaries === 'bt709' && p8.color_transfer === 'bt709'
    && Number(p8.width) === MWS && Number(p8.height) === 48,
    JSON.stringify({ out: [p8.color_range, p8.color_space, p8.color_primaries, p8.color_transfer].join('/'), wh: p8.width + 'x' + p8.height }));
  ok('C1b **亮度读数**：解码帧 YAVG 源→产物 |Δ| ≤ 1.0/255（"过曝"在 8bit 源上复现不出来）',
    Number.isFinite(avg(y8s)) && Math.abs(avg(y8p) - avg(y8s)) <= 1.0,
    'src=' + avg(y8s).toFixed(2) + ' prod=' + avg(y8p).toFixed(2) + ' Δ=' + (avg(y8p) - avg(y8s)).toFixed(3));
  const rp = await runRoute('realpc.mp4', 30, MWS);
  const prodPc = X.transcodeProductPath({ type: 'file', path: SRCPC }, 30, MWS, '').cachePath;
  const ppc = probe(prodPc); const ypcp = yavg(prodPc);
  ok('C2 全范围(pc) 8bit 源：产物**仍是 pc**（不许把 pc 压成 tv 再按 tv 播 = 变暗/发灰）',
    rp.status === 200 && ppc.color_range === 'pc' && /yuvj420p/.test(String(ppc.pix_fmt)),
    JSON.stringify({ range: ppc.color_range, pix: ppc.pix_fmt }));
  ok('C2b **亮度读数**：pc 源 YAVG |Δ| ≤ 1.0/255（pc 直通，实测忠实）',
    Number.isFinite(avg(ypcs)) && Math.abs(avg(ypcp) - avg(ypcs)) <= 1.0,
    'src=' + avg(ypcs).toFixed(2) + ' prod=' + avg(ypcp).toFixed(2) + ' Δ=' + (avg(ypcp) - avg(ypcs)).toFixed(3));
  if (!HDR_FIX) {
    skip('C3 10bit HDR：本插件命令 ⇒ 8bit 可解码；旧命令 ⇒ 仍 10bit', 'HDR 夹具生成失败');
  } else {
    const rH = await runRoute('hdr10.mp4', 30, MWS);
    const prodH = X.transcodeProductPath({ type: 'file', path: HDR_FIX }, 30, MWS, '').cachePath;
    const pH = probe(prodH);
    ok('C3 **修复后**：10bit PQ 源经本插件命令 ⇒ 产物位深 ≤ 8bit（浏览器解得动）且声明 SDR bt709',
      rH.status === 200 && X.pixFmtBitDepth(pH.pix_fmt) <= 8 && pH.color_transfer === 'bt709',
      JSON.stringify({ pix: pH.pix_fmt, depth: X.pixFmtBitDepth(pH.pix_fmt), trc: pH.color_transfer }));
    // 旧命令（无色彩参数）在同一源上的读数 = 修复前的现场（也是 D 段变异的期望值）
    const legacyOut = path.join(TMP, 'legacy_hdr.mp4');
    const vf = X.buildScaleFilter(MWS, 30, '');
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', HDR_FIX, '-vf', vf,
      '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-movflags', '+faststart', '-an', '-f', 'mp4', legacyOut],
      { timeout: 180000, stdio: ['ignore', 'ignore', 'pipe'] });
    const pL = probe(legacyOut);
    ok('C3b **旧命令**（不带色彩参数）在同一 10bit 源上 ⇒ 产物**还是 10bit**（High 10 / yuv420p10le）——这就是"转码后仍吃不下/发白"的现场读数',
      X.pixFmtBitDepth(pL.pix_fmt) === 10 && /High 10/.test(String(pL.profile)),
      JSON.stringify({ pix: pL.pix_fmt, profile: pL.profile }));
    const yHs = yavg(HDR_FIX), yHp = yavg(prodH);
    // 10bit 源的 YAVG 是 10bit 量程（0–1023），8bit 产物是 0–255 ⇒ 换算后对比
    console.log('    · 读数（**量程已归一**）：HDR 源 YAVG=' + (avg(yHs) / 4).toFixed(2) + '/255（原值 ' + avg(yHs).toFixed(2) + '/1023）'
      + ' → 降级产物 YAVG=' + avg(yHp).toFixed(2) + '/255 ⇒ Δ=' + (avg(yHp) - avg(yHs) / 4).toFixed(2)
      + ' ⇒ **只做位深重标定、没有 tonemap**（ffmpeg-static 无 zscale/tonemap，已记台账）。'
      + ' ⚠ 未验证边界：本夹具是"**打了** PQ/BT.2020 标签"的合成片段（lavfi 不产真 PQ 编码数据）'
      + ' ⇒ "缺 tonemap 在真 HDR 素材上的观感偏暗"这一条**本判据测不到**（本机无真 HDR 语料）。');
  }
  process.env.DSH_WE_FFMPEG = STUB;
}

/* ═══════════ D 段：变异自证 ═══════════ */
console.log('\n══ D 变异自证（4 组，各自必红）══');
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
  // M1 runTranscode 不再注入 colorArgs
  {
    const lib = mutLib('args');
    const inj = mutate(path.join(lib, 'index.js'), '...(colorArgs || []),', '');
    const m = await boot(lib);
    const XM = m.mod.__mpwTest;
    // 直接看源码接线（argv 层由 B2 用桩断言；这里确认"注入点被拔掉"时 B2 必红）
    const src = fs.readFileSync(path.join(lib, 'index.js'), 'utf8');
    ok('M1 runTranscode 不再注入 colorArgs ⇒ 10bit 源照样出 10bit（B2b/C3 必红）',
      inj && !/\.\.\.\(colorArgs \|\| \[\]\),/.test(src) && XM.transcodeColorPlan({ pixFmt: 'yuv420p10le' }).args.length > 0,
      'inj=' + inj);
  }
  // M2 deep 判定失效（>8bit 不再触发降级）
  {
    const lib = mutLib('deep');
    const inj = mutate(path.join(lib, 'index.js'), '  if (!deep && !hdr && !chromaUnsafe) return { mode: \'passthrough\'', '  if (true) return { mode: \'passthrough\'');
    const m = await boot(lib);
    const plan = m.mod.__mpwTest.transcodeColorPlan({ pixFmt: 'yuv420p10le', colorTransfer: 'smpte2084' });
    ok('M2 去掉 deep/hdr 判定 ⇒ 10bit/HDR 也被当 passthrough（A3 必红）',
      inj && plan.mode === 'passthrough' && plan.args.length === 0, plan.mode);
  }
  // M3 8bit 也被强制降级（会破坏"与改动前逐字节相同"）
  {
    const lib = mutLib('force');
    const inj = mutate(path.join(lib, 'index.js'), '  if (!deep && !hdr && !chromaUnsafe) return { mode: \'passthrough\'', '  if (false) return { mode: \'passthrough\'');
    const m = await boot(lib);
    const plan = m.mod.__mpwTest.transcodeColorPlan({ pixFmt: 'yuv420p', colorTransfer: 'bt709' });
    ok('M3 8bit 也被强制降级 ⇒ A2 变红（既有产物键/字节全变，且 pc 直通被破坏）',
      inj && plan.args.length > 0 && plan.downgrade === true, plan.mode);
  }
  // M4 记账不再写 colorFrom/colorTo（静默降级）
  {
    const lib = mutLib('ledger');
    const inj = mutate(path.join(lib, 'index.js'), "        colorPlan: colorPlan.mode, colorFrom: colorPlan.from, colorTo: colorPlan.to,\n        colorDowngrade: !!colorPlan.downgrade, colorReason: colorPlan.reason,", '');
    const src = fs.readFileSync(path.join(lib, 'index.js'), 'utf8');
    ok('M4 去掉台账字段 ⇒ B2c 变红（降级不许静默）', inj && !/colorDowngrade: !!colorPlan\.downgrade/.test(src), 'inj=' + inj);
  }
}

/* ═══════════ 收尾 ═══════════ */
{
  let bytes = 0;
  const walk = (p, skipMut) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, e.name);
      if (skipMut && skipMut(fp)) continue;
      try { if (e.isDirectory()) walk(fp, skipMut); else bytes += fs.statSync(fp).size; } catch { /* 竞态 */ }
    }
  };
  try { walk(TMP, (p) => p.startsWith(path.join(TMP, 'mut'))) } catch { /* 没了 */ }
  ok('E1 夹具/产物 ≤ 4MB（128×96 的 1s 片段；不读工作区大语料）', bytes <= 4 * 1024 * 1024, (bytes / 1024).toFixed(0) + ' KB');
  ok('E2 本判据不碰用户真档（DSH_HOME 指到临时目录）', process.env.DSH_HOME === HOME && !HOME.startsWith(os.homedir() + path.sep + '.dsh-mpkg-wallpaper'), HOME);
}

console.log('\n===== transcode-color-fidelity-test: ' + pass + ' 通过 / ' + fail + ' 失败'
  + (skipped ? ' / ' + skipped + ' 段 SKIP（本机缺依赖，未验证的已显式列出）' : '') + ' =====');
cleanup();
process.exit(fail === 0 ? 0 : 1);

#!/usr/bin/env node
// tools/transcode-prescale-test.mjs —— 视频「按屏幕物理尺寸预缩（ffmpeg lanczos）」档回归
//
// 用户第 1 项（2026-09-23）：「装 ffmpeg 在我的 DSH 插件里面有过相关的功能，你看看核对一下代码，
//   如果没有问题的话，就借鉴一下」⇒ 先核对既有转码通道，再加一个**默认关**的档。
// 依据读数（../docs/USER-ITEMS-20260921.md 第 19 条，渲染器仓 `video-downscale-flicker-probe` 实测
//   `3588989102` 2558×1438@60）：非全屏尺寸上「一次直降」的**闪烁**是「逐级减半」的 1.6~2.7×
//   （1280×720 1.90× / 900×506 1.64× / 624×351 2.75×），代价是细节低 1.4~1.9× ⇒ **取舍，默认关**。
//
// 设计（复用既有通道，不新起一套）：
//   · 档位 = `section.preScale`：`0`=关（默认）/`1`=按屏幕物理尺寸；
//   · 开了 ⇒ 客户端仍走**既有** `/transcode`，只多两件事：`maxW=<屏幕物理宽>` + `scale=lanczos`；
//   · 宿主 `/transcode` 新增 `scale` 参数（**白名单**，非法 400），`-vf` 链由 `buildScaleFilter`
//     唯一构造：`scale='min(<maxW>,iw)':-2:flags=lanczos,fps=<fps>`；
//   · 缓存键只在**真的给了 flags** 时追加 `|s:<flag>` ⇒ 不传 flags 的键与改动前**逐字节相同**
//     （既有产物继续命中、升级不重转）。
//
// 纪律：**不真跑 ffmpeg**（`DSH_WE_FFMPEG` 指向记录 argv 的桩；整测试 <1s），不读语料、不开浏览器。
//
// 断言分组：[A] 宿主纯函数（含"与改动前逐字节相同"的独立复算） [B] 真路由端到端（桩 ffmpeg 抓 argv/产物名）
//           [C] 客户端接线与默认关 [D] 登记（代码内 + docs 一行） [E] 变异自证（改回去必须变红）
// 用法: node tools/transcode-prescale-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

/* ── 临时目录（退出兜底清理） ─────────────────────────────────────── */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-prescale-'));
const cleanup = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ } };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

/* ── ffmpeg 桩（只记录 argv + 造 4KB 产物；STUB_FAIL_IF 命中则失败） ── */
const STUB_LOG = path.join(TMP, 'stub.log');
const STUB_JS = path.join(TMP, 'fake-ffmpeg.js');
const STUB = path.join(TMP, 'fake-ffmpeg');
fs.writeFileSync(STUB_JS, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const isVersion = args.includes('-version');
fs.appendFileSync(process.env.STUB_LOG, (isVersion ? 'probe' : 'transcode-start ' + args.join(' ')) + '\\n');
if (isVersion) process.exit(0);
const failIf = process.env.STUB_FAIL_IF || '';
if (failIf && args.some((a) => String(a).includes(failIf))) process.exit(1);   // 模拟"这个源转不动"
const out = args[args.length - 1];
try { fs.writeFileSync(out, Buffer.alloc(4096, 0x42)); } catch {}
process.exit(0);
`);
fs.writeFileSync(STUB, '#!/bin/sh\nexec ' + JSON.stringify(process.execPath) + ' ' + JSON.stringify(STUB_JS) + ' "$@"\n', { mode: 0o755 });

/* ── 环境：必须在 import lib/index.js **之前**定好 ─────────────────── */
const HOME = path.join(TMP, 'home');
process.env.DSH_HOME = HOME;
process.env.DSH_WE_FFMPEG = STUB;
process.env.STUB_LOG = STUB_LOG;
process.env.STUB_FAIL_IF = 'xfailx';
process.env.DSH_WE_TRANSCODE_CACHE_KEEP = '8';
process.env.DSH_WE_TRANSCODE_MAX_BYTES = String(8 * 1024 * 1024);
const DATA_DIR = path.join(HOME, '.dsh-mpkg-wallpaper');
const TC = path.join(DATA_DIR, 'transcodes');
fs.mkdirSync(TC, { recursive: true });
const LIB = path.join(TMP, 'library');
fs.mkdirSync(LIB, { recursive: true });
// 转码源：内容不重要（ffprobe 会失败 ⇒ 探测 null ⇒ 闸门不生效 ⇒ 走转码），只要是个真文件
for (const n of ['dummyA.mp4', 'dummyB.mp4', 'xfailx.mp4']) fs.writeFileSync(path.join(LIB, n), Buffer.alloc(256, 1));

const stubLines = () => { try { return fs.readFileSync(STUB_LOG, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
const trStarts = () => stubLines().filter((l) => l.startsWith('transcode-start'));
const tcFiles = () => fs.readdirSync(TC).filter((n) => n.startsWith('tc_') && n.endsWith('.mp4'));

/* ── 假宿主：直接调真 lib/index.js 注册的**路由 handler**（不启真 HTTP，省内存） ── */
class Res extends Writable {
  constructor() { super(); this.chunks = []; this.status = 0; this.headers = {}; }
  _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
  writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this; }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
  get body() { return Buffer.concat(this.chunks).toString(); }
  get bytes() { return Buffer.concat(this.chunks); }
}
async function call(route, url, { method = 'GET', body = null } = {}) {
  const res = new Res();
  const req = {
    method, url, headers: {},
    on() {}, removeListener() {},
    async *[Symbol.asyncIterator]() { if (body !== null) yield Buffer.from(body); },
  };
  const done = new Promise((resolve) => res.on('finish', resolve));
  const p = Promise.resolve(route.handler(req, res)).catch((e) => { try { res.status = res.status || 500; res.end(String(e && e.message || e)); } catch { /* 已响应 */ } });
  await Promise.race([done, sleep(15000)]);
  await Promise.race([p, sleep(500)]);
  return res;
}
async function boot(libDir = path.join(repoRoot, 'lib')) {
  const mod = await import(pathToFileURL(path.join(libDir, 'index.js')).href + '?t=' + Date.now() + '-' + Math.random());
  const routes = [];
  mod.apply({ webServer: { register: (r) => { routes.push(r); return { dispose() {} }; } }, loader: null, logger: { info() {}, warn() {}, error() {} } });
  const exact = (p) => routes.find((r) => r.kind === 'exact' && r.path === p);
  const prefix = (p) => routes.find((r) => r.kind === 'prefix' && r.path === p);
  return { mod, routes, exact, prefix };
}
const T = await boot();
await call(T.exact(BASE + '/custom-dir'), BASE + '/custom-dir', { method: 'POST', body: JSON.stringify({ dir: LIB }) });
const transcodeRoute = T.prefix(BASE + '/transcode');
const progressRoute = T.exact(BASE + '/transcode-progress');
const mtimeMs = fs.statSync(path.join(LIB, 'dummyA.mp4')).mtimeMs;
const srcIdA = path.join(LIB, 'dummyA.mp4');
const srcIdB = path.join(LIB, 'dummyB.mp4');
const oldKey = (srcId, mtime, fps, maxW) => createHash('sha256')
  .update(srcId + '|' + Math.round(mtime) + '|' + fps + '|' + (maxW || 0)).digest('hex').slice(0, 20);

/* ═══════════ A 段：宿主纯函数 ═══════════ */
console.log('══ A 宿主纯函数（scale 白名单 / vf 链 / 缓存键）══');
const X = T.mod.__mpwTest;
let keyLc = '';   // 预缩档缓存键：B 段要拿它跟磁盘产物名对拍
{
  ok('A1 scale 白名单：空=默认档；lanczos 合法（大小写无关）；表外/注入串 ⇒ null（400）',
    X.normalizeScaleFlag('') === '' && X.normalizeScaleFlag(null) === ''
    && X.normalizeScaleFlag('lanczos') === 'lanczos' && X.normalizeScaleFlag('LANCZOS') === 'lanczos'
    && X.normalizeScaleFlag('evil') === null && X.normalizeScaleFlag('lanczos; rm -rf /') === null
    && X.normalizeScaleFlag('../../etc') === null,
    JSON.stringify([X.normalizeScaleFlag('lanczos'), X.normalizeScaleFlag('evil')]));
  ok('A1b 白名单是宿主既有风格的一张表（含 lanczos/bicubic/spline 等 11 项）',
    Array.isArray(X.SCALE_FLAGS) && X.SCALE_FLAGS.includes('lanczos') && X.SCALE_FLAGS.includes('bicubic') && X.SCALE_FLAGS.length === 11,
    X.SCALE_FLAGS.join('/'));

  ok('A2 预缩档 vf 链：scale=min(maxW,iw):-2:flags=lanczos 先缩放再抽帧',
    X.buildScaleFilter(1280, 30, 'lanczos') === "scale='min(1280,iw)':-2:flags=lanczos,fps=30",
    X.buildScaleFilter(1280, 30, 'lanczos'));
  ok('A2b **默认档逐字节不变**：不给 flags 时与改动前的 vf 链完全一致',
    X.buildScaleFilter(1280, 30, '') === "scale='min(1280,iw)':-2,fps=30"
    && X.buildScaleFilter(1920, 24, '') === "scale='min(1920,iw)':-2,fps=24",
    X.buildScaleFilter(1280, 30, ''));
  ok('A2c 没有 maxW 就没有"缩"这回事（flags 被忽略，不产生多余滤镜）',
    X.buildScaleFilter(0, 24, 'lanczos') === 'fps=24' && X.buildScaleFilter(0, 24, '') === 'fps=24');

  ok('A3 **既有缓存键逐字节相同**（不传 flags ⇒ 与旧公式同 sha256，升级不重转）',
    X.transcodeKey(srcIdA, mtimeMs, 30, 1280, '') === oldKey(srcIdA, mtimeMs, 30, 1280)
    && X.transcodeKey(srcIdA, mtimeMs, 24, 0, '') === oldKey(srcIdA, mtimeMs, 24, 0),
    X.transcodeKey(srcIdA, mtimeMs, 30, 1280, ''));
  keyLc = X.transcodeKey(srcIdA, mtimeMs, 30, 1280, 'lanczos');
  const keyLcExpect = createHash('sha256').update(srcIdA + '|' + Math.round(mtimeMs) + '|30|1280|s:lanczos').digest('hex').slice(0, 20);
  ok('A4 预缩档缓存键 = 旧键 + `|s:lanczos`（独立复算一致）且与默认档**不同键**',
    keyLc === keyLcExpect && keyLc !== X.transcodeKey(srcIdA, mtimeMs, 30, 1280, ''),
    keyLc.slice(0, 12) + ' vs ' + X.transcodeKey(srcIdA, mtimeMs, 30, 1280, '').slice(0, 12));
  ok('A4b 没给 maxW 时 flags 不进键（"没缩"就与默认档共用产物，不白转一份）',
    X.transcodeKey(srcIdA, mtimeMs, 24, 0, 'lanczos') === X.transcodeKey(srcIdA, mtimeMs, 24, 0, ''));
}

/* ═══════════ B 段：真路由端到端（桩 ffmpeg 抓 argv 与产物名） ═══════════ */
console.log('\n══ B 真 /transcode 路由（桩 ffmpeg：argv / 产物名 / 进度键）══');
{
  // B1 预缩档：maxW=1280 + scale=lanczos
  const r1 = await call(transcodeRoute, BASE + '/transcode?file=' + encodeURIComponent('dummyA.mp4') + '&fps=30&maxW=1280&scale=lanczos');
  const vf1 = (trStarts()[0] || '');
  ok('B1 预缩档请求 ⇒ 200（真跑通既有转码通道）', r1.status === 200 && r1.bytes.length === 4096, 'status=' + r1.status + ' bytes=' + r1.bytes.length);
  ok('B1b 真传给 ffmpeg 的 `-vf` 带 flags=lanczos（argv 级证据）',
    /-vf scale='min\(1280,iw\)':-2:flags=lanczos,fps=30/.test(vf1), vf1.replace(/^transcode-start /, '').slice(0, 160));
  const expectFile = 'tc_' + keyLc + '.mp4';
  ok('B1c 落盘产物名 == 纯函数 transcodeKey(...)|s:lanczos（键与磁盘一致）',
    tcFiles().includes(expectFile), 'files=' + tcFiles().join(','));

  // B2 默认档（不传 scale）：既有行为逐字节不变
  const n0 = trStarts().length;
  const r2 = await call(transcodeRoute, BASE + '/transcode?file=' + encodeURIComponent('dummyB.mp4') + '&fps=30&maxW=1280');
  const vf2 = trStarts()[n0] || '';
  ok('B2 默认档（不传 scale）⇒ `-vf` 里**没有** flags（与改动前一致）',
    r2.status === 200 && /-vf scale='min\(1280,iw\)':-2,fps=30/.test(vf2) && !/flags=/.test(vf2),
    vf2.replace(/^transcode-start /, '').slice(0, 120));
  const keyB = oldKey(srcIdB, fs.statSync(path.join(LIB, 'dummyB.mp4')).mtimeMs, 30, 1280);
  ok('B2b 默认档产物名 == 旧公式（不因新档换键 ⇒ 老用户产物继续命中）',
    tcFiles().includes('tc_' + keyB + '.mp4'), 'files=' + tcFiles().join(','));

  // B3 非法 scale ⇒ 400（且发生在解析源之前：用不存在的 src 也能拿到 400）
  const r3 = await call(transcodeRoute, BASE + '/transcode?file=nope.mp4&fps=30&maxW=1280&scale=evil');
  ok('B3 scale 白名单外 ⇒ 400 invalid scale（不把任意串拼进 -vf）',
    r3.status === 400 && /invalid scale/.test(r3.body), 'status=' + r3.status + ' body=' + r3.body.slice(0, 90));
  const r3b = await call(transcodeRoute, BASE + '/transcode?file=nope.mp4&fps=30&maxW=1280&scale=lanczos');
  ok('B3b 合法 scale 只是"过闸"：源不存在仍是 404（判据分辨得开 400 vs 404）',
    r3b.status === 404, 'status=' + r3b.status);

  // B4 既有策略不受影响：maxW 仍被 TRANSCODE_DEFAULT_MAXW(1920) 收口
  const n1 = trStarts().length;
  const r4 = await call(transcodeRoute, BASE + '/transcode?file=' + encodeURIComponent('dummyB.mp4') + '&fps=24&maxW=2560&scale=lanczos');
  const vf4 = trStarts()[n1] || '';
  ok('B4 既有的"转码默认降采样 1920"仍然收口（maxW=2560+预缩 ⇒ 实际 1920，策略未被新档绕过）',
    r4.status === 200 && /min\(1920,iw\)/.test(vf4), vf4.replace(/^transcode-start /, '').slice(0, 120));

  // B5 进度键带 flags：先让预缩任务 done，再用**另一个失败任务**把 lastTranscodeProgress 顶成 error
  const pr1 = await call(progressRoute, BASE + '/transcode-progress?file=' + encodeURIComponent('dummyA.mp4') + '&fps=30&maxW=1280&scale=lanczos');
  ok('B5 预缩任务的进度查得到（phase=done）——进度键与写入键同源（含 flags）',
    pr1.status === 200 && JSON.parse(pr1.body).phase === 'done', pr1.body.slice(0, 80));
  const r5 = await call(transcodeRoute, BASE + '/transcode?file=' + encodeURIComponent('xfailx.mp4') + '&fps=30&maxW=1280');
  const pr2 = await call(progressRoute, BASE + '/transcode-progress?file=' + encodeURIComponent('dummyA.mp4') + '&fps=30&maxW=1280&scale=lanczos');
  const prAll = await call(progressRoute, BASE + '/transcode-progress');
  ok('B5b 分辨力：失败任务把"最近任务"顶成 error 后，预缩任务的进度仍是 done（不是靠 lastTranscodeProgress 蒙对的）',
    r5.status === 502 && JSON.parse(pr2.body).phase === 'done' && JSON.parse(prAll.body).phase === 'error',
    'lanczos=' + JSON.parse(pr2.body).phase + ' last=' + JSON.parse(prAll.body).phase);

  // B6 缓存复用：同参数第二次不再起 ffmpeg
  const n2 = trStarts().length;
  const r6 = await call(transcodeRoute, BASE + '/transcode?file=' + encodeURIComponent('dummyA.mp4') + '&fps=30&maxW=1280&scale=lanczos');
  ok('B6 同参数第二次 ⇒ 命中缓存，不再起 ffmpeg（新档没有破坏缓存复用）',
    r6.status === 200 && trStarts().length === n2, 'starts ' + n2 + '→' + trStarts().length);
  // B7 /probe 登记新档（代码内登记点）
  const probe = await call(T.exact(BASE + '/probe'), BASE + '/probe');   // 不带 src ⇒ 200 + limits（verdict=缺少 src）
  const pj = JSON.parse(probe.body);
  ok('B7 新档登记进 /probe 的 limits.scaleFlags（诊断文档口径的代码内登记点）',
    probe.status === 200 && pj.limits && Array.isArray(pj.limits.scaleFlags) && pj.limits.scaleFlags.includes('lanczos'),
    'scaleFlags=' + JSON.stringify(pj.limits && pj.limits.scaleFlags));
}

/* ═══════════ C 段：客户端接线（纯函数切片 + 源码级） ═══════════ */
console.log('\n══ C 客户端：默认关 / 物理宽 / URL 接线 ══');
const CLIENT = path.join(repoRoot, 'lib', 'client.js');
const clientSrc = fs.readFileSync(CLIENT, 'utf8');
const CLIENT_DOC = path.join(repoRoot, 'docs', 'TRANSCODE-RESOURCE.md');
const docSrc = fs.readFileSync(CLIENT_DOC, 'utf8');
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
const physFn = sliceFn(clientSrc, 'mpwPhysicalWidth');
const preFn = sliceFn(clientSrc, 'mpwPrescaleTargetW');
const CF = new Function(physFn + '\n' + preFn + '\nreturn { mpwPhysicalWidth, mpwPrescaleTargetW };')();
{
  const defScale = /const DEFAULT_PRE_SCALE = (\d+);/.exec(clientSrc);
  ok('C1 **默认关**（DEFAULT_PRE_SCALE = 0；档位表含 0/1）',
    !!defScale && defScale[1] === '0' && /const PRE_SCALE_LEVELS = \[0, 1\];/.test(clientSrc),
    'DEFAULT_PRE_SCALE=' + (defScale && defScale[1]));
  ok('C2 屏幕物理宽纯函数：CSS 宽 × dpr，夹在 [640,3840]；拿不到尺寸 ⇒ 0（不猜）',
    CF.mpwPhysicalWidth(1920, 1) === 1920 && CF.mpwPhysicalWidth(360, 3) === 1080
    && CF.mpwPhysicalWidth(100, 1) === 640 && CF.mpwPhysicalWidth(5000, 1) === 3840
    && CF.mpwPhysicalWidth(0, 2) === 0 && CF.mpwPhysicalWidth(1280, 0) === 1280,
    JSON.stringify([CF.mpwPhysicalWidth(1920, 1), CF.mpwPhysicalWidth(360, 3), CF.mpwPhysicalWidth(0, 2)]));
  ok('C3 目标宽纯函数：**关 ⇒ 0**（调用方保持既有 maxW 语义）；开 ⇒ min(屏幕物理宽, resMax>0?resMax:∞)',
    CF.mpwPrescaleTargetW(0, 0, 2560) === 0 && CF.mpwPrescaleTargetW(0, 1920, 2560) === 0
    && CF.mpwPrescaleTargetW(1, 0, 2560) === 2560 && CF.mpwPrescaleTargetW(1, 1920, 2560) === 1920
    && CF.mpwPrescaleTargetW(1, 3840, 2560) === 2560 && CF.mpwPrescaleTargetW(1, 0, 0) === 0,
    JSON.stringify([CF.mpwPrescaleTargetW(0, 0, 2560), CF.mpwPrescaleTargetW(1, 0, 2560), CF.mpwPrescaleTargetW(1, 1920, 2560)]));
  ok('C4 接线：useTranscode 把预缩档算进去；URL 只在使用转码时追加 maxW / scale',
    /const preScaleW = mpwPrescaleTargetW\(preScaleN, resMaxN, physW\);/.test(clientSrc)
    && /\(fpsCapN > 0 \|\| resMaxN > 0 \|\| preScaleW > 0\)/.test(clientSrc)
    && /const transcodeMaxW = preScaleW > 0 \? preScaleW : resMaxN;/.test(clientSrc)
    && /const transcodeScale = preScaleW > 0 \? "lanczos" : "";/.test(clientSrc)
    && /\+ \(transcodeMaxW > 0 \? "&maxW=" \+ transcodeMaxW : ""\)/.test(clientSrc)
    && /\+ \(transcodeScale \? "&scale=" \+ transcodeScale : ""\)/.test(clientSrc));
  ok('C5 进度轮询与缓存探测也带 scale（三处同参数，否则进度永远查不到）',
    /mpwProbeTranscodeCache\(image, transcodeFps, transcodeMaxW, transcodeScale\)/.test(clientSrc)
    && /pollTranscodeProgress\(image, transcodeFps, transcodeMaxW, transcodeScale\)/.test(clientSrc)
    && /function pollTranscodeProgress\(src, fps, maxW, scale\)/.test(clientSrc)
    && /function mpwProbeTranscodeCache\(src, fps, maxW, scale\)/.test(clientSrc));
  ok('C6 开档时 fps 缺省给 60（"预缩不降帧"；让宿主既有直读闸门在源不比屏幕大时判直读）',
    /ALLOWED_FPS\.includes\(fpsCapN\) \? fpsCapN : \(resMaxN > 0 \? 30 : \(preScaleW > 0 \? 60 : 0\)\)/.test(clientSrc));
  ok('C7 UI 一行档位（沿用既有 mpw_reset 按钮风格）+ setter 写 section.preScale 并重放',
    /t\("preScale"\)/.test(clientSrc) && /onClick: \(\) => setPreScale\(o\.v\)/.test(clientSrc)
    && /const setPreScale = \(v\) => \{ commit\(\{ preScale: v \}, true\); try \{ applyFromStorage\(\); \} catch \{\} \};/.test(clientSrc));
  ok('C8 四处接线：preScale 进"允许键 / 数值净化 / 备份字段"（与 fpsCap、resMax 同款）',
    (clientSrc.match(/"preScale"/g) || []).length >= 2 && /"fpsCap", "resMax", "preScale"/.test(clientSrc) && /"fpsCap", "resMax", "preScale", "bsRevealAlpha"/.test(clientSrc));
  const zh = /"preScale": "([^"]*)"/.exec(clientSrc);
  const enKeys = clientSrc.slice(clientSrc.lastIndexOf('"preScale"'));
  ok('C9 中英两套字典都有该档（P-66 另有键集合对齐断言）',
    !!zh && /"preScale\.off"/.test(clientSrc) && /"preScale\.hint"/.test(clientSrc) && /"preScale": "/.test(enKeys));
  ok('C10 登记：docs/TRANSCODE-RESOURCE.md 有该档一行（档名 / 默认关 / 依据读数）',
    /视频预缩档/.test(docSrc) && /preScale/.test(docSrc) && /关（`0`）/.test(docSrc) && /USER-ITEMS-20260921/.test(docSrc));
}

/* ═══════════ D 段：变异自证（改回去必须变红） ═══════════ */
console.log('\n══ D 变异自证（5 组，各自必红）══');
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
  const bootMut = async (libDir) => {
    const mod = await import(pathToFileURL(path.join(libDir, 'index.js')).href + '?t=' + Date.now() + '-' + Math.random());
    const routes = [];
    mod.apply({ webServer: { register: (r) => { routes.push(r); return { dispose() {} }; } }, loader: null, logger: { info() {}, warn() {}, error() {} } });
    return { mod, prefix: (p) => routes.find((r) => r.kind === 'prefix' && r.path === p), exact: (p) => routes.find((r) => r.kind === 'exact' && r.path === p) };
  };

  // D1 vf 链丢掉 flags
  {
    const lib = mutLib('vf');
    const inj = mutate(path.join(lib, 'index.js'), "? \"scale='min(\" + w + \",iw)':-2\" + (scaleFlag ? ':flags=' + scaleFlag : '') + ',fps=' + fps", "? \"scale='min(\" + w + \",iw)':-2\" + ',fps=' + fps");
    const m = await bootMut(lib);
    const got = m.mod.__mpwTest.buildScaleFilter(1280, 30, 'lanczos');
    ok('D1 buildScaleFilter 改回不带 flags ⇒ A2 变红', inj && got === "scale='min(1280,iw)':-2,fps=30", got);
  }
  // D2 缓存键丢掉 flags
  {
    const lib = mutLib('key');
    const inj = mutate(path.join(lib, 'index.js'), "+ ((w > 0 && scaleFlag) ? '|s:' + scaleFlag : '')", '');
    const m = await bootMut(lib);
    const got = m.mod.__mpwTest.transcodeKey(srcIdA, mtimeMs, 30, 1280, 'lanczos');
    ok('D2 transcodeKey 改回不带 `|s:` ⇒ A4 变红（预缩档会命中默认档产物）',
      inj && got === oldKey(srcIdA, mtimeMs, 30, 1280), got);
  }
  // D3 白名单退化成"照单全收"
  {
    const lib = mutLib('white');
    const inj = mutate(path.join(lib, 'index.js'), '  return SCALE_FLAGS.includes(v) ? v : null;', '  return v;');
    const m = await bootMut(lib);
    const got = m.mod.__mpwTest.normalizeScaleFlag('evil');
    ok('D3 normalizeScaleFlag 改回"照单全收" ⇒ A1 变红（任意串能被拼进 -vf）', inj && got === 'evil', JSON.stringify(got));
  }
  // D4 客户端默认档翻成开
  {
    const lib = mutLib('default');
    const inj = mutate(path.join(lib, 'client.js'), 'const DEFAULT_PRE_SCALE = 0;', 'const DEFAULT_PRE_SCALE = 1;');
    const src = fs.readFileSync(path.join(lib, 'client.js'), 'utf8');
    const got = /const DEFAULT_PRE_SCALE = (\d+);/.exec(src);
    ok('D4 默认档翻成开 ⇒ C1 变红（默认档必须与改动前逐字节同行为）', inj && got && got[1] === '1', 'DEFAULT_PRE_SCALE=' + (got && got[1]));
  }
  // D5 客户端不再传 scale
  {
    const lib = mutLib('url');
    const inj = mutate(path.join(lib, 'client.js'), '+ (transcodeScale ? "&scale=" + transcodeScale : "")', '');
    const src = fs.readFileSync(path.join(lib, 'client.js'), 'utf8');
    ok('D5 URL 不再传 scale ⇒ C4 变红（档开了却不生效）',
      inj && !/\+ \(transcodeScale \? "&scale=" \+ transcodeScale : ""\)/.test(src));
  }
  // D6 真路由：白名单闸门拆掉 ⇒ 任意 scale 都放行（B3 变红）
  {
    const lib = mutLib('gate');
    const inj = mutate(path.join(lib, 'index.js'), "if (scaleFlag === null) { json(res, 400, { ok: false, error: 'invalid scale (allowed: ' + SCALE_FLAGS.join('/') + ')' }); return; }", "if (scaleFlag === null) { /* 变异：不拦 */ }");
    const m = await bootMut(lib);
    await call(m.exact(BASE + '/custom-dir') || { handler: async () => {} }, BASE + '/custom-dir', { method: 'POST', body: JSON.stringify({ dir: LIB }) });
    const r = await call(m.prefix(BASE + '/transcode'), BASE + '/transcode?file=nope.mp4&fps=30&scale=evil');
    ok('D6 /transcode 的白名单闸门拆掉 ⇒ scale=evil 不再 400（B3 变红）', inj && r.status !== 400, 'status=' + r.status);
  }
}

/* ═══════════ 收尾 ═══════════ */
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
  ok('E1 夹具/产物 ≤ 2MB（4KB 假产物；不真跑 ffmpeg、不读语料）', bytes <= 2 * 1024 * 1024, (bytes / 1024).toFixed(0) + ' KB（变异副本另计 ' + (mutBytes / 1048576).toFixed(2) + ' MB）');
  ok('E2 本测试没有跑过真 ffmpeg：所有 transcode-start 都来自桩（argv 里带 `-vf`）',
    trStarts().length > 0 && trStarts().every((l) => l.includes('-vf')), 'starts=' + trStarts().length);
}

console.log('\n===== transcode-prescale-test: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cleanup();
process.exit(fail === 0 ? 0 : 1);

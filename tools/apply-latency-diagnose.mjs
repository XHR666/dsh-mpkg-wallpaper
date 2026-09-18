// tools/apply-latency-diagnose.mjs —— 「点击使用 → 画面出现」的**分段计时（只读诊断）**
//
// 背景：音频探测（2–6ms）与 scene 视频探测（2–4ms）都已压到毫秒级。若用户仍觉得"应用壁纸慢"，
// 瓶颈必在别处。本工具用**真实的 lib/index.js 路由**（apply() + 桩 req/res）对真包做分段计时，
// 不修改任何源码，也不断言（诊断工具，不进 check.sh 门禁）。
//
// 两条真实链路（与 lib/client.js 一一对应）：
//   A 主路径（渲染器 iframe，client.js `applySceneViaRenderer`，行 ~7205）：
//       /scene-thumb-token（签发 30min 场景 token）→ 渲染器自己 `?pkgurl=` 拉 **/raw 整包字节**
//       → 渲染器解析/解码/首帧（**渲染器侧，本工具量不到**，只给出插件侧字节与耗时）
//   B 回退路径（无渲染器/看门狗超时后，client.js `applySceneWallpaper` → fallback 链）：
//       /custom-scene-video-check（已毫秒）→ /custom-mpkg（时段视频）→ /custom-scene-composite（清单）
//       → /custom-scene-layer × N（**每层一次**）→ /custom-scene-frame（兜底静态帧）/ /custom-scene-thumb
//
// 用法：
//   node tools/apply-latency-diagnose.mjs --id 3554161528        # 单包（进程全新 ⇒ 第一次=冷）
//   node tools/apply-latency-diagnose.mjs --all [--root <dir>]   # 全部真包（每个包 fork 一个子进程）
//   node tools/apply-latency-diagnose.mjs --id <id> --layers 8   # 每包最多逐层测 8 层
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');

// ①(2026-09-19 敏感信息加固) 工作区根 = **仓库的上一级**（语料/WE 资产/姊妹仓都在它下面）：
// 由**脚本自身位置**推导，兜底默认不再写作者本机绝对路径。优先级不变：参数 > env > 这里。
const WS = path.resolve(ROOT, '..');
const argv = process.argv.slice(2);
const argOf = (k, dv) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : dv; };
const ROOT_DIR = argOf('--root', process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd'));
const MAX_LAYERS = Math.max(1, Number(argOf('--layers', 4)) || 4);

function listIds() {
  try { return fs.readdirSync(ROOT_DIR).filter((d) => fs.existsSync(path.join(ROOT_DIR, d, 'scene.pkg'))).sort(); }
  catch { return []; }
}
const ids = listIds();
if (!ids.length) { console.error('找不到语料（--root / MPW_SCENE_ROOT / allwallpaper/dd）'); process.exit(1); }

if (argv.includes('--all') && !argv.includes('--child')) {
  console.log('对 ' + ids.length + ' 个真包分段计时（每包一个全新进程 ⇒ 第一次调用=冷）\n');
  for (const id of ids) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', '--id', id, '--root', ROOT_DIR, '--layers', String(MAX_LAYERS)], { encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
    if (r.status !== 0) process.stderr.write(r.stderr || '');
  }
  process.exit(0);
}

const id = argOf('--id', ids[0]);
const sceneSrc = path.join(ROOT_DIR, id);
if (!fs.existsSync(path.join(sceneSrc, 'scene.pkg'))) { console.error('没有 scene.pkg: ' + sceneSrc); process.exit(1); }

/* ── 临时宿主环境：customDir 里放**符号链接**（不复制 22MB–320MB 的包） ── */
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-lat-'));
const customDir = path.join(tmpHome, 'custom');
fs.mkdirSync(path.join(tmpHome, '.dsh-mpkg-wallpaper'), { recursive: true });
fs.mkdirSync(customDir, { recursive: true });
try { fs.symlinkSync(sceneSrc, path.join(customDir, id), 'dir'); }
catch { fs.cpSync(sceneSrc, path.join(customDir, id), { recursive: true }); }
fs.writeFileSync(path.join(tmpHome, '.dsh-mpkg-wallpaper', 'custom-dir.json'), JSON.stringify({ dir: customDir }));
process.env.DSH_HOME = tmpHome;   // 必须在 import index.js 之前

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
async function call(target, url, headers) {
  const bare = target.split('?')[0];
  const r = routes.find((x) => x.kind === 'exact' && x.path === bare);
  if (!r) return { status: 0, bytes: 0, ms: 0, json: null, missing: true };
  const res = new Res();
  const done = new Promise((resolve) => res.on('finish', resolve));
  const t = process.hrtime.bigint();
  await r.handler({ method: 'GET', url: url || target, headers: headers || {} }, res);
  await Promise.race([done, new Promise((r2) => setTimeout(r2, 120000))]);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  let j = null;
  try { j = JSON.parse(res.body.toString('utf8')); } catch { /* 二进制 */ }
  return { status: res.status, bytes: res.body.length, ms, json: j };
}
const B = '/api/mpkg-wallpaper';
const pkgMB = +(fs.statSync(path.join(sceneSrc, 'scene.pkg')).size / 1048576).toFixed(1);
console.log('=== ' + id + '（scene.pkg ' + pkgMB + 'MB）—— 分段计时，第一次=冷、第二次=热 ===');
console.log('步骤                                                      冷ms      热ms       字节      备注');

const rows = [];
const step = async (label, target, url, note, headers) => {
  const cold = await call(target, url, headers);
  const warm = await call(target, url, headers);
  rows.push({ label, cold: +cold.ms.toFixed(1), warm: +warm.ms.toFixed(1), bytes: cold.bytes, status: cold.status, json: cold.json, note: note || '' });
  const j = cold.json || {};
  const extra = cold.status !== 200 ? 'HTTP ' + cold.status
    : (j.count !== undefined ? j.count + ' 条'
      : j.layers ? j.layers.length + ' 层'
        : j.has !== undefined ? 'has=' + j.has
          : (cold.bytes > 1024 ? (cold.bytes / 1048576).toFixed(2) + 'MB' : cold.bytes + 'B'));
  console.log(label.padEnd(56) + String(rows[rows.length - 1].cold).padStart(8) + String(rows[rows.length - 1].warm).padStart(10) + String(cold.bytes).padStart(11) + '   ' + extra + (note ? ' · ' + note : ''));
  return cold;
};

/* ── 链 A：渲染器 iframe 主路径 ── */
const tok = await step('A1 /scene-thumb-token（签发场景 token）', B + '/scene-thumb-token', B + '/scene-thumb-token?scene=' + encodeURIComponent('custom|' + id + '|scene.pkg'));
await step('A2 /raw 整包（渲染器 ?pkgurl= 拉的就是它）', B + '/raw', B + '/raw?folder=' + encodeURIComponent(id) + '&file=scene.pkg');
await step('A2b /raw + Range 0-65535（现在只取目录表也行）', B + '/raw', B + '/raw?folder=' + encodeURIComponent(id) + '&file=scene.pkg', '', { range: 'bytes=0-65535' });

/* ── 链 B：回退路径（与 client.js 同序） ── */
const vc = await step('B1 /custom-scene-video-check（探测内嵌视频）', B + '/custom-scene-video-check', B + '/custom-scene-video-check?folder=' + encodeURIComponent(id));
await step('B2 /custom-mpkg（时段视频 / 容器条目）', B + '/custom-mpkg', B + '/custom-mpkg?folder=' + encodeURIComponent(id) + '&file=scene.pkg');
const comp = await step('B3 /custom-scene-composite（图层清单）', B + '/custom-scene-composite', B + '/custom-scene-composite?folder=' + encodeURIComponent(id));
if (comp.status === 200 && comp.json && comp.json.layers) {
  const names = comp.json.layers.map((l) => l.texPath).slice(0, MAX_LAYERS);
  let sumCold = 0, sumWarm = 0, sumBytes = 0;
  for (const n of names) {
    const r = await call(B + '/custom-scene-layer', B + '/custom-scene-layer?folder=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(n));
    const w = await call(B + '/custom-scene-layer', B + '/custom-scene-layer?folder=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(n));
    sumCold += r.ms; sumWarm += w.ms; sumBytes += r.bytes;
  }
  console.log(('B4 /custom-scene-layer × ' + names.length + '（每层一次整包读！）').padEnd(56) + String(+sumCold.toFixed(1)).padStart(8) + String(+sumWarm.toFixed(1)).padStart(10) + String(sumBytes).padStart(11) + '   ' +
    '平均 ' + (sumCold / names.length).toFixed(1) + 'ms/层（清单共 ' + comp.json.layers.length + ' 层）');
  rows.push({ label: 'B4 /custom-scene-layer × ' + names.length, cold: +sumCold.toFixed(1), warm: +sumWarm.toFixed(1), bytes: sumBytes, status: 200, note: '共 ' + comp.json.layers.length + ' 层，每层整包读' });
} else {
  console.log('B4 /custom-scene-layer'.padEnd(56) + '        —         —          —   清单不可用（该类场景无静态图层）');
}
await step('B5 /custom-scene-frame（兜底静态帧）', B + '/custom-scene-frame', B + '/custom-scene-frame?folder=' + encodeURIComponent(id));
await step('B6 /custom-scene-thumb（列表缩略图：缓存/回退链）', B + '/custom-scene-thumb', B + '/custom-scene-thumb?folder=' + encodeURIComponent(id));
if (vc.json && vc.json.has) await step('B7 /custom-scene-video（内嵌 mp4 字节）', B + '/custom-scene-video', B + '/custom-scene-video?folder=' + encodeURIComponent(id));

/* ── 汇总 ── */
const pick = (l) => rows.find((r) => r.label.startsWith(l));
const sum = (ls) => +ls.reduce((a, r) => a + (r ? r.cold : 0), 0).toFixed(1);
const chainA = [pick('A1'), pick('A2 ')].filter(Boolean);
const chainB = [pick('B1'), pick('B2'), pick('B3'), pick('B4'), pick('B5')].filter(Boolean);
console.log('\n── 汇总（插件侧，冷启动一次） ──');
console.log('链 A 主路径（渲染器 iframe）：' + sum(chainA) + 'ms 插件侧（其中 /raw 整包 ' + (pick('A2 ') || {}).cold + 'ms / ' + pkgMB + 'MB；之后渲染器解析+解码+首帧在渲染器侧，本工具量不到）');
console.log('链 B 回退路径（静态帧/图层合成）：' + sum(chainB) + 'ms');
const slowest = rows.filter((r) => r.status === 200 || r.status === 404).sort((a, b) => b.cold - a.cold)[0];
console.log('最慢一段：' + slowest.label + ' = ' + slowest.cold + 'ms（热 ' + slowest.warm + 'ms, ' + slowest.bytes + 'B）');
try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* 忽略 */ }

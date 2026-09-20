// tools/web-probe-test.mjs —— 网页壁纸风险预检（重动画 / 需外网）的**路由级 + 数据形状**门禁
//
// 来历（用户第 11 条）：插件里本来就有对 web 壁纸的预检（Spine/L2D 骨架动画 = 重动画、
// 引用 http(s) 外链 = 需外网），但它只藏在两次目录扫描的返回值里（/custom-dir、/steam-inventory），
// 形状各不相同、也没法在"导入前"单查 ⇒ 测试台想显示两个标记只能自己再解析一遍目录。
// 本文件守两件事：
//   ① **唯一实现**：扫描与单查路由共用同一个 probeWebWallpaper()（源码级断言：不再各写一份递归）；
//   ② **接口形状**：`GET /web-probe?folder=|ltoken=` 的响应逐字段可断言（docs/WEB-WALLPAPER.md 同步）。
//
// 判据（契约，不是"我这台机器上跑出来是 200"）：
//   P1 路由存在：/web-probe 与 /custom-dir 都已注册（改名/删路由必须变红）
//   P2 形状：{ ok, target, probe:{ heavy, external, heavyHits[], externalRefs[], htmlFile, reasons[], limits } }
//   P3 判定：夹具目录含 `a.skel` + 入口 HTML 引用 `https://cdn.example/x.js` ⇒ 两个标记都为 true，
//            且证据里能看到命中的文件名与外链（不是只有一个布尔）
//   P4 负例：干净的网页壁纸（无骨骼动画、只有相对引用）⇒ 两个标记都为 false / reasons 不含命中
//   P5 回环地址不算"需外网"：入口 HTML 只引用 127.0.0.1 / localhost 时 external=false
//             （插件自己的路由就是本机地址，误判会让每张 web 壁纸都挂"外网"标记）
//   P6 参数闸门：既没有 folder 也没有 ltoken ⇒ 400；folder 穿越 ../ 或含 / ⇒ 403；不存在的目录 ⇒ 404
//   P7 扫描侧同源：/custom-dir 的同一条目里 webHeavy/webExternal 与 /web-probe 的结论逐项一致
//   P8 分辨力：把实现换回"两处各写一份递归 + 没有 /web-probe 路由"的旧形态必须变红
//             （`--module` 指向变异副本即可复跑，见文件尾说明）
//
// 复现: node tools/web-probe-test.mjs [--module <被测模块>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable, Readable } from 'node:stream';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
let pass = 0, fail = 0;
const ok = (cond, name, detail) => { if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) } else { fail++; console.error('  ✗ ' + name + (detail ? '  → ' + detail : '')) } };
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, 'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b));

/* ── 夹具：临时 DSH_HOME（绝不碰用户数据），自定义目录里放两张网页壁纸 ── */
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-webprobe-'));
process.on('exit', () => { try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch { /* 忽略 */ } });
const customDir = path.join(tmpHome, 'custom');
const heavyDir = path.join(customDir, 'heavy-web');
const cleanDir = path.join(customDir, 'clean-web');
const loopDir = path.join(customDir, 'loop-web');
for (const d of [heavyDir, cleanDir, loopDir]) fs.mkdirSync(d, { recursive: true });
fs.mkdirSync(path.join(tmpHome, '.dsh-mpkg-wallpaper'), { recursive: true });

// 重动画 + 需外网：骨骼动画资产（深层目录也要能找到）+ 入口 HTML 引外链
fs.mkdirSync(path.join(heavyDir, 'assets', 'model'), { recursive: true });
fs.writeFileSync(path.join(heavyDir, 'assets', 'model', 'char.skel'), 'SKEL');
fs.writeFileSync(path.join(heavyDir, 'assets', 'model', 'char.atlas'), 'ATLAS');
fs.writeFileSync(path.join(heavyDir, 'index.html'),
  '<!doctype html><html><head><script src="https://cdn.example.com/sdk.js"></script></head><body></body></html>');
fs.writeFileSync(path.join(heavyDir, 'project.json'), JSON.stringify({ type: 'web', file: 'index.html' }));

// 干净：只有相对引用
fs.writeFileSync(path.join(cleanDir, 'index.html'),
  '<!doctype html><html><head><script src="./assets/app.js"></script></head><body></body></html>');
fs.writeFileSync(path.join(cleanDir, 'project.json'), JSON.stringify({ type: 'web', file: 'index.html' }));

// 只引用本机回环：不算"需外网"
fs.writeFileSync(path.join(loopDir, 'index.html'),
  '<!doctype html><html><head><script src="http://127.0.0.1:8899/report"></script><img src="http://localhost:8899/x.png"></head><body></body></html>');
fs.writeFileSync(path.join(loopDir, 'project.json'), JSON.stringify({ type: 'web', file: 'index.html' }));

fs.writeFileSync(path.join(tmpHome, '.dsh-mpkg-wallpaper', 'custom-dir.json'), JSON.stringify({ dir: customDir }));
process.env.DSH_HOME = tmpHome;   // 必须在 import index.js 之前：DATA_DIR 由它决定

const argIdx = process.argv.indexOf('--module');
const MODULE_PATH = argIdx > 0 && process.argv[argIdx + 1] ? process.argv[argIdx + 1] : (process.env.MPW_MODULE || '../lib/index.js');
const { apply } = await import(MODULE_PATH);

const routes = [];
apply({ webServer: { register: (r) => routes.push(r) }, loader: null, logger: { info() {}, warn() {}, error() {} } });

class Res extends Writable {
  constructor() { super(); this.chunks = []; this.status = 0; this.headers = {} }
  _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb() }
  writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this }
  get body() { return Buffer.concat(this.chunks) }
}
async function call(target, { method = 'GET', url = target, headers = {}, body = null } = {}) {
  const bare = target.split('?')[0];
  const r = routes.find((x) => x.kind === 'exact' && x.path === bare)
    || routes.find((x) => x.kind === 'prefix' && (bare === x.path || bare.startsWith(x.path + '/')));
  if (!r) return { status: 0, headers: {}, json: {}, missing: true };
  const res = new Res();
  const done = new Promise((resolve) => res.on('finish', resolve));
  const req = body === null
    ? { method, url, headers }
    : Object.assign(Readable.from([Buffer.from(body)]), { method, url, headers });
  await r.handler(req, res);
  await Promise.race([done, new Promise((r2) => setTimeout(r2, 10000))]);
  let json = {};
  try { json = JSON.parse(res.body.toString('utf8')) } catch { json = {} }
  return { status: res.status, headers: res.headers, json };
}

const BASE = '/api/mpkg-wallpaper';
console.log('== 路由桩（DSH_HOME=' + tmpHome + '，被测模块 ' + MODULE_PATH + '）==');
// 让宿主把 customDir 设成夹具（与真机上"选目录"同一条路）
await call(BASE + '/custom-dir', { method: 'POST', body: JSON.stringify({ dir: customDir }) });

console.log('\n== P1 路由存在性（改名/删路由必须变红）==');
ok(routes.some((r) => r.path === BASE + '/web-probe'), 'P1 /web-probe 已注册', String(routes.length) + ' 条路由');
ok(routes.some((r) => r.path === BASE + '/custom-dir'), 'P1 /custom-dir 已注册（对照组）');

console.log('\n== P2/P3 形状 + 判定（重动画 + 需外网）==');
const hp = await call(BASE + '/web-probe', { url: BASE + '/web-probe?folder=heavy-web' });
ok(hp.status === 200 && hp.json.ok === true, 'P2 200 + ok:true', 'status=' + hp.status);
eq(hp.json.target, 'custom|heavy-web', 'P2 target 回显来源（custom|<folder>）');
const probe = hp.json.probe || {};
eq(Object.keys(probe).sort(), ['external', 'externalRefs', 'heavy', 'heavyHits', 'htmlFile', 'isWeb', 'limits', 'reasons', 'scannedBytes'], 'P2 probe 形状固定（文档 §风险预检接口 同款）');
ok(typeof probe.scannedBytes === 'number' && probe.scannedBytes > 0, 'P2 scannedBytes 如实给出实际读了多少字节（上限内的入口 HTML 长度）', String(probe.scannedBytes));
ok(probe.heavy === true, 'P3 含 .skel/.atlas（深层目录）⇒ heavy=true', 'heavyHits=' + JSON.stringify(probe.heavyHits));
ok(probe.heavyHits.includes('char.skel') && probe.heavyHits.includes('char.atlas'), 'P3 证据里能看到命中的文件名（不是只有一个布尔）', JSON.stringify(probe.heavyHits));
ok(probe.external === true, 'P3 入口 HTML 引 https:// ⇒ external=true', 'externalRefs=' + JSON.stringify(probe.externalRefs));
ok(probe.externalRefs.some((u) => /^https:\/\/cdn\.example\.com\/sdk\.js$/.test(u)), 'P3 证据里能看到具体外链', JSON.stringify(probe.externalRefs));
eq(probe.htmlFile, 'index.html', 'P3 htmlFile = 入口（project.json 声明的那个）');
ok(Array.isArray(probe.reasons) && probe.reasons.length === 2 && probe.reasons.every((s) => typeof s === 'string'), 'P3 reasons 是两句话（供面板/测试台直接显示）', JSON.stringify(probe.reasons));
ok(probe.limits && probe.limits.depth === 3 && probe.limits.bytes > 0 && probe.limits.refs > 0, 'P3 limits 如实给出扫描边界（深度/字节/条数）', JSON.stringify(probe.limits));

console.log('\n== P4/P5 负例：干净目录 / 只引用回环 ==');
const cp = await call(BASE + '/web-probe', { url: BASE + '/web-probe?folder=clean-web' });
ok(cp.json.probe && cp.json.probe.heavy === false && cp.json.probe.external === false, 'P4 无骨骼动画 + 只有相对引用 ⇒ 两个标记都 false', JSON.stringify(cp.json.probe && cp.json.probe.reasons));
const lp = await call(BASE + '/web-probe', { url: BASE + '/web-probe?folder=loop-web' });
ok(lp.json.probe && lp.json.probe.external === false, 'P5 只引用 127.0.0.1/localhost ⇒ external=false（插件自己的路由就是本机地址）', JSON.stringify(lp.json.probe && lp.json.probe.externalRefs));

console.log('\n== P6 参数闸门 ==');
const e400 = await call(BASE + '/web-probe');
ok(e400.status === 400 && e400.json.ok === false, 'P6 无 folder/ltoken ⇒ 400', 'status=' + e400.status);
const e403 = await call(BASE + '/web-probe', { url: BASE + '/web-probe?folder=' + encodeURIComponent('../secret') });
ok(e403.status === 403, 'P6 folder=../secret ⇒ 403（目录穿越）', 'status=' + e403.status);
const e403b = await call(BASE + '/web-probe', { url: BASE + '/web-probe?folder=' + encodeURIComponent('a/b') });
ok(e403b.status === 403, 'P6 folder 含 / ⇒ 403（只接受单段子目录名）', 'status=' + e403b.status);
const e404 = await call(BASE + '/web-probe', { url: BASE + '/web-probe?folder=nope-not-here' });
ok(e404.status === 404, 'P6 目录不存在 ⇒ 404（不是 500）', 'status=' + e404.status);
const e404b = await call(BASE + '/web-probe', { url: BASE + '/web-probe?ltoken=deadbeef' });
ok(e404b.status === 404, 'P6 ltoken 解析不到 ⇒ 404', 'status=' + e404b.status);

console.log('\n== P7 扫描侧同源（同一条目两个结论必须一致）==');
const cd = await call(BASE + '/custom-dir', { method: 'POST', body: JSON.stringify({ dir: customDir }) });
const item = (cd.json.files || []).find((f) => f.name === 'heavy-web');
ok(!!item, 'P7 /custom-dir 清单里有 heavy-web', JSON.stringify((cd.json.files || []).map((f) => f.name + ':' + f.type)));
ok(item && item.webHeavy === probe.heavy && item.webExternal === probe.external,
  'P7 扫描条目与 /web-probe 的两个标记逐项一致（同一实现 ⇒ 不可能漂移）',
  JSON.stringify(item && { scan: [item.webHeavy, item.webExternal], probe: [probe.heavy, probe.external] }));
ok(item && item.webProbe && Array.isArray(item.webProbe.heavyHits) && item.webProbe.heavyHits.length > 0,
  'P7 扫描条目带结构化 webProbe（测试台不必再解析目录）', JSON.stringify(item && item.webProbe && item.webProbe.heavyHits));

console.log('\n== P8 源码级：预检只有**一处**实现（防"两处各写一份递归"回潮）==');
{
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8');
  const defs = (src.match(/walkHeavy\s*=/g) || []).length;       // 递归的**定义**次数
  const calls = (src.match(/probeWebWallpaper\s*\(/g) || []).length; // 定义 1 + 路由 1 + 两处扫描 2 = 4
  ok(/function\s+probeWebWallpaper\s*\(/.test(src), 'P8 lib/index.js 里有模块级 probeWebWallpaper（唯一实现）');
  ok(defs === 1 && !/walkHeavy2/.test(src), 'P8 递归查找只剩**一份定义**（旧实现是两处扫描各写一份 walkHeavy/walkHeavy2）', 'walkHeavy 定义 ' + defs + ' 处 / walkHeavy2 ' + (/walkHeavy2/.test(src) ? '仍在' : '已删'));
  ok(calls >= 4, 'P8 两处扫描 + 单查路由都调用它（不再各写一份）', 'probeWebWallpaper 出现 ' + calls + ' 次');
}

console.log('')
if (fail) {
  console.error('✗ 网页壁纸风险预检门禁未通过（' + fail + ' 项失败 / ' + (pass + fail) + ' 项）');
  console.error('  分辨力自证：把 /web-probe 路由删掉、或让两处扫描各写一份递归（恢复旧形态），本文件必须变红。');
  process.exit(1);
}
console.log('网页壁纸风险预检门禁：' + pass + ' 通过, 0 失败 ✓');
console.log('契约：GET /web-probe?folder=|ltoken= → { ok, target, probe:{ heavy, external, heavyHits[], externalRefs[], htmlFile, reasons[], limits } }（docs/WEB-WALLPAPER.md）');

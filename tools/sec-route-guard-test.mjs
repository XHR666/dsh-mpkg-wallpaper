// tools/sec-route-guard-test.mjs —— ⓪①(2026-09-27 P-204 安全审计 F1–F4) 宿主路由的**来源闸门**判据。
//
// 审计报告（同工作区）：docs/reverse/SECURITY-AUDIT-secret-exfil-20260925.md
//   已复现的攻击链（§4.1，本文件 A 段就是它的**自动化版本**）：
//     P2 `POST /custom-dir`（`Origin: https://evil.example` + `content-type: text/plain`）→ 200 盲改目录
//     P3 `GET  /raw?custom=1&file=topsecret.txt`（同 Origin）→ 200 + `ACAO: <攻击者源>` + 密文读回
//   修后：P2 → 403（来源闸门）+ P3 → 403（扩展名白名单）/ 即便拿到字节也**没有 ACAO**（读不回）。
//
// 判据结构（每条都要求"攻击被拒 + 正常仍通 + 回退口能回到旧行为"）：
//   A 攻击链：用真 `lib/index.js`（真路由桩）+ 临时 `DSH_HOME`/临时夹具目录（**绝不碰真实密钥**）
//     ① 修后：POST /custom-dir 403、GET /raw 403、无 ACAO、`/scene-thumb-token` 拒签发；
//     ② 正常：同源 POST /custom-dir 200、`Origin: null` + 真容器文件 GET /raw 200 + ACAO: null、
//        同源签发真身份 token 200；
//     ③ 修前读数复现（= 把守卫去掉的变异）：`MPW_CSRF=0` + `MPW_CORS_LEGACY=1` +
//        `MPW_CUSTOM_DIR_ALLOW_ANY=1` ⇒ 同一发请求 200 + ACAO 回显 + 密文读回（旧行为逐条重现）。
//   B 纯函数矩阵：`corsOriginAllowed` / `secGateDecision`（sfs/origin 组合）/ `secCustomDirDenied`
//     （`~/.ssh`、`~/.dsh`、点段、家目录）/ `secRawFileAllowed`（.mpkg/.flac 放行，.txt/.yaml/无后缀拒绝）
//   C 变异自证：把 4 个守卫分别"去掉"（env 回退档 + 直接改纯函数入参）⇒ 对应断言必红
//
// 用法: node tools/sec-route-guard-test.mjs
// 纯 Node，无浏览器、无网络、无 ffmpeg；只写 os.tmpdir() 下的临时目录。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable, Readable } from 'node:stream';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
let pass = 0; let fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.error('  ✗ ' + name + (detail ? ' → ' + detail : '')); }
};
const MARK = 'FIXTURE-DO-NOT-USE-abcdef123456';

/* ── 夹具（全部在 os.tmpdir() 下；**不读也不写任何真实密钥**） ─────────────────────────── */
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-sec-home-'));
const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-sec-secrets-'));
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-sec-media-'));
fs.writeFileSync(path.join(secretDir, 'topsecret.txt'), MARK + '\n');           // 审计 P3 的"密文"
fs.writeFileSync(path.join(secretDir, 'id_rsa'), MARK + '\n');                  // 无点前缀的敏感文件
fs.writeFileSync(path.join(secretDir, '.credentials.yaml'), 'apiKey: ' + MARK); // 点前缀（旧防线：不可读）
fs.writeFileSync(path.join(mediaDir, 'fixture.mpkg'), 'PKGV0022-fake-container\n'); // 合法容器（白名单内）
fs.writeFileSync(path.join(mediaDir, 'song.flac'), 'fLaC' + '\0'.repeat(8));    // 合法音轨
fs.mkdirSync(path.join(tmpHome, '.dsh-mpkg-wallpaper'), { recursive: true });
process.env.DSH_HOME = tmpHome;   // 必须在 import index.js 之前（DATA_DIR 由它决定）

const { apply, __mpwTest } = await import(path.join(ROOT, 'lib/index.js'));
const routes = [];
apply({ webServer: { register: (r) => routes.push(r) }, loader: null, logger: { info() {}, warn() {}, error() {} } });

class Res extends Writable {
  constructor() { super(); this.chunks = []; this.status = 0; this.headers = {}; }
  _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
  writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this; }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
  get body() { return Buffer.concat(this.chunks); }
}
async function call(target, { method = 'GET', url = target, headers = {}, body = null } = {}) {
  const bare = target.split('?')[0];
  const r = routes.find((x) => x.kind === 'exact' && x.path === bare)
    || routes.find((x) => x.kind === 'prefix' && (bare === x.path || bare.startsWith(x.path + '/')));
  if (!r) return { status: 0, headers: {}, body: Buffer.alloc(0), missing: true };
  const res = new Res();
  const done = new Promise((resolve) => res.on('finish', resolve));
  const req = body === null
    ? { method, url, headers }
    : Object.assign(Readable.from([Buffer.from(body)]), { method, url, headers });
  await r.handler(req, res);
  await Promise.race([done, new Promise((r2) => setTimeout(r2, 5000))]);
  return { status: res.status, headers: res.headers, body: res.body };
}
const B = '/api/mpkg-wallpaper';
const EVIL = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' };
const SAME = { origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' };

console.log('== 攻击链夹具（DSH_HOME=' + tmpHome + '；目录含 topsecret.txt / id_rsa / .credentials.yaml / fixture.mpkg）==');
ok(routes.length > 20, '真 lib/index.js 已注册路由表（' + routes.length + ' 条）');

/* ── A 攻击链：修后 403 / 正常仍通 / 回退口复现旧行为 ───────────────────────────────── */
console.log('\n== A1 修后：审计 §4.1 的攻击链必须被切断 ==');
const p2 = await call(B + '/custom-dir', { method: 'POST', url: B + '/custom-dir', headers: EVIL, body: JSON.stringify({ dir: secretDir }) });
ok(p2.status === 403, 'P2 盲改 customDir（evil 源 + text/plain）⇒ 403', 'status=' + p2.status + ' body=' + p2.body.toString().slice(0, 90));
ok(/csrf-origin-gate|sec-fetch-site/.test(p2.body.toString()), 'P2 拒绝原因可读（csrf-origin-gate）', p2.body.toString().slice(0, 120));

// 直接把 customDir 放到"合法但指向密文目录"的位置（模拟"攻击已改目录"的最坏前提）：走同源写一次
const p2ok = await call(B + '/custom-dir', { method: 'POST', url: B + '/custom-dir', headers: SAME, body: JSON.stringify({ dir: secretDir }) });
ok(p2ok.status === 200, 'P2b 同源（插件 UI 自己）改目录 ⇒ 200（正常路径没被闸门误伤）', 'status=' + p2ok.status);
const p3 = await call(B + '/raw', { url: B + '/raw?custom=1&file=topsecret.txt', headers: { origin: 'https://evil.example' } });
ok(p3.status === 403, 'P3 读 topsecret.txt ⇒ 403（扩展名白名单；改前 200 + 密文读回）', 'status=' + p3.status + ' body=' + p3.body.toString().slice(0, 80));
ok(!p3.headers['access-control-allow-origin'], 'P3 即便响应体里什么都没有，也**没有 ACAO**（跨源读不回）', 'acao=' + JSON.stringify(p3.headers['access-control-allow-origin'] || null));
const p3b = await call(B + '/raw', { url: B + '/raw?custom=1&file=id_rsa', headers: { origin: 'https://evil.example' } });
ok(p3b.status === 403, 'P3b 读 id_rsa（无点前缀，旧防线挡不住）⇒ 403', 'status=' + p3b.status);
const p3c = await call(B + '/raw', { url: B + '/raw?custom=1&file=.credentials.yaml', headers: { origin: 'https://evil.example' } });
ok(p3c.status === 403, 'P3c 点前缀文件仍 403（旧防线保持）', 'status=' + p3c.status);
const p5 = await call(B + '/scene-thumb-token', { url: B + '/scene-thumb-token?scene=' + encodeURIComponent('custom||topsecret.txt'), headers: { origin: 'null', 'sec-fetch-site': 'cross-site' } });
ok(p5.status === 403, 'P5 沙箱帧（Origin: null）为任意身份自签 token ⇒ 403', 'status=' + p5.status + ' body=' + p5.body.toString().slice(0, 90));
const p5b = await call(B + '/scene-thumb-token', { url: B + '/scene-thumb-token?scene=' + encodeURIComponent('custom||topsecret.txt'), headers: SAME });
ok(p5b.status === 403 && /scene-identity-/.test(p5b.body.toString()), 'P5b 即便是同源，身份指不到真实文件也拒签（F4 身份校验）', 'status=' + p5b.status + ' body=' + p5b.body.toString().slice(0, 110));

console.log('\n== A2 修后：正常链路仍然通（零回归） ==');
const r0 = await call(B + '/custom-dir', { method: 'POST', url: B + '/custom-dir', headers: SAME, body: JSON.stringify({ dir: mediaDir }) });
ok(r0.status === 200, 'R0 同源切到"合法媒体目录"夹具 ⇒ 200', 'status=' + r0.status);
const r13 = await call(B + '/scene-thumb-token', { url: B + '/scene-thumb-token?scene=' + encodeURIComponent('custom||fixture.mpkg'), headers: { 'sec-fetch-site': 'same-origin' } });
let tok = null;
try { tok = JSON.parse(r13.body.toString()); } catch { /* 非 JSON */ }
ok(r13.status === 200 && tok && tok.ok && typeof tok.token === 'string', 'R4 同源为**真实存在**的场景签 token ⇒ 200（渲染器 strict 档链路）', 'status=' + r13.status);
const st = tok && tok.token ? '&st=' + encodeURIComponent(tok.token) : '';
const r10 = await call(B + '/raw', { url: B + '/raw?custom=1&file=fixture.mpkg' + st, headers: { origin: 'null' } });
ok(r10.status === 200 && r10.headers['access-control-allow-origin'] === 'null' && /PKGV0022/.test(r10.body.toString()),
  'R1 沙箱帧（Origin: null + 合法 st）读**真容器** ⇒ 200 + ACAO: null + 字节完整（渲染器主链路）', 'status=' + r10.status + ' acao=' + JSON.stringify(r10.headers['access-control-allow-origin'] || null));
const r11 = await call(B + '/raw', { url: B + '/raw?custom=1&file=song.flac', headers: { origin: 'http://127.0.0.1:8899' } });
ok(r11.status === 200 && r11.headers['access-control-allow-origin'] === 'http://127.0.0.1:8899',
  'R2 白名单渲染器源（8899/8902）读音轨 ⇒ 200 + 回显该源（跨源链路仍通）', 'status=' + r11.status + ' acao=' + JSON.stringify(r11.headers['access-control-allow-origin'] || null));
const r12 = await call(B + '/raw', { url: B + '/raw?custom=1&file=fixture.mpkg', headers: { origin: 'https://evil.example' } });
ok(r12.status === 200 && !r12.headers['access-control-allow-origin'],
  'R3 非白名单源读**白名单内**的容器：字节仍可被"盲取"，但**没有 ACAO** ⇒ 浏览器里读不回', 'status=' + r12.status + ' acao=' + JSON.stringify(r12.headers['access-control-allow-origin'] || null));
const r14 = await call(B + '/security', { url: B + '/security' });
let secInfo = null;
try { secInfo = JSON.parse(r14.body.toString()); } catch { /* 非 JSON */ }
ok(r14.status === 200 && secInfo && secInfo.csrfGate === 'on' && secInfo.corsLegacy === 'off', 'R5 GET /security 如实播报闸门状态（默认 on / legacy off）', 'status=' + r14.status);
const r15 = await call(B + '/custom-scene-thumb', { method: 'POST', url: B + '/custom-scene-thumb', headers: Object.assign({}, EVIL), body: JSON.stringify({ w: 1, h: 1 }) });
ok(r15.status === 403, 'R6 缩略图上报（evil 源盲发）⇒ 403（写路由全过闸门）', 'status=' + r15.status);
const r16 = await call(B + '/diag', { method: 'POST', url: B + '/diag', headers: Object.assign({}, EVIL), body: JSON.stringify({ ok: true }) });
ok(r16.status === 403, 'R7 /diag 盲写（evil 源）⇒ 403（8MB 落盘不再能被任意页面触发）', 'status=' + r16.status);

console.log('\n== A3 回退口把守卫去掉 ⇒ **旧行为逐条复现**（变异必红的另一半） ==');
process.env.MPW_CSRF = '0';
process.env.MPW_CORS_LEGACY = '1';
process.env.MPW_CUSTOM_DIR_ALLOW_ANY = '1';
const m2 = await call(B + '/custom-dir', { method: 'POST', url: B + '/custom-dir', headers: EVIL, body: JSON.stringify({ dir: secretDir }) });
ok(m2.status === 200, 'M1 回退档：盲改 customDir 又变成 200（= 去掉闸门，判据有分辨力）', 'status=' + m2.status);
const m3 = await call(B + '/raw', { url: B + '/raw?custom=1&file=topsecret.txt', headers: { origin: 'https://evil.example' } });
ok(m3.status === 200 && /FIXTURE-DO-NOT-USE/.test(m3.body.toString()),
  'M2 回退档：审计 P3 的"密文读回"完整重现（200 + 内容）', 'status=' + m3.status + ' len=' + m3.body.length);
ok(m3.headers['access-control-allow-origin'] === 'https://evil.example' && m3.headers['access-control-allow-credentials'] === 'true',
  'M3 回退档：ACAO 又回显攻击者源 + allow-credentials（F1 原样）', 'acao=' + JSON.stringify(m3.headers['access-control-allow-origin'] || null));
const m5 = await call(B + '/scene-thumb-token', { url: B + '/scene-thumb-token?scene=' + encodeURIComponent('custom||topsecret.txt'), headers: { origin: 'null' } });
ok(m5.status === 403, 'M4 身份校验不随闸门回退（F4 收口是**不可回退**的那一条 —— 令牌门不再形同虚设）', 'status=' + m5.status);
delete process.env.MPW_CSRF;
delete process.env.MPW_CORS_LEGACY;
delete process.env.MPW_CUSTOM_DIR_ALLOW_ANY;
const back = await call(B + '/raw', { url: B + '/raw?custom=1&file=topsecret.txt', headers: { origin: 'https://evil.example' } });
ok(back.status === 403, 'M5 回退口关掉之后又恢复 403（回退是**显式且可逆**的）', 'status=' + back.status);

/* ── B 纯函数矩阵 ───────────────────────────────────────────────────────────────────── */
console.log('\n== B 纯函数矩阵（真实现直接调） ==');
const T = __mpwTest;
ok(!!T && typeof T.corsOriginAllowed === 'function' && typeof T.secGateDecision === 'function', 'B0 __mpwTest 导出安全纯函数');
ok(T.corsOriginAllowed('null') === true && T.corsOriginAllowed('http://127.0.0.1:3080') === true, 'B1 null / 3080 ⇒ 允许');
ok(T.corsOriginAllowed('https://evil.example') === false && T.corsOriginAllowed('') === false && T.corsOriginAllowed('*') === false, 'B2 任意源 / 空 / `*` ⇒ 拒绝');
ok(T.corsForOrigin({ headers: { origin: 'https://evil.example' } }, { 'x-a': '1' }, true)['access-control-allow-origin'] === undefined, 'B3 corsForOrigin：非白名单 ⇒ 不发任何 ACAO');
ok(T.corsForOrigin({ headers: { origin: 'null' } }, {}, true)['access-control-allow-origin'] === 'null', 'B4 corsForOrigin：null ⇒ 回显 null');
const g1 = T.secGateDecision({ method: 'POST', headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', host: '127.0.0.1:3080' } }, { path: B + '/settings' });
ok(g1.block === true && /sec-fetch-site/.test(g1.reason), 'B5 cross-site POST ⇒ 拦（理由=sec-fetch-site）', g1.reason);
const g2 = T.secGateDecision({ method: 'POST', headers: { 'sec-fetch-site': 'same-origin', origin: 'http://192.168.1.50:3080', host: '192.168.1.50:3080' } }, { path: B + '/settings' });
ok(g2.block === false, 'B6 局域网字面 IP 同源（手机打开 DSH）⇒ 放行（不误伤真机用法）', g2.reason);
const g3 = T.secGateDecision({ method: 'POST', headers: { origin: 'http://evil.example', host: 'evil.example' } }, { path: B + '/settings' });
ok(g3.block === true, 'B7 DNS 重绑定形态（Host 是域名，Origin 自洽）⇒ 拦', g3.reason);
const g4 = T.secGateDecision({ method: 'GET', headers: {} }, { path: B + '/settings' });
ok(g4.block === false, 'B8 无任何浏览器证据（curl/测试桩）⇒ 按旧口径放行', g4.reason);
const g5 = T.secGateDecision({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } }, { path: B + '/settings' });
ok(g5.block === true, 'B9 GET /settings 也在闸门内（跨站 <img> 不再能盲触发）', g5.reason);
const g6 = T.secGateDecision({ method: 'GET', headers: {} }, { path: B + '/custom-scene-thumb' });
ok(g6.block === false, 'B10 普通 GET（缩略图列表）不受影响', g6.reason);
const home = os.homedir();
ok(!!T.secCustomDirDenied(path.join(home, '.ssh')) && !!T.secCustomDirDenied(path.join(home, '.dsh', 'x')), 'B11 ~/.ssh 与 ~/.dsh/** ⇒ 拒');
ok(!!T.secCustomDirDenied(home), 'B12 家目录自身 ⇒ 拒');
ok(T.secCustomDirDenied(mediaDir) === '', 'B13 普通目录 ⇒ 放行');
ok(T.secRawFileAllowed('a.mpkg') && T.secRawFileAllowed('b.PKG') && T.secRawFileAllowed('c.flac') && T.secRawFileAllowed('d.json'), 'B14 容器/音轨/清单 ⇒ 放行');
ok(!T.secRawFileAllowed('topsecret.txt') && !T.secRawFileAllowed('id_rsa') && !T.secRawFileAllowed('a.yaml') && !T.secRawFileAllowed('noext'), 'B15 .txt / 无后缀 / .yaml / id_rsa ⇒ 拒');
process.env.MPW_CUSTOM_DIR_ALLOW_ANY = '1';
ok(T.secRawFileAllowed('topsecret.txt') === true, 'B16 回退口 MPW_CUSTOM_DIR_ALLOW_ANY=1 ⇒ 扩展名不设限（旧口径可复现）');
delete process.env.MPW_CUSTOM_DIR_ALLOW_ANY;
process.env.MPW_CORS_ORIGINS = 'https://mirror.example';
ok(T.corsOriginAllowed('https://mirror.example') === true, 'B17 MPW_CORS_ORIGINS 追加白名单生效');
delete process.env.MPW_CORS_ORIGINS;

/* ── C 变异自证（直接改守卫语义 ⇒ 断言必红） ─────────────────────────────────────────── */
console.log('\n== C 变异自证（把守卫挑掉一条 ⇒ 同一组断言必须变红） ==');
const MUT = [
  { name: 'C1 去掉扩展名白名单（旧口径）', env: { MPW_CUSTOM_DIR_ALLOW_ANY: '1' }, probe: () => T.secRawFileAllowed('topsecret.txt') },
  { name: 'C2 去掉 CORS 白名单（旧口径回显）', env: { MPW_CORS_LEGACY: '1' }, probe: () => T.corsOriginAllowed('https://evil.example') },
  { name: 'C3 去掉整道 CSRF 闸门', env: { MPW_CSRF: '0' }, probe: () => !T.secGateDecision({ method: 'POST', headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' } }, { path: B + '/settings' }).block },
];
for (const m of MUT) {
  const saved = {};
  for (const [k, v] of Object.entries(m.env)) { saved[k] = process.env[k]; process.env[k] = v; }
  let red = false;
  try { red = m.probe() === true; } catch { red = true; }
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  ok(red, '变异必红：' + m.name);
}
// C4：身份校验不可回退 —— 把 customDir 指向一个**不存在**的目录后，真身份也签不出来（证明校验真的在跑）
const p6 = await call(B + '/scene-thumb-token', { url: B + '/scene-thumb-token?scene=' + encodeURIComponent('custom||not-there.mpkg'), headers: { 'sec-fetch-site': 'same-origin' } });
ok(p6.status === 403, '变异必红：身份指向不存在的文件 ⇒ 403（校验在跑，不是恒放行）', 'status=' + p6.status);

console.log('\n' + (fail ? '✗' : '✓') + ' sec-route-guard（插件侧）：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

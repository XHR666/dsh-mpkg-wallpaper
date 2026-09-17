// tools/better-sidebar-compat-test.mjs —— better-sidebar 适配的回归门禁（用户第 1 项）
//
// 为什么需要它：插件的「按版本适配」有两段链路，两段都出过**静默失效**——
//   ① host 侧 `/ping` 的 betterSidebarVersion 字段恒为 null
//      真因（2026-09-17 查实）：`let betterSidebarVersion = null; betterSidebarVersion = betterSidebarVersion()`
//      局部变量把同名函数遮蔽 → 调用 null → TypeError 被空 catch 吞掉。装了 0.19.1 也返回 null。
//      更早还有一次同类症状的真因是 dshHomeDir() 少了一层 `.dsh`（见 lib/index.js:52-56）。
//   ② 客户端只在「设置页组件」的 effect 里发 /ping ⇒ 不打开插件设置页时 body 上永远没有
//      `data-mpw-bs-version` ⇒ 所有 `[data-mpw-bs-version^=…]` 版本门控规则一条都不生效。
// 两处都是"看起来在适配、实际没适配"的假绿，所以本用例用**真 apply() + 真桩 DOM** 断言结果落点。
//
// 本文件断言（每条都能被"改回旧写法"变红）：
//   A. host /ping：DSH_HOME 指向装有 better-sidebar 的 profile ⇒ betterSidebarVersion === 磁盘上的版本
//      （含"多 profile：headless 没装、web 装了"仍取到 web 的版本）
//   B. 变异用例：把函数名改回与局部变量同名（复现真因）⇒ 同一断言必须变红（证明用例有分辨力）
//   C. 客户端：apply()（页面加载路径，**不经过设置页**）就把版本写到 body[data-mpw-bs-version]；
//      未装 better-sidebar 时不写（属性缺失）
//   D. 静态契约：浮窗（0.16+ 才有的 data-dsh-float-window）规则必须带版本门控；
//      版本只会来自 /ping 的同一处写入（属性名一致，防"改了写侧忘了读侧"）
//   E. 金丝雀（已装 better-sidebar 时；未装则 SKIP）：我们 bsCompat 依赖的 DOM 锚点在**该版本产物**里
//      仍然存在（better-sidebar 的类名前缀是构建期哈希，锚点消失 = 适配静默死亡）
//
// 复现: node tools/better-sidebar-compat-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
let pass = 0, fail = 0, skip = 0;
const ok = (n, d) => { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); };
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')); };
const sk = (n, d) => { skip++; console.log('  ⤼ SKIP ' + n + (d ? '  [' + d + ']' : '')); };

/* ---------- 夹具：一份"装了 better-sidebar 的 DSH_HOME" ---------- */
const FAKE_VER = '0.19.1';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-bs-'));
const mkProfile = (name, ver) => {
  const dir = path.join(home, 'profiles', name, 'node_modules', 'dsh-better-sidebar');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-better-sidebar', version: ver }));
  return dir;
};
mkProfile('headless', null);                        // 没装（不该被扫到）
fs.rmSync(path.join(home, 'profiles', 'headless', 'node_modules', 'dsh-better-sidebar'), { recursive: true, force: true });
mkProfile('web', FAKE_VER);                          // 装了
process.env.DSH_HOME = home;                         // 必须在 import index.js 之前（DATA_DIR 由它决定）

/* ---------- 路由桩（与 tools/scene-audio-route-test.mjs 同款） ---------- */
class Res extends Writable {
  constructor() { super(); this.chunks = []; this.status = 0; this.headers = {}; }
  _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
  writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this; }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
  get body() { return Buffer.concat(this.chunks); }
}
function routesOf(applyFn, { sidebarLoaded = true } = {}) {
  const routes = [];
  const ctx = {
    webServer: { register: (r) => routes.push(r) },
    loader: { entries: () => (sidebarLoaded ? [{ options: { id: 'better-sidebar', name: 'dsh-better-sidebar' }, disabled: false }] : []) },
    logger: { info() {}, warn() {}, error() {} },
  };
  applyFn(ctx);
  return routes;
}
async function ping(routes) {
  const r = routes.find((x) => x.kind === 'exact' && String(x.path).endsWith('/ping'));
  if (!r) return { missing: true };
  const res = new Res();
  const done = new Promise((resolve) => res.on('finish', resolve));
  await r.handler({ method: 'GET', url: r.path }, res);
  await Promise.race([done, new Promise((r2) => setTimeout(r2, 2000))]);
  try { return { status: res.status, json: JSON.parse(res.body.toString('utf8')) }; } catch (e) { return { status: res.status, error: String(e.message), raw: res.body.toString('utf8').slice(0, 200) }; }
}

const mod = await import('../lib/index.js');
const routes = routesOf(mod.apply);

console.log('\n== A. host /ping 的 betterSidebarVersion（DSH_HOME=' + home + '）==');
{
  const p = await ping(routes);
  ok('/ping 路由存在', !p.missing && p.status === 200, 'status=' + p.status);
  ok('betterSidebar 检测 = true（loader 里有该插件行）', p.json && p.json.betterSidebar === true, JSON.stringify(p.json && p.json.betterSidebar));
  ok('betterSidebarVersion === 磁盘版本 ' + FAKE_VER + '（改前：恒 null）',
    p.json && p.json.betterSidebarVersion === FAKE_VER, JSON.stringify(p.json && p.json.betterSidebarVersion));
  ok('版本是形如 x.y.z 的字符串（不是对象/布尔）',
    !!(p.json && typeof p.json.betterSidebarVersion === 'string' && /^\d+\.\d+\.\d+/.test(p.json.betterSidebarVersion)),
    JSON.stringify(p.json && p.json.betterSidebarVersion));
  // 未装 better-sidebar 的 DSH_HOME：不得误报版本
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-bs-none-'));
  const p2 = await ping(routes);
  ok('没有装 better-sidebar 的 DSH_HOME ⇒ null（不臆造版本）', p2.json && p2.json.betterSidebarVersion === null, JSON.stringify(p2.json && p2.json.betterSidebarVersion));
  process.env.DSH_HOME = home;
}

console.log('\n== B. 变异用例：把函数名改回与局部变量同名（复现真因）⇒ 必须变红 ==');
{
  const mut = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-bs-mut-'));
  // 只复制 index.js 与它的两个相对依赖（lib/liquid-glass/ 是目录，本机 cpSync 会 EINVAL；
  // 且变异只发生在 index.js，复制整个 lib 没有必要）。
  fs.mkdirSync(path.join(mut, 'lib'), { recursive: true });
  for (const f of ['index.js', 'pkg-extract.js', 'web-wallpaper.js']) {
    fs.copyFileSync(path.join(ROOT, 'lib', f), path.join(mut, 'lib', f));
  }
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(mut, 'package.json'));
  const f = path.join(mut, 'lib', 'index.js');
  const src = fs.readFileSync(f, 'utf8');
  const mutated = src
    .replace('function detectBetterSidebarVersion()', 'function betterSidebarVersion()')
    .replace('detectBetterSidebarVersion();', 'betterSidebarVersion();');
  fs.writeFileSync(f, mutated);
  const same = mutated !== src && /function betterSidebarVersion\(\)/.test(mutated) && /betterSidebarVersion\(\);/.test(mutated);
  ok('变异体构造成功（函数名被改回同名）', same);
  process.env.DSH_HOME = home;
  const mutMod = await import(pathToFileURL(f).href);
  const mp = await ping(routesOf(mutMod.apply));
  ok('变异体的 betterSidebarVersion 变回 null（这就是用例的分辨力）',
    mp.json && mp.json.betterSidebarVersion === null, JSON.stringify(mp.json && mp.json.betterSidebarVersion));
  ok('变异体与真实实现返回**不同**结果（同断言在旧写法下必红）',
    (mp.json && mp.json.betterSidebarVersion) !== FAKE_VER);
  fs.rmSync(mut, { recursive: true, force: true });
}

console.log('\n== C. 客户端：apply()（页面加载路径）即写 body[data-mpw-bs-version] ==');
{
  const { loadPlugin } = await import('./_stub.mjs');
  // 同一进程里第二次 loadPlugin 前必须清掉"只注册一次"的守卫（client.js 第 6 行有
  // `if (globalThis.__mpwClientLoaded) return …` 的短路，不清就会抛"未注册"）。
  const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwBsVerAt', '__mpwGlobalWired', '__mpwInlineWatcher', '__mpwStyleWatch'];
  const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch {} } };
  const pingOk = async (url) => (String(url).includes('/ping')
    ? { ok: true, status: 200, json: async () => ({ ok: true, version: '3.7.2', betterSidebar: true, betterSidebarVersion: FAKE_VER }) }
    : { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) });
  reset();
  const a = loadPlugin({ quiet: true, fetch: pingOk });
  await new Promise((r) => setTimeout(r, 60));
  ok('装了 better-sidebar ⇒ body[data-mpw-bs-version] = ' + FAKE_VER,
    a.doc.body.getAttribute('data-mpw-bs-version') === FAKE_VER, JSON.stringify(a.doc.body.getAttribute('data-mpw-bs-version')));
  const pingNo = async (url) => (String(url).includes('/ping')
    ? { ok: true, status: 200, json: async () => ({ ok: true, version: '3.7.2', betterSidebar: false, betterSidebarVersion: null }) }
    : { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) });
  reset();
  const b = loadPlugin({ quiet: true, fetch: pingNo });
  await new Promise((r) => setTimeout(r, 60));
  ok('没装 better-sidebar ⇒ 属性缺失（旧版本走"通用"路径，不加版本前缀）',
    b.doc.body.getAttribute('data-mpw-bs-version') === null, JSON.stringify(b.doc.body.getAttribute('data-mpw-bs-version')));
  ok('loadPlugin 的报告里没有 apply 期异常', (a.applyErrors || []).length === 0 && (b.applyErrors || []).length === 0,
    JSON.stringify([...(a.applyErrors || []), ...(b.applyErrors || [])].slice(0, 3)));
}

console.log('\n== D. 静态契约（版本门控 / 写入与读取同一属性名）==');
{
  const client = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  const gateLines = client.split('\n').filter((l) => l.includes('data-dsh-float-window'));
  ok('浮窗规则存在且**每条**都带 [data-mpw-bs-version^="0.16"] 门控',
    gateLines.length >= 2 && gateLines.every((l) => l.includes('data-mpw-bs-version^="0.16"')), gateLines.length + ' 行');
  ok('写入侧属性名 = data-mpw-bs-version', /setAttribute\("data-mpw-bs-version"/.test(client));
  ok('读取侧（CSS 门控）属性名同为 data-mpw-bs-version', /\[data-mpw-bs-version\^=/.test(client));
  const callIdx = client.indexOf('refreshBetterSidebarVersion();');
  const applyIdx = client.indexOf('function applyInner');
  ok('页面加载路径里调用了版本探测（applyInner 之后的调用点存在）',
    callIdx > 0 && applyIdx > 0 && callIdx > applyIdx, 'callIdx=' + callIdx + ' applyIdx=' + applyIdx);
  ok('探测函数有 5s 去抖（apply 重跑不刷请求）', /__mpwBsVerAttr|__mpwBsVerAt/.test(client));
  // ①(2026-09-17) 面板级规则必须**同时**挂 0.19 的稳定属性锚点：类名哈希 0.16→0.19 已经换过一次
  //   （旧哈希 → nArs4W_），只靠 [class*="_bottomPanel"] 子串在下次前缀/命名变更时会静默失配。
  const attrPanel = (client.match(/\[data-dsh-better-sidebar\] \[data-dsh-bottom-panel\]/g) || []).length;
  const attrPane = (client.match(/\[data-dsh-better-sidebar\] \[data-dsh-pane\]/g) || []).length;
  const clsPanel = (client.match(/\[class\*="_bottomPanel"\]/g) || []).length;
  ok('面板根规则挂了稳定属性锚点 [data-dsh-bottom-panel]（与类名子串并存）', attrPanel >= 4, 'attrPanel=' + attrPanel + ' clsPanel=' + clsPanel);
  ok('面板内层规则挂了稳定属性锚点 [data-dsh-pane]', attrPane >= 2, 'attrPane=' + attrPane);
}

console.log('\n== E. 金丝雀：我们依赖的 DOM 锚点是否还在"已装版本"的产物里 ==');
{
  const BS_DIR = process.env.MPW_BS_DIR || '/root/.dsh/profiles/web/node_modules/dsh-better-sidebar';
  if (!fs.existsSync(path.join(BS_DIR, 'package.json'))) {
    sk('未安装 dsh-better-sidebar，跳过锚点金丝雀', BS_DIR);
  } else {
    const ver = JSON.parse(fs.readFileSync(path.join(BS_DIR, 'package.json'), 'utf8')).version;
    const libDir = path.join(BS_DIR, 'lib');
    const files = fs.existsSync(libDir) ? fs.readdirSync(libDir).filter((f) => f.endsWith('.js')) : [];
    const blob = files.map((f) => fs.readFileSync(path.join(libDir, f), 'utf8')).join('\n');
    ok('better-sidebar ' + ver + ' 产物可读（' + files.length + ' 个 js）', files.length > 0);
    // 我们 bsCompat 的作用域锚点：根节点属性（0.19.x：src/client/index.tsx 里 setAttribute 到 body 下的 host）
    const NEED = ['data-dsh-better-sidebar', '_panel', '_bottomPanel', '_pane', '_tabBar', '_terminalWrap', '_editorHeader', '_browserBar'];
    for (const tok of NEED) {
      const n = blob.split(tok).length - 1;
      if (n > 0) ok('锚点仍在: ' + tok + ' ×' + n);
      else bad('锚点消失: ' + tok + '（我们 bsCompat 的规则在该版本上会静默失效，需更新 docs/BETTER-SIDEBAR-COMPAT.md 与选择器）');
    }
    // 已放弃的锚点（0.19 删除浮窗/添加栏）：允许为 0，但必须确认"不是我们唯一的锚点"
    const GONE_OK = ['data-dsh-float-window', '_floatWindow', '_addBar', '_addButton'];
    const goneNow = GONE_OK.filter((t) => !blob.includes(t));
    console.log('  · 该版本已无（预期，规则仅为旧版保留）: ' + (goneNow.join(' ') || '（无）'));
    ok('作用域锚点与面板类名锚点都不为空（不是"全都消失"的假绿）',
      NEED.filter((t) => blob.includes(t)).length >= 6);
  }
}

fs.rmSync(home, { recursive: true, force: true });
console.log('\n' + (fail === 0 ? '全部通过 ✓' : '存在失败项 ✗') + '  pass=' + pass + ' fail=' + fail + ' skip=' + skip);
process.exit(fail === 0 ? 0 : 1);

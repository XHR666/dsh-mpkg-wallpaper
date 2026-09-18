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
// ①(修正 2026-09-17 自查) **这里原来是"恒真"断言**：`ok(n, d)` 把第二参数当详情打印、条件被丢掉
//   ⇒ 28 条断言永远不会红（假绿）。现在按 (name, cond, detail) 真判：cond 为假即 fail++ 并打印 ✗。
//   同类模式在本仓库别的测试里也存在（`scene-audio-route-test` / `scene-video-test` / `transcode-limit-test`），
//   已单独派单修（见 docs/PATCHES.md 的记录）。新增断言一律用 `ok(名, 条件, 详情)` 或 `bad(...)`。
const ok = (n, cond, d) => {
  if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); }
  else { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')); }
};
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')); };
const sk = (n, d) => { skip++; console.log('  ⤼ SKIP ' + n + (d ? '  [' + d + ']' : '')); };

/* ---------- 夹具：一份"装了 better-sidebar 的 DSH_HOME" ---------- */
// ①(2026-09-17 卫生纪律) 临时目录**无论用例成功/失败/抛异常都必须清掉**（09-17 那次磁盘被
//   测试夹具塞满的教训）：注册 exit 兜底 + 每个目录建时就登记，断言中途 throw 也不留残留。
const TMP_DIRS = [];
const mkTmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TMP_DIRS.push(d); return d; };
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });
const FAKE_VER = '0.19.1';
const home = mkTmp('mpw-bs-');
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
  process.env.DSH_HOME = mkTmp('mpw-bs-none-');
  const p2 = await ping(routes);
  ok('没有装 better-sidebar 的 DSH_HOME ⇒ null（不臆造版本）', p2.json && p2.json.betterSidebarVersion === null, JSON.stringify(p2.json && p2.json.betterSidebarVersion));
  process.env.DSH_HOME = home;
}

console.log('\n== B. 变异用例：把函数名改回与局部变量同名（复现真因）⇒ 必须变红 ==');
{
  const mut = mkTmp('mpw-bs-mut-');
  // 只复制 index.js 与它的相对依赖（lib/liquid-glass/ 是目录，本机 cpSync 会 EINVAL；
  // 且变异只发生在 index.js，复制整个 lib 没有必要）。
  // ①(WP-1 2026-09-19) 依赖表要跟着源码走：`lib/web-wallpaper.js` 现在**相对 import** 了
  //   `./web-interaction.js`（①WP-2 把帧内触摸代理接进 shim）⇒ 少复制一个文件就是
  //   ERR_MODULE_NOT_FOUND（本夹具曾在 check.sh 第 10 步整段变红）。判据 = `lib/index.js` 的
  //   相对依赖闭包；改源码的相对依赖时**这里要同步**（tools/bundle-equivalence-test.mjs 的模块表同理）。
  fs.mkdirSync(path.join(mut, 'lib'), { recursive: true });
  for (const f of ['index.js', 'pkg-extract.js', 'web-interaction.js', 'web-wallpaper.js']) {
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
  //  ①(修正 2026-09-17) 只统计**选择器行**：注释里也会提到 data-dsh-float-window（规则说明），
  //  把注释算进来会让"每条都带版本门控"这条断言在真实现下假红。
  const gateLines = client.split('\n').filter((l) => /\[data-dsh-float-window\]/.test(l) && !/^\s*(\/\*|\*|\/\/)/.test(l));
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

console.log('\n== F. 底部面板悬浮适配（bsFloat）：圆角 / 裁切 / 零边距 / 无边框 + 变异对照 ==');
{
  // ①(2026-09-17 用户第 2 项「对 better-sidebar 底部面板做悬浮适配，不要再犯"边被切掉/边重复"」)
  //   真机证据：tools/probe-out/bs-bottom-{before,after,off,notours,all}.{json,txt}
  //   （探针 tools/bs-bottom-panel-probe.mjs；结论与数字见 docs/BETTER-SIDEBAR-COMPAT.md §6）。
  //   本节的断言全部是"改回旧写法就会变红"的几何纪律，而不是"规则存在"这种弱断言。
  const { loadPlugin } = await import('./_stub.mjs');
  /* ①(2026-09-17) 注意：本文件顶部的 ok(n,d) **只接收 (名字, 细节)**，不判定条件
     （`ok('x', cond, detail)` 里的 cond 会被当成 detail 打印 ⇒ 断言是"装饰性"的）。
     本节要的是"改回旧写法必须变红"，所以用严格版 assertF(cond, name, detail)。 */
  const assertF = (cond, name, detail) => ok(name, cond, detail);   // ok 现已是 (名, 条件, 详情) 真判
  const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwBsVerAt', '__mpwGlobalWired', '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss'];
  const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch {} } };
  const cssOf = (clientPath, patch) => {
    reset();
    loadPlugin({ quiet: true, clientPath, settings: { enabled: true, image: true, bsCompat: true, bsFloat: true } });
    return String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss(patch) : '') || '');
  };
  const strip = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = (css) => [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].replace(/\s+/g, ' ').trim(), body: m[2] }));
  const PANEL = (sel) => /\[data-dsh-bottom-panel\]|\[class\*="_bottomPanel"\]/.test(sel);
  const geometryProblems = (css) => {
    const rs = rules(css);
    const panelRules = rs.filter((r) => PANEL(r.sel) && !/bottomResize|panelBody/i.test(r.sel));
    return {
      panelRules,
      hasRadius: panelRules.some((r) => /border-radius\s*:\s*14px/.test(r.body)),
      hasClip: panelRules.some((r) => /overflow\s*:\s*hidden/.test(r.body)),
      // 显式归零（margin: 0 / 0px / 0 0 0 0）是允许的（覆盖宿主将来的默认外边距）；
      // 任何**非零** margin 都算"给面板加偏移"（旧写法 0 8px 8px）——这条才是判据。
      margins: panelRules.filter((r) => {
        const m = /(?:^|;)\s*margin(-[a-z]+)?\s*:\s*([^;]+)/.exec(r.body)
        if (!m) return false
        return !/^(0|0px)(\s+(0|0px))*(\s*!important)?$/.test(m[2].trim())
      }).map((r) => r.sel.slice(0, 60) + ' { margin… }'),
      // 同时要求面板根**显式**写 margin:0（不依赖宿主默认值）
      hasZeroMargin: panelRules.some((r) => /(?:^|;)\s*margin\s*:\s*0\s*(;|$)/.test(r.body)),
      offsets: panelRules.filter((r) => /(^|;)\s*(left|right)\s*:/.test(r.body)).map((r) => r.sel + ' { ' + r.body.trim() + ' }'),
      stripTop: (rs.find((r) => /bottomResize/.test(r.sel)) || {}).body || '',
      // 只看**我们 bsCompat 作用域内**的规则（header [class*="_panel"] 那组是宿主顶栏菜单，与本条无关）
      legacyLeak: rs.filter((r) => /\[data-dsh-better-sidebar\]/.test(r.sel) && /\[class\*="_panel"\]/.test(r.sel) && !(/:not\(\[class\*="_panelBody"\]\)/.test(r.sel) && /:not\(\[data-dsh-bottom-panel\]\)/.test(r.sel))).map((r) => r.sel),
      // 注意排除 border-radius（它不是"画一条边"）
      ourBorders: rs.filter((r) => /data-dsh-better-sidebar/.test(r.sel) && /(^|;)\s*border(-(top|right|bottom|left|color|style|width|image))?\s*:/.test(r.body)).map((r) => r.sel),
    };
  };

  const CLIENT = path.join(ROOT, 'lib', 'client.js');
  const css = cssOf(CLIENT, { image: true, enabled: true, bsCompat: true, bsFloat: true });
  const g = geometryProblems(css);
  assertF(g.panelRules.length > 0 && g.hasRadius,
    'F1 底部面板根规则存在，且同时挂稳定属性锚点 [data-dsh-bottom-panel] + border-radius:14px',
    'panelRules=' + g.panelRules.length + ' hasRadius=' + g.hasRadius);
  assertF(g.hasClip, 'F2 外壳 overflow:hidden（内层直角/激活胶囊由外壳圆角裁掉，圆角里不会套直角矩形）');
  assertF(g.margins.length === 0,
    'F3a ★ 面板根不得有**任何非零 margin**（旧写法 margin:0 8px 8px 会把 left 推开 8px、折叠态留 3.6px 残影）',
    g.margins.join(' | '));
  assertF(g.hasZeroMargin, 'F3b 面板根显式 margin:0（不依赖宿主默认外边距）');
  assertF(g.offsets.length === 0,
    'F4 ★ 面板根不得有 left/right 偏移（面板 left/right 由它自己的 ResizeObserver 对齐中心列）', g.offsets.join(' | '));
  assertF(/top\s*:\s*0/.test(g.stripTop),
    'F5 ★ resize strip 被挪进面板内（top:0；宿主原为 top:-4px，外壳裁切后会切掉一半 = "边被切掉"）',
    JSON.stringify(g.stripTop.replace(/\s+/g, ' ').slice(0, 90)));
  assertF(g.legacyLeak.length === 0,
    'F6 ★ 命中 [class*="_panel"] 的规则都排除了 _panelBody / 底部面板（子串会命中 nArs4W_panelBody）',
    g.legacyLeak.join(' | '));
  assertF(g.ourBorders.length === 0,
    'F7 ★ 我们的 bs 规则不画任何 border（面板上沿 1px 与 tabBar 下沿 1px 都是宿主的，避免重复边框）',
    g.ourBorders.join(' | '));
  const cssOff = cssOf(CLIENT, { image: true, enabled: true, bsCompat: true, bsFloat: false });
  assertF(!/\[data-dsh-bottom-panel\][^{]*\{[^}]*border-radius/.test(strip(cssOff)),
    'F8 bsFloat 关 ⇒ 不输出底部面板圆角/裁切几何（关了就是原样；真机对照见 bs-bottom-off.json）');
  const cssAll = cssOf(CLIENT, { image: true, enabled: true, bsCompat: true, bsFloat: true, bsReveal: true, bsAlpha: true, bsAqua: true });
  const flat = strip(cssAll);
  assertF(flat.indexOf('--dsw-alias-bg-base) 68%') > 0
    && flat.indexOf('--dsw-alias-bg-base) 68%') < flat.indexOf('background-color: var(--dsw-alias-bg-base) !important'),
    'F9 全开时仍是"后写优先"：bsAlpha 的面板底色规则出现在 bsAqua 之前（aqua 最终胜出，真机实测面板底=白）');

  // ── 变异对照（证明上面的断言有分辨力）：把源码改回"旧写法" ⇒ F3/F5/F6 必须变红 ──
  const raw = fs.readFileSync(CLIENT, 'utf8');
  let mut = raw
    .replace('\tborder-radius: 14px;\n\toverflow: hidden;\n\tmargin: 0;\n}', '\tborder-radius: 14px;\n\toverflow: hidden;\n\tmargin: 0 8px 8px;\n}')
    .replace(/\[data-dsh-better-sidebar\] \[data-dsh-bottom-panel\] > \[class\*="bottomResize"\] \{\n\ttop: 0;\n\}\n/, '')
    .replace(/\[class\*="_panel"\]\:not\(\[class\*="_panelBody"\]\)\:not\(\[data-dsh-bottom-panel\]\)/g, '[class*="_panel"]');
  if (mut === raw || !/margin: 0 8px 8px;/.test(mut) || /bottomResize"\] \{\n\ttop: 0;/.test(mut)) {
    bad('[变异自证] 未能把源码改回旧写法（闸门写法变了？同步改本用例）');
  } else {
    const TMP = mkTmp('mpw-bs-mut-');
    const mutPath = path.join(TMP, 'client-bsfloat-old.js');
    fs.writeFileSync(mutPath, mut);
    const gm = geometryProblems(cssOf(mutPath, { image: true, enabled: true, bsCompat: true, bsFloat: true }));
    assertF(gm.margins.length > 0, '（对照）旧写法下 F3 会红：面板根出现 margin', gm.margins.join(' | '));
    assertF(!/top\s*:\s*0/.test(gm.stripTop), '（对照）旧写法下 F5 会红：strip 不再被挪进面板（回到 top:-4px）');
    assertF(gm.legacyLeak.length > 0, '（对照）旧写法下 F6 会红：[class*="_panel"] 规则泄漏到 _panelBody', gm.legacyLeak.slice(0, 2).join(' | '));
  }
}

console.log('\n== E. 金丝雀：我们依赖的 DOM 锚点是否还在"已装版本"的产物里 ==');{
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
      if (n > 0) ok('锚点仍在: ' + tok, true, '×' + n);
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

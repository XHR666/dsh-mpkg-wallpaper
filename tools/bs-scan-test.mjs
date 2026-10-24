// tools/bs-scan-test.mjs —— 侧栏「扫描壁纸」页签（第一位入口）的回归门禁（2026-10-24 任务二）
//
// 四段链路任何一段断掉都是"看起来有页签、实际不能扫描/不能应用"的假绿：
//   ① 排序：order 在全部注册 tab（含内置 editor=10）中最小 ⇒ 侧栏第一位；
//   ② 扫描→展示：进入即扫（kickScan）→ 大容器网格（缩略图走 mpwThumbChildren 同一候选链）；
//   ③ 点选→应用：走与设置页同一条 mpwApplyWallFromList 管线（持久化逐键同形）；
//   ④ 空态/错误态明确 + 懒加载分页（首屏挂载节点数 < 库总数，大库不全量挂 DOM）。
// 变异自证（期望红集 == 实际红集，逐条相等）：
//   M-order  order 5→60（不再是第一位）⇒ O2、O3 必红
//   M-empty  删掉空态分支 ⇒ E1 必红
//   M-lazy   每页 24→1000（懒加载失效）⇒ S2b 必红
//   M-apply  点选应用断链（applyItem 变空操作）⇒ S3 必红
// 复现: node tools/bs-scan-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
let pass = 0, fail = 0;
const ok = (n, cond, d) => {
  if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); }
  else { fail++; console.log('  ✗ ' + n + (d ? '  → ' + d : '')); }
};

const TMP_DIRS = [];
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP_DIRS.push(d); return d; };
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const { loadPlugin, cancelWorldTimers } = await import('./_stub.mjs');
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwBsVerAt', '__mpwGlobalWired',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState', '__mpwBsScanKick'];
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k]; } catch {} } };

const SCAN_ID = 'mpkg-wallpaper:scan';
const WALL_ID = 'mpkg-wallpaper';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fake better-sidebar 服务（同 bs-tab-test 手法；可预置"内置"tab 供排序判据） */
function makeBsWorld(preseed) {
  const state = { calls: 0, registered: new Map(), lastDescriptor: null, descriptors: [], openTabLog: [] };
  const svc = {
    version: '0.28.0',
    features: ['badge', 'tabLifecycle'],
    registerTab(d) {
      if (state.registered.has(d.id)) throw new Error('[dsh-better-sidebar] tab type "' + d.id + '" already registered');
      state.calls++;
      state.lastDescriptor = d;
      state.descriptors.push(d);
      const disp = () => { state.registered.delete(d.id); };
      state.registered.set(d.id, disp);
      return disp;
    },
    openTab(seed) { state.openTabLog.push(seed && seed.type); },
  };
  if (preseed) for (const p of preseed) svc.registerTab(p);
  const effectLog = [];
  const fiberDisposers = [];
  const decorate = (ctx) => {
    ctx.effect = (fn, name) => { effectLog.push(String(name || '')); const d = fn(); if (typeof d === 'function') fiberDisposers.push(d); return d; };
    ctx.get = (n) => (n === 'betterSidebar' ? svc : undefined);
  };
  return { svc, state, effectLog, decorate };
}

/** 树工具：执行函数组件（深度≤6）+ 收集节点 */
function collectNodes(tree) {
  const nodes = [], strings = [];
  const str = (n) => {
    if (n == null) return;
    if (typeof n === 'string') { strings.push(n); return; }
    if (Array.isArray(n)) { n.forEach(str); return; }
    if (typeof n === 'object') {
      if (n.props) { for (const v of Object.values(n.props)) if (typeof v === 'string') strings.push(v); }
      if (n.kids) str(n.kids);
    }
  };
  const walk = (n, d) => {
    if (n == null || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach((x) => walk(x, d)); return; }
    if (n.props) nodes.push(n.props);
    if (typeof n.type === 'function' && d < 6) { try { walk(n.type(Object.assign({ t: (k) => k }, n.props || {})), d + 1); } catch {} return; }
    if (n.kids) walk(n.kids, d);
  };
  walk(tree, 0);
  str(tree);
  return { nodes, strings };
}

/** 30 项 Steam 视频库夹具（/steam-inventory 应答） */
const steamLib = (n) => ({ ok: true, installDir: '/steam', wallpapers: Array.from({ length: n }, (_, i) => ({
  ltoken: 'lt' + i, title: 'Wall ' + i, type: 'video', media: 'videos/bg' + i + '.mp4', preview: 'preview.jpg',
})) });
const fetchFor = (payload) => async (url) => {
  const u = String(url);
  if (u.indexOf('/steam-inventory') >= 0) return { ok: true, status: 200, json: async () => (payload && payload.steam !== undefined) ? payload.steam : steamLib(30) };
  if (u.indexOf('/custom-dir') >= 0) return { ok: true, status: 200, json: async () => (payload && payload.custom !== undefined) ? payload.custom : { ok: false, error: 'no-dir' } };
  return { ok: false, status: 404, json: async () => ({}) };
};

/** 渲染扫描页签：返回 { r, tree, nodes, strings, kick, d }（stub effect 不跑 ⇒ 扫描用 kick 驱动） */
function renderScan(world, opts2 = {}) {
  reset();
  const w = world || makeBsWorld();
  const opts = { quiet: true, ctxDecorate: (ctx) => { w.decorate(ctx); ctx.locale.bind = () => (k) => ((w.dicts && w.dicts.zh && w.dicts.zh[k] !== undefined) ? w.dicts.zh[k] : k); } };
  if (opts2.fetch) opts.fetch = opts2.fetch;
  if (opts2.settings) opts.settings = opts2.settings;
  const r = loadPlugin(opts);
  const d = w.state.descriptors.find((x) => x.id === SCAN_ID);
  if (!d) return { r, w, crashed: true };
  const render = () => {
    let tree = null;
    try { tree = d.component({ ctx: r.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: SCAN_ID }, visible: true }); }
    catch (e) { return { crashed: true }; }
    const c = collectNodes(tree);
    return { tree, nodes: c.nodes, strings: c.strings };
  };
  w.dicts = r.localeDicts;
  const first = render();
  return Object.assign({ r, w, d, render, kick: globalThis.__mpwBsScanKick, crashed: !!first.crashed }, first);
}

console.log('\n== O. 排序：扫描页签 order 最小（侧栏第一位）==');
{
  reset();
  const w = makeBsWorld([
    { id: 'editor', title: () => 'editor', order: 10, component: () => null },
    { id: 'git', title: () => 'git', order: 20, component: () => null },
  ]);
  loadPlugin({ quiet: true, ctxDecorate: w.decorate });
  const ds = w.state.descriptors;
  const scanD = ds.find((x) => x.id === SCAN_ID);
  const wallD = ds.find((x) => x.id === WALL_ID);
  ok('O1 扫描页签已注册且 order 数值', !!scanD && typeof scanD.order === 'number', scanD ? 'order=' + scanD.order : 'd=null');
  ok('O2 扫描 order < 壁纸 order（插件内第一位）',
    !!scanD && !!wallD && scanD.order < wallD.order, 'scan=' + (scanD && scanD.order) + ' wall=' + (wallD && wallD.order));
  const all = [{ id: 'editor', order: 10 }, { id: 'git', order: 20 }].concat(ds.map((d) => ({ id: d.id, order: d.order })));
  const sorted = all.slice().sort((a, b) => a.order - b.order);
  ok('O3 全部注册 tab（含内置 editor=10/git=20）按 order 排序后第一位是扫描页签',
    sorted[0] && sorted[0].id === SCAN_ID, JSON.stringify(sorted.slice(0, 3)));
}

console.log('\n== S. 扫描→展示→点选应用（桩环境全链路）==');
{
  const s = renderScan(null, { fetch: fetchFor(null), settings: { enabled: true, customDirPath: '' } });
  const zh = s.r.localeDicts.zh;
  ok('S1 未扫描：重扫按钮在树（进入即扫由 visible 驱动，桩里用 kick）',
    !s.crashed && s.nodes.some((p) => p && p['data-mpw-scan-rescan'] !== undefined && typeof p.onClick === 'function'),
    s.crashed ? 'crashed' : 'ok');
  ok('S1b 骨架/标题在树', (s.strings || []).some((x) => String(x).indexOf(zh['bsScan.title']) >= 0), (s.strings || []).slice(0, 60).join('|').slice(0, 80));

  console.log('  -- S2 kickScan ⇒ 大容器网格（首屏 24 < 库 30，懒加载生效）--');
  let kicked = false;
  try { s.kick(); kicked = true; } catch (e) {}
  await sleep(120);
  const t2 = s.render();
  const items = t2.nodes.filter((p) => p && typeof p['data-mpw-scan-item'] === 'string');
  ok('S2 扫描完成：30 项库在网格里出前 24 项（每项带 key 标记）',
    kicked && !t2.crashed && items.length === 24 && items[0]['data-mpw-scan-item'] === 'steam|lt0',
    'items=' + items.length + ' first=' + (items[0] && items[0]['data-mpw-scan-item']));
  ok('S2b 懒加载：首屏挂载节点数(24) < 库总数(30)，且「继续展开」按钮在树（含剩余数）',
    items.length < 30 && (t2.nodes || []).some((p) => p && p['data-mpw-scan-more'] !== undefined)
      && (t2.strings || []).some((x) => String(x).indexOf('（6）') >= 0),
    'mounted=' + items.length);
  ok('S2c 缩略图走同一候选链（每项都有 data-mpw-thumb-box）',
    t2.nodes.filter((p) => p && p['data-mpw-thumb-box'] !== undefined).length >= 24,
    'thumbs=' + t2.nodes.filter((p) => p && p['data-mpw-thumb-box'] !== undefined).length);

  console.log('  -- S3 点选应用 ⇒ 走统一应用管线（持久化逐键同形）--');
  const useBtn = t2.nodes.find((p) => p && typeof p['data-mpw-scan-use'] === 'string' && typeof p.onClick === 'function');
  try { useBtn.onClick(); } catch (e) {}
  await sleep(3600);   // 等 boot 收尾闸门（3.5s）放行落盘
  const stored = JSON.parse(s.r.ctx ? (globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}') : '{}');
  ok('S3 应用后持久化 = 库项身份（mpkgKey=library|<ltoken>、converted=mp4、image=host:?ltoken=…）',
    stored.mpkgKey === 'library|lt0' && stored.converted === 'mp4' && String(stored.image || '').indexOf('host:?ltoken=lt0&file=') === 0,
    'mpkgKey=' + stored.mpkgKey + ' converted=' + stored.converted + ' image=' + String(stored.image || '').slice(0, 60));

  console.log('  -- S4 「继续展开」⇒ 余量挂载（分页真实可翻）--');
  const moreBtn = t2.nodes.find((p) => p && p['data-mpw-scan-more'] !== undefined && typeof p.onClick === 'function');
  try { moreBtn.onClick(); } catch (e) {}
  const t4 = s.render();
  const items4 = t4.nodes.filter((p) => p && typeof p['data-mpw-scan-item'] === 'string');
  ok('S4 展开后 30 项全挂且「继续展开」退场', items4.length === 30 && !t4.nodes.some((p) => p && p['data-mpw-scan-more'] !== undefined),
    'items=' + items4.length);
}

console.log('\n== E. 空态 / 错误态 ==');
{
  const e1 = renderScan(null, { fetch: fetchFor({ steam: { ok: true, wallpapers: [] } }), settings: { enabled: true, customDirPath: '' } });
  try { e1.kick(); } catch (err) {}
  await sleep(80);
  const t1 = e1.render();
  ok('E1 空结果 ⇒ 明确空态（data-mpw-scan-empty + bsScan.empty 文案）',
    t1.nodes.some((p) => p && p['data-mpw-scan-empty'] !== undefined)
      && (t1.strings || []).some((x) => String(x).indexOf(e1.r.localeDicts.zh['bsScan.empty']) >= 0),
    (t1.strings || []).slice(0, 80).join('|').slice(0, 100));

  const e2 = renderScan(null, { fetch: async () => { throw new Error('host down'); }, settings: { enabled: true, customDirPath: '' } });
  try { e2.kick(); } catch (err) {}
  await sleep(80);
  const t2e = e2.render();
  ok('E2 扫描失败 ⇒ 明确错误态（data-mpw-scan-err + 文案 + 重试入口仍在）',
    t2e.nodes.some((p) => p && p['data-mpw-scan-err'] !== undefined)
      && (t2e.strings || []).some((x) => String(x).indexOf(e2.r.localeDicts.zh['bsScan.err']) >= 0)
      && t2e.nodes.some((p) => p && p['data-mpw-scan-rescan'] !== undefined),
    'err-line=' + t2e.nodes.some((p) => p && p['data-mpw-scan-err'] !== undefined));
}

console.log('\n== W. 网页壁纸确认（点选 web 项 ⇒ 先确认再落盘）==');
{
  const s = renderScan(null, { fetch: fetchFor({ steam: { ok: true, wallpapers: [
    { ltoken: 'w1', title: 'Webby', type: 'web', media: 'index.html', webHeavy: false, webExternal: false },
  ] } }), settings: { enabled: true, customDirPath: '' } });
  try { s.kick(); } catch (e) {}
  await sleep(120);
  const t = s.render();
  const useBtn = t.nodes.find((p) => p && typeof p['data-mpw-scan-use'] === 'string' && typeof p.onClick === 'function');
  try { useBtn.onClick(); } catch (e) {}
  const t2 = s.render();
  const confirm = t2.nodes.some((p) => p && p['data-mpw-scan-webconfirm'] !== undefined);
  ok('W1 点 web 项 ⇒ 先出确认面板（不直接落盘）',
    confirm, 'confirm=' + confirm);
  const goBtn2 = (t2.nodes.find((p) => p && p.className === 'mpw_button' && typeof p.onClick === 'function'));
  try { goBtn2.onClick(); } catch (e) {}
  await sleep(3600);
  const stored = JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}');
  ok('W2 确认后落盘：converted=web + 默认沙箱通道（&shim=1）',
    stored.converted === 'web' && String(stored.webUrl || '').indexOf('host:?ltoken=w1&web=1&file=index.html&shim=1') === 0,
    'webUrl=' + String(stored.webUrl || '').slice(0, 80));
}

console.log('\n== I. i18n（zh/en 两表 bsScan.* 键集逐键相等 + 渲染期取词）==');
{
  reset();
  const w = makeBsWorld();
  const r = loadPlugin({ quiet: true, ctxDecorate: w.decorate });
  const dicts = r.localeDicts;
  const KEYS = ['bsScan.title', 'bsScan.desc', 'bsScan.rescan', 'bsScan.scanning', 'bsScan.count', 'bsScan.empty',
    'bsScan.err', 'bsScan.applied', 'bsScan.webConfirm', 'bsScan.webGo', 'bsScan.webGoCompat', 'bsScan.webCancel'];
  const missZh = KEYS.filter((k) => !dicts || !dicts.zh || typeof dicts.zh[k] !== 'string' || !dicts.zh[k]);
  const missEn = KEYS.filter((k) => !dicts || !dicts.en || typeof dicts.en[k] !== 'string' || !dicts.en[k]);
  ok('I1 zh 表 12 个 bsScan.* 键全部非空', missZh.length === 0, JSON.stringify(missZh));
  ok('I2 en 表 12 个 bsScan.* 键全部非空', missEn.length === 0, JSON.stringify(missEn));
  ok('I3 zh/en 键集逐键相等（一边漏键必红）', missZh.length === 0 && missEn.length === 0
    && KEYS.every((k) => dicts.zh[k] !== undefined && dicts.en[k] !== undefined), '');
  const scanD = w.state.descriptors.find((x) => x.id === SCAN_ID);
  ok('I4 描述符 title()/description() 渲染期按词典取词',
    !!scanD && scanD.title() === dicts.zh['bsScan.title'] && scanD.description() === dicts.zh['bsScan.desc'],
    scanD ? 'title=' + scanD.title() : 'd=null');
}

/* ---------- 变异自证（隔离副本；锚点必须恰好替换一次且旧串不再存在 —— R2） ---------- */
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');

async function withMutant(id, what, pairs, expectRed, runGroup) {
  const dir = mkTmp('mpw-bs-scan-mut-');
  const f = path.join(dir, 'client.js');
  let mutated = src0;
  const applied = [];
  for (const [anchor, replacement] of pairs) {
    const n = mutated.split(anchor).length - 1;
    const next = mutated.replace(anchor, replacement);
    const okApply = n === 1 && next !== mutated && !next.includes(anchor);
    applied.push(okApply);
    mutated = next;
  }
  fs.writeFileSync(f, mutated);
  reset();
  let red = [];
  try { red = await runGroup(f); } catch (e) { red = ['THROW:' + String(e && e.message || e).slice(0, 60)]; }
  const eq = applied.every(Boolean) && JSON.stringify(red.slice().sort()) === JSON.stringify(expectRed.slice().sort());
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-MISMATCH') + ' ' + id + ' ' + what);
  console.log('    期望红集=' + JSON.stringify(expectRed.slice().sort()) + ' 实际红集=' + JSON.stringify(red.slice().sort())
    + ' 变异生效=' + JSON.stringify(applied));
  if (!eq) fail++; else pass++;
}

console.log('\n== M. 变异自证（期望红集 == 实际红集，逐条相等）==');

// M-order：order 5→60 ⇒ 不再小于内置 editor(10)/壁纸(50) ⇒ O2、O3 红
await withMutant('M-order', 'order 5→60（扫描页签不再第一位）',
  [['const MPW_BS_SCAN_ORDER = 5;', 'const MPW_BS_SCAN_ORDER = 60; /* M-order */']], ['O2', 'O3'],
  async (f) => {
    const red = [];
    reset();
    const w = makeBsWorld([{ id: 'editor', title: () => 'editor', order: 10, component: () => null }]);
    loadPlugin({ quiet: true, clientPath: f, ctxDecorate: w.decorate });
    const ds = w.state.descriptors;
    const scanD = ds.find((x) => x.id === SCAN_ID), wallD = ds.find((x) => x.id === WALL_ID);
    if (!(!!scanD && !!wallD && scanD.order < wallD.order)) red.push('O2');
    const all = [{ id: 'editor', order: 10 }].concat(ds.map((d) => ({ id: d.id, order: d.order })));
    const sorted = all.slice().sort((a, b) => a.order - b.order);
    if (!(sorted[0] && sorted[0].id === SCAN_ID)) red.push('O3');
    return red;
  });

// M-empty：删掉空态分支 ⇒ E1 红（空结果必须有明确空态）
await withMutant('M-empty', '删掉空态分支（空结果没有提示）',
  [['rows.push(h("div", { key: "empty", className: "mpw_hint", "data-mpw-scan-empty": "" }, t("bsScan.empty")));', '/* M-empty */']], ['E1'],
  async (f) => {
    const red = [];
    reset();
    const w = makeBsWorld();
    const r = loadPlugin({ quiet: true, clientPath: f, ctxDecorate: w.decorate, fetch: fetchFor({ steam: { ok: true, wallpapers: [] } }), settings: { enabled: true, customDirPath: '' } });
    const scanD = w.state.descriptors.find((x) => x.id === SCAN_ID);
    const render = () => { try { return collectNodes(scanD.component({ ctx: r.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: SCAN_ID }, visible: true })); } catch (e) { return { nodes: [], strings: [] }; } };
    try { globalThis.__mpwBsScanKick(); } catch (e) {}
    await sleep(80);
    const t = render();
    if (!(t.nodes.some((p) => p && p['data-mpw-scan-empty'] !== undefined)
      && (t.strings || []).some((x) => String(x).indexOf(r.localeDicts.zh['bsScan.empty']) >= 0))) red.push('E1');
    return red;
  });

// M-lazy：每页 24→1000 ⇒ 首屏挂载节点数 == 总数 ⇒ 懒加载判据 S2b 红
await withMutant('M-lazy', '每页 24→1000（懒加载失效、大库全量挂载）',
  [['const MPW_SCAN_PAGE = 24;', 'const MPW_SCAN_PAGE = 1000; /* M-lazy */']], ['S2b'],
  async (f) => {
    const red = [];
    reset();
    const w = makeBsWorld();
    const r = loadPlugin({ quiet: true, clientPath: f, ctxDecorate: w.decorate, fetch: fetchFor(null), settings: { enabled: true, customDirPath: '' } });
    const scanD = w.state.descriptors.find((x) => x.id === SCAN_ID);
    const render = () => { try { return collectNodes(scanD.component({ ctx: r.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: SCAN_ID }, visible: true })); } catch (e) { return { nodes: [], strings: [] }; } };
    try { globalThis.__mpwBsScanKick(); } catch (e) {}
    await sleep(120);
    const t = render();
    const items = t.nodes.filter((p) => p && typeof p['data-mpw-scan-item'] === 'string');
    if (!(items.length < 30 && (t.nodes || []).some((p) => p && p['data-mpw-scan-more'] !== undefined))) red.push('S2b');
    return red;
  });

// M-apply：点选应用断链（applyItem 变空操作）⇒ S3 红（点了"使用"但档里没有库项身份）
await withMutant('M-apply', '点选应用断链（applyItem 变空操作）',
  [['try { mpwApplyWallFromList(w, scanUi); } catch (e) { mpwErr("bsScan(apply)", e); }', '/* M-apply */']], ['S3'],
  async (f) => {
    const red = [];
    reset();
    const w = makeBsWorld();
    const r = loadPlugin({ quiet: true, clientPath: f, ctxDecorate: w.decorate, fetch: fetchFor(null), settings: { enabled: true, customDirPath: '' } });
    const scanD = w.state.descriptors.find((x) => x.id === SCAN_ID);
    const render = () => { try { return collectNodes(scanD.component({ ctx: r.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: SCAN_ID }, visible: true })); } catch (e) { return { nodes: [], strings: [] }; } };
    try { globalThis.__mpwBsScanKick(); } catch (e) {}
    await sleep(120);
    const t = render();
    const useBtn = t.nodes.find((p) => p && typeof p['data-mpw-scan-use'] === 'string' && typeof p.onClick === 'function');
    try { useBtn.onClick(); } catch (e) {}
    await sleep(3600);
    const stored = JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}');
    if (!(stored.mpkgKey === 'library|lt0' && stored.converted === 'mp4')) red.push('S3');
    return red;
  });

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

// tools/bs-scan-test.mjs —— 「壁纸」页签内部「扫描壁纸」面板的回归门禁（2026-10-25 纠正版）
//
// 契约（2026-10-25 任务纠正）：扫描入口不再是独立侧栏页签，而是侧栏「壁纸」页签内部 tab 栏
// 第一位的面板（设置页那份不渲染）。四段链路任何一段断掉都是"看起来有扫描、实际不能用"的假绿：
//   ① 内部 tab 顺序：侧栏版本 scan 第一位且默认选中；设置页版本不含 scan（bs-tab-test D/E 也有，
//      这里从"扫描面板"角度再钉一次顺序数组与面板落点）；
//   ② 扫描目标优先级：已选自定义本地目录 ⇒ **只扫它**（/custom-dir）；未选 ⇒ 只扫本地 WE 库
//      （/steam-inventory）——桩 fetch 记录 URL 断言取数来源，两边都扫 = 旧错误实现必红；
//   ③ 扫描→展示→点选应用：进入即扫（kickScan）→ 网格墙（缩略图走 mpwThumbChildren 同一候选链）
//      → 点选走与设置页同一条 mpwApplyWallFromList 管线（持久化逐键同形）；
//   ④ 懒加载无门槛：首屏挂载 < 库总数；**没有「继续展开」按钮**；滚到底（续页到稳定）=
//      全部结果可达；空态/错误态明确 + 重扫入口。
// 变异自证（期望红集 == 实际红集，逐条相等）：
//   M-order    内部 tab 顺序改错（scan 不在首位）⇒ O2 必红
//   M-priority 优先级打掉（始终扫 WE 库）⇒ P1、P2 必红
//   M-empty    删掉空态分支 ⇒ E1 必红
//   M-lazy     每页 24→1000（懒加载失效）⇒ S2b 必红
//   M-scroll   续页断链（每次 +0）⇒ S4 必红
//   M-apply    点选应用断链 ⇒ S3 必红
//   M-dir      目录记账断链（kickScan 不记录实际取数来源）⇒ D1、D2 必红
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
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState', '__mpwBsScanKick', '__mpwBsScanMore'];
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k]; } catch {} } };

const WALL_ID = 'mpkg-wallpaper';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fake better-sidebar 服务（同 bs-tab-test 手法） */
function makeBsWorld() {
  const state = { calls: 0, registered: new Map(), lastDescriptor: null, descriptors: [] };
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
  };
  const decorate = (ctx) => {
    ctx.effect = (fn, name) => { const d = fn(); return d; };
    ctx.get = (n) => (n === 'betterSidebar' ? svc : undefined);
  };
  return { svc, state, decorate };
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
/** 40 项自定义目录夹具（/custom-dir 应答） */
const customLib = (n) => ({ ok: true, files: Array.from({ length: n }, (_, i) => ({
  name: 'clip' + i + '.mp4', type: 'video', media: 'clip' + i + '.mp4', preview: '',
})) });
const fetchFor = (payload) => async (url) => {
  const u = String(url);
  if (u.indexOf('/steam-inventory') >= 0) return { ok: true, status: 200, json: async () => (payload && payload.steam !== undefined) ? payload.steam : steamLib(30) };
  if (u.indexOf('/custom-dir') >= 0) return { ok: true, status: 200, json: async () => (payload && payload.custom !== undefined) ? payload.custom : customLib(40) };
  return { ok: false, status: 404, json: async () => ({}) };
};

/** 渲染侧栏「壁纸」页签（内含内部 scan 面板）：返回 render()/kick()/more() 读数。
 *  桩 effect 不跑 ⇒ 扫描用 kick 驱动、续页用 more 驱动（与生产同一函数：__mpwBsScanMore）。 */
function renderWall(world, opts2 = {}) {
  reset();
  const w = world || makeBsWorld();
  const opts = { quiet: true, ctxDecorate: (ctx) => { w.decorate(ctx); ctx.locale.bind = () => (k) => ((w.dicts && w.dicts.zh && w.dicts.zh[k] !== undefined) ? w.dicts.zh[k] : k); } };
  if (opts2.fetch) opts.fetch = opts2.fetch;
  if (opts2.settings) opts.settings = opts2.settings;
  const r = loadPlugin(opts);
  w.dicts = r.localeDicts;
  const d = w.state.descriptors.find((x) => x.id === WALL_ID);
  if (!d) return { r, w, crashed: true };
  const render = () => {
    let tree = null;
    try { tree = d.component({ ctx: r.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: WALL_ID }, visible: true }); }
    catch (e) { return { crashed: true }; }
    const c = collectNodes(tree);
    return { tree, nodes: c.nodes, strings: c.strings };
  };
  const first = render();
  const items = () => first.nodes.length >= 0 ? null : null; // 占位（读数走每次 render 的返回值）
  return Object.assign({ r, w, d, render, kick: globalThis.__mpwBsScanKick, more: globalThis.__mpwBsScanMore, crashed: !!first.crashed, items }, first);
}
/** 数当前树里挂载的扫描结果项 */
const countItems = (t) => t.nodes.filter((p) => p && typeof p['data-mpw-scan-item'] === 'string');

console.log('\n== O. 内部 tab 顺序：scan 第一位（侧栏版本）+ 设置页不含 scan ==');
{
  reset();
  const w = makeBsWorld();
  const r = loadPlugin({ quiet: true, ctxDecorate: (ctx) => { w.decorate(ctx); ctx.locale.bind = () => (k) => ((w.dicts && w.dicts.zh && w.dicts.zh[k] !== undefined) ? w.dicts.zh[k] : k); } });
  w.dicts = r.localeDicts;
  const zhDicts = r.localeDicts.zh;
  const d = w.state.descriptors.find((x) => x.id === WALL_ID);
  let tree = null;
  try { tree = d.component({ ctx: r.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: WALL_ID }, visible: true }); } catch (e) {}
  // tab 栏按钮序：data-mpw-tabbar 的按钮 kids（scan 按钮带 data-mpw-tab-scan；其余按标签文本）
  const bar = (() => { let hit = null; const f = (n, dd) => { if (hit || n == null || typeof n !== 'object' || dd > 8) return; if (Array.isArray(n)) { n.forEach((x) => f(x, dd)); return; } if (n.props && n.props['data-mpw-tabbar'] !== undefined) { hit = n; return; } if (n.kids) f(n.kids, dd); }; f(tree, 0); return hit; })();
  const labelOf = (b) => (b.props && b.props['data-mpw-tab-scan'] !== undefined) ? 'scan' : (b.kids && typeof b.kids[0] === 'string' ? b.kids[0] : '?');
  const tabKeys = bar && Array.isArray(bar.kids) ? bar.kids.filter(Boolean).map(labelOf) : [];
  const row = (() => { let hit = null; const f = (n, dd) => { if (hit || n == null || typeof n !== 'object' || dd > 9) return; if (Array.isArray(n)) { n.forEach((x) => f(x, dd)); return; } if (n.props && n.props.className === 'mpw_tabRow') { hit = n; return; } if (n.kids) f(n.kids, dd); }; f(tree, 0); return hit; })();
  const panelKeys = row && Array.isArray(row.kids) ? row.kids.filter(Boolean).map((p) => p.props && p.props['data-mpw-tabkey']) : [];
  const EXPECT_LABELS = ['scan', zhDicts['sec.source'], zhDicts['sec.wallpaper'], zhDicts['sec.appearance'], zhDicts['sec.unify'], zhDicts['sec.blur'], zhDicts['sec.other'], zhDicts['sec.liquid']];
  const EXPECT_KEYS = ['scan', 'source', 'wallpaper', 'appearance', 'unify', 'blur', 'other', 'liquid'];
  ok('O1 内部 tab 栏按钮顺序数组首项 == scan（判据断言顺序数组）',
    JSON.stringify(tabKeys) === JSON.stringify(EXPECT_LABELS),
    'tabs=' + JSON.stringify(tabKeys));
  ok('O2 内容面板键序同源同序（首项 scan + 扫描面板体在树）',
    JSON.stringify(panelKeys) === JSON.stringify(EXPECT_KEYS)
      && collectNodes(tree).nodes.some((p) => p && p['data-mpw-bs-scan'] !== undefined), 'panels=' + JSON.stringify(panelKeys));

  reset();
  const b0tree = loadPlugin({ quiet: true, settings: { enabled: true } }).sectionComp({ t: (k) => k, close: () => {} });   // 设置页（无 bs world）
  const rowS = (() => { let hit = null; const f = (n, dd) => { if (hit || n == null || typeof n !== 'object' || dd > 9) return; if (Array.isArray(n)) { n.forEach((x) => f(x, dd)); return; } if (n.props && n.props.className === 'mpw_tabRow') { hit = n; return; } if (n.kids) f(n.kids, dd); }; f(b0tree, 0); return hit; })();
  const panelKeysS = rowS && Array.isArray(rowS.kids) ? rowS.kids.filter(Boolean).map((p) => p.props && p.props['data-mpw-tabkey']) : [];
  ok('O3 设置页内部 tab 列表 == 原 7 项（不含 scan）',
    JSON.stringify(panelKeysS) === JSON.stringify(['source', 'wallpaper', 'appearance', 'unify', 'blur', 'other', 'liquid']),
    'panels=' + JSON.stringify(panelKeysS));
}

console.log('\n== P. 扫描目标优先级：已选自定义目录 ⇒ 只扫它；未选 ⇒ 只扫 WE 库（桩断言取数来源）==');
{
  // P1/P2：已选自定义目录（customDirPath 非空）⇒ fetch 只打 /custom-dir，绝不打 /steam-inventory
  const urls = [];
  const s1 = renderWall(null, {
    fetch: async (url, o) => { urls.push(String(url)); const body = (o && o.body) ? JSON.parse(o.body) : {}; return { ok: true, status: 200, json: async () => (String(url).indexOf('/custom-dir') >= 0) ? customLib(40) : steamLib(30) }; },
    settings: { enabled: true, customDirPath: '/data/wallpapers' },
  });
  try { s1.kick(); } catch (e) {}
  await sleep(120);
  const t1 = s1.render();
  const items1 = countItems(t1);
  ok('P1 已选自定义目录 ⇒ 扫描取数只来自 /custom-dir（40 项全部入列）',
    urls.some((u) => u.indexOf('/custom-dir') >= 0) && items1.length > 0 && items1[0]['data-mpw-scan-item'] === 'custom|clip0.mp4'
      && items1.length === 24,
    'urls=' + JSON.stringify(urls) + ' items=' + items1.length + ' first=' + (items1[0] && items1[0]['data-mpw-scan-item']));
  ok('P2 已选自定义目录 ⇒ 绝不扫 /steam-inventory（旧"两边都扫"实现在此必红）',
    urls.every((u) => u.indexOf('/steam-inventory') < 0), 'urls=' + JSON.stringify(urls));

  // P3：未选自定义目录 ⇒ 只扫 /steam-inventory
  const urls3 = [];
  const s3 = renderWall(null, {
    fetch: async (url) => { urls3.push(String(url)); return { ok: true, status: 200, json: async () => steamLib(30) }; },
    settings: { enabled: true, customDirPath: '' },
  });
  try { s3.kick(); } catch (e) {}
  await sleep(120);
  const t3 = s3.render();
  ok('P3 未选自定义目录 ⇒ 只扫 WE 库（/steam-inventory；且不空跑 /custom-dir）',
    urls3.some((u) => u.indexOf('/steam-inventory') >= 0) && urls3.every((u) => u.indexOf('/custom-dir') < 0)
      && countItems(t3).length === 24 && countItems(t3)[0]['data-mpw-scan-item'] === 'steam|lt0',
    'urls=' + JSON.stringify(urls3));

  // P4：自定义目录不可读 ⇒ 明确错误态 + 重扫入口（不静默失败）
  const s4 = renderWall(null, {
    fetch: fetchFor({ custom: { ok: false, error: 'no-such-dir' } }),
    settings: { enabled: true, customDirPath: '/not/readable' },
  });
  try { s4.kick(); } catch (e) {}
  await sleep(120);
  const t4 = s4.render();
  ok('P4 目录不可读 ⇒ 明确错误态（data-mpw-scan-err + 文案）且重扫入口仍在',
    t4.nodes.some((p) => p && p['data-mpw-scan-err'] !== undefined)
      && (t4.strings || []).some((x) => String(x).indexOf(s4.r.localeDicts.zh['bsScan.err']) >= 0)
      && t4.nodes.some((p) => p && p['data-mpw-scan-rescan'] !== undefined),
    'err=' + t4.nodes.some((p) => p && p['data-mpw-scan-err'] !== undefined));
}

console.log('\n== D. 当前目录显示（标题上方；显示值 == 实际取数来源；2026-10-25 任务 1.1）==');
{
  // 树里找 data-mpw-scan-dir 行，取路径 span 的文本（走原始元素树——kids 在元素上，不在 props 上）
  const dirRowOf = (t) => {
    const tree = t.tree !== undefined ? t.tree : t;
    let hit = null;
    const find = (n, dd) => {
      if (hit || n == null || typeof n !== 'object' || dd > 12) return;
      if (Array.isArray(n)) { n.forEach((x) => find(x, dd)); return; }
      if (n.props && n.props['data-mpw-scan-dir'] !== undefined) { hit = n; return; }
      if (n.kids) find(n.kids, dd + 1);
    };
    find(tree, 0);
    if (!hit || !Array.isArray(hit.kids)) return null;
    const v = hit.kids.find((k) => k && typeof k === 'object' && k.props && k.props.className === 'mpw_scanDirPath');
    return v ? { text: typeof v.kids[0] === 'string' ? v.kids[0] : '', title: v.props.title } : null;
  };

  // D1：已选自定义目录 ⇒ 显示值 == /custom-dir 请求体里的 dir（同一来源，两处各自算必红）
  const urlsD1 = [];
  const s1 = renderWall(null, {
    fetch: async (url, o) => { urlsD1.push({ url: String(url), body: (o && o.body) ? JSON.parse(o.body) : {} }); return { ok: true, status: 200, json: async () => (String(url).indexOf('/custom-dir') >= 0) ? customLib(4) : steamLib(2) }; },
    settings: { enabled: true, customDirPath: '/data/wallpapers' },
  });
  try { s1.kick(); } catch (e) {}
  await sleep(120);
  const t1 = s1.render();
  const row1 = dirRowOf(t1);
  const reqDir = (urlsD1.find((u) => u.url.indexOf('/custom-dir') >= 0) || {}).body;
  ok('D1 显示值 == /custom-dir 请求 dir（显示层不另算）',
    row1 && row1.text === '/data/wallpapers' && reqDir && reqDir.dir === '/data/wallpapers',
    'row=' + JSON.stringify(row1) + ' req=' + JSON.stringify(reqDir));
  ok('D1b 长路径有 title 全路径兜底（title 属性 == 显示值）', row1 && row1.title === '/data/wallpapers', 'title=' + (row1 && row1.title));

  // D2：未选自定义目录 ⇒ 显示 /steam-inventory 应答的 installDir（同一份应答，不另推）
  const s2 = renderWall(null, { fetch: fetchFor({ steam: { ok: true, installDir: '/games/Steam/wallpaper_engine', wallpapers: [] } }), settings: { enabled: true, customDirPath: '' } });
  try { s2.kick(); } catch (e) {}
  await sleep(120);
  const row2 = dirRowOf(s2.render());
  ok('D2 WE 库分支显示 installDir（与扫描同一应答）',
    row2 && row2.text === '/games/Steam/wallpaper_engine', 'row=' + JSON.stringify(row2));

  // D3：installDir 为 null ⇒ 明确"未找到"文案（不显示空串/undefined）
  const s3 = renderWall(null, { fetch: fetchFor({ steam: { ok: true, installDir: null, wallpapers: [] } }), settings: { enabled: true, customDirPath: '' } });
  try { s3.kick(); } catch (e) {}
  await sleep(120);
  const row3 = dirRowOf(s3.render());
  ok('D3 未发现库目录 ⇒ bsScan.dirNone 文案（不落 undefined）',
    row3 && row3.text === s3.r.localeDicts.zh['bsScan.dirNone'] && row3.text.indexOf('undefined') < 0, 'row=' + JSON.stringify(row3));

  // D4：目录变更后重开即变（"重开" = 重新加载面板 ⇒ 重读档重扫；桩里 = 新世界各自 seed 自己的档）
  const fetchD4 = async (url, o) => {
    const body = (o && o.body) ? JSON.parse(o.body) : {};
    return { ok: true, status: 200, json: async () => (String(url).indexOf('/custom-dir') >= 0)
      ? { ok: true, files: [{ name: 'd-' + body.dir + '.mp4', type: 'video', media: 'x.mp4', preview: '' }] }
      : steamLib(2) };
  };
  const s4a = renderWall(null, { fetch: fetchD4, settings: { enabled: true, customDirPath: '/data/first' } });
  try { s4a.kick(); } catch (e) {}
  await sleep(100);
  const first = dirRowOf(s4a.render());
  const s4b = renderWall(null, { fetch: fetchD4, settings: { enabled: true, customDirPath: '/data/second' } });
  try { s4b.kick(); } catch (e) {}
  await sleep(100);
  const second = dirRowOf(s4b.render());
  ok('D4 目录变更后重开 ⇒ 显示跟着变（不缓存旧值）',
    first && first.text === '/data/first' && second && second.text === '/data/second',
    'first=' + JSON.stringify(first) + ' second=' + JSON.stringify(second));

  // D5：重扫入口/复制按钮在树（复制按钮为可选件，存在即可；不断言剪贴板行为——无浏览器）
  ok('D5 目录行不再有「复制路径」按钮（2026-11-01 用户要求移除）', !(t1.nodes || []).some((p) => p && p['data-mpw-scan-dir-copy'] !== undefined), '');
}

console.log('\n== S. 扫描→展示→点选应用（桩环境全链路；经侧栏「壁纸」页签渲染）==');
{
  const s = renderWall(null, { fetch: fetchFor(null), settings: { enabled: true, customDirPath: '' } });
  const zh = s.r.localeDicts.zh;
  ok('S1 未扫描：重扫按钮在树（进入即扫由 visible 驱动，桩里用 kick）',
    !s.crashed && s.nodes.some((p) => p && p['data-mpw-scan-rescan'] !== undefined && typeof p.onClick === 'function'),
    s.crashed ? 'crashed' : 'ok');
  ok('S1b 标题/内部 tab 标签在树', (s.strings || []).some((x) => String(x).indexOf(zh['bsScan.title']) >= 0), (s.strings || []).slice(0, 60).join('|').slice(0, 80));

  console.log('  -- S2 kickScan ⇒ 网格墙（首屏 24 < 库 30，懒加载生效）--');
  let kicked = false;
  try { s.kick(); kicked = true; } catch (e) {}
  await sleep(120);
  const t2 = s.render();
  const items = countItems(t2);
  ok('S2 扫描完成：30 项库在网格里出前 24 项（每项带 key 标记）',
    kicked && !t2.crashed && items.length === 24 && items[0]['data-mpw-scan-item'] === 'steam|lt0',
    'items=' + items.length + ' first=' + (items[0] && items[0]['data-mpw-scan-item']));
  ok('S2b 懒加载：首屏挂载节点数(24) < 库总数(30)，且**没有「继续展开」按钮**、续页哨兵在树',
    items.length < 30 && !(t2.nodes || []).some((p) => p && p['data-mpw-scan-more'] !== undefined)
      && (t2.nodes || []).some((p) => p && p['data-mpw-scan-sentinel'] !== undefined),
    'mounted=' + items.length + ' moreBtn=' + (t2.nodes || []).some((p) => p && p['data-mpw-scan-more'] !== undefined));
  ok('S2c 缩略图走同一候选链（每项都有 data-mpw-thumb-box）',
    t2.nodes.filter((p) => p && p['data-mpw-thumb-box'] !== undefined).length >= 24,
    'thumbs=' + t2.nodes.filter((p) => p && p['data-mpw-thumb-box'] !== undefined).length);

  console.log('  -- S3 点选应用 ⇒ 走统一应用管线（持久化逐键同形）--');
    // ①(2026-11-01 改版) 网格项改「点选选中」⇒ 先点第一项，再点详情里的应用按钮
    { const c0 = t2.nodes.find((p) => p && p['data-mpw-scan-item'] !== undefined); try { globalThis.__mpwBsScan.setSelected(c0['data-mpw-scan-item']); } catch (e) {} }
    const t2b = s.render();
    const useBtn = t2b.nodes.find((p) => p && typeof p['data-mpw-scan-use'] === 'string' && typeof p.onClick === 'function');
    try { useBtn.onClick(); } catch (e) {}
    await sleep(3600);
  const stored = JSON.parse(s.r.ctx ? (globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}') : '{}');
  ok('S3 应用后持久化 = 库项身份（mpkgKey=library|<ltoken>、converted=mp4、image=host:?ltoken=…）',
    stored.mpkgKey === 'library|lt0' && stored.converted === 'mp4' && String(stored.image || '').indexOf('host:?ltoken=lt0&file=') === 0,
    'mpkgKey=' + stored.mpkgKey + ' converted=' + stored.converted + ' image=' + String(stored.image || '').slice(0, 60));

  console.log('  -- S4 滚到底 ⇒ 续页到稳定后全部结果可达（无按钮门槛）--');
  const more = globalThis.__mpwBsScanMore;
  let guard = 0;
  try { for (;;) { guard++; if (guard > 20) break; const before = countItems(s.render()).length; more(); await sleep(1); const after = countItems(s.render()).length; if (after >= 30) break; if (after === before) break; } } catch (e) {}
  const t4 = s.render();
  const items4 = countItems(t4);
  ok('S4 续页到稳定后 30 项全部挂载（滚到底 = 全部结果可达）、哨兵退场、无「继续展开」',
    items4.length === 30 && !t4.nodes.some((p) => p && p['data-mpw-scan-more'] !== undefined)
      && !t4.nodes.some((p) => p && p['data-mpw-scan-sentinel'] !== undefined),
    'items=' + items4.length);
}

console.log('\n== E. 空态 / 错误态（WE 库分支）==');
{
  const e1 = renderWall(null, { fetch: fetchFor({ steam: { ok: true, wallpapers: [] } }), settings: { enabled: true, customDirPath: '' } });
  try { e1.kick(); } catch (err) {}
  await sleep(80);
  const t1 = e1.render();
  ok('E1 空结果 ⇒ 明确空态（data-mpw-scan-empty + bsScan.empty 文案）',
    t1.nodes.some((p) => p && p['data-mpw-scan-empty'] !== undefined)
      && (t1.strings || []).some((x) => String(x).indexOf(e1.r.localeDicts.zh['bsScan.empty']) >= 0),
    (t1.strings || []).slice(0, 80).join('|').slice(0, 100));

  const e2 = renderWall(null, { fetch: async () => { throw new Error('host down'); }, settings: { enabled: true, customDirPath: '' } });
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
  const s = renderWall(null, { fetch: fetchFor({ steam: { ok: true, wallpapers: [
    { ltoken: 'w1', title: 'Webby', type: 'web', media: 'index.html', webHeavy: false, webExternal: false },
  ] } }), settings: { enabled: true, customDirPath: '' } });
  try { s.kick(); } catch (e) {}
  await sleep(120);
  const t = s.render();
    // ①(2026-11-01 改版) 先点缩略图选中，再点详情里的应用按钮
    { const c0 = t.nodes.find((p) => p && p['data-mpw-scan-item'] !== undefined); try { globalThis.__mpwBsScan.setSelected(c0['data-mpw-scan-item']); } catch (e) {} }
    const tSel = s.render();
    const useBtn = tSel.nodes.find((p) => p && typeof p['data-mpw-scan-use'] === 'string' && typeof p.onClick === 'function');
    try { useBtn.onClick(); } catch (e) {}
    const t2 = s.render();
  const confirm = t2.nodes.some((p) => p && p['data-mpw-scan-webconfirm'] !== undefined);
  ok('W1 点 web 项 ⇒ 先出确认面板（不直接落盘）',
    confirm, 'confirm=' + confirm);
    // ①(2026-11-01 改版) 详情区「应用此壁纸」也是 mpw_button ⇒ 用稳定标记定位确认面板的 go
    const goBtn2 = (t2.nodes.find((p) => p && p['data-mpw-scan-webgo'] !== undefined && typeof p.onClick === 'function'));
  try { goBtn2.onClick(); } catch (e) {}
  await sleep(3600);
  const stored = JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}');
  ok('W2 确认后落盘：converted=web + 默认沙箱通道（&shim=1）',
    stored.converted === 'web' && String(stored.webUrl || '').indexOf('host:?ltoken=w1&web=1&file=index.html&shim=1') === 0,
    'webUrl=' + String(stored.webUrl || '').slice(0, 80));
}

console.log('\n== I. i18n（zh/en 两表 bsScan.* 键集逐键相等 + bsTab 存留键）==');
{
  reset();
  const w = makeBsWorld();
  const r = loadPlugin({ quiet: true, ctxDecorate: w.decorate });
  const dicts = r.localeDicts;
  const KEYS = ['bsScan.title', 'bsScan.rescan', 'bsScan.scanning', 'bsScan.count', 'bsScan.empty',
    'bsScan.err', 'bsScan.applied', 'bsScan.webConfirm', 'bsScan.webGo', 'bsScan.webGoCompat', 'bsScan.webCancel',
    'bsScan.dir', 'bsScan.dirNone'];
  const missZh = KEYS.filter((k) => !dicts || !dicts.zh || typeof dicts.zh[k] !== 'string' || !dicts.zh[k]);
  const missEn = KEYS.filter((k) => !dicts || !dicts.en || typeof dicts.en[k] !== 'string' || !dicts.en[k]);
  ok('I1 zh 表 bsScan.* 键全部非空', missZh.length === 0, JSON.stringify(missZh));
  ok('I2 en 表 bsScan.* 键全部非空', missEn.length === 0, JSON.stringify(missEn));
  ok('I3 zh/en 键集逐键相等（一边漏键必红）', missZh.length === 0 && missEn.length === 0
    && KEYS.every((k) => dicts.zh[k] !== undefined && dicts.en[k] !== undefined), '');
  ok('I4 已删的 bsScan.desc（独立页签描述符专用）零残留',
    dicts && dicts.zh && dicts.en && dicts.zh['bsScan.desc'] === undefined && dicts.en['bsScan.desc'] === undefined, '');
  ok('I5 bsTab.title/desc 存留（「壁纸」页签描述符要用）',
    dicts && typeof dicts.zh['bsTab.title'] === 'string' && typeof dicts.zh['bsTab.desc'] === 'string', '');
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

// 共享：变异副本上渲染侧栏页签的小工具。**必须先 render 一次**再返回 ——
// kick/more 出口（window.__mpwBsScanKick/__mpwBsScanMore）在面板渲染时才登记；
// 不先渲染的话 kick 是 undefined，变异组会因"没扫描"而假红（R1：红也要红对原因）。
async function renderOn(f, opts2 = {}) {
  reset();
  const w = makeBsWorld();
  const opts = { quiet: true, clientPath: f, ctxDecorate: w.decorate };
  if (opts2.fetch) opts.fetch = opts2.fetch;
  if (opts2.settings) opts.settings = opts2.settings;
  const r = loadPlugin(opts);
  const d = w.state.descriptors.find((x) => x.id === WALL_ID);
  const render = () => { try { const tree = d.component({ ctx: r.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: WALL_ID }, visible: true }); const c = collectNodes(tree); return { tree, nodes: c.nodes, strings: c.strings }; } catch (e) { return { tree: null, nodes: [], strings: [] }; } };
  render();
  return { r, w, render };
}

// M-order：内部 tab 顺序改错（scan 的按钮排到 source 之后）⇒ O1 红（按钮序数组首项 != scan）
await withMutant('M-order', '内部 tab 顺序改错（scan 按钮不在首位）',
  [[`\t\t\tif (scanTabOn) tabBtns.push(h("button", { key: "tab-scan", className: "mpw_tab" + (settingsTab === "scan" ? " mpw_tabActive" : ""), type: "button", "data-mpw-tab-scan": "", onClick: () => switchTab("scan") }, t("bsScan.title")));
\t\t\ttabBtns.push(h("button", { className: "mpw_tab" + (settingsTab === "source" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("source") }, t("sec.source")));`,
    `\t\t\ttabBtns.push(h("button", { className: "mpw_tab" + (settingsTab === "source" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("source") }, t("sec.source"))); /* M-order */
\t\t\tif (scanTabOn) tabBtns.push(h("button", { key: "tab-scan", className: "mpw_tab" + (settingsTab === "scan" ? " mpw_tabActive" : ""), type: "button", "data-mpw-tab-scan": "", onClick: () => switchTab("scan") }, t("bsScan.title")));`]], ['O1'],
  async (f) => {
    const red = [];
    const { r, w } = await renderOn(f);
    const d = w.state.descriptors.find((x) => x.id === WALL_ID);
    let tree = null;
    try { tree = d.component({ ctx: r.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: WALL_ID }, visible: true }); } catch (e) {}
    const bar = (() => { let hit = null; const f2 = (n, dd) => { if (hit || n == null || typeof n !== 'object' || dd > 8) return; if (Array.isArray(n)) { n.forEach((x) => f2(x, dd)); return; } if (n.props && n.props['data-mpw-tabbar'] !== undefined) { hit = n; return; } if (n.kids) f2(n.kids, dd); }; f2(tree, 0); return hit; })();
    const labelOf = (b) => (b.props && b.props['data-mpw-tab-scan'] !== undefined) ? 'scan' : (b.kids && typeof b.kids[0] === 'string' ? b.kids[0] : '?');
    const tabKeys = bar && Array.isArray(bar.kids) ? bar.kids.filter(Boolean).map(labelOf) : [];
    const zh = r.localeDicts.zh;
    const EXPECT_LABELS = ['scan', zh['sec.source'], zh['sec.wallpaper'], zh['sec.appearance'], zh['sec.unify'], zh['sec.blur'], zh['sec.other'], zh['sec.liquid']];
    if (!(JSON.stringify(tabKeys) === JSON.stringify(EXPECT_LABELS))) red.push('O1');
    return red;
  });

// M-priority：优先级打掉（始终扫 WE 库）⇒ P1（自定义目录没被扫）、P2（steam 反而被扫）红
await withMutant('M-priority', '扫描优先级打掉（自定义目录分支恒假）',
  [['\t\t\t\tif (dir) {\n\t\t\t\t\t// ①(2026-10-25 任务 1.1) 显示值 = **实际取数来源**：自定义分支在请求发出前记账\n\t\t\t\t\t//   （就是这条 /custom-dir 请求体里的 dir），禁止显示层另算一份。\n\t\t\t\t\ttry { mpwBsScanStore.srcDir = dir; } catch (e) {}', '\t\t\t\tif (false) { /* M-priority */\n\t\t\t\t\ttry { mpwBsScanStore.srcDir = dir; } catch (e) {}']], ['P1', 'P2'],
  async (f) => {
    const red = [];
    const urls = [];
    const { render } = await renderOn(f, {
      fetch: async (url) => { urls.push(String(url)); return { ok: true, status: 200, json: async () => (String(url).indexOf('/custom-dir') >= 0) ? customLib(40) : steamLib(30) }; },
      settings: { enabled: true, customDirPath: '/data/wallpapers' },
    });
    try { globalThis.__mpwBsScanKick(); } catch (e) {}
    await sleep(120);
    const t = render();
    const items = countItems(t);
    if (!(urls.some((u) => u.indexOf('/custom-dir') >= 0) && items.length > 0 && items[0]['data-mpw-scan-item'] === 'custom|clip0.mp4')) red.push('P1');
    if (!(urls.every((u) => u.indexOf('/steam-inventory') < 0))) red.push('P2');
    return red;
  });

// M-empty：删掉空态分支 ⇒ E1 红（空结果必须有明确空态）
await withMutant('M-empty', '删掉空态分支（空结果没有提示）',
  [['rows.push(h("div", { key: "empty", className: "mpw_hint", "data-mpw-scan-empty": "" }, t("bsScan.empty")));', '/* M-empty */']], ['E1'],
  async (f) => {
    const red = [];
    const { r, render } = await renderOn(f, { fetch: fetchFor({ steam: { ok: true, wallpapers: [] } }), settings: { enabled: true, customDirPath: '' } });
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
    const { render } = await renderOn(f, { fetch: fetchFor(null), settings: { enabled: true, customDirPath: '' } });
    try { globalThis.__mpwBsScanKick(); } catch (e) {}
    await sleep(120);
    const t = render();
    const items = countItems(t);
    if (!(items.length < 30 && !(t.nodes || []).some((p) => p && p['data-mpw-scan-more'] !== undefined)
      && (t.nodes || []).some((p) => p && p['data-mpw-scan-sentinel'] !== undefined))) red.push('S2b');
    return red;
  });

// M-scroll：续页断链（每次 +0）⇒ S4 红（滚到底永远到不了全部结果）
await withMutant('M-scroll', '续页断链（appendMore 每次 +0）',
  [['const nx = Math.min(items.length, n + MPW_SCAN_PAGE);', 'const nx = Math.min(items.length, n + 0); /* M-scroll */']], ['S4'],
  async (f) => {
    const red = [];
    const { render } = await renderOn(f, { fetch: fetchFor(null), settings: { enabled: true, customDirPath: '' } });
    try { globalThis.__mpwBsScanKick(); } catch (e) {}
    await sleep(120);
    const more = globalThis.__mpwBsScanMore;
    let guard = 0;
    try { for (;;) { guard++; if (guard > 20) break; const before = countItems(render()).length; more(); await sleep(1); const after = countItems(render()).length; if (after >= 30) break; if (after === before) break; } } catch (e) {}
    const t = render();
    if (!(countItems(t).length === 30 && !t.nodes.some((p) => p && p['data-mpw-scan-sentinel'] !== undefined))) red.push('S4');
    return red;
  });

// M-apply：点选应用断链（applyItem 变空操作）⇒ S3 红（点了"使用"但档里没有库项身份）
await withMutant('M-apply', '点选应用断链（applyItem 变空操作）',
  [['try { mpwApplyWallFromList(w, scanUi); } catch (e) { mpwErr("bsScan(apply)", e); }', '/* M-apply */']], ['S3'],
  async (f) => {
    const red = [];
    const { render } = await renderOn(f, { fetch: fetchFor(null), settings: { enabled: true, customDirPath: '' } });
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

// M-dir：目录记账断链（kickScan 不再记录实际取数来源）⇒ D1（自定义分支显示空）/ D2（WE 分支显示空）红
await withMutant('M-dir', '目录记账断链（kickScan 不写 srcDir）',
  [['try { mpwBsScanStore.srcDir = dir; } catch (e) {}\n\t\t\t\t\ttry { setSrcDir(dir); } catch (e) {}', '/* M-dir custom */'],
   ['const inst = String((d && d.installDir) || "");', 'const inst = ""; /* M-dir steam */']], ['D1', 'D2'],
  async (f) => {
    const red = [];
    const dirRowOf = (t) => {
      const tree = t.tree !== undefined ? t.tree : t;
      let hit = null;
      const find = (n, dd) => {
        if (hit || n == null || typeof n !== 'object' || dd > 12) return;
        if (Array.isArray(n)) { n.forEach((x) => find(x, dd)); return; }
        if (n.props && n.props['data-mpw-scan-dir'] !== undefined) { hit = n; return; }
        if (n.kids) find(n.kids, dd + 1);
      };
      find(tree, 0);
      if (!hit || !Array.isArray(hit.kids)) return null;
      const v = hit.kids.find((k) => k && typeof k === 'object' && k.props && k.props.className === 'mpw_scanDirPath');
      return v ? { text: typeof v.kids[0] === 'string' ? v.kids[0] : '' } : null;
    };
    const a = await renderOn(f, { fetch: fetchFor({ custom: customLib(4) }), settings: { enabled: true, customDirPath: '/data/wallpapers' } });
    try { globalThis.__mpwBsScanKick(); } catch (e) {}
    await sleep(120);
    const ra = dirRowOf(a.render());
    if (!(ra && ra.text === '/data/wallpapers')) red.push('D1');
    const b = await renderOn(f, { fetch: fetchFor({ steam: { ok: true, installDir: '/games/Steam/wallpaper_engine', wallpapers: [] } }), settings: { enabled: true, customDirPath: '' } });
    try { globalThis.__mpwBsScanKick(); } catch (e) {}
    await sleep(120);
    const rb = dirRowOf(b.render());
    if (!(rb && rb.text === '/games/Steam/wallpaper_engine')) red.push('D2');
    return red;
  });

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

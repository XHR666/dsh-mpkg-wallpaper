// tools/bs-tab-test.mjs —— better-sidebar 侧边栏页签 + 设置双入口的回归门禁（2026-10-25 纠正版）
//
// 为什么需要它：插件向 dsh-better-sidebar 注册侧边栏 tab 有四段链路，任何一段断掉都是
// "看起来接了、实际没接"的假绿：
//   ① 注册本身（registerTab 恰好一次=只有「壁纸」页签、字段齐全、id 不与内置 6 tab 重名，
//      且上一批错误新增的独立「扫描壁纸」页签 mpkg-wallpaper:scan **不存在**）；
//   ② 生命周期（必须包 ctx.effect ⇒ fiber 卸载撤销 ⇒ 重激活不抛 already registered）；
//   ③ 可选依赖降级（better-sidebar 未装/未就绪 ⇒ 有界重试后安全跳过，绝不崩）；
//   ④ i18n（zh/en 两表键集逐键相等 + 已删键不得残留）。
// 本文件断言（每条都能被"改回坏写法"变红，见文末 M1–M5 变异自证）：
//   A. 正常注册：恰好 1 次注册 / id 集合恰为 {mpkg-wallpaper} / 字段 / effect 包裹 / 卸载重注册
//   B. 缺席降级（无服务）：无异常 / 首轮尝试后等待 / 有界超时降级提示 / 服务晚到仍能注册
//   C. i18n：bsTab.* 存留键 + 已删除的 jump/state/kind 键不得残留（zh/en 一致）
//   D. 侧栏「壁纸」页签 = 整页设置 + 内部 tab 栏 8 项且 scan 第一位默认选中（任务纠正 ①③）
//   E. 设置页恢复 = 整页设置（7 项内部 tab，无 scan、无跳转壳；清单驱动逐 tab 可交互）
//      + 两入口同一份配置（同一持久化键逐字段等价）
//   M1. 去掉 optional 守卫 ⇒ B1、B2、B3 必红
//   M2. 去掉 ctx.effect 包裹 ⇒ A5、A6a、A6b 必红
//   M3. id 改成内置名 subagent ⇒ A2、A8 必红
//   M4. 设置页注册组件换成空壳（跳转壳类回归）⇒ E1、E2 必红
//   M5. 侧栏页签不传 scanTab（内部 scan tab 消失）⇒ D2、D3 必红
// 契约沿革（2026-10-25，随任务纠正改写，旧断言不删只随契约演进）：
//   · A1 由"注册 2 次（扫描+壁纸）"改写为"注册恰好 1 次"——独立扫描页签按任务要求删除；
//   · E2 由"设置页只剩跳转壳"反转——设置页恢复整页设置，跳转壳本身成为必须不存在的回归项；
//   · C 组键集由 17 个 bsTab.* 收缩为 title/desc 两个存留键 + 已删键零残留。
// 契约沿革（2026-11-02，tab 切换机制演进，留痕）：
//   · D3 由"translateX(-0%) 内容位移为 0"演进为"激活标记 data-mpw-tabactive 恰好一个且在
//     scan 面板上"。原因：根治"切设置页后界面整体左移"（真机探针读数 frame.scrollLeft=156，
//     根因 = tab 行 N×100% 超宽 + translateX 切换撑破布局根）；实现改为 grid 同格堆叠
//     （.mpw_tabRow 块 ⑩a 注：任一时刻只有激活面板可见，行宽恒等容器宽，不再写 transform）。
//   · 新增 D8：CSS 产物堆叠规则（grid-area:1/1 + visibility:hidden；激活面板 visible）+
//     源码零残留（无 translateX 行切换写法、无 flex:"0 0 100%" 超宽面板）。
//     注：任务书草案写 position:absolute 堆叠，落地选 grid 同格叠放（任务书 §高度"二选一选
//     简单可靠者"的后者）——absolute 面板不给父容器高度需另补，grid 天然取最大高度且无
//     定位基准问题；两条不变量相同（行宽恒等容器宽 + 激活项唯一可见）。
//   · 其余行为断言（index/顺序/数量/默认激活项/滚动位置语义：面板始终挂载不改）全部保留。
// 复现: node tools/bs-tab-test.mjs
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

/* ---------- 临时目录卫生（无论成败都清；仿 better-sidebar-compat-test.mjs） ---------- */
const TMP_DIRS = [];
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP_DIRS.push(d); return d; };
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

/* ---------- 桩 world 卫生 ---------- */
const { loadPlugin, cancelWorldTimers } = await import('./_stub.mjs');
// 同进程多次 loadPlugin 前必须清的全局守卫（__mpwAppliedOnce = apply 幂等；__mpwBsTabState = 本功能注册状态）
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwBsVerAt', '__mpwGlobalWired',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState', '__mpwBsScanKick', '__mpwBsScanMore'];
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k]; } catch {} } };

/* ---------- fake better-sidebar 服务 + cordis 形状的 effect ---------- */
// registerTab 的重复 id 语义照抄 dsh-better-sidebar v0.28.0 src/client/service.ts:1064
// （`tab type "X" already registered`）；effect 像 cordis 一样**持有 disposer**（桩默认丢弃），
// 这样"包没包 ctx.effect"才有功能性判据（卸载后重注册是否撞车），而不是只数调用。
function makeBsWorld() {
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
  const effectLog = [];
  const fiberDisposers = [];
  /** cordis 形状的 effect：持有 disposer、回调异常**向上抛**（真实宿主语义；桩默认吞错，
   *  会让"注册失败"静默 ⇒ 变异自证必须钉住语义）。 */
  const decorateEffect = (ctx) => {
    ctx.effect = (fn, name) => {
      effectLog.push(String(name || ''));
      const d = fn();
      if (typeof d === 'function') fiberDisposers.push(d);
      return d;
    };
  };
  const decorate = (ctx) => { decorateEffect(ctx); ctx.get = (n) => (n === 'betterSidebar' ? svc : undefined); };
  const unload = () => { for (const d of fiberDisposers.splice(0)) { try { d(); } catch {} } };
  return { svc, state, effectLog, decorate, decorateEffect, unload };
}

/** 词典接线的 locale.bind（真实宿主语义：bind(NS) 返回的 t 按**当前语言**词典查键） */
function decorateLocaleZh(ctx, dicts) {
  ctx.locale.bind = () => (k) => ((dicts && dicts.zh && dicts.zh[k] !== undefined) ? dicts.zh[k] : k);
}

const BUILTIN_TAB_IDS = ['editor', 'git', 'subagent', 'sidechat', 'terminal-bottom', 'diff'];
const SCAN_ID = 'mpkg-wallpaper:scan';
const WALL_ID = 'mpkg-wallpaper';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 树工具：执行函数组件（深度≤4，与 panel-smoke 同手法）+ 收集节点/字符串。 */
function collect(tree, execDepth) {
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
    if (typeof n.type === 'function' && d < (execDepth || 4)) { try { walk(n.type(Object.assign({ t: (k) => k }, n.props || {})), d + 1); } catch {} return; }
    if (n.kids) walk(n.kids, d);
  };
  walk(tree, 0);
  str(tree);
  return { nodes, strings: strings.join(' | ') };
}
/** 找第一个 role=switch 的元素（执行函数组件后）：设置页主开关的按钮。 */
function findFirstSwitch(tree) {
  let hit = null;
  const walk = (n, d) => {
    if (hit || n == null || typeof n !== 'object' || d > 6) return;
    if (Array.isArray(n)) { n.forEach((x) => walk(x, d)); return; }
    if (n.props && n.props.role === 'switch' && typeof n.props.onClick === 'function') { hit = n.props; return; }
    if (typeof n.type === 'function') { try { walk(n.type(Object.assign({ t: (k) => k }, n.props || {})), d + 1); } catch {} return; }
    if (n.kids) walk(n.kids, d);
  };
  walk(tree, 0);
  return hit;
}
/** 内部 tab 栏读数：data-mpw-tabbar 节点的按钮序列（文本 + 是否激活 + scan 标记）。 */
function tabBarInfo(tree) {
  let bar = null;
  const find = (n, d) => {
    if (bar || n == null || typeof n !== 'object' || d > 8) return;
    if (Array.isArray(n)) { n.forEach((x) => find(x, d)); return; }
    if (n.props && n.props['data-mpw-tabbar'] !== undefined) { bar = n; return; }
    if (typeof n.type === 'function') { try { find(n.type(Object.assign({ t: (k) => k }, n.props || {})), d + 1); } catch {} return; }
    if (n.kids) find(n.kids, d);
  };
  find(tree, 0);
  if (!bar || !Array.isArray(bar.kids)) return null;
  const tabs = bar.kids.filter(Boolean).map((b) => ({
    text: (b && b.kids && typeof b.kids[0] === 'string') ? b.kids[0] : '',
    active: !!(b && b.props && String(b.props.className || '').indexOf('mpw_tabActive') >= 0),
    scan: !!(b && b.props && b.props['data-mpw-tab-scan'] !== undefined),
  }));
  // 内容面板键序（data-mpw-tabkey）：与 tab 序一一对应
  let row = null;
  const findRow = (n, d) => {
    if (row || n == null || typeof n !== 'object' || d > 9) return;
    if (Array.isArray(n)) { n.forEach((x) => findRow(x, d)); return; }
    if (n.props && n.props.className === 'mpw_tabRow') { row = n; return; }
    if (typeof n.type === 'function') { try { findRow(n.type(Object.assign({ t: (k) => k }, n.props || {})), d + 1); } catch {} return; }
    if (n.kids) findRow(n.kids, d);
  };
  findRow(tree, 0);
  const panelKeys = (row && Array.isArray(row.kids)) ? row.kids.filter(Boolean).map((p) => p.props && p.props['data-mpw-tabkey']) : [];
  return { tabs, panelKeys };
}

console.log('\n== A. 正常注册（服务在 apply 时已就绪；①(2026-10-25) 只注册「壁纸」一个页签）==');
let A = {};
{
  reset();
  const w = makeBsWorld();
  const a = loadPlugin({ quiet: true, ctxDecorate: w.decorate });
  A = { a, w };
  const ds = w.state.descriptors;
  const ids = ds.map((d) => d.id);
  ok('A1 registerTab 恰好被调 1 次（只有「壁纸」，不多不少）', w.state.calls === 1, 'calls=' + w.state.calls);
  ok('A2 id 集合恰为 [mpkg-wallpaper]（独立「扫描壁纸」页签不得复活）',
    ids.length === 1 && ids[0] === WALL_ID, 'ids=' + JSON.stringify(ids));
  ok('A2b 已删除的 mpkg-wallpaper:scan 不在注册表里', !ids.includes(SCAN_ID), JSON.stringify(ids));
  ok('A2c 不与内置 6 tab 重名', ids.every((i) => !BUILTIN_TAB_IDS.includes(i)), JSON.stringify(ids));
  const d = w.state.lastDescriptor;
  ok('A3 描述符字段齐全（title/description/icon 为函数、order 数值、single、component）',
    !!d && typeof d.title === 'function' && typeof d.description === 'function'
    && typeof d.icon === 'function' && typeof d.order === 'number'
    && d.single === true && typeof d.component === 'function',
    JSON.stringify(ds.map((x) => ({ id: x.id, order: x.order }))));
  ok('A4 注册包在 ctx.effect 里（effect 名登记）',
    w.effectLog.includes('ui-mpkg-wallpaper: better-sidebar tab'), JSON.stringify(w.effectLog));
  ok('A5 apply 全程无异常', (a.applyErrors || []).length === 0, JSON.stringify((a.applyErrors || []).slice(0, 2)));
  ok('A5b ready 表记录成功且不含 scan id', (() => { const st = globalThis.__mpwBsTabState; return !!st && !!st.ready && st.ready[WALL_ID] === true && !(SCAN_ID in st.ready); })(),
    JSON.stringify((globalThis.__mpwBsTabState || {}).ready));

  console.log('  -- A6 生命周期：卸载 → 重 apply ⇒ 重注册、不撞 already registered --');
  w.unload();
  ok('A6a 卸载后 better-sidebar 注册表已清', w.state.registered.size === 0, 'size=' + w.state.registered.size);
  try { delete globalThis.__mpwAppliedOnce; } catch {}
  const errs0 = (A.a.applyErrors || []).length;
  A.a.plugin.apply(A.a.ctx);
  ok('A6b 重 apply 后重注册成功且无 already registered 异常',
    w.state.calls === 2 && (A.a.applyErrors || []).length === errs0,
    'calls=' + w.state.calls + ' errs=' + JSON.stringify((A.a.applyErrors || []).slice(errs0, errs0 + 2)));

  console.log('  -- A7 重复注册必须抛错（better-sidebar 契约，插件守卫存在的理由）--');
  let threw = '';
  try { w.svc.registerTab(w.state.lastDescriptor); } catch (e) { threw = String(e && e.message || e); }
  ok('A7 同 id 二次 registerTab 抛 already registered',
    /already registered/.test(threw), threw || '没有抛');

  console.log('  -- A8 id 唯一性判据（变异 M3 的靶子）--');
  ok('A8 描述符 id 不在内置 6 tab 表里', !!d && !BUILTIN_TAB_IDS.includes(d.id), d ? d.id : 'd=null');
}

console.log('\n== B. 缺席降级（better-sidebar 未装 / 未就绪）==');
{
  console.log('  -- B1/B2 无服务：apply 无异常、首轮尝试后进入等待 --');
  reset();
  const b = loadPlugin({ quiet: true });          // 桩 ctx 无 get/reflect/betterSidebar ⇒ 探测全空
  const st = globalThis.__mpwBsTabState;
  const bsErrs = (b.applyErrors || []).filter((m) => /mpwBsTab|bs-tab|better-sidebar/i.test(m));
  ok('B1 apply 全程无异常（降级路径不崩）', (b.applyErrors || []).length === 0, JSON.stringify((b.applyErrors || []).slice(0, 2)));
  ok('B2 首轮尝试已发生且未注册（attempts ≥ 1、registered=false）',
    !!st && st.attempts >= 1 && st.registered === false && st.timer,
    st ? 'attempts=' + st.attempts + ' registered=' + st.registered : 'st=null');
  ok('B2b 无 bs-tab 相关错误输出', bsErrs.length === 0, JSON.stringify(bsErrs.slice(0, 2)));

  console.log('  -- B3 有界重试到期 ⇒ 降级（stopped + 恰一行 console.info，无异常）--');
  const infoLines = [];
  const origInfo = console.info;
  console.info = (...a) => { infoLines.push(a.map(String).join(' ')); };
  try {
    st.attempts = 31;   // MPW_BS_RETRY_MAX-1：下一跳即到期（不真等 8s）
    await sleep(450);
  } finally { console.info = origInfo; }
  ok('B3 重试到期后 stopped=true 且降级提示恰好出现（无 bs-tab 异常）',
    st.stopped === true && infoLines.filter((l) => /better-sidebar/.test(l)).length === 1
    && (b.applyErrors || []).length === 0,
    'stopped=' + st.stopped + ' info=' + JSON.stringify(infoLines.slice(0, 2)) + ' errs=' + (b.applyErrors || []).length);

  console.log('  -- B4 服务晚到（启动竞态）：等待期把服务补上 ⇒ 仍能注册 --');
  reset();
  const w2 = makeBsWorld();
  const b4 = loadPlugin({ quiet: true });          // 先无服务
  const st4 = globalThis.__mpwBsTabState;
  b4.ctx.get = (n) => (n === 'betterSidebar' ? w2.svc : undefined);   // 服务"装好了"
  await sleep(450);                                 // 等下一跳（≤250ms）
  ok('B4 服务晚到后自动注册成功（恰好 1 个页签）且无异常',
    st4 && st4.registered === true && w2.state.calls === 1 && (b4.applyErrors || []).length === 0,
    'registered=' + (st4 && st4.registered) + ' calls=' + w2.state.calls + ' errs=' + JSON.stringify((b4.applyErrors || []).slice(0, 2)));
}

console.log('\n== C. i18n（存留键 + 已删键零残留 + zh/en 一致）==');
{
  const dicts = A.a.localeDicts;
  const KEEP = ['bsTab.title', 'bsTab.desc'];
  const REMOVED = ['bsTab.jumpDesc', 'bsTab.jumpOpen', 'bsTab.jumpCur', 'bsTab.jumpFail',
    'bsTab.stateOn', 'bsTab.stateOff', 'bsTab.empty', 'bsTab.err', 'bsTab.settingsHint', 'bsTab.refresh',
    'bsTab.kind.image', 'bsTab.kind.video', 'bsTab.kind.web', 'bsTab.kind.mpkg', 'bsTab.kind.scene'];
  ok('C1 词典已随 apply 注册（zh/en 两表都在）', !!dicts && !!dicts.zh && !!dicts.en, dicts ? 'ns=' + A.a.localeNs : 'dicts=null');
  const missZh = KEEP.filter((k) => !dicts || !dicts.zh || typeof dicts.zh[k] !== 'string' || !dicts.zh[k]);
  const missEn = KEEP.filter((k) => !dicts || !dicts.en || typeof dicts.en[k] !== 'string' || !dicts.en[k]);
  ok('C2 zh 表存留的 2 个 bsTab.* 键全部非空', missZh.length === 0, JSON.stringify(missZh));
  ok('C3 en 表存留的 2 个 bsTab.* 键全部非空', missEn.length === 0, JSON.stringify(missEn));
  const leftZh = REMOVED.filter((k) => dicts && dicts.zh && dicts.zh[k] !== undefined);
  const leftEn = REMOVED.filter((k) => dicts && dicts.en && dicts.en[k] !== undefined);
  ok('C4 已删除的 15 个 bsTab.* 键在 zh 表零残留（跳转壳/状态卡死了，键不能留）', leftZh.length === 0, JSON.stringify(leftZh));
  ok('C5 已删除的 15 个 bsTab.* 键在 en 表零残留', leftEn.length === 0, JSON.stringify(leftEn));
  ok('C6 bsScan.title 在两表都在（内部 tab 栏标签要用）',
    dicts && dicts.zh && dicts.en && typeof dicts.zh['bsScan.title'] === 'string' && typeof dicts.en['bsScan.title'] === 'string', '');
  const d = A.w.state.descriptors.find((x) => x.id === WALL_ID);
  ok('C7 title()/description() 渲染期按词典取词（函数式，跟随语言）',
    !!d && d.title() === dicts.zh['bsTab.title'] && d.description() === dicts.zh['bsTab.desc'],
    d ? 'title=' + d.title() : 'd=null');
}

console.log('\n== D. 侧栏「壁纸」页签 = 整页设置 + 内部 tab 栏 8 项（scan 第一位、默认选中）==');
{
  const mk = () => { const w = makeBsWorld(); w.dicts = A.a.localeDicts; return w; };
  const renderWall = (seed) => {
    reset();
    const w = mk();
    const opts = { quiet: true, ctxDecorate: (ctx) => { w.decorate(ctx); decorateLocaleZh(ctx, w.dicts); } };
    if (seed !== undefined) opts.settings = seed;
    const r = loadPlugin(opts);
    const d = w.state.descriptors.find((x) => x.id === WALL_ID);
    if (!d) return { r, text: '', nodes: [], crashed: true, w };
    let tree = null, crashed = false;
    try { tree = d.component({ ctx: r.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: WALL_ID }, visible: true }); }
    catch (e) { crashed = true; }
    const c = collect(tree, 4);
    return { r, tree, text: c.strings, nodes: c.nodes, crashed, w };
  };
  const zh = A.a.localeDicts.zh;

  const d1 = renderWall({ enabled: true });
  ok('D1 「壁纸」页签渲染的是整页设置（主开关 + 扫描入口在树）',
    d1.text.includes(zh['master']) && d1.text.includes(zh['lib.scan']) && !d1.crashed, d1.text.slice(0, 120));

  const info1 = d1.tree ? tabBarInfo(d1.tree) : null;
  const EXPECT_TABS = ['scan', 'source', 'wallpaper', 'appearance', 'unify', 'blur', 'other', 'liquid'];
  ok('D2 内部 tab 栏 8 项且顺序 = scan 第一 + 原 7 项',
    !!info1 && info1.tabs.length === 8 && info1.tabs[0].scan === true
    && info1.panelKeys.length === 8 && JSON.stringify(info1.panelKeys) === JSON.stringify(EXPECT_TABS),
    info1 ? 'panels=' + JSON.stringify(info1.panelKeys) : 'no-bar');
  ok('D3 scan 默认选中（tab 激活态在 scan 上；2026-11-02 演进：激活标记 data-mpw-tabactive 恰好一个）',
    !!info1 && info1.tabs[0].active === true
    && d1.nodes.filter((p) => p && p['data-mpw-tabactive'] !== undefined).length === 1
    && d1.nodes.some((p) => p && p['data-mpw-tabkey'] === 'scan' && p['data-mpw-tabactive'] !== undefined),
    info1 ? 'active0=' + info1.tabs[0].active : 'no-bar');
  ok('D4 内容面板 scan 在树（data-mpw-tabkey=scan + 扫描网格标记）',
    d1.nodes.some((p) => p && p['data-mpw-tabkey'] === 'scan') && d1.nodes.some((p) => p && p['data-mpw-bs-scan'] !== undefined),
    'scan-panel=' + d1.nodes.some((p) => p && p['data-mpw-tabkey'] === 'scan'));

  const d2 = renderWall({ enabled: true, image: 'data:image/png;base64,AAA', converted: 'mp4' });
  ok('D5 有档：当前壁纸卡（缩略图框）+ 启用态在树',
    d2.nodes.some((p) => p && p['data-mpw-thumb-box'] !== undefined), d2.text.slice(0, 120));

  const d3 = renderWall({ enabled: "yes", image: 123, npVolume: "abc", mute: "no" });
  ok('D6 垃圾档防御：非字符串/越型字段不炸且整页设置照常渲染',
    d3.text.length > 0 && d3.text.includes(zh['master']) && !d3.crashed, d3.text.slice(0, 120));

  const d4 = renderWall({ enabled: true, image: 'data:image/png;base64,AAA', converted: 'mp4' });
  ok('D7 播放/暂停控件跟随整页设置（mp4 档 ⇒ 暂停壁纸按钮在树）',
    d4.text.includes(zh['pause.pause']), d4.text.slice(0, 160));
}

console.log('\n== D8. tab 同格堆叠（2026-11-02 左移根治）的产物与源码断言 ==');
{
  reset();
  loadPlugin({ quiet: true });
  const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '');
  cancelWorldTimers();
  const iRow = css.indexOf('.mpw_tabBody > .mpw_tabRow > * {');
  const rowBody = iRow >= 0 ? css.slice(css.indexOf('{', iRow) + 1, css.indexOf('}', iRow)) : '';
  ok('D8a CSS 产物含同格堆叠规则（grid-area:1/1 + visibility:hidden + min-width:0）',
    iRow >= 0 && rowBody.indexOf('grid-area: 1 / 1;') >= 0
    && rowBody.indexOf('visibility: hidden;') >= 0 && rowBody.indexOf('min-width: 0;') >= 0,
    rowBody.trim().slice(0, 100));
  const iAct = css.indexOf('.mpw_tabBody > .mpw_tabRow > [data-mpw-tabactive] {');
  const actBody = iAct >= 0 ? css.slice(css.indexOf('{', iAct) + 1, css.indexOf('}', iAct)) : '';
  ok('D8b 激活面板唯一可见（data-mpw-tabactive ⇒ visibility:visible）',
    iAct >= 0 && actBody.indexOf('visibility: visible;') >= 0, actBody.trim().slice(0, 80));
  const rowRule = (css.match(/\.mpw_tabRow \{([^}]*)\}/) || [])[1] || '';
  ok('D8c tabRow 基础规则不再含 transform/transition（切换零位移、祖先链零 transform）',
    rowRule.length > 0 && rowRule.indexOf('transform') < 0 && rowRule.indexOf('transition') < 0, rowRule.trim().slice(0, 80));
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  ok('D8d 源码零残留：无 translateX 行切换写法、无 flex:"0 0 100%" 超宽面板',
    src.indexOf('"translateX(-" + Math.max(0') < 0 && src.indexOf('flex: "0 0 100%"') < 0, '');
  // ①(2026-11-03 #13 A4) switchTab 本体零样式写入（防"JS 位移"改法复活：切换只准 setState，
  //   可见性由 data-mpw-tabactive 的 CSS 驱动）。变异 M6 注回 translateX ⇒ 本条必红。
  const iSw = src.indexOf('const switchTab = (id) => {');
  const iEnd = iSw >= 0 ? src.indexOf('};', iSw) : -1;
  const swBody = iSw >= 0 && iEnd > iSw ? src.slice(iSw, iEnd) : '';
  ok('D8e switchTab 本体零 style/transform 写入（只 setState；A4 #13 回归锁）',
    swBody.length > 0 && swBody.indexOf('.style') < 0 && swBody.indexOf('transform') < 0,
    swBody.trim().slice(0, 80));
}

console.log('\n== E. 设置页恢复整页设置（7 项内部 tab；无 scan、无跳转壳）+ 两入口同一份配置 ==');
{
  const zh = A.a.localeDicts.zh;

  console.log('  -- E1/E2 设置页=整页设置（页签在不在都一样；跳转壳必须不存在）--');
  reset();
  const w3 = makeBsWorld();
  const b1 = loadPlugin({ quiet: true, settings: { enabled: true }, ctxDecorate: w3.decorate });
  const t1 = collect(b1.sectionComp({ t: (k) => k, close: () => {} }), 4);
  ok('E1 页签已注册：设置页仍渲染整页设置（主开关/扫描入口在树）',
    t1.strings.includes('master') && t1.strings.includes('lib.scan'), t1.strings.slice(0, 100));
  ok('E2 跳转壳必须不存在（上一批的错误搬迁不得回归）',
    !t1.nodes.some((p) => p && p['data-mpw-bs-jump'] !== undefined), 'jump=' + t1.nodes.some((p) => p && p['data-mpw-bs-jump'] !== undefined));
  const infoS = tabBarInfo(b1.sectionComp({ t: (k) => k, close: () => {} }));
  ok('E3 设置页内部 tab 栏 = 原 7 项、不含 scan（与侧栏版本同组件不同 tab 集）',
    !!infoS && infoS.panelKeys.length === 7 && !infoS.panelKeys.includes('scan')
    && JSON.stringify(infoS.panelKeys) === JSON.stringify(['source', 'wallpaper', 'appearance', 'unify', 'blur', 'other', 'liquid']),
    infoS ? 'panels=' + JSON.stringify(infoS.panelKeys) : 'no-bar');

  console.log('  -- E4 清单驱动：设置页 7 组内部 tab 逐项可见且可交互（缺一项即红）--');
  const t4 = collect(b1.sectionComp({ t: (k) => k, close: () => {} }), 5);
  const panels = {};
  for (const p of t4.nodes) if (p && typeof p['data-mpw-tabkey'] === 'string') panels[p['data-mpw-tabkey']] = (panels[p['data-mpw-tabkey']] || 0) + 1;
  const SEVEN = ['source', 'wallpaper', 'appearance', 'unify', 'blur', 'other', 'liquid'];
  ok('E4a 7 个内部 tab 面板全部在树', SEVEN.every((k) => panels[k] >= 1), JSON.stringify(panels));
  // 每个面板的**可交互控件**数（onClick 按钮 / role=switch / input）：全 0 = 该组控件丢失
  const interactCount = (key) => {
    let count = 0;
    const walk = (n, d, inside) => {
      if (n == null || typeof n !== 'object' || d > 10) return;
      if (Array.isArray(n)) { n.forEach((x) => walk(x, d, inside)); return; }
      const here2 = inside || (n.props && n.props['data-mpw-tabkey'] === key);
      if (here2 && n.props && (typeof n.props.onClick === 'function' || n.props.role === 'switch' || n.props.type === 'button' || n.props.className === 'mpw_input')) count++;
      if (typeof n.type === 'function') { try { walk(n.type(Object.assign({ t: (k) => k }, n.props || {})), d + 1, here2); } catch {} return; }
      if (n.kids) walk(n.kids, d, here2);
    };
    walk(b1.sectionComp({ t: (k) => k, close: () => {} }), 0, false);
    return count;
  };
  const counts = {};
  for (const k of SEVEN) counts[k] = interactCount(k);
  ok('E4b 7 组面板每组都有可交互控件（≥2），缺组即红',
    SEVEN.every((k) => counts[k] >= 2), JSON.stringify(counts));
  ok('E4c 代表性控件抽查：主开关（source）、缩略图链（wallpaper 组）在树',
    t4.nodes.some((p) => p && p.role === 'switch') && t4.nodes.some((p) => p && p['data-mpw-thumb-box'] !== undefined), '');

  console.log('  -- E5 配置读写等价：侧栏页签与设置页两条路写出的持久化逐字节相等 --');
  const seedStore = { enabled: true, image: 'data:image/png;base64,AAA', converted: 'mp4', sharp: false };
  // 路 A：从「壁纸」侧栏页签（bs world）里点主开关
  reset();
  const wA = makeBsWorld();
  const storeA = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null }, setItem(k, v) { this._m.set(k, String(v)) }, removeItem(k) { this._m.delete(k) } };
  const ra = loadPlugin({ quiet: true, settings: JSON.parse(JSON.stringify(seedStore)), ctxDecorate: wA.decorate, localStorage: storeA });
  const dA = wA.state.descriptors.find((x) => x.id === WALL_ID);
  const treeA = dA.component({ ctx: ra.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: WALL_ID }, visible: true });
  const swA = findFirstSwitch(treeA);
  try { swA.onClick(); } catch (e) {}
  await sleep(3600);   // 等 boot 收尾闸门（3.5s 世界定时器）放行落盘
  const jsonA = storeA.getItem('dsh.mpkg-wallpaper.v2');
  // 路 B：从设置页（无 bs world 的 fallback）点同一个主开关
  reset();
  const storeB = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null }, setItem(k, v) { this._m.set(k, String(v)) }, removeItem(k) { this._m.delete(k) } };
  const rb = loadPlugin({ quiet: true, settings: JSON.parse(JSON.stringify(seedStore)), localStorage: storeB });
  const treeB = rb.sectionComp({ t: (k) => k, close: () => {} });
  const swB = findFirstSwitch(treeB);
  try { swB.onClick(); } catch (e) {}
  await sleep(3600);   // 同上：两条路等同一个闸门 ⇒ 对比的是同一种读数
  const jsonB = storeB.getItem('dsh.mpkg-wallpaper.v2');
  const stripStamp = (j) => { try { const o = JSON.parse(j); delete o.__mpwLocalAt; delete o.__mpwHostAt; return JSON.stringify(o) } catch (e) { return j } };
  ok('E5 两条路的写入逐字段相等（剥时间戳；且确实写入了 ⇒ 判据能失败）',
    !!swA && !!swB && stripStamp(jsonA) === stripStamp(jsonB) && jsonA !== null && JSON.parse(jsonA).enabled === false,
    'equal=' + (stripStamp(jsonA) === stripStamp(jsonB)) + ' A=' + String(jsonA).slice(0, 80));
  ok('E5b 两条路共用同一持久化键（STORE_KEY 未改名）',
    jsonA !== null && jsonB !== null, 'A=' + (jsonA ? 'set' : 'null') + ' B=' + (jsonB ? 'set' : 'null'));
}

/* ---------- 变异自证（隔离副本；每个锚点必须恰好替换一次且旧串不再存在 —— R2） ---------- */
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');
function runChecksOn() {
  const red = [];
  const detail = {};
  const group = (id, cond, d) => { detail[id] = d || ''; if (!cond) red.push(id); };
  return { group, red, detail };
}

async function withMutant(id, what, pairs, expectRed, runGroup) {
  const dir = mkTmp('mpw-bs-tab-mut-');
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
  let red = [], detail = {};
  try { red = await runGroup(f); } catch (e) { detail = { throw: String(e && e.message || e) }; }
  const eq = applied.every(Boolean) && JSON.stringify(red.slice().sort()) === JSON.stringify(expectRed.slice().sort());
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-MISMATCH') + ' ' + id + ' ' + what);
  console.log('    期望红集=' + JSON.stringify(expectRed.slice().sort()) + ' 实际红集=' + JSON.stringify(red.slice().sort())
    + ' 变异生效=' + JSON.stringify(applied)
    + (eq ? '' : '  详情=' + JSON.stringify(detail).slice(0, 400)));
  if (!eq) fail++; else pass++;
}

console.log('\n== M. 变异自证（期望红集 == 实际红集，逐条相等）==');

// M1：去掉 optional 守卫（`if (!bs)` 恒假）⇒ 服务缺席时直闯注册 ⇒ 注册尝试从未发生、
//    有界重试与降级提示整条链路死掉 ⇒ B1（无异常被打破）、B2（首轮尝试）、B3（到期降级）红。
await withMutant('M1', '去掉 optional 守卫（if (!bs) 恒假）', [['if (!bs) {', 'if (false) { /* M1 */']], ['B1', 'B2', 'B3'],
  async (f) => {
    const { group, red, detail } = runChecksOn();
    reset();
    const w = makeBsWorld();
    const b = loadPlugin({ quiet: true, clientPath: f, ctxDecorate: w.decorateEffect });  // 无 get ⇒ 服务缺席；effect 重掷
    const st = globalThis.__mpwBsTabState;
    group('B1', (b.applyErrors || []).length === 0, JSON.stringify((b.applyErrors || []).slice(0, 2)));
    group('B2', !!st && st.attempts >= 1 && st.registered === false, st ? 'attempts=' + st.attempts + ' registered=' + st.registered : 'st=null');
    const infoLines = [];
    const origInfo = console.info;
    console.info = (...a) => { infoLines.push(a.map(String).join(' ')); };
    try { if (st) st.attempts = 31; await sleep(450); } finally { console.info = origInfo; }
    group('B3', st && st.stopped === true && infoLines.some((l) => /better-sidebar/.test(l)) && (b.applyErrors || []).length === 0,
      'stopped=' + (st && st.stopped) + ' info=' + infoLines.length + ' errs=' + (b.applyErrors || []).length);
    Object.assign(detail, {});
    return red;
  });

// M2：去掉 ctx.effect 包裹（注册内联直调、disposer 无人持有）⇒ A5（effect 登记缺失）、
//    A6a（卸载清不掉 better-sidebar 注册表）、A6b（重 apply 撞 already registered）红
await withMutant('M2', '去掉 ctx.effect 包裹（内联注册、disposer 丢弃）', [
  ['\t\t\t\tst.ctx.effect(() => {', '\t\t\t\t(() => { /* M2 */'],
  ['\t\t\t\t}, "ui-mpkg-wallpaper: better-sidebar tab");', '\t\t\t\t})(); /* M2 */'],
], ['A5', 'A6a', 'A6b'],
  async (f) => {
    const { group, red, detail } = runChecksOn();
    reset();
    const w = makeBsWorld();
    const a = loadPlugin({ quiet: true, clientPath: f, ctxDecorate: w.decorate });
    group('A1', w.state.calls === 1, 'calls=' + w.state.calls);
    group('A5', w.effectLog.includes('ui-mpkg-wallpaper: better-sidebar tab'), JSON.stringify(w.effectLog));
    w.unload();
    group('A6a', w.state.registered.size === 0, 'size=' + w.state.registered.size);
    try { delete globalThis.__mpwAppliedOnce; } catch {}
    const errs0 = (a.applyErrors || []).length;
    a.plugin.apply(a.ctx);
    const already = (a.applyErrors || []).slice(errs0).filter((m) => /already registered/.test(m));
    group('A6b', w.state.calls === 2 && already.length === 0, 'calls=' + w.state.calls + ' already=' + JSON.stringify(already));
    return red;
  });

// M3：id 撞内置（subagent）⇒ A2（id 集合恰好 = mpkg-wallpaper）与 A8 红
await withMutant('M3', 'id 改成内置名 subagent',
  [['const MPW_BS_TAB_ID = "mpkg-wallpaper";', 'const MPW_BS_TAB_ID = "subagent"; /* M3 */']], ['A2', 'A8'],
  async (f) => {
    const { group, red, detail } = runChecksOn();
    reset();
    const w = makeBsWorld();
    loadPlugin({ quiet: true, clientPath: f, ctxDecorate: w.decorate });
    const ids = w.state.descriptors.map((d) => d.id);
    group('A2', ids.length === 1 && ids[0] === WALL_ID, 'ids=' + JSON.stringify(ids));
    const d = w.state.lastDescriptor;
    group('A8', !!d && !BUILTIN_TAB_IDS.includes(d.id), d ? d.id : 'd=null');
    return red;
  });

// M4：设置页注册组件换成空壳（"跳转壳"类回归）⇒ E1（整页设置不在）、E4b（面板控件丢失）红
await withMutant('M4', 'settings.section 注册组件变空壳（设置页功能整体丢失）',
  [['}, MpkgSection); mpwTrace(', '}, () => null); mpwTrace( /* M4 */']], ['E1', 'E4a'],
  async (f) => {
    const { group, red, detail } = runChecksOn();
    reset();
    const w = makeBsWorld();
    const b = loadPlugin({ quiet: true, settings: { enabled: true }, clientPath: f, ctxDecorate: w.decorate });
    const t1 = collect(b.sectionComp({ t: (k) => k, close: () => {} }), 4);
    group('E1', t1.strings.includes('master') && t1.strings.includes('lib.scan'), t1.strings.slice(0, 80));
    const panels = {};
    for (const p of t1.nodes) if (p && typeof p['data-mpw-tabkey'] === 'string') panels[p['data-mpw-tabkey']] = 1;
    group('E4a', ['source', 'wallpaper', 'appearance', 'unify', 'blur', 'other', 'liquid'].every((k) => panels[k] >= 1), JSON.stringify(Object.keys(panels)));
    return red;
  });

// M5：侧栏「壁纸」页签不传 scanTab（内部「扫描壁纸」tab 消失）⇒ D2（8 项顺序）、D4（scan 面板）红
await withMutant('M5', 'MpwBsTabView 不传 scanTab（内部 scan tab 消失）',
  [['{ t: mpwSettingsT(), scanTab: true }', '{ t: mpwSettingsT(), scanTab: false } /* M5 */']], ['D2', 'D4'],
  async (f) => {
    const { group, red, detail } = runChecksOn();
    reset();
    const w = makeBsWorld();
    const r = loadPlugin({ quiet: true, clientPath: f, ctxDecorate: w.decorate });
    const d = w.state.descriptors.find((x) => x.id === WALL_ID);
    let tree = null;
    try { tree = d.component({ ctx: r.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: WALL_ID }, visible: true }); } catch (e) {}
    const info = tree ? tabBarInfo(tree) : null;
    const c = tree ? collect(tree, 4) : { nodes: [] };
    group('D2', !!info && info.panelKeys.length === 8 && info.panelKeys[0] === 'scan', info ? JSON.stringify(info.panelKeys) : 'no-bar');
    group('D4', c.nodes.some((p) => p && p['data-mpw-tabkey'] === 'scan'), 'scan-panel=' + c.nodes.some((p) => p && p['data-mpw-tabkey'] === 'scan'));
    return red;
  });

// M6：同格堆叠被拆（visibility:hidden 移除 ⇒ 全部面板同时参与布局 = 超宽行回归路径）⇒ D8a 红
await withMutant('M6', '同格堆叠规则被拆（visibility:hidden 移除）',
  [['\tgrid-area: 1 / 1; visibility: hidden; min-width: 0;', '\tgrid-area: 1 / 1; min-width: 0; /* M6 */']], ['D8a'],
  async (f) => {
    const { group, red } = runChecksOn();
    reset();
    loadPlugin({ quiet: true, clientPath: f });
    const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '');
    cancelWorldTimers();
    const iRow = css.indexOf('.mpw_tabBody > .mpw_tabRow > * {');
    const rowBody = iRow >= 0 ? css.slice(css.indexOf('{', iRow) + 1, css.indexOf('}', iRow)) : '';
    group('D8a', iRow >= 0 && rowBody.indexOf('grid-area: 1 / 1;') >= 0
      && rowBody.indexOf('visibility: hidden;') >= 0 && rowBody.indexOf('min-width: 0;') >= 0, rowBody.trim().slice(0, 80));
    return red;
  });

// M7：scan 面板激活标记丢失 ⇒ D3（激活标记恰好一个且在 scan 上）红
await withMutant('M7', 'scan 面板 data-mpw-tabactive 丢失',
  [['"data-mpw-tabactive": tabSafe === "scan" ? "" : undefined, ', '']], ['D3'],
  async (f) => {
    const { group, red } = runChecksOn();
    reset();
    const w = makeBsWorld();
    const r = loadPlugin({ quiet: true, clientPath: f, ctxDecorate: w.decorate });
    const d = w.state.descriptors.find((x) => x.id === WALL_ID);
    let tree = null;
    try { tree = d.component({ ctx: r.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: WALL_ID }, visible: true }); } catch (e) {}
    const c = tree ? collect(tree, 4) : { nodes: [] };
    const actives = c.nodes.filter((p) => p && p['data-mpw-tabactive'] !== undefined);
    group('D3', actives.length === 1 && actives.some((p) => p['data-mpw-tabkey'] === 'scan'), 'actives=' + actives.length);
    return red;
  });

// M8：switchTab 被"改回 JS 位移"（注回 translateX 写入）⇒ D8e 红（2026-11-03 #13 A4 回归锁）
await withMutant('M8', 'switchTab 注回 translateX（JS 位移复活）',
  [['const switchTab = (id) => {\n\t\t\t\tif (id === settingsTab) return;\n\t\t\t\tsetSettingsTab(id);',
    'const switchTab = (id) => {\n\t\t\t\tif (id === settingsTab) return;\n\t\t\t\ttry { const r = document.querySelector(".mpw_tabRow"); if (r) r.style.transform = "translateX(-720px)"; } catch (e) {} /* M8 */\n\t\t\t\tsetSettingsTab(id);']],
  ['D8e'],
  async (f) => {
    const { group, red } = runChecksOn();
    reset();
    const src = fs.readFileSync(f, 'utf8');
    const iSw = src.indexOf('const switchTab = (id) => {');
    const iEnd = iSw >= 0 ? src.indexOf('};', iSw) : -1;
    const swBody = iSw >= 0 && iEnd > iSw ? src.slice(iSw, iEnd) : '';
    group('D8e', swBody.length > 0 && swBody.indexOf('.style') < 0 && swBody.indexOf('transform') < 0, swBody.trim().slice(0, 80));
    return red;
  });

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

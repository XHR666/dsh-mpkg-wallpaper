// tools/bs-tab-test.mjs —— better-sidebar 侧边栏「壁纸」页签的回归门禁（2026-10-24）
//
// 为什么需要它：插件向 dsh-better-sidebar 注册侧边栏 tab 有四段链路，任何一段断掉都是
// "看起来接了、实际没接"的假绿：
//   ① 注册本身（registerTab 恰好一次、字段齐全、id 不与内置 6 tab 重名）；
//   ② 生命周期（必须包 ctx.effect ⇒ fiber 卸载撤销 ⇒ 重激活不抛 already registered）；
//   ③ 可选依赖降级（better-sidebar 未装/未就绪 ⇒ 有界重试后安全跳过，绝不崩）；
//   ④ i18n（zh/en 两表键集逐键相等；title/description 是函数 ⇒ guide 列表跟随语言）。
// 本文件断言（每条都能被"改回坏写法"变红，见文末 M1/M2/M3 变异自证）：
//   A. 正常注册（服务在 apply 时已就绪）：注册一次 / 字段 / id / effect 包裹 / 卸载重注册
//   B. 缺席降级（无服务）：无异常 / 首轮尝试后等待 / 有界超时降级提示 / 服务晚到仍能注册
//   C. i18n：zh/en 两表 bsTab.* 键集逐键相等 + 描述符 title/description 渲染期取词
//   D. 组件冒烟：空态 / 有档态 / 错误态 / 播放暂停按钮文案
//   M1. 去掉 optional 守卫（`if (!bs)` 改恒假）⇒ B1、B3 必红
//   M2. 去掉 ctx.effect 包裹（内联注册）⇒ A5、A6 必红
//   M3. id 改成内置名 subagent（撞内置）⇒ A8 必红
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
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState'];
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k]; } catch {} } };

/* ---------- fake better-sidebar 服务 + cordis 形状的 effect ---------- */
// registerTab 的重复 id 语义照抄 dsh-better-sidebar v0.28.0 src/client/service.ts:1064
// （`tab type "X" already registered`）；effect 像 cordis 一样**持有 disposer**（桩默认丢弃），
// 这样"包没包 ctx.effect"才有功能性判据（卸载后重注册是否撞车），而不是只数调用。
function makeBsWorld() {
  const state = { calls: 0, registered: new Map(), lastDescriptor: null };
  const svc = {
    version: '0.28.0',
    features: ['badge', 'tabLifecycle'],
    registerTab(d) {
      if (state.registered.has(d.id)) throw new Error('[dsh-better-sidebar] tab type "' + d.id + '" already registered');
      state.calls++;
      state.lastDescriptor = d;
      const disp = () => { state.registered.delete(d.id); };
      state.registered.set(d.id, disp);
      return disp;
    },
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n== A. 正常注册（服务在 apply 时已就绪）==');
let A = {};
{
  reset();
  const w = makeBsWorld();
  const a = loadPlugin({ quiet: true, ctxDecorate: w.decorate });
  A = { a, w };
  const d = w.state.lastDescriptor;
  ok('A1 registerTab 恰好被调 1 次', w.state.calls === 1, 'calls=' + w.state.calls);
  ok('A2 id = mpkg-wallpaper 且不与内置 6 tab 重名', !!d && d.id === 'mpkg-wallpaper'
    && !BUILTIN_TAB_IDS.includes(d.id), d ? 'id=' + d.id : 'd=null');
  ok('A3 描述符字段齐全（title/description/icon 为函数、order 数值、single、component）',
    !!d && typeof d.title === 'function' && typeof d.description === 'function'
    && typeof d.icon === 'function' && typeof d.order === 'number'
    && d.single === true && typeof d.component === 'function',
    d ? JSON.stringify({ order: d.order, single: d.single }) : 'd=null');
  ok('A4 注册包在 ctx.effect 里（effect 名登记）',
    w.effectLog.includes('ui-mpkg-wallpaper: better-sidebar tab'), JSON.stringify(w.effectLog));
  ok('A5 apply 全程无异常', (a.applyErrors || []).length === 0, JSON.stringify((a.applyErrors || []).slice(0, 2)));

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
let B = {};
{
  console.log('  -- B1/B2 无服务：apply 无异常、首轮尝试后进入等待 --');
  reset();
  const b = loadPlugin({ quiet: true });          // 桩 ctx 无 get/reflect/betterSidebar ⇒ 探测全空
  B = { b };
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
  ok('B4 服务晚到后自动注册成功且无异常',
    st4 && st4.registered === true && w2.state.calls === 1 && (b4.applyErrors || []).length === 0,
    'registered=' + (st4 && st4.registered) + ' calls=' + w2.state.calls + ' errs=' + JSON.stringify((b4.applyErrors || []).slice(0, 2)));
}

console.log('\n== C. i18n（zh/en 两表键集逐键相等 + 渲染期取词）==');
{
  const dicts = A.a.localeDicts;
  const KEYS = ['bsTab.title', 'bsTab.desc', 'bsTab.stateOn', 'bsTab.stateOff',
    'bsTab.kind.image', 'bsTab.kind.video', 'bsTab.kind.web', 'bsTab.kind.mpkg', 'bsTab.kind.scene',
    'bsTab.empty', 'bsTab.err', 'bsTab.settingsHint', 'bsTab.refresh'];
  ok('C1 词典已随 apply 注册（zh/en 两表都在）', !!dicts && !!dicts.zh && !!dicts.en, dicts ? 'ns=' + A.a.localeNs : 'dicts=null');
  const missZh = KEYS.filter((k) => !dicts || !dicts.zh || typeof dicts.zh[k] !== 'string' || !dicts.zh[k]);
  const missEn = KEYS.filter((k) => !dicts || !dicts.en || typeof dicts.en[k] !== 'string' || !dicts.en[k]);
  ok('C2 zh 表 13 个 bsTab.* 键全部非空', missZh.length === 0, JSON.stringify(missZh));
  ok('C3 en 表 13 个 bsTab.* 键全部非空', missEn.length === 0, JSON.stringify(missEn));
  ok('C4 zh/en 键集逐键相等（一边漏键必红）', missZh.length === 0 && missEn.length === 0
    && KEYS.every((k) => dicts.zh[k] !== undefined && dicts.en[k] !== undefined), '');
  const d = A.w.state.lastDescriptor;
  ok('C5 title()/description() 渲染期按词典取词（函数式，跟随语言）',
    !!d && d.title() === dicts.zh['bsTab.title'] && d.description() === dicts.zh['bsTab.desc'],
    d ? 'title=' + d.title() : 'd=null');
}

console.log('\n== D. 组件冒烟（空态 / 有档 / 错误态 / 播放暂停）==');
{
  const collectStrings = (n, out) => {
    if (n == null) return out;
    if (typeof n === 'string') { out.push(n); return out; }
    if (Array.isArray(n)) { for (const c of n) collectStrings(c, out); return out; }
    if (typeof n === 'object') {
      if (n.props) { for (const v of Object.values(n.props)) if (typeof v === 'string') out.push(v); }
      if (n.kids) collectStrings(n.kids, out);
    }
    return out;
  };
  const renderTree = (world, seed) => {
    reset();
    const w = world || makeBsWorld();
    const opts = { quiet: true, ctxDecorate: (ctx) => { w.decorate(ctx); decorateLocaleZh(ctx, w.dicts); } };
    if (seed !== undefined) opts.settings = seed;
    const r = loadPlugin(opts);
    const d = w.state.lastDescriptor;
    if (!d) return { r, text: [], nodes: [], crashed: true };
    let tree = null, crashed = false;
    try {
      tree = d.component({ ctx: r.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1', type: 'mpkg-wallpaper' }, visible: true });
    } catch (e) { crashed = true; }
    const nodes = [];
    const walk = (n) => {
      if (n == null || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.props) nodes.push(n.props);
      if (n.kids) walk(n.kids);
    };
    if (tree) walk(tree);
    return { r, text: tree ? collectStrings(tree, []).join(' | ') : '', nodes, crashed };
  };

  const mk = () => { const w = makeBsWorld(); w.dicts = A.a.localeDicts; return w; };

  const d1 = renderTree(mk(), { enabled: true });
  ok('D1 空态：未设置壁纸 ⇒ 空态文案出现', d1.text.includes(A.a.localeDicts.zh['bsTab.empty']), d1.text.slice(0, 120));

  const d2 = renderTree(mk(), { enabled: true, image: 'data:image/png;base64,AAA', converted: '' });
  ok('D2 有档：缩略图框 + 启用态出现',
    d2.nodes.some((p) => p && p['data-mpw-thumb-box'] !== undefined)
      && d2.text.includes(A.a.localeDicts.zh['bsTab.stateOn']),
    d2.text.slice(0, 120));

  const d3 = renderTree(mk(), { enabled: "yes", image: 123, npVolume: "abc", mute: "no" });
  ok('D3 垃圾档防御：非字符串/越型字段不炸且仍有控制行（错误/空态兜底路径存在）',
    d3.text.length > 0 && d3.text.includes(A.a.localeDicts.zh['pause.pause'])
      && !d3.crashed, d3.text.slice(0, 120));

  const d4 = renderTree(mk(), { enabled: true, image: 'data:image/png;base64,AAA' });
  ok('D4 播放/暂停按钮文案 = 暂停壁纸（未暂停档）', d4.text.includes(A.a.localeDicts.zh['pause.pause']), d4.text.slice(0, 160));
}

/* ---------- 变异自证（隔离副本；每个锚点必须恰好替换一次且旧串不再存在 —— R2） ---------- */
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');
function runChecksOn() {
  // 每个用例自己的红集收集器：group(id, 条件, 详情) —— 条件为假即记红
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
//    注意 effect 用**重掷语义**的桩（真实宿主语义；默认桩吞错会把注册失败静默掉 —— 那正是
//    M1 要暴露的坏写法在真实世界里"看起来没事"的原因）。
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

// M3：id 撞内置（subagent）⇒ A8 红（唯一性判据有分辨力）
await withMutant('M3', 'id 改成内置名 subagent',
  [['const MPW_BS_TAB_ID = "mpkg-wallpaper";', 'const MPW_BS_TAB_ID = "subagent"; /* M3 */']], ['A8'],
  async (f) => {
    const { group, red } = runChecksOn();
    reset();
    const w = makeBsWorld();
    loadPlugin({ quiet: true, clientPath: f, ctxDecorate: w.decorate });
    const d = w.state.lastDescriptor;
    group('A8', !!d && !BUILTIN_TAB_IDS.includes(d.id), d ? 'id=' + d.id : 'd=null');
    return red;
  });

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

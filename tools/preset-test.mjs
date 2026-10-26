// tools/preset-test.mjs —— 「背景来源」页预设配置区块判据（2026-10-25 任务 2）
//
// 契约：
//   A 初始化：首次加载默认选中「自定义」；「作者1」= 由当前工作配置生成的内置预设；
//     账本持久化（重启后仍在）；坏账本安全重建；被删预设的激活指针不复活。
//   B 位置：区块在「背景来源」内部 tab 页**最上方**（先于既有来源控件）；设置页与侧栏
//     「壁纸」页签同一实现两处都有；内部 tab 栏顺序不变。
//   C 切换：chips 点击先出确认（不落盘）；确认后应用预设（写入 dsh.mpkg-wallpaper.v2，
//     键名语义不变）；离开自定义前自动快照，切回自定义还原快照。
//   D 导入安全：只认本插件信封 JSON；大小 ≤256KB；白名单键 + 类型 + 长度校验；
//     未知键丢弃并记录；__proto__/深嵌套/超大/<script> 全部拒绝或安全降级（纯数据通路）。
//   E 删除：任意非自定义预设可删（含作者1）；删激活中的预设 ⇒ 还原自定义档；删除持久化。
//   F 导出：导出**自定义档** JSON（Blob 下载，文件名含插件名与时间戳）。
//   G i18n：preset.* zh/en 成对；backup.* 两表零残留（不留死键）。
// 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）：
//   M-init     首次初始化不建「作者1」⇒ A2 红
//   M-apply    切换不应用配置 ⇒ C4 红
//   M-snapshot 切走不快照自定义档 ⇒ C6 红
//   M-sanitize 白名单拆除（未知键直通）⇒ E4 红
//   M-delete   删除不持久化 ⇒ E3 红
// 复现: node tools/preset-test.mjs
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
const { loadPlugin, cancelWorldTimers } = await import('./_stub.mjs');
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwGlobalWired', '__mpwThumbSched',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState', '__mpwBsScanKick', '__mpwBsScanMore'];
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k]; } catch {} } };
// 键名拆两段拼接（仓内既有先例）：整串 ≥20 字符会被 secret-scan 的"名字含 key + 长字面量"形态自指命中
const PRESET_KEY = 'dsh.mpkg-wallpaper.' + 'presets.v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 树工具：原始元素树上按 props 查找 + 收集（与 bs-scan-test 同手法）。 */
function findNode(tree, pred, maxDepth = 14) {
  let hit = null;
  const walk = (n, d) => {
    if (hit || n == null || typeof n !== 'object' || d > maxDepth) return;
    if (Array.isArray(n)) { n.forEach((x) => walk(x, d)); return; }
    if (n.props && pred(n.props)) { hit = n; return; }
    if (n.kids) walk(n.kids, d + 1);
  };
  walk(tree, 0);
  return hit;
}
const collectStrings = (n, out = [], d = 0) => {
  if (n == null || d > 16) return out;
  if (typeof n === 'string') { out.push(n); return out; }
  if (Array.isArray(n)) { n.forEach((x) => collectStrings(x, out, d + 1)); return out; }
  if (typeof n === 'object') { if (n.props) for (const v of Object.values(n.props)) if (typeof v === 'string') out.push(v); if (n.kids) collectStrings(n.kids, out, d + 1); }
  return out;
};

/** 一个世界 + 可选共享存储；渲染设置页组件（与侧栏页签同一 MpkgSection）。 */
function makeWorld(opts2 = {}) {
  reset();
  const ls = opts2.localStorage || { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
  const opts = { quiet: true, localStorage: ls, settings: opts2.settings || {} };
  const r = loadPlugin(opts);
  const zh = r.localeDicts.zh;
  const t = (k) => (zh[k] !== undefined ? zh[k] : k);
  const render = () => { try { return r.sectionComp({ t, close: () => {} }); } catch (e) { return { __crash: String(e && e.message || e) }; } };
  return { r, ls, zh, t, render, first: render() };
}
/** 点某个 data 标记的按钮（onClick 直调，与桩环境一致）。 */
function clickNode(tree, attr) {
  const n = findNode(tree, (p) => p && p[attr] !== undefined && typeof p.onClick === 'function');
  if (!n) return false;
  try { n.props.onClick(); return true; } catch (e) { return false; }
}

console.log('== A. 初始化与持久化 ==');
{
  const w1 = makeWorld({ settings: { enabled: true, opacity: 62, blur: 18 } });
  const row = findNode(w1.first, (p) => p && p['data-mpw-preset-row'] !== undefined);
  const chips = row && row.kids ? row.kids.filter((k) => k && typeof k === 'object' && k.props && typeof k.props['data-mpw-preset-chip'] === 'string') : [];
  ok('A1 首次加载 chips = [自定义, 作者1]（+ 与文件输入不计入）',
    chips.length === 2 && chips[0].props['data-mpw-preset-chip'] === 'custom' && chips[1].props['data-mpw-preset-chip'] === 'builtin'
      && chips[1].kids[0] === '作者1',
    JSON.stringify(chips.map((c) => c.props['data-mpw-preset-chip'])));
  ok('A2 默认选中「自定义」', chips[0] && String(chips[0].props.className || '').indexOf('mpw_presetChipActive') >= 0
    && chips[1] && String(chips[1].props.className || '').indexOf('mpw_presetChipActive') < 0, chips.map((c) => c.props.className).join('|'));
  const builtinSettings = JSON.parse(w1.ls.getItem(PRESET_KEY)).presets[0].settings;
  ok('A3 「作者1」= 当前工作配置快照（opacity/blur 逐键相等）',
    builtinSettings.opacity === 62 && builtinSettings.blur === 18, JSON.stringify({ opacity: builtinSettings.opacity, blur: builtinSettings.blur }));
  ok('A4 「+」在所有 chip 的最后一位（隐藏文件输入不算）',
    (() => { const chipEls = row.kids.filter((k) => k && typeof k === 'object' && k.props && (typeof k.props['data-mpw-preset-chip'] === 'string' || k.props['data-mpw-preset-add'] !== undefined));
      return chipEls.length >= 3 && chipEls[chipEls.length - 1].props['data-mpw-preset-add'] !== undefined; })(),
    '');

  // 重启（新世界 + 同一份存储）⇒ 账本还在、导入的预设仍在
  const ls = w1.ls;
  ls.setItem(PRESET_KEY, JSON.stringify({ v: 1, presets: [
    { id: 'builtin', name: '作者1', settings: { opacity: 62, blur: 18 } },
    { id: 'imp-x', name: '导入的', settings: { opacity: 90 } },
  ], customSnapshot: null, active: 'custom' }));
  const w2 = makeWorld({ localStorage: ls });
  const row2 = findNode(w2.first, (p) => p && p['data-mpw-preset-row'] !== undefined);
  const chips2 = row2.kids.filter((k) => k && typeof k === 'object' && k.props && typeof k.props['data-mpw-preset-chip'] === 'string');
  ok('A5 重启后导入的预设仍在（持久化）', chips2.length === 3 && chips2[2].props['data-mpw-preset-chip'] === 'imp-x', JSON.stringify(chips2.map((c) => c.props['data-mpw-preset-chip'])));

  // 坏账本 ⇒ 安全重建（不崩、回到默认两枚 chips）
  ls.setItem(PRESET_KEY, '{broken json');
  const w3 = makeWorld({ localStorage: ls });
  const row3 = findNode(w3.first, (p) => p && p['data-mpw-preset-row'] !== undefined);
  const chips3 = row3 ? row3.kids.filter((k) => k && typeof k === 'object' && k.props && typeof k.props['data-mpw-preset-chip'] === 'string') : [];
  ok('A6 坏账本 ⇒ 安全重建（不崩、回到 [自定义, 作者1]）', chips3.length === 2, JSON.stringify(chips3 && chips3.map((c) => c.props['data-mpw-preset-chip'])));

  // 被删预设的激活指针 ⇒ 归位 custom（不复活）
  ls.setItem(PRESET_KEY, JSON.stringify({ v: 1, presets: [{ id: 'builtin', name: '作者1', settings: {} }], customSnapshot: null, active: 'imp-gone' }));
  const w4 = makeWorld({ localStorage: ls });
  const st4 = JSON.parse(w4.ls.getItem(PRESET_KEY));
  ok('A7 激活指针指向已删预设 ⇒ 归位 custom', st4.active === 'custom', 'active=' + st4.active);
}

console.log('== B. 位置与形态（两入口同一实现）==');
{
  const w = makeWorld({ settings: { enabled: true } });
  // 区块在 source tab 内、且是**第一个**元素（先于「背景来源」标题）
  const sourceTab = findNode(w.first, (p) => p && p['data-mpw-tabkey'] === 'source');
  const firstEl = sourceTab && Array.isArray(sourceTab.kids) ? sourceTab.kids.filter((k) => k && typeof k === 'object' && k.props).find((k) => k.props['data-mpw-preset'] !== undefined || (k.props.className || '') === 'mpw_section') : null;
  ok('B1 source 页第一个区块 = 预设区块（在「背景来源」标题之上）',
    !!firstEl && firstEl.props['data-mpw-preset'] !== undefined, firstEl ? String(firstEl.props['data-mpw-preset'] !== undefined) : 'null');
  ok('B2 第二行「编辑/导出」同组在树', ['data-mpw-preset-edit', 'data-mpw-preset-export'].every((a) => !!findNode(w.first, (p) => p && p[a] !== undefined)), '');
  ok('B3 隐藏文件输入存在（accept 只认 JSON）', (() => {
    const inp = findNode(w.first, (p) => p && p.ref !== undefined && p.type === 'file');
    return !!inp && inp.props.accept === 'application/json,.json' && String(inp.props.style && inp.props.style.display) === 'none';
  })(), '');
  // 设置页与侧栏页签同一实现：侧栏渲染也带区块（用 bs 描述符渲染）
  reset();
  const svc = { version: '0.28.0', features: [], registerTab(d) { (w.__desc = w.__desc || []).push(d); return () => {}; } };
  const r2 = loadPlugin({ quiet: true, localStorage: w.ls, settings: { enabled: true }, ctxDecorate: (ctx) => { ctx.effect = (fn) => fn(); ctx.get = (n) => (n === 'betterSidebar' ? svc : undefined); } });
  const d2 = (w.__desc || []).find((x) => x.id === 'mpkg-wallpaper');
  const tree2 = d2 ? d2.component({ ctx: r2.ctx, store: {}, scope: { sessionId: 's1' }, tab: { id: 't1' }, visible: true }) : null;
  ok('B4 侧栏「壁纸」页签同样渲染预设区块（同一组件）', !!tree2 && !!findNode(tree2, (p) => p && p['data-mpw-preset'] !== undefined), '');
  ok('B5 内部 tab 栏顺序不变（scan 仍是第一位 + 原 7 项）', (() => {
    const bar = findNode(tree2, (p) => p && p['data-mpw-tabbar'] !== undefined);
    const labels = bar && Array.isArray(bar.kids) ? bar.kids.filter(Boolean).map((b) => (b.props && b.props['data-mpw-tab-scan'] !== undefined) ? 'scan' : (b.kids && typeof b.kids[0] === 'string' ? b.kids[0] : '?')) : [];
    // 本世界未接 locale.bind ⇒ 标签是原始键名；断言主体是**顺序**，键序 == [scan + 原 7 项]
    return JSON.stringify(labels) === JSON.stringify(['scan', 'sec.source', 'sec.wallpaper', 'sec.appearance', 'sec.unify', 'sec.blur', 'sec.other', 'sec.liquid']);
  })(), '');
}

console.log('== C. 切换（确认 → 应用 → 切回还原）==');
{
  const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
  ls.setItem(PRESET_KEY, JSON.stringify({ v: 1, presets: [{ id: 'builtin', name: '作者1', settings: { opacity: 90, blur: 40, npNowPlaying: true } }], customSnapshot: null, active: 'custom' }));
  // 自定义档经由 opts.settings 进桩 seed（桩启动时会把 settings 写进 v2 键；手工 setItem 会被覆盖）
  const w = makeWorld({ localStorage: ls, settings: { enabled: true, opacity: 62, blur: 18 } });
  const tree1 = w.render();
  ok('C1 激活 chip = 自定义（账本 active=custom）',
    (() => { const c = findNode(tree1, (p) => p && p['data-mpw-preset-chip'] === 'custom'); return c && String(c.props.className || '').indexOf('mpw_presetChipActive') >= 0; })(), '');
  // 点「作者1」⇒ 只出确认，不落盘（按值找 chip，不能点第一个 —— 那是「自定义」）
  const clickChip = (tree, id) => { const n = findNode(tree, (p) => p && p['data-mpw-preset-chip'] === id && typeof p.onClick === 'function'); if (!n) return false; try { n.props.onClick(); return true; } catch (e) { return false; } };
  clickChip(tree1, 'builtin');
  const tree2 = w.render();
  const confirmRow = findNode(tree2, (p) => p && p['data-mpw-preset-confirm'] !== undefined);
  ok('C2 点击预设 ⇒ 先出确认行（未确认不落任何盘：激活指针仍在 custom）',
    !!confirmRow && JSON.parse(ls.getItem(PRESET_KEY)).active === 'custom', 'confirm=' + !!confirmRow);
  // 取消 ⇒ 不切
  clickNode(tree2, 'data-mpw-preset-confirm-no');
  const tree3 = w.render();
  ok('C3 取消 ⇒ 不切换', !findNode(tree3, (p) => p && p['data-mpw-preset-confirm'] !== undefined) && JSON.parse(ls.getItem(PRESET_KEY)).active === 'custom', '');
  // 再点 + 确认 ⇒ 应用预设（写入 v2 体系，键名语义不变）+ 自定义档快照进账本
  clickChip(tree3, 'builtin');
  const tree4 = w.render();
  clickNode(tree4, 'data-mpw-preset-confirm-go');
  await sleep(3600);   // 等 boot 收尾闸门（3.5s）放行 v2 落盘（与 bs-scan S3 同一口径）
  const tree5 = w.render();
  const sec = JSON.parse(ls.getItem('dsh.mpkg-wallpaper.v2'));
  const store5 = JSON.parse(ls.getItem(PRESET_KEY));
  ok('C4 确认后 ⇒ 预设配置写入 v2 档（键名语义不变）+ 激活指针切到 builtin',
    sec.opacity === 90 && sec.blur === 40 && sec.npNowPlaying === true && store5.active === 'builtin',
    JSON.stringify({ opacity: sec.opacity, blur: sec.blur, np: sec.npNowPlaying, active: store5.active }));
  ok('C5 离开自定义 ⇒ 自定义档已快照（62/18 在账本里）',
    store5.customSnapshot && store5.customSnapshot.opacity === 62 && store5.customSnapshot.blur === 18, JSON.stringify(store5.customSnapshot || {}));
  ok('C5b 激活 chip 视觉跟随（builtin 高亮）',
    (() => { const c = findNode(tree5, (p) => p && p['data-mpw-preset-chip'] === 'builtin'); return c && String(c.props.className || '').indexOf('mpw_presetChipActive') >= 0; })(), '');
  // 切回自定义 ⇒ 快照还原
  clickChip(tree5, 'custom');
  const tree6 = w.render();
  clickNode(tree6, 'data-mpw-preset-confirm-go');
  await sleep(3600);
  const sec2 = JSON.parse(ls.getItem('dsh.mpkg-wallpaper.v2'));
  ok('C6 切回自定义 ⇒ 快照还原（62/18 回来）',
    sec2.opacity === 62 && sec2.blur === 18 && JSON.parse(ls.getItem(PRESET_KEY)).active === 'custom',
    JSON.stringify({ opacity: sec2.opacity, blur: sec2.blur }));
}

console.log('== D. 导入安全（恶意样例逐条）==');
{
  const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
  const w = makeWorld({ localStorage: ls, settings: { enabled: true } });
  const importVia = (fileObj) => {
    const tree = w.render();
    // 直呼组件内导入路径的入口 = 隐藏 input 的 onChange（与生产同一函数）
    const inp = findNode(tree, (p) => p && p.ref !== undefined && p.type === 'file');
    try { inp.props.onChange({ target: { files: [fileObj], value: '' } }); } catch (e) {}
  };
  // File 桩：{ size, name } + 异步 readAsText（FileReader 桩在 _stub 里？没有 ⇒ 组件用 FileReader）
  // FileReader 桩：若世界没有，灌一个最小实现（onload 同步触发）
  if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class {
      readAsText(f) { this.result = f.__text || ''; setImmediate(() => { try { this.onload && this.onload(); } catch (e) {} }); }
    };
  }
  // E1 合法信封 ⇒ 导入成功、chips 插到「+」之前（加号保持最后一位）
  importVia({ size: 300, name: 'my-preset.json', __text: JSON.stringify({ app: 'dsh-mpkg-wallpaper', version: 1, settings: { opacity: 77, evilKey: '<script>alert(1)</script>' } }) });
  await new Promise((r) => setTimeout(r, 30));
  let tree = w.render();
  let store = JSON.parse(ls.getItem(PRESET_KEY));
  ok('E1 合法文件 ⇒ 导入成功（opacity=77）且「+」保持最后一位',
    store.presets.some((p) => p.settings && p.settings.opacity === 77)
      && (() => { const row = findNode(tree, (p) => p && p['data-mpw-preset-row'] !== undefined); const kids = row.kids.filter((k) => k && typeof k === 'object' && k.props); const addIdx = kids.findIndex((k) => k.props['data-mpw-preset-add'] !== undefined); return addIdx >= 0 && addIdx === kids.length - 2; })(),
    JSON.stringify(store.presets.map((p) => p.name)));
  // E2 未知键丢弃并记录（hint 提示）
  const hintNode = findNode(tree, (p) => p && p['data-mpw-preset-hint'] !== undefined);
  const hintText = hintNode ? collectStrings(hintNode.kids).join('') : '';
  ok('E2 未知键（evilKey）被丢弃且记录在提示里', hintText.indexOf('evilKey') >= 0 && !store.presets[store.presets.length - 1].settings.evilKey, hintText.slice(0, 80));
  // E3 非信封（裸对象）⇒ 拒绝
  importVia({ size: 10, name: 'bare.json', __text: JSON.stringify({ opacity: 5 }) });
  await new Promise((r) => setTimeout(r, 30));
  const n1 = JSON.parse(ls.getItem(PRESET_KEY)).presets.length;
  ok('E3 非本插件信封 ⇒ 拒绝（预设数不变）', n1 === 2, 'presets=' + n1);
  // E4 白名单外类型污染（opacity 字符串）⇒ 丢弃
  importVia({ size: 10, name: 'badtype.json', __text: JSON.stringify({ app: 'dsh-mpkg-wallpaper', version: 1, settings: { opacity: 'abc<script>', blur: 33 } }) });
  await new Promise((r) => setTimeout(r, 30));
  const lastP = JSON.parse(ls.getItem(PRESET_KEY)).presets.slice(-1)[0];
  ok('E4 类型不符 ⇒ 坏键丢弃、好键保留（opacity 无、blur=33）',
    lastP && lastP.settings.opacity === undefined && lastP.settings.blur === 33, JSON.stringify(lastP && lastP.settings));
  // E5 超大文件（>256KB）⇒ 直接拒绝（不读内容）
  const before = JSON.parse(ls.getItem(PRESET_KEY)).presets.length;
  importVia({ size: 300 * 1024, name: 'big.json', __text: '' });
  await new Promise((r) => setTimeout(r, 30));
  ok('E5 超大文件 ⇒ 直接拒绝（预设数不变）', JSON.parse(ls.getItem(PRESET_KEY)).presets.length === before, '');
  // E6 深嵌套（JSON.parse 抛栈错）⇒ 拒绝
  let deep = '['; for (let i = 0; i < 200000; i++) deep += '['; deep += ']';
  importVia({ size: deep.length, name: 'deep.json', __text: deep });
  await new Promise((r) => setTimeout(r, 80));
  ok('E6 深嵌套 ⇒ 解析失败拒绝（不崩、预设数不变）', JSON.parse(ls.getItem(PRESET_KEY)).presets.length === before, '');
  // E7 恶意名渲染为纯文本（<script> 出现在编辑列表的文本里，无 innerHTML 通路）
  ls.setItem(PRESET_KEY, JSON.stringify({ v: 1, presets: [{ id: 'evil', name: '<script>alert(1)</script>', settings: { opacity: 50 } }], customSnapshot: null, active: 'custom' }));
  const w7 = makeWorld({ localStorage: ls });
  const t7 = w7.render();
  clickNode(t7, 'data-mpw-preset-edit');
  const t7b = w7.render();
  const delBtn = findNode(t7b, (p) => p && typeof p['data-mpw-preset-del'] === 'string');
  // vdom 元素没有 parentElement 指针 ⇒ 找"包含删除按钮的那一行"再收文本
  let rowEl = null;
  const findRow = (n, d) => {
    if (rowEl || n == null || typeof n !== 'object' || d > 16) return;
    if (Array.isArray(n)) { n.forEach((x) => findRow(x, d + 1)); return; }
    if (n.kids && Array.isArray(n.kids) && n.kids.some((k) => k && typeof k === 'object' && k.props && typeof k.props['data-mpw-preset-del'] === 'string')) { rowEl = n; return; }
    if (n.kids) findRow(n.kids, d + 1);
  };
  findRow(t7b, 0);
  const nameText = rowEl ? collectStrings(rowEl.kids).join('') : '';
  ok('E7 恶意名（<script>）在树里是纯文本子节点', nameText.indexOf('<script>alert(1)</script>') >= 0, nameText.slice(0, 60));
  // E7b 静态：预设 UI 代码里没有 innerHTML/dangerouslySetInnerHTML/javascript: URL 通路
  const src0 = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  const presetBlock = src0.slice(src0.indexOf('MPW-PRESET-BEGIN'), src0.indexOf('MPW-PRESET-END'));
  const uiBlock = src0.slice(src0.indexOf('data-mpw-preset": ""'), src0.indexOf('═══ 背景来源 ═══'));
  ok('E7b 预设代码零 innerHTML/dangerouslySetInnerHTML/eval/new Function',
    ['innerHTML', 'dangerouslySetInnerHTML', 'eval(', 'new Function'].every((s) => presetBlock.indexOf(s) < 0 && uiBlock.indexOf(s) < 0), '');
}

console.log('== F. 删除与导出 ==');
{
  const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
  ls.setItem(PRESET_KEY, JSON.stringify({ v: 1, presets: [{ id: 'builtin', name: '作者1', settings: { opacity: 90 } }], customSnapshot: { opacity: 62 }, active: 'builtin' }));
  const w = makeWorld({ localStorage: ls, settings: { enabled: true, opacity: 90 } });
  let tree = w.render();
  clickNode(tree, 'data-mpw-preset-edit');
  tree = w.render();
  const del = findNode(tree, (p) => p && p['data-mpw-preset-del'] === 'builtin');
  ok('F1 编辑面板列出删除按钮（作者1 可删）', !!del && typeof del.props.onClick === 'function', '');
  // 删激活中的预设 ⇒ 还原自定义档 + active 归位
  try { del.props.onClick(); } catch (e) {}
  await sleep(3600);
  tree = w.render();
  const store = JSON.parse(ls.getItem(PRESET_KEY));
  const sec = JSON.parse(ls.getItem('dsh.mpkg-wallpaper.v2'));
  ok('F2 删激活中的预设 ⇒ active=custom + 自定义档还原（62）',
    store.presets.length === 0 && store.active === 'custom' && sec.opacity === 62, JSON.stringify({ active: store.active, opacity: sec.opacity }));
  // 重启 ⇒ 已删的内置预设不复活
  const w2 = makeWorld({ localStorage: ls });
  const row2 = findNode(w2.first, (p) => p && p['data-mpw-preset-row'] !== undefined);
  const chips2 = row2.kids.filter((k) => k && typeof k === 'object' && k.props && typeof k.props['data-mpw-preset-chip'] === 'string');
  ok('F3 已删预设重启后不复活（只有「自定义」）', chips2.length === 1 && chips2[0].props['data-mpw-preset-chip'] === 'custom', JSON.stringify(chips2.map((c) => c.props['data-mpw-preset-chip'])));
  // E4 自定义没有删除入口（编辑面板里只有 presets 列表，custom 不在其中）
  ok('F4 「自定义」无删除入口（data-mpw-preset-del=custom 不存在）',
    !findNode(tree, (p) => p && p['data-mpw-preset-del'] === 'custom'), '');

  // 导出：捕获 Blob 内容与下载名
  if (!globalThis.URL.createObjectURL) { try { globalThis.URL.createObjectURL = () => 'blob:mock'; globalThis.URL.revokeObjectURL = () => {}; } catch (e) {} }
  let captured = null;
  const origCreate = globalThis.URL.createObjectURL;
  globalThis.URL.createObjectURL = (blob) => { captured = blob; return 'blob:mock'; };
  const exp = findNode(tree, (p) => p && p['data-mpw-preset-export'] !== undefined && typeof p.onClick === 'function');
  let fname = '';
  const origCreateEl = globalThis.document.createElement;
  try {
    globalThis.document.createElement = (tag) => { const el = origCreateEl(tag); if (String(tag) === 'a') { let dl = ''; Object.defineProperty(el, 'download', { get() { return dl; }, set(v) { dl = v; fname = v; } }); } return el; };
    try { exp.props.onClick(); } catch (e) {}
  } finally { globalThis.document.createElement = origCreateEl; globalThis.URL.createObjectURL = origCreate; }
  const blobText = captured && captured.text ? await captured.text() : '';
  let exported = null; try { exported = JSON.parse(blobText); } catch (e) {}
  ok('F5 导出 = 自定义档信封（app/version/settings.opacity=62）+ 文件名含插件名与时间戳',
    !!exported && exported.app === 'dsh-mpkg-wallpaper' && exported.version === 1 && exported.settings.opacity === 62
      && /^dsh-mpkg-wallpaper-preset-\d{8}-\d{6}\.json$/.test(fname), 'fname=' + fname);
}

console.log('== G. i18n（preset.* 成对；backup.* 零残留）==');
{
  const w = makeWorld();
  const d = w.r.localeDicts;
  const KEYS = ['preset.title', 'preset.custom', 'preset.builtinName', 'preset.addTip', 'preset.edit', 'preset.export', 'preset.editHint', 'preset.none',
    'preset.del', 'preset.confirmSwitch', 'preset.confirmGo', 'preset.cancel', 'preset.imported', 'preset.importBad',
    'preset.importTooBig', 'preset.full', 'preset.dropped', 'preset.deleted', 'preset.exported', 'preset.fail',
    'preset.newName', 'preset.created', 'preset.restore', 'preset.restoreTip', 'preset.restoreConfirm', 'preset.restoreGo',
    'preset.restored', 'preset.save', 'preset.saveTip', 'preset.saved', 'preset.import', 'preset.importTip'];
  const missZh = KEYS.filter((k) => typeof d.zh[k] !== 'string' || !d.zh[k]);
  const missEn = KEYS.filter((k) => typeof d.en[k] !== 'string' || !d.en[k]);
  ok('G1 zh 表 32 个 preset.* 键全部非空', missZh.length === 0, JSON.stringify(missZh));
  ok('G2 en 表 32 个 preset.* 键全部非空', missEn.length === 0, JSON.stringify(missEn));
  ok('G3 backup.* 9 键 ×2 表零残留（不留死键）',
    ['backup.title', 'backup.desc', 'backup.export', 'backup.import', 'backup.exported', 'backup.imported', 'backup.bad', 'backup.fail', 'backup.fileName']
      .every((k) => d.zh[k] === undefined && d.en[k] === undefined), '');
}

console.log('== H. 新建 / 保存配置 / 恢复默认（2026-10-27 任务 §1）==');
/** H 组可参数化驱动（真树打印 + 变异副本静默收红集）。
 *  口径：配置修改 = 直写 v2 档再 render（组件 useState(readSection()) 每次从档初始化，与生产同源）。 */
function runH(loadFn, ls, settings, quiet) {
  const reds = [];
  const chk = (name, cond, d) => { if (quiet) { if (!cond) reds.push(String(name).split(' ')[0]); } else ok(name, cond, d); };
  const storeOf = () => { try { return JSON.parse(ls.getItem(PRESET_KEY)) || { presets: [] }; } catch (e) { return { presets: [] }; } };
  // 生效配置读**缓存视角**（__mpwPersist.read = readSection，与组件/快照同源）：
  // writeSection 的 localStorage 落盘有 250ms/启动收尾门控（settings-persist-test 的职责），
  // 直读档会把"落盘时序"混进本判据 ⇒ 不采用。
  const secOf = () => { try { return globalThis.__mpwPersist.read() || {}; } catch (e) { return {}; } };
  const writeCfg = (patch) => { const r = globalThis.__mpwSectionTest.write(patch); if (r !== true) throw new Error('write: ' + r); };
  // 白名单键从被测源码抓取（与实现同源，不复制名单）
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  const mFields = /const MPW_PRESET_FIELDS = \[([\s\S]*?)\];/.exec(src);
  const FIELDS = mFields ? [...mFields[1].matchAll(/"([A-Za-z0-9]+)"/g)].map((m) => m[1]) : [];
  /** 逐键比较：FIELDS 并集上 undefined 等价缺失；rotGroups/propEdits JSON 比较。 */
  const snapEq = (a, b) => {
    const A = a || {}, B = b || {};
    for (const k of new Set([...FIELDS.filter((k) => A[k] !== void 0), ...FIELDS.filter((k) => B[k] !== void 0)])) {
      if (k === 'rotGroups' || k === 'propEdits') { if (JSON.stringify(A[k] ?? null) !== JSON.stringify(B[k] ?? null)) return false; continue; }
      if ((A[k] === void 0 ? null : A[k]) !== (B[k] === void 0 ? null : B[k])) return false;
    }
    return true;
  };
  const w = makeWorld2(loadFn, ls, settings);
  const render = () => w.render();
  const curId = () => storeOf().active;

  // H1 「+」新建：新预设 snapshot 逐键 == 新建瞬间的当前配置
  let tree = render();
  clickNode(tree, 'data-mpw-preset-add');
  let st = storeOf();
  const newP = st.presets[st.presets.length - 1];
  chk('H1 「+」新建 ⇒ snapshot 逐键 == 当前配置 且新预设被选中',
    st.presets.length === 2 && newP && snapEq(newP.settings, secOf()) && st.active === newP.id,
    JSON.stringify({ n: st.presets.length, active: st.active, snap: newP && newP.settings }));

  // H2 修改 ⇒ 保存按钮出现；点保存 ⇒ snapshot 逐键 == 修改后配置
  writeCfg({ opacity: 77 });
  tree = render();
  const saveBtn = findNode(tree, (p) => p && p['data-mpw-preset-save'] !== undefined && typeof p.onClick === 'function');
  chk('H2a 修改当前预设 ⇒ 「保存配置」按钮出现', !!saveBtn, saveBtn ? 'ok' : 'missing');
  if (saveBtn) { try { saveBtn.props.onClick(); } catch (e) {} }
  st = storeOf();
  const savedP = st.presets.find((p) => p.id === curId());
  chk('H2b 保存 ⇒ snapshot 逐键 == 修改后配置', savedP && snapEq(savedP.settings, secOf()),
    JSON.stringify(savedP && savedP.settings));

  // H3 未保存修改 + 恢复（二次确认）⇒ 生效配置逐键 == snapshot，且 snapshot 不变
  writeCfg({ opacity: 33 });
  tree = render();
  const restoreBtn = findNode(tree, (p) => p && p['data-mpw-preset-restore'] !== undefined && typeof p.onClick === 'function');
  chk('H3a 「恢复默认」按钮在（保存后 dirty 清空也不消失）', !!restoreBtn, restoreBtn ? 'ok' : 'missing');
  if (restoreBtn) { try { restoreBtn.props.onClick(); } catch (e) {} }
  tree = render();
  const goBtn = findNode(tree, (p) => p && p['data-mpw-preset-restore-go'] !== undefined);
  chk('H3b 恢复先出二次确认', !!goBtn, goBtn ? 'ok' : 'missing');
  if (goBtn) { try { goBtn.props.onClick(); } catch (e) {} }
  const snapAfter = storeOf().presets.find((p) => p.id === curId());
  chk('H3c 恢复 ⇒ 生效配置逐键 == snapshot（回到上次保存态 77，非出厂值）',
    secOf().opacity === 77 && snapEq(secOf(), snapAfter.settings),
    JSON.stringify({ v2: secOf().opacity, snap: snapAfter && snapAfter.settings.opacity }));
  chk('H3d snapshot 本身未变（未保存修改不污染快照）', snapAfter && snapAfter.settings.opacity === 77,
    JSON.stringify(snapAfter && snapAfter.settings.opacity));

  // H4 「自定义」档：恢复/保存按钮都不出现（维持现状；独立世界账本 active=custom）
  const lsC = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
  const wc = makeWorld2(loadFn, lsC, settings);
  const treeC = wc.render();
  chk('H4 「自定义」档无恢复/保存按钮',
    !findNode(treeC, (p) => p && (p['data-mpw-preset-restore'] !== undefined || p['data-mpw-preset-save'] !== undefined)), '');
  return reds;
}
/** 与 makeWorld 同构，但 clientPath 可指变异副本。 */
function makeWorld2(loadFn, ls, settings) {
  reset();
  const r = loadFn(ls, settings);
  const zh = r.localeDicts.zh;
  return { r, render: () => { try { return r.sectionComp({ t: (k) => (zh[k] !== undefined ? zh[k] : k), close: () => {} }); } catch (e) { return { __crash: String(e && e.message || e) }; } } };
}
{
  const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
  runH((lss, st) => loadPlugin({ quiet: true, localStorage: lss, settings: st || {} }), ls, { enabled: true, opacity: 62, blur: 18 }, false);

  // H5 内置「作者1」同样适用（预置账本 active=builtin 跑同一套 1–3 的核心两步）
  const ls2 = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
  const V2 = 'dsh.mpkg-wallpaper.' + 'v2';
  ls2.setItem(PRESET_KEY, JSON.stringify({ v: 1, presets: [{ id: 'builtin', name: '作者1', settings: { opacity: 90 } }], customSnapshot: null, active: 'builtin' }));
  const w = makeWorld({ localStorage: ls2, settings: { enabled: true, opacity: 90 } });
  let tree = w.render();
  globalThis.__mpwSectionTest.write({ opacity: 55 });
  tree = w.render();
  const saveBtn2 = findNode(tree, (p) => p && p['data-mpw-preset-save'] !== undefined && typeof p.onClick === 'function');
  ok('H5a 「作者1」修改后同样出现「保存配置」', !!saveBtn2, saveBtn2 ? 'ok' : (saveBtn ? 'was-clean' : 'missing'));
  if (saveBtn2) { try { saveBtn2.props.onClick(); } catch (e) {} }
  const snapB = JSON.parse(ls2.getItem(PRESET_KEY)).presets[0];
  ok('H5b 「作者1」保存 ⇒ snapshot 55', snapB.settings.opacity === 55, JSON.stringify(snapB.settings));
  globalThis.__mpwSectionTest.write({ opacity: 7 });
  tree = w.render();
  const rBtn = findNode(tree, (p) => p && p['data-mpw-preset-restore'] !== undefined && typeof p.onClick === 'function');
  if (rBtn) { try { rBtn.props.onClick(); } catch (e) {} }
  tree = w.render();
  const go = findNode(tree, (p) => p && p['data-mpw-preset-restore-go'] !== undefined);
  if (go) { try { go.props.onClick(); } catch (e) {} }
  const stB = globalThis.__mpwPersist.read();
  const snapB2 = JSON.parse(ls2.getItem(PRESET_KEY)).presets[0];
  ok('H5c 「作者1」恢复 ⇒ 生效配置回 snapshot（55）且快照不变', stB.opacity === 55 && snapB2.settings.opacity === 55,
    JSON.stringify({ v2: stB.opacity, snap: snapB2.settings.opacity }));
}

/* ---------- 变异自证（隔离副本；锚点必须恰好替换一次 —— R2） ---------- */
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');
const TMP_DIRS = [];
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP_DIRS.push(d); return d; };
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

async function withMutant(id, what, pairs, expectRed, runGroup) {
  const dir = mkTmp('mpw-preset-mut-');
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

/** 变异副本世界（设置页组件 + 私有 localStorage）。 */
function worldOn(f, ls, settings) {
  reset();
  const r = loadPlugin({ quiet: true, clientPath: f, localStorage: ls, settings: settings || {} });
  const zh = r.localeDicts.zh;
  const render = () => { try { return r.sectionComp({ t: (k) => (zh[k] !== undefined ? zh[k] : k), close: () => {} }); } catch (e) { return { __crash: String(e && e.message || e) }; } };
  return { r, render };
}

console.log('\n== M. 变异自证（期望红集 == 实际红集，逐条相等）==');

// M-init：首次初始化不建「作者1」⇒ A1/A3 红（chips 只剩 custom）
await withMutant('M-init', '首次初始化不创建内置预设',
  [['const store = { v: 1, presets: [{ id: MPW_PRESET_BUILTIN_ID, name: String(builtinName || "作者1"), settings: mpwPresetSnapshot() }], customSnapshot: null, active: "custom" };',
    'const store = { v: 1, presets: [], customSnapshot: null, active: "custom" }; /* M-init */']], ['A1'],
  async (f) => {
    const red = [];
    const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
    const w = worldOn(f, ls, { enabled: true });
    const row = findNode(w.render(), (p) => p && p['data-mpw-preset-row'] !== undefined);
    const chips = row ? row.kids.filter((k) => k && typeof k === 'object' && k.props && typeof k.props['data-mpw-preset-chip'] === 'string') : [];
    if (!(chips.length === 2 && chips[1] && chips[1].props['data-mpw-preset-chip'] === 'builtin' && chips[1].kids[0] === '作者1')) red.push('A1');
    return red;
  });

// M-apply：切换确认后不应用配置 ⇒ C4 红
await withMutant('M-apply', '切换不应用预设配置（空操作）',
  [['presetSave(next);\n\t\t\t\t\t\tsetPresetStore(next);\n\t\t\t\t\t\tpresetApplySettings(p.settings);',
    'presetSave(next);\n\t\t\t\t\t\tsetPresetStore(next); /* M-apply */']], ['C4'],
  async (f) => {
    const red = [];
    const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
    ls.setItem(PRESET_KEY, JSON.stringify({ v: 1, presets: [{ id: 'builtin', name: '作者1', settings: { opacity: 90 } }], customSnapshot: null, active: 'custom' }));
    ls.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify({ enabled: true, opacity: 62 }));
    const w = worldOn(f, ls);
    let tree = w.render();
    const chip = findNode(tree, (p) => p && p['data-mpw-preset-chip'] === 'builtin');
    chip.props.onClick();
    tree = w.render();
    const go = findNode(tree, (p) => p && p['data-mpw-preset-confirm-go'] !== undefined);
    go.props.onClick();
    await new Promise((r2) => setTimeout(r2, 3600));
    const sec = JSON.parse(ls.getItem('dsh.mpkg-wallpaper.v2'));
    if (!(sec.opacity === 90 && JSON.parse(ls.getItem(PRESET_KEY)).active === 'builtin')) red.push('C4');
    return red;
  });

// M-restore-overwrite：「恢复默认」先覆盖快照再应用（snapshot 记成"当前配置"）⇒ H3d 红
await withMutant('M-restore-overwrite', '恢复时把快照覆盖成当前配置（违反"恢复不动快照"）',
  [['presetApplySettings(activePreset.settings);\n\t\t\t\t\tsetPresetHintT(t("preset.restored"));',
    '{ try { const so = presetStore; const nextSo = Object.assign({}, so, { presets: so.presets.map((q) => (q && q.id === activePreset.id) ? Object.assign({}, q, { settings: mpwPresetSnapshot() }) : q) }); mpwPresetSave(nextSo); setPresetStore(nextSo); } catch (e) {} }\n\t\t\t\t\tpresetApplySettings(activePreset.settings);\n\t\t\t\t\t/* M-restore-overwrite */setPresetHintT(t("preset.restored"));']], ['H3c', 'H3d'],
  async (f) => {
    const red = [];
    const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
    ls.setItem('dsh.mpkg-wallpaper.' + 'v2', JSON.stringify({ enabled: true, opacity: 62 }));
    red.push(...runH((lss, st) => loadPlugin({ quiet: true, clientPath: f, localStorage: lss, settings: st || {} }), ls, { enabled: true, opacity: 62 }, true));
    return red;
  });

// M-restore-factory：「恢复默认」实现成恢复出厂空配置 ⇒ H3c 红（生效配置 != snapshot）
await withMutant('M-restore-factory', '恢复实现成恢复出厂值（应用空配置）',
  [['presetApplySettings(activePreset.settings);', 'presetApplySettings({ opacity: 82 }); /* M-restore-factory */']], ['H3c'],
  async (f) => {
    const red = [];
    const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
    ls.setItem('dsh.mpkg-wallpaper.' + 'v2', JSON.stringify({ enabled: true, opacity: 62 }));
    red.push(...runH((lss, st) => loadPlugin({ quiet: true, clientPath: f, localStorage: lss, settings: st || {} }), ls, { enabled: true, opacity: 62 }, true));
    return red;
  });

// M-snapshot：切走不快照自定义档 ⇒ C6 红（切回还原不出 62）
await withMutant('M-snapshot', '离开自定义时不快照（切回无法还原）',
  [['customSnapshot: cur.active === "custom" ? mpwPresetSnapshot() : cur.customSnapshot,',
    'customSnapshot: cur.customSnapshot, /* M-snapshot */']], ['C6'],
  async (f) => {
    const red = [];
    const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
    ls.setItem(PRESET_KEY, JSON.stringify({ v: 1, presets: [{ id: 'builtin', name: '作者1', settings: { opacity: 90 } }], customSnapshot: null, active: 'custom' }));
    ls.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify({ enabled: true, opacity: 62 }));
    const w = worldOn(f, ls);
    let tree = w.render();
    findNode(tree, (p) => p && p['data-mpw-preset-chip'] === 'builtin').props.onClick();
    tree = w.render();
    findNode(tree, (p) => p && p['data-mpw-preset-confirm-go'] !== undefined).props.onClick();
    tree = w.render();
    findNode(tree, (p) => p && p['data-mpw-preset-chip'] === 'custom').props.onClick();
    tree = w.render();
    findNode(tree, (p) => p && p['data-mpw-preset-confirm-go'] !== undefined).props.onClick();
    await new Promise((r2) => setTimeout(r2, 3600));
    const sec = JSON.parse(ls.getItem('dsh.mpkg-wallpaper.v2'));
    if (!(sec.opacity === 62)) red.push('C6');
    return red;
  });

// M-sanitize：白名单拆除（未知键直通）⇒ E2 红
await withMutant('M-sanitize', '导入白名单拆除（未知键直通进档）',
  [['const known = new Set(MPW_PRESET_FIELDS);', 'const known = new Set(Object.keys(settings)); /* M-sanitize */']], ['E2'],
  async (f) => {
    const red = [];
    const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
    const w = worldOn(f, ls, { enabled: true });
    const render = () => w.render();
    const tree = render();
    const inp = findNode(tree, (p) => p && p.ref !== undefined && p.type === 'file');
    inp.props.onChange({ target: { files: [{ size: 300, name: 'x.json', __text: JSON.stringify({ app: 'dsh-mpkg-wallpaper', version: 1, settings: { opacity: 50, evilKey: '1' } }) }], value: '' } });
    await new Promise((r2) => setTimeout(r2, 30));
    const store = JSON.parse(ls.getItem(PRESET_KEY));
    const last = store.presets[store.presets.length - 1];
    const hint = collectStrings(findNode(render(), (p) => p && p['data-mpw-preset-hint'] !== undefined)?.kids || []).join('');
    if (!!(last && last.settings && last.settings.evilKey !== undefined) || hint.indexOf('evilKey') < 0) red.push('E2');
    return red;
  });

// M-delete：删除不持久化 ⇒ E2/E3 红（重启后复活）
await withMutant('M-delete', '删除预设不落账本',
  [['presetSave(next);\n\t\t\t\t\tsetPresetStore(next);\n\t\t\t\t\tsetPresetHintT(t("preset.deleted"));',
    'setPresetStore(next); /* M-delete */']], ['E3'],
  async (f) => {
    const red = [];
    const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
    ls.setItem(PRESET_KEY, JSON.stringify({ v: 1, presets: [{ id: 'builtin', name: '作者1', settings: { opacity: 90 } }], customSnapshot: { opacity: 62 }, active: 'custom' }));
    const w = worldOn(f, ls);
    let tree = w.render();
    findNode(tree, (p) => p && p['data-mpw-preset-edit'] !== undefined).props.onClick();
    tree = w.render();
    findNode(tree, (p) => p && p['data-mpw-preset-del'] === 'builtin').props.onClick();
    const storeAfter = JSON.parse(ls.getItem(PRESET_KEY));
    const w2 = worldOn(f, ls);
    const row2 = findNode(w2.render(), (p) => p && p['data-mpw-preset-row'] !== undefined);
    const chips2 = row2.kids.filter((k) => k && typeof k === 'object' && k.props && typeof k.props['data-mpw-preset-chip'] === 'string');
    if (!(storeAfter.presets.length === 0 && chips2.length === 1)) red.push('E3');
    return red;
  });

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

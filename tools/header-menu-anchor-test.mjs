// tools/header-menu-anchor-test.mjs —— LAYER2-B：header 系菜单 z 规则不得误抬 *Anchor 触发锚点
//
// 现象（真机）：有壁纸时，标题栏里的 split-button 触发组
//   <span class="_root_4ub78_1 OMoRSG_menuAnchor">（「用 文件管理器 打开」）跑到大纲面板上面；
//   无壁纸时正常。原因：OMoRSG_menuAnchor 类名含 "_menu" 子串，被两条只在有壁纸路径输出的
//   header 系 z 提升规则命中（lib/client.js 的 `header …[class*="_menu"]{z:60}` 与
//   `html body .wSkVaW_header …[class*="_menu"]{z:90}`）；z:90 高于大纲面板祖先盒的 60 档 ⇒ 盖住面板。
// 修法：类名段统一加 :not([class*="Anchor"]):not([class*="anchor"])（POP_NOT 同款结构化排除——
//   *Anchor 是触发器锚点不是浮层容器）；真菜单容器（ZKlsPq_menu / QsffPG_menu 等不含 Anchor）不受影响。
//
// 契约：
//   B1 有壁纸产物中 z:60 / z:90 两条 header 系规则在场且层值不变（抬升行为保留）
//   B2 真菜单容器（ZKlsPq_menu / QsffPG_menu）仍被 z:90 规则命中（不回退）
//   B3 两态产物中，没有任何 z-index 规则的类名段命中 "_root_4ub78_1 OMoRSG_menuAnchor"
//   B4 两条规则的类名段都带 Anchor 排除（防回退变异）
// 变异自证（隔离副本；期望红集 == 实际红集）：
//   M-noanchor 还原 z:90 规则 _menu 段（去掉 Anchor 排除）⇒ B3、B4 红
//   M-dropmenu 删掉 z:90 规则两段 _menu 行 ⇒ B2 红（真菜单失去抬升）
// 复现: node tools/header-menu-anchor-test.mjs
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

function cssOf(clientPath, settings) {
  reset();
  loadPlugin({ quiet: true, clientPath, settings });
  return String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '') || '');
}
const strip = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '');
const rulesOf = (css) => [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].replace(/\s+/g, ' ').trim(), body: m[2] }));
const zOf = (r) => { const m = /z-index\s*:\s*([^;!]+)/.exec(r && r.body || ''); return m ? m[1].trim() : null; };

/** 段级匹配（诚实简化：只模拟本契约涉及的 [class*="…"] 肯定条件与 :not([class*="…"]) 排除；
    role= 等其它简单条件不参与——不含类名条件的段一律视为不命中，保守不误报）。 */
function segMatches(seg, classAttr) {
  const bare = seg.replace(/:not\([^()]*\)/g, ''); // :not(...) 里的条件是排除，不当肯定条件
  const pos = [...bare.matchAll(/\[class\*="([^"]+)"\]/g)].map((m) => m[1]);
  if (pos.length === 0) return false;
  if (!pos.every((x) => classAttr.includes(x))) return false;
  const negs = [...seg.matchAll(/:not\(\[class\*="([^"]+)"\]\)/g)].map((m) => m[1]);
  if (negs.some((x) => classAttr.includes(x))) return false;
  return true;
}
const segs = (r) => r.sel.split(',').map((s) => s.trim()).filter((s) => /\[class\*=/.test(s));

const MENU_ANCHOR = '_root_4ub78_1 OMoRSG_menuAnchor'; // 真机样本（split-button 触发锚点）
const REAL_MENUS = ['ZKlsPq_menu', 'QsffPG_menu'];     // 宿主真菜单容器类（无 Anchor）

const WITH_IMG = { enabled: true, image: 'data:image/png;base64,AAA' };
const NO_IMG = { enabled: true };

/** 契约红集（前缀区分态）。 */
function contractReds(clientPath, prefix = '') {
  const red = [];
  const withCss = cssOf(clientPath, WITH_IMG);
  const noCss = cssOf(clientPath, NO_IMG);
  const wRules = rulesOf(withCss).filter((r) => /z-index/.test(r.body));

  const r60 = wRules.find((r) => segs(r).some((s) => s.startsWith('header [class*="_menu"]')));
  const r90 = wRules.find((r) => segs(r).some((s) => s.includes('.wSkVaW_header [class*="_menu"]')));
  if (!(r60 && zOf(r60) === '60')) red.push(prefix + 'B1');
  if (!(r90 && zOf(r90) === '90')) red.push(prefix + 'B1');
  const menuHit = REAL_MENUS.every((cls) => r90 && segs(r90).some((s) => segMatches(s, cls)));
  if (!menuHit) red.push(prefix + 'B2');
  for (const [tag, css] of [['', withCss], ['N-', noCss]]) {
    const hits = [];
    for (const r of rulesOf(css)) {
      if (!/z-index/.test(r.body)) continue;
      for (const s of segs(r)) if (segMatches(s, MENU_ANCHOR)) hits.push(s.slice(0, 70));
    }
    if (hits.length > 0) red.push((prefix || '') + (tag ? 'N-' : '') + 'B3');
  }
  for (const r of [r60, r90]) {
    if (!r) continue;
    if (!segs(r).every((s) => s.includes(':not([class*="Anchor"])') || !/\[class\*="_/.test(s))) { red.push(prefix + 'B4'); break; }
  }
  return red;
}

console.log('== B. header 菜单 z 规则 × Anchor 触发锚点 ==');
const red = contractReds(path.join(ROOT, 'lib', 'client.js'));
{
  // 友好打印（同 contractReds 的判定）
  const withCss = cssOf(path.join(ROOT, 'lib', 'client.js'), WITH_IMG);
  const noCss = cssOf(path.join(ROOT, 'lib', 'client.js'), NO_IMG);
  const wRules = rulesOf(withCss).filter((r) => /z-index/.test(r.body));
  const r60 = wRules.find((r) => segs(r).some((s) => s.startsWith('header [class*="_menu"]')));
  const r90 = wRules.find((r) => segs(r).some((s) => s.includes('.wSkVaW_header [class*="_menu"]')));
  ok('B1 有壁纸：header 系 z:60 / z:90 规则在场且层值不变', !!r60 && zOf(r60) === '60' && !!r90 && zOf(r90) === '90',
    'z60=' + (r60 ? zOf(r60) : 'missing') + ' z90=' + (r90 ? zOf(r90) : 'missing'));
  const menuOk = REAL_MENUS.every((cls) => r90 && segs(r90).some((s) => segMatches(s, cls)));
  ok('B2 真菜单容器（' + REAL_MENUS.join('/') + '）仍被 z:90 命中（不回退）', menuOk,
    menuOk ? 'hit' : 'miss');
  const hitsIn = (css) => rulesOf(css).flatMap((r) => (/z-index/.test(r.body) ? segs(r).filter((s) => segMatches(s, MENU_ANCHOR)) : []));
  const hw = hitsIn(withCss), hn = hitsIn(noCss);
  ok('B3 有壁纸：无任何 z 规则段命中 OMoRSG_menuAnchor', hw.length === 0, hw.length ? hw[0] : 'clean');
  ok('B3b 无壁纸：无任何 z 规则段命中 OMoRSG_menuAnchor', hn.length === 0, hn.length ? hn[0] : 'clean');
  const excl = [r60, r90].filter(Boolean).every((r) => segs(r).every((s) => s.includes(':not([class*="Anchor"])') || !/\[class\*="_/.test(s)));
  ok('B4 两条规则的类名段都带 Anchor 排除（POP_NOT 模式）', excl, '');
}

/* ---------- 变异自证（隔离副本） ---------- */
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');
const TMP_DIRS = [];
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP_DIRS.push(d); return d; };
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

async function withMutant(id, what, pairs, expectRed) {
  const dir = mkTmp('mpw-anchor-mut-');
  const f = path.join(dir, 'client.js');
  let mutated = src0;
  const applied = [];
  for (const [anchor, replacement] of pairs) {
    const n = mutated.split(anchor).length - 1;
    const next = mutated.replace(anchor, replacement);
    applied.push(n === 1 && next !== mutated && !next.includes(anchor));
    mutated = next;
  }
  fs.writeFileSync(f, mutated);
  reset();
  let red;
  try { red = contractReds(f); } catch (e) { red = ['THROW:' + String(e && e.message || e).slice(0, 60)]; }
  const eq = applied.every(Boolean) && JSON.stringify(red.slice().sort()) === JSON.stringify(expectRed.slice().sort());
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-MISMATCH') + ' ' + id + ' ' + what);
  console.log('    期望红集=' + JSON.stringify(expectRed.slice().sort()) + ' 实际红集=' + JSON.stringify(red.slice().sort())
    + ' 变异生效=' + JSON.stringify(applied));
  if (!eq) fail++; else pass++;
}

console.log('\n== M. 变异自证（期望红集 == 实际红集）==');
await withMutant('M-noanchor', '还原 z:90 规则 _menu 段（去掉 Anchor 排除 ⇒ menuAnchor 再被抬升）',
  [['html body .wSkVaW_header [class*="_menu"]:not([class*="Anchor"]):not([class*="anchor"]),\nhtml body .wSkVaW_header [class*="_popover"]:not([class*="Anchor"]):not([class*="anchor"]),',
    'html body .wSkVaW_header [class*="_menu"],\nhtml body .wSkVaW_header [class*="_popover"], /* M-noanchor */']],
  ['B3', 'B4']);
await withMutant('M-dropmenu', '删掉 z:90 规则两段 _menu 行（真菜单失去抬升）',
  [[`html body .wSkVaW_header [class*="_menu"]:not([class*="Anchor"]):not([class*="anchor"]),
html body .wSkVaW_header [class*="_popover"]:not([class*="Anchor"]):not([class*="anchor"]),`,
    `html body .wSkVaW_header [class*="_popover"]:not([class*="Anchor"]):not([class*="anchor"]), /* M-dropmenu */`]],
  ['B1', 'B2']);

if (red.length) { console.log('\n!! 真树红集非空：' + JSON.stringify(red)); fail += red.length; }
console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

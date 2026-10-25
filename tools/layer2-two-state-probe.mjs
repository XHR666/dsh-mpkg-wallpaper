// tools/layer2-two-state-probe.mjs —— LAYER2 两态（有壁纸 / 无壁纸）产物 CSS 对比探针（只读，不改 lib）
// 输出：两态各自的规则选择器集合、差集、以及关键选择器（conv 面板 / menuAnchor 命中 / float）在哪态出现。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const { loadPlugin, cancelWorldTimers } = await import('./_stub.mjs');
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwGlobalWired', '__mpwThumbSched',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState', '__mpwBsScanKick', '__mpwBsScanMore'];
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k]; } catch {} } };

function cssOf(settings) {
  reset();
  loadPlugin({ quiet: true, clientPath: path.join(ROOT, 'lib', 'client.js'), settings });
  return String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '') || '');
}
const strip = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '');
const rulesOf = (css) => [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1].replace(/\s+/g, ' ').trim(), body: m[2] }));

const WITH = rulesOf(cssOf({ enabled: true, image: 'data:image/png;base64,AAA' }));
const WITHOUT = rulesOf(cssOf({ enabled: true })); // 无 image/webUrl ⇒ hasImage=false
const key = (r) => r.sel + ' {' + r.body.replace(/\s+/g, ' ').trim() + '}';
const withSet = new Map(WITH.map((r) => [key(r), r]));
const withoutSet = new Map(WITHOUT.map((r) => [key(r), r]));

console.log(`有壁纸规则数=${WITH.length}  无壁纸规则数=${WITHOUT.length}`);
const onlyWith = [...withSet.keys()].filter((k) => !withoutSet.has(k));
const onlyWithout = [...withoutSet.keys()].filter((k) => !withSet.has(k));
console.log(`\n== 只在有壁纸态输出（${onlyWith.length} 条，看选择器）==`);
for (const k of onlyWith) console.log('  - ' + k.slice(0, 160));
console.log(`\n== 只在无壁纸态输出（${onlyWithout.length} 条）==`);
for (const k of onlyWithout) console.log('  - ' + k.slice(0, 160));

const pick = (label, pred) => {
  console.log(`\n== ${label} ==`);
  for (const [name, set] of [['有壁纸', withSet], ['无壁纸', withoutSet]]) {
    const hits = [...set.values()].filter(pred);
    console.log(`  [${name}] ${hits.length} 条`);
    for (const r of hits) console.log('    * ' + r.sel.slice(0, 150) + '  ⇒ ' + r.body.replace(/\s+/g, ' ').slice(0, 60));
  }
};
pick('A. conv 面板层级规则（选择器含 dsh-conv-panel）', (r) => r.sel.includes('dsh-conv-panel'));
pick('B. 可能命中 OMoRSG_menuAnchor 的规则（[class*="_menu"] 无尾下划线 或 _popover/_dropdown 系）',
  (r) => /class\*="_menu"\]/.test(r.sel) || /class\*="_popover"\]/.test(r.sel) || /class\*="_dropdown"\]/.test(r.sel));
pick('C. 右侧边栏悬浮几何（data-mpw-float / dockkit / sidebar-right-panel）',
  (r) => r.sel.includes('data-mpw-float') || r.sel.includes('data-dockkit') || r.sel.includes('data-sidebar-right-panel'));
cancelWorldTimers();
process.exit(0);

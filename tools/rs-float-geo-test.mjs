// tools/rs-float-geo-test.mjs —— LAYER2-C：右栏悬浮几何 + 层级基准的两态（有壁纸/无壁纸）契约
//
// 现象（真机）：无壁纸时右侧边栏不是悬浮的（平铺原位），且大纲面板低于右栏；有壁纸时两者都正常。
// 原因：右栏悬浮几何（外层浮起/内层还原/拖拽还原/tab 条/轨迹裁剪）与右栏 z 基准（12 档）
// 原先只在 buildCss 的 hasImage 主线输出，而 body[data-mpw-float] 属性由 JS 按 section.float
// 打标（与 hasImage 无关）⇒ 无壁纸时属性在、几何规则缺 ⇒ 悬浮失效；右栏未被压到 12 档 ⇒
// 大纲（880，LAYER2-A 已两态输出）低于右栏自然层序。
//
// 契约（lib/client.js 常量 __rsFloatGeoCss，两条 return 路径都输出）：
//   C1 两态在场：z 基准(z:12/z:1/side-lift:2500) / push 外层浮起(top/bottom/right:10px、
//      radius:18px、box-shadow) / dockkit 浮起(margin:10px…) / 内层还原(top:0…) /
//      拖拽还原(margin:0) / tab 条(margin-left:10px) / 轨迹裁剪(max-width:100%)
//   C2 反向（防壁纸化）：无壁纸态的 float/右栏相关规则里**不得**出现外观声明——
//      background-color / backdrop-filter / filter / border-color（暗色描边适配）/
//      --dsw-specific-sidebar-fill / parked / unify / rsblur / rightbar-fullscreen
//      （这些仍挂 hasImage：无壁纸引入它们 = 把无壁纸态壁纸化）
//   C3 排序：两态都有 大纲面板(880) > 右栏(12) > 左栏(1)
// 变异自证（隔离副本；期望红集 == 实际红集）：
//   M-noimg-geo  无壁纸早退路径去掉 __rsFloatGeoCss 输出 ⇒ 无壁纸组 C1/C3 红
//   M-wallpaperize 把暗色描边（data-ds-dark-theme border-color）塞进常量 ⇒ C2 红
// 复现: node tools/rs-float-geo-test.mjs
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
const norm = (b) => b.replace(/\s+/g, ' ').trim();
const findRule = (rs, pred) => rs.find((r) => pred(r.sel));

const WITH_IMG = { enabled: true, image: 'data:image/png;base64,AAA' };
const NO_IMG = { enabled: true };

// 关键规则（选择器片段 → 必须出现的声明片段）
const GEO_KEYS = [
  ['z 基准 右栏 12', (sel) => sel.includes('[data-sidebar-right-panel], html body [data-dockkit-pane]'), 'z-index: 12'],
  ['z 基准 左栏 1', (sel) => sel === 'html body [class*="sidebarCol"]:not([data-sidebar-right-panel])', 'z-index: 1'],
  ['z 基准 side-lift 2500', (sel) => sel.includes('[data-mpw-side-lift]'), 'z-index: 2500'],
  ['push 外层浮起', (sel) => sel.includes('[data-mpw-float] [data-sidebar-right-panel="push"]') && !sel.includes('[data-sidebar-right-panel="push"] ['), 'top: 10px'],
  ['dockkit 浮起', (sel) => sel.startsWith('html body[data-mpw-float] [data-dockkit-pane]'), 'margin: 10px'],
  ['内层还原', (sel) => sel.includes('[data-mpw-float] [data-sidebar-right-panel] [data-sidebar-right-panel]'), 'top: 0'],
  ['拖拽还原', (sel) => sel.includes('[data-dsh-sidebar-dragging][data-mpw-float]'), 'margin: 0'],
  ['tab 条几何', (sel) => sel.includes('[data-mpw-float] [data-sidebar-right-panel] [data-dockkit-strip]') && !sel.includes('> *'), 'margin-left: 10px'],
  ['轨迹裁剪', (sel) => sel.includes('traject-clip') && sel.includes('qBU-ya'), 'max-width: 100%'],
];

/** 无壁纸态防壁纸化：float/右栏相关规则里禁止出现的外观声明。 */
const APPEARANCE_FORBIDDEN = /background-color|backdrop-filter|text-shadow|box-shadow:\s*[^;]*rgba\(0,\s*0,\s*255|--dsw-specific-sidebar-fill|data-mpw-rightbar-parked|data-mpw-unify|data-mpw-rsblur|rightbar-fullscreen/;
function appearanceViolations(css) {
  const rs = rulesOf(css);
  const hits = [];
  for (const r of rs) {
    if (!/(data-mpw-float|sidebar-right|dockkit)/.test(r.sel)) continue;
    // 悬浮几何允许的描边：亮色 border 1px（卡片轮廓）与 transition 里的 border-color 过渡项；
    // 暗色主题适配（border-color 声明）不允许
    const body = norm(r.body);
    if (/(^|[;{]\s*)border-color/.test(body) || APPEARANCE_FORBIDDEN.test(body)) hits.push(r.sel.slice(0, 80) + ' { ' + body.slice(0, 60) + ' }');
  }
  return hits;
}

/** 契约红集。prefix：''（有壁纸）/ 'N-'（无壁纸）。 */
function contractReds(clientPath, prefix = '') {
  const red = [];
  const withCss = cssOf(clientPath, WITH_IMG);
  const noCss = cssOf(clientPath, NO_IMG);
  const wRs = rulesOf(withCss), nRs = rulesOf(noCss);

  for (const [name, pred, decl] of GEO_KEYS) {
    const w = findRule(wRs, pred), n = findRule(nRs, pred);
    if (!(w && norm(w.body).includes(decl))) red.push(prefix + 'C1');
    if (!(n && norm(n.body).includes(decl))) red.push(prefix + 'NC1');
  }
  const viol = appearanceViolations(noCss);
  if (viol.length > 0) red.push(prefix + 'C2');
  const panelZ = (rs) => { const r = findRule(rs, (s) => s === 'html body .dsh-conv-panel'); const m = /z-index:\s*(\d+)/.exec(r ? r.body : ''); return m ? Number(m[1]) : NaN; };
  const rsZ = (rs) => { const r = findRule(rs, (s) => s.includes('[data-sidebar-right-panel], html body [data-dockkit-pane]')); const m = /z-index:\s*(\d+)/.exec(r ? r.body : ''); return m ? Number(m[1]) : NaN; };
  if (!(panelZ(wRs) > rsZ(wRs))) red.push(prefix + 'C3');
  if (!(panelZ(nRs) > rsZ(nRs))) red.push(prefix + 'NC3');
  return [...new Set(red)];
}

console.log('== C. 右栏悬浮几何 + 层级基准（两态）==');
const CLIENT = path.join(ROOT, 'lib', 'client.js');
{
  const withCss = cssOf(CLIENT, WITH_IMG);
  const noCss = cssOf(CLIENT, NO_IMG);
  const wRs = rulesOf(withCss), nRs = rulesOf(noCss);
  for (const [name, pred, decl] of GEO_KEYS) {
    const w = findRule(wRs, pred), n = findRule(nRs, pred);
    ok(`C1 [有壁纸] ${name}`, !!(w && norm(w.body).includes(decl)), w ? 'ok' : 'missing');
    ok(`C1 [无壁纸] ${name}`, !!(n && norm(n.body).includes(decl)), n ? 'ok' : 'missing');
  }
  const viol = appearanceViolations(noCss);
  ok('C2 [无壁纸] float/右栏规则无外观声明（不壁纸化）', viol.length === 0, viol.length ? viol[0] : 'clean');
  const pz = (rs) => Number(/z-index:\s*(\d+)/.exec(findRule(rs, (s) => s === 'html body .dsh-conv-panel').body)[1]);
  const rz = (rs) => Number(/z-index:\s*(\d+)/.exec(findRule(rs, (s) => s.includes('[data-sidebar-right-panel], html body [data-dockkit-pane]')).body)[1]);
  ok(`C3 [有壁纸] 大纲(${pz(wRs)}) > 右栏(${rz(wRs)})`, pz(wRs) > rz(wRs), '');
  ok(`C3 [无壁纸] 大纲(${pz(nRs)}) > 右栏(${rz(nRs)})`, pz(nRs) > rz(nRs), '');
}

/* ---------- 变异自证（隔离副本） ---------- */
const src0 = fs.readFileSync(CLIENT, 'utf8');
const TMP_DIRS = [];
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP_DIRS.push(d); return d; };
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

async function withMutant(id, what, pairs, expectRed) {
  const dir = mkTmp('mpw-geo-mut-');
  const f = path.join(dir, 'client.js');
  let mutated = src0;
  const applied = [];
  for (const [anchor, replacement] of pairs) {
    const n = mutated.split(anchor).length - 1;
    const next = mutated.replace(anchor, replacement);
    // 生效断言：锚恰一次；替换确实改了文本；且要么锚已不存在（删除/改值型），
    // 要么替换文本在场（插入型——替换串保留锚自身属正常）。
    applied.push(n === 1 && next !== mutated && (!next.includes(anchor) || next.includes(replacement)));
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
await withMutant('M-noimg-geo', '无壁纸早退路径去掉 __rsFloatGeoCss 输出（LAYER2-C 回退）',
  [['css += __rsFloatGeoCss;\n\t\t\treturn emitSurfaceTokens(css + buildUiCss(section, false)) + __npCss;',
    '/* M-noimg-geo */\n\t\t\treturn emitSurfaceTokens(css + buildUiCss(section, false)) + __npCss;']],
  ['NC1', 'NC3']);
await withMutant('M-wallpaperize', '把暗色描边规则塞进悬浮几何常量（无壁纸态被壁纸化）',
  [['html body[data-mpw-float] [data-dockkit-pane],\nhtml body[data-mpw-float] [data-dockkit-strip] {',
    'html body[data-ds-dark-theme][data-mpw-float] [data-sidebar-right-panel] { border-color: rgba(148,180,220,0.34) !important; }\nhtml body[data-mpw-float] [data-dockkit-pane],\nhtml body[data-mpw-float] [data-dockkit-strip] {']],
  ['C2']);

const red = contractReds(CLIENT);
if (red.length) { console.log('\n!! 真树红集非空：' + JSON.stringify(red)); fail += red.length; }
console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

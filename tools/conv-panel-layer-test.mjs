// tools/conv-panel-layer-test.mjs —— dsh-conversation 浮窗（.dsh-conv-panel）层级判据（2026-10-25 任务 3；2026-10-26 契约演进）
//
// 契约（lib/client.js buildCss 的「dsh-conv-panel 层级」块；机制与证据链见该块注释）：
//   T1 面板层值：html body .dsh-conv-panel { z-index: 880 !important }
//      （> 正文 0 / 输入框 7 / 侧栏 1 / 右栏全屏 40；< 菜单磨砂 900 / 模态 portal root 1000 /
//        本插件弹窗 2000 / 弹层表面 3000。宿主无 --dsw-z-* 令牌 ⇒ 带依据的常量，不写死 9999）
//   T2 祖先盒规则：面板在标题栏内的祖先盒（:has 匹配）position:relative + z-index:60 ——
//      标题栏内与面板同域的内容按 60 档排序（该值独立于面板档，面板 880 不改它）
//   T-header-auto（机制核心，在 lib 注释有完整证据链）：面板存在且无弹层时 header 取
//      z-index:auto（不再自建层叠上下文封顶面板）；其在场性由 T0 的规则计数与 lib 注释佐证，
//      未单设变异（本文件维持既定三条变异，不扩）
//   T3 让位：设置/弹层在场（_overlay/_overlayLayer/_modal）⇒ 面板与祖先盒 z:auto（压不过设置/模态）
//   R  三组比较（对照值来源：宿主包 CSS 与本文件既有档位，证据链记录在 lib/client.js 注释）：
//      浮窗(880) > 输入框 wSkVaW_composerSeat(7)；
//      浮窗(880) < 宿主对话框 portal root(1000)；
//      浮窗(880) < 菜单磨砂(900) / 弹层表面(3000)
// 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）：
//   M-value  面板层值 880→9999 ⇒ R2、R3 红（盖过模态与弹层）
//   M-untrap 祖先盒规则删掉 ⇒ T2 红
//   M-yield  让位规则删掉 ⇒ T3 红（设置打开时浮窗不让位）
// 复现: node tools/conv-panel-layer-test.mjs
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

/** 取产物 CSS（与 panel-surface-token-test 同口径；image 必须真 URL 形态 ⇒ 全量分支）。 */
function cssOf(clientPath) {
  reset();
  loadPlugin({ quiet: true, clientPath, settings: { enabled: true, image: 'data:image/png;base64,AAA' } });
  return String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '')) || '';
}
const strip = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '');
/** 解析规则：选择器(归一空白) → 声明体 */
const rulesOf = (css) => [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].replace(/\s+/g, ' ').trim(), body: m[2] }));
const convRules = (rs) => rs.filter((r) => r.sel.indexOf('dsh-conv-panel') >= 0);
const zOf = (r) => { const m = /z-index\s*:\s*([^;!]+)/.exec(r && r.body || ''); return m ? m[1].trim() : null; };

// 对照档位（来源注释：lib/client.js 既有规则 + 宿主包只读证据，详见 lib「dsh-conv-panel 层级」块）
const HOST_COMPOSER_SEAT_Z = 7;      // 宿主 dsh-client-ui-conversation：.wSkVaW_composerSeat{z-index:7}
const HOST_DIALOG_PORTAL_Z = 1000;   // 宿主对话框挂在 portal root（z-index:1000，lib 注释真机祖先链）
const OUR_MENU_FROST_Z = 900;        // 本插件「小面板磨砂」z-index:900
const OUR_POPUP_SURFACE_Z = 3000;    // 本插件弹层表面 z-index:3000

console.log('== T. 规则在场 + 数值比较 ==');
const css = cssOf(path.join(ROOT, 'lib', 'client.js'));
const rs = rulesOf(css);
const crs = convRules(rs);
{
  ok('T0 产物 CSS 里有 conv-panel 规则（≥3 组）', crs.length >= 3, 'n=' + crs.length);
  const panel = crs.find((r) => r.sel === 'html body .dsh-conv-panel' && /z-index/.test(r.body));
  const zv = panel ? zOf(panel) : null;
  ok('T1 面板层值 = 880（!important；档位家族取值）', panel && zv === '880' && /!important/.test(panel.body), 'z=' + zv);
  ok('T1b 没有写死 9999（任务明令禁止）', crs.every((r) => zOf(r) !== '9999'), '');
  const untrap = crs.find((r) => r.sel.indexOf('.wSkVaW_header :has([class*="dsh-conv-panel"])') >= 0 && !/auto/.test(r.body));
  ok('T2 祖先盒规则在场（header 内祖先盒 relative + z-index:60；独立于面板 880 档）',
    !!untrap && /position\s*:\s*relative/.test(untrap.body) && zOf(untrap) === '60', untrap ? untrap.body.slice(0, 60) : 'missing');
  for (const ov of ['_overlayLayer', '_overlay', '_modal']) {
    const y1 = crs.find((r) => r.sel.indexOf(':has([class*="' + ov + '"]) .dsh-conv-panel') >= 0);
    const y2 = crs.find((r) => r.sel.indexOf(':has([class*="' + ov + '"]) .wSkVaW_header :has([class*="dsh-conv-panel"])') >= 0);
    ok('T3 让位（' + ov + ' ⇒ 面板 + 祖先盒 z:auto）', !!y1 && zOf(y1) === 'auto' && !!y2 && zOf(y2) === 'auto',
      y1 ? ('y1=' + zOf(y1) + ' y2=' + (y2 ? zOf(y2) : 'missing')) : 'missing');
  }
  // 三组比较（数值都是产物/证据常量，变异或对照改动即红）
  const pv = Number(zv);
  ok('R1 浮窗(880) > 输入框 composerSeat(' + HOST_COMPOSER_SEAT_Z + ')', pv > HOST_COMPOSER_SEAT_Z, '');
  ok('R2 浮窗(880) < 宿主对话框 portal root(' + HOST_DIALOG_PORTAL_Z + ')（设置/模态在上）', pv < HOST_DIALOG_PORTAL_Z, '');
  ok('R3 浮窗(880) < 菜单磨砂(' + OUR_MENU_FROST_Z + ') 且 < 弹层表面(' + OUR_POPUP_SURFACE_Z + ')（我们的弹层在上）',
    pv < OUR_MENU_FROST_Z && pv < OUR_POPUP_SURFACE_Z, '');
}

/* ---------- 变异自证（隔离副本；锚点必须恰好替换一次 —— R2） ---------- */
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');
const TMP_DIRS = [];
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP_DIRS.push(d); return d; };
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

async function withMutant(id, what, pairs, expectRed, runGroup) {
  const dir = mkTmp('mpw-conv-mut-');
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

const checkReds = (f) => {
  const red = [];
  const rs2 = rulesOf(cssOf(f));
  const crs2 = convRules(rs2);
  const panel = crs2.find((r) => r.sel === 'html body .dsh-conv-panel' && /z-index/.test(r.body));
  const pv = Number(zOf(panel));
  const untrap = crs2.find((r) => r.sel.indexOf('.wSkVaW_header :has([class*="dsh-conv-panel"])') >= 0 && !/auto/.test(r.body));
  if (!untrap || !(/position\s*:\s*relative/.test(untrap.body) && zOf(untrap) === '60')) red.push('T2');
  let yieldOk = true;
  for (const ov of ['_overlayLayer', '_overlay', '_modal']) {
    const y1 = crs2.find((r) => r.sel.indexOf(':has([class*="' + ov + '"]) .dsh-conv-panel') >= 0);
    const y2 = crs2.find((r) => r.sel.indexOf(':has([class*="' + ov + '"]) .wSkVaW_header :has([class*="dsh-conv-panel"])') >= 0);
    if (!y1 || zOf(y1) !== 'auto' || !y2 || zOf(y2) !== 'auto') yieldOk = false;
  }
  if (!yieldOk) red.push('T3');
  if (!(pv > HOST_COMPOSER_SEAT_Z)) red.push('R1');
  if (!(pv < HOST_DIALOG_PORTAL_Z)) red.push('R2');
  if (!(pv < OUR_MENU_FROST_Z && pv < OUR_POPUP_SURFACE_Z)) red.push('R3');
  return red;
};

console.log('\n== M. 变异自证（期望红集 == 实际红集，逐条相等）==');
await withMutant('M-value', '面板层值 880→9999（盖过模态与弹层）',
  [['html body .dsh-conv-panel { z-index: 880 !important; }', 'html body .dsh-conv-panel { z-index: 9999 !important; } /* M-value */']], ['R2', 'R3'],
  checkReds);
await withMutant('M-untrap', '祖先盒规则删掉（header 内与面板同域的内容不再有 60 档排序）',
  [['html body .wSkVaW_header :has([class*="dsh-conv-panel"]) {\n\tposition: relative;\n\tz-index: 60 !important;\n}', '/* M-untrap */']], ['T2'],
  checkReds);
await withMutant('M-yield', '让位规则删掉（设置打开不让位）',
  [['html body:has([class*="_overlayLayer"]) .dsh-conv-panel,\nhtml body:has([class*="_overlay"]) .dsh-conv-panel,\nhtml body:has([class*="_modal"]) .dsh-conv-panel,\nhtml body:has([class*="_overlayLayer"]) .wSkVaW_header :has([class*="dsh-conv-panel"]),\nhtml body:has([class*="_overlay"]) .wSkVaW_header :has([class*="dsh-conv-panel"]),\nhtml body:has([class*="_modal"]) .wSkVaW_header :has([class*="dsh-conv-panel"]) {\n\tz-index: auto !important;\n}', '/* M-yield */']], ['T3'],
  checkReds);

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

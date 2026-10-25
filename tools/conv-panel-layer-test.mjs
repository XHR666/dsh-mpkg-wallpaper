// tools/conv-panel-layer-test.mjs —— dsh-conversation 浮窗（.dsh-conv-panel）层级判据（2026-10-25 任务 3；2026-10-26 契约演进 ×2）
//
// 契约（lib/client.js 的「dsh-conv-panel 层级」块 __convPanelLayerCss；机制与证据链见该块注释）：
//   T1 面板层值：html body .dsh-conv-panel { z-index: 880 !important }
//      （> 正文 0 / 输入框 7 / 侧栏 1 / 右栏全屏 40；< 菜单磨砂 900 / 模态 portal root 1000 /
//        本插件弹窗 2000 / 弹层表面 3000。宿主无 --dsw-z-* 令牌 ⇒ 带依据的常量，不写死 9999）
//   T2 祖先盒规则：面板在标题栏内的祖先盒（:has 匹配）position:relative + z-index:60 ——
//      标题栏内与面板同域的内容按 60 档排序（该值独立于面板档，面板 880 不改它）
//   T-header-auto（机制核心，在 lib 注释有完整证据链）：面板存在且无弹层时 header 取
//      z-index:auto（不再自建层叠上下文封顶面板）；其在场性由 T0 的规则计数与 lib 注释佐证，
//      未单设变异（本文件维持既定变异清单，不扩）
//   T3 让位（2026-10-26 真机定案·第2版）：让位只认**真正的模态** ——
//      html body:has([role="dialog"][aria-modal="true"]) .dsh-conv-panel { z-index:auto !important }
//      （_overlayLayer/_overlay/_modal 是宿主**常驻**类名，用它做 :has 条件恒真 ⇒ 面板 880 恒被
//        压回 auto ⇒「大纲被正文压住」；旧三条类名让位已废除）
//   T3b 反向：产物中不得再出现「类名条件让位」的 .dsh-conv-panel 规则（防倒退回恒真条件）
//   ②(2026-10-26 LAYER2-A) 两态契约：以上规则**不依赖 hasImage**（只依赖插件启用）——
//      有壁纸 / 无壁纸两态产物都必须满足同一份断言（无壁纸组断言名加 N- 前缀）。
//      无壁纸时面板 880 缺席会被 wSkVaW_tabs 与 uV2eYG_root 输入卡盖住（真机实测）。
//   R  三组比较（对照值来源：宿主包 CSS 与本文件既有档位，证据链记录在 lib/client.js 注释）：
//      浮窗(880) > 输入框 wSkVaW_composerSeat(7)；
//      浮窗(880) < 宿主对话框 portal root(1000)；
//      浮窗(880) < 菜单磨砂(900) / 弹层表面(3000)
// 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）：
//   M-value  面板层值 880→9999 ⇒ 两态 R2、R3 红（盖过模态与弹层）
//   M-untrap 祖先盒规则删掉 ⇒ 两态 T2 红
//   M-yield  让位规则删掉 ⇒ 两态 T3 红（真模态打开不让位）
//   M-yield-class 倒退变异：让位改回 _modal 类名恒真条件 ⇒ 两态 T3 + T3b 红
//   M-noimg  无壁纸路径不再输出 conv 层级块 ⇒ 无壁纸组 N-T0/N-T1/N-T2/N-T3 红（LAYER2-A 契约）
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

/** 取产物 CSS；settings 可指定两态：有壁纸（image 真 URL 形态）/ 无壁纸（只有 enabled）。 */
function cssOf(clientPath, settings) {
  reset();
  loadPlugin({ quiet: true, clientPath, settings: settings ?? { enabled: true, image: 'data:image/png;base64,AAA' } });
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

/** 一份产物 CSS 的契约断言；name 前缀区分两态（''=有壁纸，'N-'=无壁纸）。返回红集（T/R 编号）。 */
function contractReds(css, prefix = '') {
  const rs = rulesOf(css);
  const crs = convRules(rs);
  const red = [];
  const panel = crs.find((r) => r.sel === 'html body .dsh-conv-panel' && /z-index/.test(r.body));
  const zv = panel ? zOf(panel) : null;
  if (crs.length < 3) red.push(prefix + 'T0');
  if (!(panel && zv === '880' && /!important/.test(panel.body))) red.push(prefix + 'T1');
  if (!crs.every((r) => zOf(r) !== '9999')) red.push(prefix + 'T1b');
  const untrap = crs.find((r) => r.sel.indexOf('.wSkVaW_header :has([class*="dsh-conv-panel"])') >= 0 && !/auto/.test(r.body));
  if (!(untrap && /position\s*:\s*relative/.test(untrap.body) && zOf(untrap) === '60')) red.push(prefix + 'T2');
  const yr = crs.find((r) => r.sel.includes(':has([role="dialog"][aria-modal="true"]) .dsh-conv-panel'));
  if (!(yr && zOf(yr) === 'auto' && /!important/.test(yr.body))) red.push(prefix + 'T3');
  const cy = crs.filter((r) => r.sel.includes('.dsh-conv-panel') && /:has\(\[class\*="_(?:overlay|overlayLayer|modal)"\]\)/.test(r.sel) && !/:not\(/.test(r.sel));
  if (cy.length > 0) red.push(prefix + 'T3b');
  const pv = Number(zv);
  if (!(pv > HOST_COMPOSER_SEAT_Z)) red.push(prefix + 'R1');
  if (!(pv < HOST_DIALOG_PORTAL_Z)) red.push(prefix + 'R2');
  if (!(pv < OUR_MENU_FROST_Z && pv < OUR_POPUP_SURFACE_Z)) red.push(prefix + 'R3');
  return red;
}

/** 打印一组断言（同 contractReds 的判定，逐条 ok() 输出）。 */
function reportGroup(css, label, prefix) {
  const rs = rulesOf(css);
  const crs = convRules(rs);
  const panel = crs.find((r) => r.sel === 'html body .dsh-conv-panel' && /z-index/.test(r.body));
  const zv = panel ? zOf(panel) : null;
  const untrap = crs.find((r) => r.sel.indexOf('.wSkVaW_header :has([class*="dsh-conv-panel"])') >= 0 && !/auto/.test(r.body));
  const yr = crs.find((r) => r.sel.includes(':has([role="dialog"][aria-modal="true"]) .dsh-conv-panel'));
  const cy = crs.filter((r) => r.sel.includes('.dsh-conv-panel') && /:has\(\[class\*="_(?:overlay|overlayLayer|modal)"\]\)/.test(r.sel) && !/:not\(/.test(r.sel));
  ok(`[${label}] T0 产物 CSS 里有 conv-panel 规则（≥3 组）`, crs.length >= 3, 'n=' + crs.length);
  ok(`[${label}] T1 面板层值 = 880（!important；档位家族取值）`, !!panel && zv === '880' && /!important/.test(panel.body), 'z=' + zv);
  ok(`[${label}] T1b 没有写死 9999（任务明令禁止）`, crs.every((r) => zOf(r) !== '9999'), '');
  ok(`[${label}] T2 祖先盒规则在场（header 内祖先盒 relative + z-index:60）`,
    !!untrap && /position\s*:\s*relative/.test(untrap.body) && zOf(untrap) === '60', untrap ? untrap.body.slice(0, 60) : 'missing');
  ok(`[${label}] T3 让位：真模态（[role="dialog"][aria-modal="true"]）在场 ⇒ 面板 z:auto`,
    !!yr && zOf(yr) === 'auto' && /!important/.test(yr.body), yr ? ('z=' + zOf(yr)) : 'missing');
  ok(`[${label}] T3b 反向：不存在类名条件让位（_overlay/_overlayLayer/_modal ⇒ 恒真条件，防回退）`,
    cy.length === 0, cy.length ? ('hit=' + cy[0].sel.slice(0, 80)) : 'clean');
  const pv = Number(zv);
  ok(`[${label}] R1 浮窗(880) > 输入框 composerSeat(7)`, pv > HOST_COMPOSER_SEAT_Z, '');
  ok(`[${label}] R2 浮窗(880) < 宿主对话框 portal root(1000)（设置/模态在上）`, pv < HOST_DIALOG_PORTAL_Z, '');
  ok(`[${label}] R3 浮窗(880) < 菜单磨砂(900) 且 < 弹层表面(3000)（我们的弹层在上）`,
    pv < OUR_MENU_FROST_Z && pv < OUR_POPUP_SURFACE_Z, '');
  return contractReds(css, prefix);
}

console.log('== T. 规则在场 + 数值比较（有壁纸 / 无壁纸 两态，LAYER2-A 契约）==');
const WITH_IMG = { enabled: true, image: 'data:image/png;base64,AAA' };
const NO_IMG = { enabled: true };
const redWith = reportGroup(cssOf(path.join(ROOT, 'lib', 'client.js'), WITH_IMG), '有壁纸', '');
const redNo = reportGroup(cssOf(path.join(ROOT, 'lib', 'client.js'), NO_IMG), '无壁纸', 'N-');

/* ---------- 变异自证（隔离副本；锚点必须恰好替换一次 —— R2） ---------- */
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');
const TMP_DIRS = [];
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP_DIRS.push(d); return d; };
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

async function withMutant(id, what, pairs, expectRed) {
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
  let red;
  try {
    red = [...contractReds(cssOf(f, WITH_IMG), ''), ...contractReds(cssOf(f, NO_IMG), 'N-')];
  } catch (e) { red = ['THROW:' + String(e && e.message || e).slice(0, 60)]; }
  const eq = applied.every(Boolean) && JSON.stringify(red.slice().sort()) === JSON.stringify(expectRed.slice().sort());
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-MISMATCH') + ' ' + id + ' ' + what);
  console.log('    期望红集=' + JSON.stringify(expectRed.slice().sort()) + ' 实际红集=' + JSON.stringify(red.slice().sort())
    + ' 变异生效=' + JSON.stringify(applied));
  if (!eq) fail++; else pass++;
}

console.log('\n== M. 变异自证（期望红集 == 实际红集，逐条相等；两态联合红集）==');
await withMutant('M-value', '面板层值 880→9999（盖过模态与弹层，两态同红）',
  [['html body .dsh-conv-panel { z-index: 880 !important; }', 'html body .dsh-conv-panel { z-index: 9999 !important; } /* M-value */']],
  ['T1', 'T1b', 'R2', 'R3', 'N-T1', 'N-T1b', 'N-R2', 'N-R3']);
await withMutant('M-untrap', '祖先盒规则删掉（header 内与面板同域的内容不再有 60 档排序）',
  [['html body .wSkVaW_header :has([class*="dsh-conv-panel"]) {\n\tposition: relative;\n\tz-index: 60 !important;\n}', '/* M-untrap */']],
  ['T2', 'N-T2']);
await withMutant('M-yield', '让位规则删掉（真模态打开不让位）',
  [['html body:has([role="dialog"][aria-modal="true"]) .dsh-conv-panel {\n\t\tz-index: auto !important;\n\t}', '/* M-yield */']],
  ['T3', 'N-T3']);
await withMutant('M-yield-class', '倒退变异：把让位改回类名恒真条件（_modal ⇒ 面板恒压 auto）',
  [['html body:has([role="dialog"][aria-modal="true"]) .dsh-conv-panel {\n\t\tz-index: auto !important;\n\t}',
    'html body:has([class*="_modal"]) .dsh-conv-panel {\n\t\tz-index: auto !important;\n\t} /* M-yield-class */']],
  ['T3', 'T3b', 'N-T3', 'N-T3b']);
await withMutant('M-noimg', '无壁纸早退路径不再输出 conv 层级块（LAYER2-A 回退）',
  [['css += __convPanelLayerCss;\n\t\t\treturn emitSurfaceTokens(css + buildUiCss(section, false)) + __npCss;',
    '/* M-noimg */\n\t\t\treturn emitSurfaceTokens(css + buildUiCss(section, false)) + __npCss;']],
  ['N-T0', 'N-T1', 'N-T2', 'N-T3', 'N-R1']);

if (redWith.length || redNo.length) {
  console.log('\n!! 真树两态红集非空：' + JSON.stringify({ redWith, redNo }));
  fail += redWith.length + redNo.length;
}
console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

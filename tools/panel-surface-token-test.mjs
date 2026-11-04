// tools/panel-surface-token-test.mjs —— 「标题栏浮层面板」表面与主界面统一的回归门禁（2026-10-24）
//
// 背景（任务书差异表第一行）：智能体团队展开面板（宿主 dsh-experimental-client-ui-agent-team 的
// .VoX2oq_panel，根元素带 [data-team-panel]）与 Token 用量/会话统计面板（dsh-client-ui-chat 的
// .bRhRbq_panel）的底色由本插件接管（2026-10-09 第三批真机修复，解决"宿主 :before 伪元素画在
// 元素背景之上、改元素底看不见"的机制问题）。接管结构保留，但**取值**原来是插件自造的
// 霜化档（80% 白 + blur(11px)），与主界面菜单面板族（宿主 .JObwrW_panel / .QsffPG_menu /
// .ZKlsPq_menu：--dsw-specific-menu + --dsw-menu-backdrop-filter = blur(40px) saturate(150%)）
// 不一致 —— 团队面板比主界面**更白、更糊**。
// 本次统一：SSOT 新增 --mpw-surface-panel-menu（= var(--dsw-specific-menu)，亮/暗/darwin 由宿主
// 定义自动跟随）与 --mpw-panel-menu-blur（= var(--dsw-menu-backdrop-filter)，宿主常量），
// 规则本体仍只读 --mpw-* 命名空间（token-namespace 纪律）。
//
// 本文件断言（每条都能被"改回旧取值/删结构"变红，见文末 M1–M3）：
//   P1 SSOT：两个新 token 恰好定义一次，值 = 统一表面 token（符号级；2026-11-03 起可调）
//   P2 产物规则：[data-team-panel]::before 底消费 --mpw-surface-panel-menu，不再消费旧霜化档
//   P3 产物规则：[data-team-panel]::before 磨砂消费 --mpw-panel-menu-blur（标准 + webkit 前缀）
//   P4 逐 token 相等（代换到统一表面 token）+ 暗色档消费 pop-surface-dark
//   P5 结构：[data-team-panel] 元素透明 + ::before 单层底/模糊（避免 fixed tooltip 包含块）
//   P6 层叠：通用 [role="dialog"] 兜底与 team 规则并存（特异性 (0,1,2) > (0,1,0)，team 胜）
// 复现: node tools/panel-surface-token-test.mjs
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

const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwBsVerAt', '__mpwGlobalWired',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState'];
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k]; } catch {} } };

const { loadPlugin, cancelWorldTimers } = await import('./_stub.mjs');
/** 取产物 CSS（与 style-scope-guard / css-matrix 同口径的 __mpwBuildCss 入口）。
 *  image 必须是**真 URL 形态**（布尔 true 会被归一化成 "" ⇒ 走 !hasImage 分支，
 *  那条分支不含对话框/浮层面板块 ⇒ 全部 P 组假红）。 */
function cssOf(clientPath, patch) {
  reset();
  loadPlugin({ quiet: true, clientPath, settings: Object.assign({ enabled: true, image: 'data:image/png;base64,AAA' }, patch || {}) });
  return String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss(patch || {}) : '')) || '';
}
const strip = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (css) => [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].replace(/\s+/g, ' ').trim(), body: m[2] }));
/** [data-team-panel] 的元素级规则（选择器是 "html body [data-team-panel], html body [class*=…]" 形态） */
const teamRules = (rs) => rs.filter((r) => r.sel.includes('[data-team-panel]') && !r.sel.includes('::'));
const ssotOf = (rs) => rs.find((r) => r.sel === 'body' && r.body.includes('--mpw-surface-panel-menu'));
const menuValOf = (rs) => { const s = ssotOf(rs); return s ? (/--mpw-surface-panel-menu\s*:\s*([^;]+)/.exec(s.body) || [])[1] || null : null; };
const blurValOf = (rs) => { const s = ssotOf(rs); return s ? (/--mpw-panel-menu-blur\s*:\s*([^;]+)/.exec(s.body) || [])[1] || null : null; };
const bgRuleOf = (rs) => teamRules(rs).find((r) => /background-color/.test(r.body)) || null;

const DETAIL_NAMES = {
  P1a: 'SSOT 定义 --mpw-surface-panel-menu = var(--mpw-pop-surface)',
  P1b: 'SSOT 定义 --mpw-panel-menu-blur = var(--mpw-pop-blur)',
  P1c: '两个 token 在产物里各只有 SSOT 一个定义点',
  P2a: '[data-team-panel] 背景规则存在',
  P2b: '背景消费 --mpw-surface-panel-menu（不再消费旧霜化档）',
  P3: '磨砂消费 --mpw-panel-menu-blur（标准 + webkit）',
  P4a: '底消费 --mpw-surface-panel-menu（= 统一 --mpw-pop-surface）',
  P4b: '磨砂消费 --mpw-panel-menu-blur（= 统一 --mpw-pop-blur）',
  P4c: '暗色档消费 --mpw-pop-surface-dark（统一亮/暗两态）',
  P5: '元素透明 + ::before 单层表面/模糊（fixed tooltip 不建包含块）',
  P6: '通用 [role="dialog"] 兜底并存（team 规则特异性 (0,1,2) > (0,1,0) 胜出）',
};

/** 判据核心（P 组与变异组共用同一实现 —— 变异测的就是这套逻辑的分辨力） */
function judge(clientPath) {
  const rs = rules(cssOf(clientPath, {}));
  const red = [];
  const detail = {};
  const g = (id, cond, d) => { detail[id] = d || ''; if (!cond) red.push(id); };
  const team = teamRules(rs);
  const bg = bgRuleOf(rs);
  const menuVal = menuValOf(rs), blurVal = blurValOf(rs);
  g('P2a', team.length >= 1, JSON.stringify(team.map((r) => r.sel)));
  const teamPseudoSurface = rs.filter((r) => r.sel.includes('[data-team-panel]::before')
    && r.body.includes('var(--mpw-surface-panel-menu)'));
  const sf = teamPseudoSurface[0];
  g('P2b', !!sf && sf.body.includes('var(--mpw-surface-panel-menu)') && !sf.body.includes('--mpw-surface-panel-frost'),
    sf ? sf.body.slice(0, 120) : '无规则');
  g('P3', !!sf && /-webkit-backdrop-filter\s*:\s*var\(--mpw-panel-menu-blur\)/.test(sf.body)
    && /(?:^|;)\s*backdrop-filter\s*:\s*var\(--mpw-panel-menu-blur\)/.test(sf.body),
    sf ? (sf.body.match(/backdrop-filter[^;]*/g) || []).join(' | ') : '无规则');
  const teamElementTransparent = team.every((r) => /background-color\s*:\s*transparent/.test(r.body)
    && !/backdrop-filter\s*:\s*var\(/.test(r.body));
  g('P5', teamElementTransparent && teamPseudoSurface.length === 1,
    'elementTransparent=' + teamElementTransparent + ' pseudoSurface=' + teamPseudoSurface.length);
  g('P1a', menuVal === 'var(--mpw-pop-surface)', String(menuVal));
  g('P1b', blurVal === 'var(--mpw-pop-blur)', String(blurVal));
  const cnt = (tok) => (strip(rs.length ? rs.map((r) => r.body).join(';') : '').match(new RegExp(tok.replace(/-/g, '\\-') + '\\s*:', 'g')) || []).length;
  g('P1c', cnt('--mpw-surface-panel-menu') === 1 && cnt('--mpw-panel-menu-blur') === 1,
    'menu=' + cnt('--mpw-surface-panel-menu') + ' blur=' + cnt('--mpw-panel-menu-blur'));
  // P4 逐 token 相等：消费点 → SSOT → 宿主常量，两层代换后与主界面基准符号级相等
  g('P4a', !!sf && menuVal === 'var(--mpw-pop-surface)' && sf.body.includes('var(--mpw-surface-panel-menu)'),
    sf ? 'surface ✓=' + !!/var\(--mpw-surface-panel-menu\)/.test(sf.body) + ' menuVal=' + menuVal : '无规则');
  g('P4b', !!sf && blurVal === 'var(--mpw-pop-blur)' && sf.body.includes('var(--mpw-panel-menu-blur)'),
    'blurVal=' + blurVal);
  const darkTeam = rs.filter((r) => /data-ds-dark-theme\] \[data-team-panel\]/.test(r.sel) && /background/.test(r.body));
  g('P4c', darkTeam.length === 1 && darkTeam[0].body.includes('var(--mpw-pop-surface-dark)'), JSON.stringify(darkTeam.map((r) => r.sel + ':' + r.body.slice(0, 80))));
  const dlgFallback = rs.find((r) => r.sel.includes('[role="dialog"]') && /background-color/.test(r.body));
  g('P6', !!dlgFallback && team.length >= 1, dlgFallback ? '兜底在' : '兜底缺失');
  return { red, detail };
}

console.log('== P. 逐 token 相等（真产物 buildCss）==');
{
  const { red, detail } = judge(path.join(ROOT, 'lib', 'client.js'));
  const ALL = ['P1a', 'P1b', 'P1c', 'P2a', 'P2b', 'P3', 'P4a', 'P4b', 'P4c', 'P5', 'P6'];
  for (const id of ALL) {
    const isRed = red.includes(id);
    ok(id + ' ' + DETAIL_NAMES[id], !isRed, isRed ? detail[id] : '');
  }
}

console.log('\n== M. 变异自证（期望红集 == 实际红集，逐条相等）==');
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');

async function withMutant(id, what, pairs, expectRed) {
  const dir = mkTmp('mpw-panel-tok-mut-');
  const f = path.join(dir, 'client.js');
  let mutated = src0;
  const applied = [];
  for (const [a, r] of pairs) {
    const n = mutated.split(a).length - 1;
    const next = mutated.replace(a, r);
    applied.push(n === 1 && next !== mutated && !next.includes(a));
    mutated = next;
  }
  fs.writeFileSync(f, mutated);
  const { red } = judge(f);
  const eq = applied.every(Boolean) && JSON.stringify(red.slice().sort()) === JSON.stringify(expectRed.slice().sort());
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-MISMATCH') + ' ' + id + ' ' + what);
  console.log('    期望红集=' + JSON.stringify(expectRed.slice().sort()) + ' 实际红集=' + JSON.stringify(red.slice().sort())
    + ' 变异生效=' + JSON.stringify(applied));
  if (!eq) fail++; else pass++;
}

await withMutant('M1', 'SSOT 值改回旧霜化档', [
  ['tok("--mpw-surface-panel-menu", "var(--mpw-pop-surface)")', 'tok("--mpw-surface-panel-menu", "var(--mpw-surface-panel-frost)") /* M1 */'],
], ['P1a', 'P4a']);

await withMutant('M2', '磨砂改回 blur(11px) 常量', [
  ['html body [data-team-panel]::before {\n\tcontent: "" !important;\n\tposition: absolute !important;\n\tinset: 0 !important;\n\tz-index: -1 !important;\n\tpointer-events: none !important;\n\tborder-radius: inherit !important;\n\tbackground-color: var(--mpw-surface-panel-menu) !important;\n\t-webkit-backdrop-filter: var(--mpw-panel-menu-blur) !important;\n\tbackdrop-filter: var(--mpw-panel-menu-blur) !important;\n}',
   'html body [data-team-panel]::before {\n\tcontent: "" !important;\n\tposition: absolute !important;\n\tinset: 0 !important;\n\tz-index: -1 !important;\n\tpointer-events: none !important;\n\tborder-radius: inherit !important;\n\tbackground-color: var(--mpw-surface-panel-menu) !important;\n\t-webkit-backdrop-filter: blur(11px) !important;\n\tbackdrop-filter: blur(11px) !important;\n} /* M2 */'],
], ['P3', 'P4b']);

await withMutant('M3', '元素重新画底（破坏单层结构）', [
  ['html body [data-team-panel] {\n\tbackground-color: transparent !important;',
   'html body [data-team-panel] {\n\tbackground-color: var(--mpw-surface-panel-menu) !important;'],
], ['P5']);

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

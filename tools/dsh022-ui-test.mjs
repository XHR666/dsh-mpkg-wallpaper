// tools/dsh022-ui-test.mjs —— DSH 0.2.2-rc.2 UI 回归修复判据（B2/B5/B7 菜单 material 换代 + B11 原生 dialog + B12 用户消息框模糊开关）
//
// 契约（lib/client.js；证据 docs/reports/DSH022-UI-20261115/ probe-report.json A/B 读数）：
//   A 组（菜单 material 家族，B2/B5/B7）：
//     A1 内层 material 透明化规则匹配两代类名（_material_ 前缀通配；旧 ri079 已 0 命中，
//        0.2.2-rc.2 = _material_1w4el_21），且带 [aria-hidden="true"] 抬档变体（暗色下压过
//        pop-surface-dark 内层规则 ⇒ 暗色同样单层）。
//     A2 旧代兼容保留：_surface_ri079_1 / _surface_1w4el_ 两代外壳都在模糊中和/::before 排除里。
//     A3 迁移收口：lib/client.js 里不再有 [class*="_material_ri079_"] 原子（R36 同类排查完成）。
//     A4 JS 侧 mpwPopInsideMenuShell 同步认 1w4el 外壳。
//     A5 popSurfaceSel 的 ::before 玻璃排除 1w4el 外壳（隔离 backdrop root 内伪元素采样不到页面）。
//   D 组（B11 原生 dialog）：
//     D1 dialog[open]:not([class*="dshm-picker"]) 进入亮/暗两条不透明兜底（dsh-mobile 的
//        .dsh-module-dialog 背景吃 --dsw-alias-bg-layer-1，被 token 半透明化后裸 dialog 无 role）。
//   B 组（B12 用户消息框模糊开关 msgBlur，默认开=现状）：
//     B1 默认档（无 msgBlur 键）产物**不含**关档规则。
//     B2 msgBlur:false 产物含 userStack 实底（--mpw-surface-panel）+ 子树 blur 撤销 + 暗色变体。
//     B3 开/关两档产物逐字节不同（开关真的接线，switch-wiring 口径）。
//     B4 关档规则只出现在两条 return 路径（无壁纸/有壁纸）都覆盖。
//     B5 全链路登记：boolFields / MPW_PRESET_FIELDS / resetSettings / toggleRow(appearance) / zh+en i18n。
//   变异自证（隔离副本；期望红集 == 实际红集，逐条相等）：
//     M1 摘掉主路径的 mpwMsgBlurOffCss 拼接 ⇒ B2/B3/B4 红
//     M2 内层 material 透明化改回只认 ri079 ⇒ A1 红
//     M3 暗色 dialog 兜底去掉 dialog[open] ⇒ D1 红
// 复现: node tools/dsh022-ui-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const CLIENT_PATH = path.join(ROOT, 'lib', 'client.js');
const CLIENT = fs.readFileSync(CLIENT_PATH, 'utf8');
let pass = 0, fail = 0;
const ok = (n, cond, d) => {
  if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); }
  else { fail++; console.log('  ✗ ' + n + (d ? '  → ' + d : '')); }
};
const { loadPlugin } = await import('./_stub.mjs');
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwGlobalWired', '__mpwThumbSched',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState', '__mpwBsScanKick', '__mpwBsScanMore'];
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k]; } catch {} } };
function cssOf(clientPath, patch) {
  reset();
  loadPlugin({ quiet: true, clientPath, settings: Object.assign({ enabled: true }, patch || {}) });
  return String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss(patch || {}) : '') || '';
}

console.log('== A. 菜单 material 家族换代（B2/B5/B7）==');
{
  const cssOn = cssOf(CLIENT_PATH, { image: 'data:image/png;base64,AAA', float: true });
  ok('A1a 内层 material 透明化按 _material_ 前缀通配（两代同收）',
    /html body :is\(\[data-menu-material\], \[data-trigger-menu\]\) \[class\*="_material_"\],\s*\n\s*html body :is\(\[data-menu-material\], \[data-trigger-menu\]\) \[class\*="_material_"\]\[aria-hidden="true"\]/.test(cssOn),
    cssOn.includes('[class*="_material_"][aria-hidden="true"]') ? '' : 'aria-hidden 抬档变体缺失');
  ok('A1b 透明化规则体为 background-color: transparent !important（单层纪律：外壳画底、内层透明）',
    /html body :is\(\[data-menu-material\], \[data-trigger-menu\]\) \[class\*="_material_"\],\s*\n\s*html body :is\(\[data-menu-material\], \[data-trigger-menu\]\) \[class\*="_material_"\]\[aria-hidden="true"\] \{\s*background-color: transparent !important;/s.test(cssOn), '');
  ok('A2a 两代外壳都在内层 blur 中和规则里（旧 ri079 兼容 + 新 1w4el）',
    cssOn.includes('[class*="_surface_ri079_1"] [class*="_material_"]') && cssOn.includes('[class*="_surface_1w4el_"] [class*="_material_"]'), '');
  ok('A2b ::before 玻璃排除两代外壳（隔离 backdrop root 内伪元素采样不到页面）',
    cssOn.includes('not([class*="_surface_ri079_1"])') && cssOn.includes('not([class*="_surface_1w4el_"])'), '');
  ok('A3 迁移收口：去除注释后源码不再有 [class*="_material_ri079_"] 选择器原子（R36 同类排查；历史注释保留）',
    !CLIENT.replace(/\/\*[\s\S]*?\*\//g, '').includes('[class*="_material_ri079_"]'), '非注释代码仍有旧原子');
  ok('A4 JS mpwPopInsideMenuShell 认 1w4el 外壳（内层元素不再吃兜底底）',
    CLIENT.includes("p.matches('[class*=\"_surface_ri079_\"], [class*=\"_surface_1w4el_\"]')"), '');
  ok('A5 模型菜单内层透明规则通配 _material_（T14 规则同步换代）',
    cssOn.includes('html body[data-mpw-float] [class*="_7KE1Ra_menu"] [class*="_material_"]'), '');
}

console.log('== D. 原生 dialog 不透明兜底（B11）==');
{
  const cssOn = cssOf(CLIENT_PATH, { image: 'data:image/png;base64,AAA' });
  const hasLight = /dialog\[open\]:not\(\[class\*="dshm-picker"\]\)/.test(cssOn);
  const darkCount = (cssOn.match(/body\[data-ds-dark-theme\] dialog\[open\]:not\(\[class\*="dshm-picker"\]\)/g) || []).length;
  ok('D1a dialog[open]（排除 dshm-picker 全屏透明包装层）进入亮色不透明兜底', hasLight, '');
  ok('D1b 暗色规则同样带 dialog[open]', darkCount >= 1, 'dark=' + darkCount);
  ok('D1c 兜底值 = --mpw-surface-panel（复用面板表面 SSOT，不写死白色）',
    /dialog\[open\]:not\(\[class\*="dshm-picker"\]\) \{\s*background-color: var\(--mpw-surface-panel\)/s.test(cssOn), '');
}

console.log('== B. 用户消息框背景模糊开关（B12，默认开=现状）==');
{
  const cssDefault = cssOf(CLIENT_PATH, { image: 'data:image/png;base64,AAA' });
  const cssOn = cssOf(CLIENT_PATH, { image: 'data:image/png;base64,AAA', msgBlur: true });
  const cssOff = cssOf(CLIENT_PATH, { image: 'data:image/png;base64,AAA', msgBlur: false });
  const cssOffNoWall = cssOf(CLIENT_PATH, { image: '', msgBlur: false });
  ok('B1 默认档与显式开档都不含关档规则（默认=现状零输出）',
    !cssDefault.includes('data-chat-flow-kind="user"') && !cssOn.includes('data-chat-flow-kind="user"'), '');
  ok('B2a 关档：userStack 实底 = var(--mpw-surface-panel)（不写死白色；后代组合器——宿主槽位包装层不能直接子代）',
    /\[data-chat-flow-kind="user"\] \[class\*="userRow"\] \[class\*="userStack"\] \{\s*background-color: var\(--mpw-surface-panel, #ffffff\) !important;/s.test(cssOff), '');
  ok('B2b 关档：子树 blur 撤销规则在（防御性，宿主未来加 blur 时开关仍有效）',
    /html body \[data-chat-flow-kind="user"\] \* \{\s*-webkit-backdrop-filter: none !important;\s*\n\s*backdrop-filter: none !important;/s.test(cssOff), '');
  ok('B2c 关档：暗色变体用 --mpw-surface-panel-dark',
    /body\[data-ds-dark-theme\] \[data-chat-flow-kind="user"\] \[class\*="userRow"\] \[class\*="userStack"\] \{\s*background-color: var\(--mpw-surface-panel-dark, #1b1e24\) !important;/s.test(cssOff), '');
  ok('B2d 关档实底规则不得用直接子代 >（真机 DOM：flowItem 与 userRow 之间隔 data-slot display:contents 包装层，> 会 0 命中——审查 BLOCKER-1 回归钉）',
    (() => { const m = /html body(?:\[data-ds-dark-theme\])? \[data-chat-flow-kind="user"\]([^{}]*)\{\s*background-color: var\(--mpw-surface-panel/s.exec(cssOff); return !!m && !m[1].includes('>'); })(), '');
  ok('B3 开/关两档产物逐字节不同（开关真的接线）', cssOn !== cssOff, '');
  ok('B4 无壁纸关档同样产出（两条 return 路径都覆盖）',
    cssOffNoWall.includes('data-chat-flow-kind="user"'), '');
  ok('B5a boolFields 登记（导入布尔净化链）', /const boolFields = \[[^\]]*"msgBlur"\]/.test(CLIENT), '');
  ok('B5b MPW_PRESET_FIELDS 登记（预设快照白名单；[^\]] 防跨数组误配）', /const MPW_PRESET_FIELDS = \[[^\]]*"msgBlur"/.test(CLIENT), '');
  ok('B5c resetSettings 复位 msgBlur（恢复默认 = 回开）', /msgBlur: DEFAULT_MSG_BLUR/.test(CLIENT), '');
  ok('B5d 外观 tab 有 toggleRow（data-mpw-tabkey="appearance" 区块内）', (() => {
    const i = CLIENT.indexOf('"data-mpw-tabkey": "appearance"');
    if (i < 0) return false;
    const seg = CLIENT.slice(i, i + 6000);
    return /toggleRow\(t\("msgBlur"\), t\("msgBlur\.desc"\), "msgBlur", DEFAULT_MSG_BLUR\)/.test(seg);
  })(), '');
  ok('B5e zh/en 词典都有 msgBlur 两键', /"msgBlur": "用户消息框背景模糊"/.test(CLIENT) && /"msgBlur": "User message background blur"/.test(CLIENT), '');
  {
    // B5f 行为级往返（审查 P2-2）：写入口走**真 writeSection**（__mpwSectionTest.write 与
    // 设置面板 commit() 同一条持久化路径），随后 __mpwBuildCss({}) 读的是同一份 sectionCache
    // ⇒ "写入 → 生效"零重建往返。预设快照白名单的净化语义由 B5b + M4 钉（mpwPresetSanitizeSettings
    // 按 boolFields 放行布尔、按 MPW_PRESET_FIELDS 收白名单外键）。
    reset();
    loadPlugin({ quiet: true, clientPath: CLIENT_PATH, settings: { enabled: true, image: 'data:image/png;base64,AAA' } });
    const w = (globalThis.__mpwSectionTest && globalThis.__mpwSectionTest.write({ msgBlur: false }));
    const cssRound = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '');
    ok('B5f 行为往返：真 writeSection 写 msgBlur:false ⇒ 同一持久化路径下的产物含关档规则',
      w === true && /data-chat-flow-kind="user"\] \[class\*="userRow"\]/.test(cssRound), 'write=' + JSON.stringify(w));
    reset();
  }
}

console.log('== M. 变异自证（隔离副本；期望红集 == 实际红集）==');
const runChecks = (clientPath) => {
  const red = [];
  try {
    const src = fs.readFileSync(clientPath, 'utf8');
    if (!/const MPW_PRESET_FIELDS = \[[^\]]*"msgBlur"/.test(src)) red.push('B5b');
    const cssOn = cssOf(clientPath, { image: 'data:image/png;base64,AAA', float: true });
    const cssDefault = cssOf(clientPath, { image: 'data:image/png;base64,AAA' });
    const cssOff = cssOf(clientPath, { image: 'data:image/png;base64,AAA', msgBlur: false });
    const cssOffNoWall = cssOf(clientPath, { image: '', msgBlur: false });
    if (!/html body :is\(\[data-menu-material\], \[data-trigger-menu\]\) \[class\*="_material_"\],\s*\n\s*html body :is\(\[data-menu-material\], \[data-trigger-menu\]\) \[class\*="_material_"\]\[aria-hidden="true"\]/.test(cssOn)) red.push('A1a');
    if (!/\[data-chat-flow-kind="user"\] \[class\*="userRow"\] \[class\*="userStack"\] \{\s*background-color: var\(--mpw-surface-panel/s.test(cssOff)) red.push('B2a');
    if (!(!cssDefault.includes('data-chat-flow-kind="user"'))) red.push('B1');
    if (!(cssOff.includes('data-chat-flow-kind="user"') && cssDefault !== cssOff)) red.push('B3');
    if (!cssOffNoWall.includes('data-chat-flow-kind="user"')) red.push('B4');
    { const m = /html body(?:\[data-ds-dark-theme\])? \[data-chat-flow-kind="user"\]([^{}]*)\{\s*background-color: var\(--mpw-surface-panel/s.exec(cssOff); const b2dOk = !!(m && !m[1].includes('>')); if (!b2dOk) red.push('B2d'); }
    if (!/dialog\[open\]:not\(\[class\*="dshm-picker"\]\)/.test(cssOn)) red.push('D1a');
    if (!(cssOn.match(/body\[data-ds-dark-theme\] dialog\[open\]/g) || []).length) red.push('D1b');
  } catch (e) { red.push('THROW:' + String(e && e.message || e).slice(0, 60)); }
  return red;
};
const mutant = (id, from, to, expect) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-dsh022-'));
  const anchorCount = CLIENT.split(from).length - 1;
  if (anchorCount !== 1) { console.log(`  ✗ ${id} 变异锚点必须唯一（R2）：实际出现 ${anchorCount} 次`); fail++; return; }
  const mut = CLIENT.replace(from, to);
  if (mut === CLIENT) { console.log(`  ✗ ${id} 变异锚点缺失（R2：变异必须真的打上去）`); fail++; return; }
  const p = path.join(dir, 'client.js');
  fs.writeFileSync(p, mut);
  const actual = runChecks(p);
  const okSet = JSON.stringify([...expect].sort()) === JSON.stringify([...actual].sort());
  if (okSet) { pass++; console.log(`  ✓ MUTANT-RED-OK ${id}  期望=${JSON.stringify(expect.sort())} 实际=${JSON.stringify(actual.sort())}`); }
  else { fail++; console.log(`  ✗ MUTANT-MISMATCH ${id}  期望=${JSON.stringify(expect.sort())} 实际=${JSON.stringify(actual.sort())}`); }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
};
mutant('M1 摘掉主路径 msgBlurOffCss 拼接',
  'return emitSurfaceTokens(css + buildUiCss(section, dlgFrosted) + (hasImage ? mpwMobileShellOpaqueCss() : "")) + __npCss + mpwMsgBlurOffCss(section);',
  'return emitSurfaceTokens(css + buildUiCss(section, dlgFrosted) + (hasImage ? mpwMobileShellOpaqueCss() : "")) + __npCss;',
  ['B2a', 'B2d', 'B3']);
mutant('M1b 摘掉无壁纸路径 msgBlurOffCss 拼接',
  'return emitSurfaceTokens(css + buildUiCss(section, false)) + noImagePopCss + __npCss + mpwMsgBlurOffCss(section);',
  'return emitSurfaceTokens(css + buildUiCss(section, false)) + noImagePopCss + __npCss;',
  ['B4']);
mutant('M2 内层 material 透明化改回只认 ri079（复现 0.2.2 双层白）',
  'html body :is([data-menu-material], [data-trigger-menu]) [class*="_material_"],\n  html body :is([data-menu-material], [data-trigger-menu]) [class*="_material_"][aria-hidden="true"] {\n    background-color: transparent !important;\n  }',
  'html body :is([data-menu-material], [data-trigger-menu]) [class*="_material_ri079_"] {\n    background-color: transparent !important;\n  }',
  ['A1a']);
mutant('M3 暗色 dialog 兜底去掉 dialog[open]',
  'body[data-ds-dark-theme] [role="dialog"],\nbody[data-ds-dark-theme] [role="alertdialog"],\nbody[data-ds-dark-theme] dialog[open]:not([class*="dshm-picker"]) {',
  'body[data-ds-dark-theme] [role="dialog"],\nbody[data-ds-dark-theme] [role="alertdialog"] {',
  ['D1b']);
mutant('M4 从 MPW_PRESET_FIELDS 摘掉 msgBlur（预设快照漏键 ⇒ B5b 红）',
  '\n\t\t\t"msgBlur" // ①(2026-11-15 B12) 用户消息框背景模糊开关随预设走',
  '',
  ['B5b']);

console.log(`===== ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);

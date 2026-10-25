// tools/market-topbar-glass-test.mjs —— 插件市场「搜索框+Tag 栏」顶栏观感判据（2026-10-25 任务 4）
//
// 契约（lib/client.js buildCss 的「插件市场顶栏半透明磨砂」块；标记见 mpwSolidSurfaceSync）：
//   G1 底色 = var(--dsw-specific-menu, #f8f9faf0)：回退值 alpha ≈ 0.94 —— 既非纯白（alpha<1）
//      又非全透（alpha>0.5 阈值）；宿主令牌在场时用宿主档（linux 亮=#f8f9fa94 ≈ 0.58，同区间）
//   G2 无壁纸态同规则在场（buildCss !hasImage 早退之前输出 ⇒ 两态观感一致；插件停用 = 顶部早退不输出）
//   G3 模糊 = var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%)) —— 非 none
//   G4 深色规则在（回退 #303136f0）
//   G5 l1（dsh-conv-panel 实底）语义不变：有壁纸在、无壁纸不在（与 l2 玻璃档互不干扰）
// 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）：
//   M-solid    回退值改纯白（alpha=1）⇒ G1、G2 红（"纯白不透明"回归）
//   M-trans    回退值改全透（alpha=0）⇒ G1、G2 红（"全透明直接透过去"回归）
//   M-blur     模糊改 none ⇒ G3 红（"只剩半透明没模糊"回归）
// 复现: node tools/market-topbar-glass-test.mjs
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

function cssOf(clientPath, patch) {
  reset();
  loadPlugin({ quiet: true, clientPath, settings: Object.assign({ enabled: true }, patch || {}) });
  return String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss(patch || {}) : '')) || '';
}
const strip = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '');
const rulesOf = (css) => [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].replace(/\s+/g, ' ').trim(), body: m[2] }));
const l2Rules = (rs) => rs.filter((r) => r.sel.indexOf('[data-mpw-solid-surface="l2"]') >= 0);
/** 从 `var(--tok, #f8f9faf0)` 里取回退 hex 的 alpha 字节（8 位 hex 才有；返回 0..1，取不到 = null） */
const alphaOf = (body, tok) => {
  const m = new RegExp('var\\(' + tok + ',\\s*#([0-9a-fA-F]{8})').exec(body);
  if (!m) return null;
  return parseInt(m[1].slice(6, 8), 16) / 255;
};
const blurOf = (body, tok) => {
  // 值里有嵌套括号（blur(40px) saturate(150%)）⇒ 用 "!important" 收尾做惰性捕获
  const m = new RegExp('backdrop-filter\\s*:\\s*var\\(' + tok + ',\\s*(.+?)\\)\\s*!important').exec(body);
  return m ? m[1].trim() : null;
};

console.log('== G. 市场顶栏半透明磨砂（两态对照）==');
{
  const cssOn = cssOf(path.join(ROOT, 'lib', 'client.js'), { image: 'data:image/png;base64,AAA' });
  const cssOff = cssOf(path.join(ROOT, 'lib', 'client.js'), { image: '', webUrl: '' });
  const on = l2Rules(rulesOf(cssOn));
  const off = l2Rules(rulesOf(cssOff));
  ok('G-前置 有壁纸/无壁纸两态都有 l2 规则（各 2 条：亮/暗）', on.length === 2 && off.length === 2, 'on=' + on.length + ' off=' + off.length);
  const aLight = alphaOf(on[0] && on[0].body || '', '--dsw-specific-menu');
  ok('G1 有壁纸：底色回退 alpha ≈ 0.94（非纯白 alpha<1、非全透 alpha>0.5）',
    aLight !== null && aLight < 1 && aLight > 0.5, 'alpha=' + aLight);
  const aLightOff = alphaOf(off[0] && off[0].body || '', '--dsw-specific-menu');
  ok('G2 无壁纸：同一条规则同值（两态观感一致）', aLightOff !== null && aLightOff < 1 && aLightOff > 0.5, 'alpha=' + aLightOff);
  const bl = blurOf(on[0] && on[0].body || '', '--dsw-menu-backdrop-filter');
  ok('G3 模糊 = blur(40px) saturate(150%)（非 none）', !!bl && bl.indexOf('blur(40px)') >= 0 && bl.indexOf('saturate(150%)') >= 0, 'blur=' + bl);
  const dark = on.find((r) => r.sel.indexOf('data-ds-dark-theme') >= 0);
  const aDark = alphaOf(dark && dark.body || '', '--dsw-specific-menu');
  ok('G4 深色规则在（回退 #303136f0，alpha 同区间）', aDark !== null && aDark < 1 && aDark > 0.5, 'alpha=' + aDark);
  const offAll = rulesOf(cssOff);
  ok('G5 l1（浮窗实底）维持门控：无壁纸不在、有壁纸在（与 l2 玻璃互不干扰）',
    offAll.filter((r) => r.sel.indexOf('[data-mpw-solid-surface="l1"]') >= 0).length === 0
      && rulesOf(cssOn).filter((r) => r.sel.indexOf('[data-mpw-solid-surface="l1"]') >= 0).length === 2, '');
}

/* ---------- 变异自证（隔离副本；锚点必须恰好替换一次 —— R2） ---------- */
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');
const TMP_DIRS = [];
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP_DIRS.push(d); return d; };
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

async function withMutant(id, what, pairs, expectRed, runGroup) {
  const dir = mkTmp('mpw-market-mut-');
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
  const on = l2Rules(rulesOf(cssOf(f, { image: 'data:image/png;base64,AAA' })));
  const off = l2Rules(rulesOf(cssOf(f, { image: '', webUrl: '' })));
  const a1 = alphaOf(on[0] && on[0].body || '', '--dsw-specific-menu');
  const a2 = alphaOf(off[0] && off[0].body || '', '--dsw-specific-menu');
  if (!(a1 !== null && a1 < 1 && a1 > 0.5)) red.push('G1');
  if (!(a2 !== null && a2 < 1 && a2 > 0.5)) red.push('G2');
  const bl = blurOf(on[0] && on[0].body || '', '--dsw-menu-backdrop-filter');
  if (!(!!bl && bl.indexOf('blur(40px)') >= 0)) red.push('G3');
  return red;
};

console.log('\n== M. 变异自证（期望红集 == 实际红集，逐条相等）==');
await withMutant('M-solid', '回退值改纯白（#f8f9faff，alpha=1）',
  [['background-color: var(--dsw-specific-menu, #f8f9faf0) !important;', 'background-color: var(--dsw-specific-menu, #f8f9faff) !important; /* M-solid */']], ['G1', 'G2'],
  checkReds);
await withMutant('M-trans', '回退值改全透（#f8f9fa00，alpha=0）',
  [['background-color: var(--dsw-specific-menu, #f8f9faf0) !important;', 'background-color: var(--dsw-specific-menu, #f8f9fa00) !important; /* M-trans */']], ['G1', 'G2'],
  checkReds);
await withMutant('M-blur', '模糊改 none（只剩半透明；改亮色档那条）',
  [['background-color: var(--dsw-specific-menu, #f8f9faf0) !important;\n\t-webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%)) !important;\n\tbackdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%)) !important;',
    'background-color: var(--dsw-specific-menu, #f8f9faf0) !important;\n\t-webkit-backdrop-filter: none !important;\n\tbackdrop-filter: none !important; /* M-blur */']], ['G3'],
  checkReds);

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

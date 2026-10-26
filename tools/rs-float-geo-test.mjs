// tools/rs-float-geo-test.mjs —— 右栏悬浮几何四组契约（{有壁纸,无壁纸} × {展开,收起}；2026-10-26 BUG 修复版）
//
// BUG（真机 A/B 定性）：2f0c9c9 把悬浮几何无条件带进无壁纸态，而收纳态兜底
// （body[data-mpw-rightbar-parked] ⇒ 底/边/影/玻璃全清 + opacity:0）只在 hasImage 主线 ⇒
// 无壁纸 + 右栏收起时，宿主留在 DOM 的停靠件被几何画成带边框/圆角/阴影的悬浮卡片（幽灵区）；
// 有壁纸收起有兜底 ⇒ 正常。
// 修复：__rsFloatGeoCss 全部选择器加 :not([data-mpw-rightbar-parked])（展开态专用）——
//   收纳态由 JS 广播（mpwRightbarParked：宿主 [data-rightbar-collapsed] 或右栏 aria-hidden；
//   展开即摘；两种壁纸态都跑），门控后收起态一条几何都不命中，停靠件回归宿主原生形态。
//
// 契约（lib/client.js 常量 __rsFloatGeoCss，两条 return 路径都输出）：
//   G1 展开态（两壁纸态）：9 组关键几何/基准规则在场且命中（无壁纸组 N- 前缀）——LAYER2-C 目标
//   G2 收起态（两壁纸态）：同一批规则命中 0 条（本 BUG 的反向断言）
//   G3 有壁纸收起：主线 parked 兜底规则在场且命中（清底/影 + opacity:0）——壁纸态收起行为保障
//   G4 无壁纸（展开命中规则内）：无外观声明（border-color/backdrop-filter/background-color
//      声明、parked/unify/rsblur/fullscreen 引用）——不壁纸化
//   G5 两壁纸态展开排序：大纲 880 > 右栏 12
// 匹配口径（诚实简化）：状态判定只作用于 body 级条件（float/parked/dark/dragging/traject-clip）；
//   元素级条件（[data-sidebar-right-panel] / [data-dockkit-*] / 轨迹页类）按"目标元素在展开与
//   收起态都驻留 DOM"处理——收起态宿主保留停靠件正是幽灵区的前提。
// 变异自证（隔离副本；期望红集 == 实际红集）：
//   M-ungate     常量内去掉全部 :not([data-mpw-rightbar-parked]) ⇒ 四组收起 G2 全红
//   M-rehasimage 早退路径去掉 __rsFloatGeoCss 输出 ⇒ 无壁纸展开 G1 红
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

// 状态：body 级标记（float=悬浮开；parked=右栏收纳态广播）
const EXPANDED = { float: true, parked: false, dragging: true }; // G1 判定含拖拽还原规则
const EXPANDED_NODRAG = { float: true, parked: false, dragging: false };
const COLLAPSED = { float: true, parked: true, dragging: false };

/** 剥除门控段后再做子串匹配（锚与门控正交）。 */
const bare = (sel) => String(sel).replaceAll(':not([data-mpw-rightbar-parked])', '');

/** 段级状态判定：body 状态条件不满足 ⇒ 不命中；元素级条件视为存在（收起态停靠件驻留 DOM）。 */
function segStateHit(seg, state) {
  if (seg.includes('body[data-mpw-float]') && !state.float) return false;
  if (seg.includes(':not([data-mpw-rightbar-parked])') && state.parked) return false;
  if (/(^|[ ,])body\[data-mpw-rightbar-parked\]/.test(seg) && !state.parked) return false;
  if (seg.includes('[data-ds-dark-theme]') && state.dark === false) return false;
  if (seg.includes(':not([data-mpw-traject-clip="off"])') && state.trajectOff) return false;
  if (seg.includes('[data-dsh-sidebar-dragging]') && !state.dragging) return false;
  return true;
}
const ruleStateHit = (r, state) => r.sel.split(',').some((seg) => segStateHit(seg.trim(), state));

// 关键规则锚（选择器特征 → 必须出现的声明片段）；修复后它们全部带 :not(parked)
const GEO_KEYS = [
  ['z 基准 右栏 12', (sel) => sel.includes('[data-sidebar-right-panel], html body:not([data-mpw-rightbar-parked]) [data-dockkit-pane]') || (sel.includes('[data-sidebar-right-panel]') && sel.includes('[data-dockkit-pane]') && sel.includes('[data-dockkit-strip]')), 'z-index: 12'],
  ['z 基准 左栏 1', (sel) => sel === 'html body [class*="sidebarCol"]:not([data-sidebar-right-panel])', 'z-index: 1'],
  ['z 基准 side-lift 2500', (sel) => sel.includes('[data-mpw-side-lift]'), 'z-index: 2500'],
  ['push 外层浮起', (sel) => sel.includes('[data-mpw-float] [data-sidebar-right-panel="push"]') && !sel.includes('[data-sidebar-right-panel="push"] ['), 'top: 10px'],
  ['dockkit 浮起', (sel) => sel.startsWith('html body[data-mpw-float] [data-dockkit-pane]'), 'margin: 10px'],
  ['内层还原', (sel) => sel.includes('[data-mpw-float] [data-sidebar-right-panel] [data-sidebar-right-panel]'), 'top: 0'],
  ['拖拽还原', (sel) => sel.includes('[data-dsh-sidebar-dragging][data-mpw-float]'), 'margin: 0'],
  ['tab 条几何', (sel) => sel.includes('[data-mpw-float] [data-sidebar-right-panel] [data-dockkit-strip]') && !sel.includes('> *'), 'margin-left: 10px'],
  ['轨迹裁剪', (sel) => sel.includes('traject-clip') && sel.includes('qBU-ya'), 'max-width: 100%'],
];

/** 无壁纸防壁纸化：展开命中的规则里禁止外观声明。 */
function appearanceViolations(rs) {
  const hits = [];
  for (const r of rs) {
    if (!ruleStateHit(r, EXPANDED)) continue;
    if (!/(data-mpw-float|sidebar-right|dockkit)/.test(r.sel)) continue;
    const body = norm(r.body);
    if (/(^|[;{]\s*)border-color/.test(body) || /background-color|backdrop-filter|data-mpw-rightbar-parked\]$|data-mpw-unify|data-mpw-rsblur|rightbar-fullscreen/.test(body))
      hits.push(r.sel.slice(0, 80) + ' { ' + body.slice(0, 60) + ' }');
  }
  return hits;
}

/** 契约红集。wp：true=有壁纸。 */
function contractReds(clientPath, wp) {
  const red = [];
  const rs = rulesOf(cssOf(clientPath, wp ? WITH_IMG : NO_IMG));
  const tag = wp ? '' : 'N-';
  for (const [, pred, decl] of GEO_KEYS) {
    const r = findRule(rs, (sel) => pred(bare(sel)) && norm(rs.find((x) => x.sel === sel).body).includes(decl));
    if (!r) red.push(tag + 'G1');                                          // 规则不在场
    else {
      if (!ruleStateHit(r, EXPANDED)) red.push(tag + 'G1');                // 展开态不命中
      if (ruleStateHit(r, COLLAPSED)) red.push(tag + 'G2');                // 收起态命中 ⇒ 幽灵
    }
  }
  if (wp) {
    const parkedHide = rs.find((r) => r.sel.includes('body[data-mpw-rightbar-parked] [data-sidebar-right-panel]') && r.sel.includes('[data-dockkit-strip]') && !r.sel.includes(':not(') && /opacity:\s*0/.test(norm(r.body)));
    if (!(parkedHide && ruleStateHit(parkedHide, COLLAPSED) && norm(parkedHide.body).includes('opacity: 0'))) red.push('G3');
  } else {
    const viol = appearanceViolations(rs);
    if (viol.length > 0) red.push('G4');
  }
  const pzOf = (rrs) => { const r = rrs.find((x) => x.sel === 'html body .dsh-conv-panel'); const m = /z-index:\s*(\d+)/.exec(r ? r.body : ''); return m ? Number(m[1]) : NaN; };
  const rzOf = (rrs) => { const r = rrs.find((x) => x.sel.includes('[data-sidebar-right-panel]') && x.sel.includes('[data-dockkit-strip]') && !x.sel.includes('body[data-mpw-rightbar-parked]') && !x.sel.includes('sblur') && /z-index:\s*\d/.test(norm(x.body))); const m = /z-index:\s*(\d+)/.exec(r ? r.body : ''); return m ? Number(m[1]) : NaN; };
  if (!(pzOf(rs) > rzOf(rs))) red.push(tag + 'G5');
  return [...new Set(red)];
}

console.log('== G. 右栏悬浮几何四组契约 ==');
const CLIENT = path.join(ROOT, 'lib', 'client.js');
{
  const wRs = rulesOf(cssOf(CLIENT, WITH_IMG));
  const nRs = rulesOf(cssOf(CLIENT, NO_IMG));
  for (const [name, pred, decl] of GEO_KEYS) {
    for (const [wpLabel, rs2] of [['有壁纸', wRs], ['无壁纸', nRs]]) {
      const rule = findRule(rs2, (sel) => pred(bare(sel)) && norm(rs2.find((x) => x.sel === sel).body).includes(decl));
      const gated = !!rule && rule.sel.includes(':not([data-mpw-rightbar-parked])');
      ok(`G1[${wpLabel}·展开] ${name}`, !!(rule && ruleStateHit(rule, name === '拖拽还原' ? EXPANDED : EXPANDED) && norm(rule.body).includes(decl)), rule ? (gated ? 'gated ✓' : 'ungated!') : 'missing');
      const hitC = !!(rule && ruleStateHit(rule, COLLAPSED));
      ok(`G2[${wpLabel}·收起] ${name} 零命中`, !hitC, hitC ? 'HIT(幽灵)' : '0');
    }
  }
  const parkedHide = wRs.find((r) => r.sel.includes('body[data-mpw-rightbar-parked] [data-sidebar-right-panel]') && r.sel.includes('[data-dockkit-strip]') && !r.sel.includes(':not(') && /opacity:\s*0/.test(norm(r.body)));
  ok('G3[有壁纸·收起] parked 兜底（清底/影 + opacity:0）在场且命中', !!(parkedHide && ruleStateHit(parkedHide, COLLAPSED) && norm(parkedHide.body).includes('opacity: 0')), parkedHide ? 'ok' : 'missing');
  ok('G4[无壁纸] 展开命中规则无外观声明（不壁纸化）', appearanceViolations(nRs).length === 0, appearanceViolations(nRs)[0] ?? 'clean');
  const pz = (rs) => Number(/z-index:\s*(\d+)/.exec(findRule(rs, (s) => s === 'html body .dsh-conv-panel').body)[1]);
  const rz = (rs) => Number(/z-index:\s*(\d+)/.exec(findRule(rs, (s2) => { const b = s2.includes('[data-sidebar-right-panel]') && s2.includes('[data-dockkit-strip]') && !s2.includes('body[data-mpw-rightbar-parked]') && !s2.includes('sblur'); return b && /z-index:\s*\d/.test(rs.find((x) => x.sel === s2).body); }).body)[1]);
  ok(`G5[有壁纸·展开] 大纲(${pz(wRs)}) > 右栏(${rz(wRs)})`, pz(wRs) > rz(wRs), '');
  ok(`G5[无壁纸·展开] 大纲(${pz(nRs)}) > 右栏(${rz(nRs)})`, pz(nRs) > rz(nRs), '');
}

/* ---------- 变异自证（隔离副本） ---------- */
const src0 = fs.readFileSync(CLIENT, 'utf8');
const TMP_DIRS = [];
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP_DIRS.push(d); return d; };
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

async function withMutant(id, what, pairs, expectRed, opts = {}) {
  const dir = mkTmp('mpw-geo2-mut-');
  const f = path.join(dir, 'client.js');
  let mutated = src0;
  const applied = [];
  for (const [anchor, replacement] of pairs) {
    const n = mutated.split(anchor).length - 1;
    const next = opts.replaceAll ? mutated.split(anchor).join(replacement) : mutated.replace(anchor, replacement);
    applied.push(n >= 1 && next !== mutated && (opts.replaceAll ? !next.includes(anchor) : (!next.includes(anchor) || next.includes(replacement))));
    mutated = next;
  }
  fs.writeFileSync(f, mutated);
  reset();
  let red;
  try { red = [...contractReds(f, true), ...contractReds(f, false)]; } catch (e) { red = ['THROW:' + String(e && e.message || e).slice(0, 60)]; }
  const eq = applied.every(Boolean) && JSON.stringify(red.slice().sort()) === JSON.stringify(expectRed.slice().sort());
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-MISMATCH') + ' ' + id + ' ' + what);
  console.log('    期望红集=' + JSON.stringify(expectRed.slice().sort()) + ' 实际红集=' + JSON.stringify(red.slice().sort())
    + ' 变异生效=' + JSON.stringify(applied));
  if (!eq) fail++; else pass++;
}

console.log('\n== M. 变异自证（期望红集 == 实际红集）==');
await withMutant('M-ungate', '常量内去掉全部 :not([data-mpw-rightbar-parked])（回到 2f0c9c9 回归形态）',
  [[':not([data-mpw-rightbar-parked])', '']], 
  ['G2', 'N-G2'], { replaceAll: true });
await withMutant('M-rehasimage', '无壁纸早退路径去掉 __rsFloatGeoCss 输出（LAYER2-C 回退）',
  [['css += __rsFloatGeoCss;\n\t\t\treturn emitSurfaceTokens(css + buildUiCss(section, false)) + __npCss;',
    '/* M-rehasimage */\n\t\t\treturn emitSurfaceTokens(css + buildUiCss(section, false)) + __npCss;']],
  ['N-G1', 'N-G5']);

const red = [...contractReds(CLIENT, true), ...contractReds(CLIENT, false)];
if (red.length) { console.log('\n!! 真树红集非空：' + JSON.stringify(red)); fail += red.length; }
console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

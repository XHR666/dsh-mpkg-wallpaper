// tools/pop-ctl-guard-test.mjs —— 弹层表面规则不得命中「inline 触发器包装」的回归门禁
//（2026-10-24 任务三：侧栏终端"选择 Shell"按钮背景与相邻按钮不一致）
//
// 现象与归属（证据链，详见交付报告）：
//   · 该按钮 = 宿主侧栏终端的壳选择触发器：`<span class="_root_4ub78_1 zjup-W_menu">
//     <button class="_button_1rv3m_2 _ghost_1rv3m_45 _md_1rv3m_23 zjup-W_trigger"
//     aria-label="选择 Shell" aria-haspopup="menu">`。
//     类名哈希的出处（file:line 级证据）：
//     - `zjup-W_*`：@deepseek-ai/dsh-client-ui-sidebar-terminal/lib/client.js
//       （`.zjup-W_trigger{border-radius:4px;…padding:0}` —— 无背景）；
//     - `_button_1rv3m_2`/`_ghost_1rv3m_45`：@deepseek-ai/dsh-web-frontend/dist/assets/index-BPHePDI_.css
//       （`_button_…{…background:transparent}`；ghost 只有 :hover/:active 才有底）。
//     ⇒ **宿主设计上该按钮静默态就是无底**（与相邻按钮一致）。
//   · 差异来源 = 本插件：弹层表面选择器 `[class*="_menu"]`（POP_NOT 未排除它）**子串命中**
//     了触发器包装 span 的 `zjup-W_menu` 类 ⇒ 我们的弹层模糊/底色规则刷在了 20px 控件壳上
//     ⇒ 与相邻按钮不一致。归属 (c)：属本插件，必须修。
//   修法（沿用仓库既有"结构标记 + CSS 只认标记"手法，不用 :has() —— 源码 §E 已有 Firefox 结论）：
//     mpwTagOnePopover 先判 mpwPopInlineCtl（inline(-flex) + ≤48×40px + 内含 aria-haspopup 触发钮）
//     ⇒ 打 data-mpw-pop-ctl；POP_NOT 增加 :not([data-mpw-pop-ctl]) ⇒ 表面规则让位。
// 本文件断言（每条都能被"改回坏写法"变红，见文末 M7/M8 变异自证）：
//   C1 标记：触发器包装被打 data-mpw-pop-ctl；真弹层表面照旧打 data-mpw-pop-bg（回归面）；
//      触发按钮本体（_trigger 类）不被标记；结构变化后旧标记自动撤销。
//   C2 产物：buildCss 产物的弹层表面选择器带 :not([data-mpw-pop-ctl]) 排除。
//   C3 语义（独立裁判 R4）：从源码 POP_NOT 重组选择器，用独立迷你求值器判定——
//      带标记的包装不命中、去标记的同一元素命中（证明 C2 的排除正是防回归的那道闸）。
//   M7  从 POP_NOT 删掉 :not([data-mpw-pop-ctl]) ⇒ C3(带标记不命中) 必红
//   M8  mpwPopInlineCtl 恒 false ⇒ C1(标记缺失) 必红
// 复现: node tools/pop-ctl-guard-test.mjs
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

const { loadPlugin, cancelWorldTimers } = await import('./_stub.mjs');
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwBsVerAt', '__mpwGlobalWired',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState', '__mpwBsScanKick'];
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k]; } catch {} } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 夹具：宿主侧栏终端"选择 Shell"的触发器包装/按钮/真弹层表面（结构与真机 HTML 同形）。 */
function makeWrapEl(opts2 = {}) {
  const attrs = new Map(Object.entries(opts2.attrs || {}));
  const el = {
    nodeType: 1,
    className: opts2.cls || '_root_4ub78_1 zjup-W_menu',
    role: opts2.role || null,
    __attrs: attrs,
    getAttribute(k) { return attrs.has(String(k)) ? attrs.get(String(k)) : null; },
    hasAttribute(k) { return attrs.has(String(k)); },
    setAttribute(k, v) { attrs.set(String(k), String(v)); },
    removeAttribute(k) { attrs.delete(String(k)); },
    querySelector(sel) {
      const s = String(sel);
      if (opts2.noTriggerChild) return null;
      if (/button\[aria-haspopup\]/.test(s) || /role='combobox'/.test(s)) return { fake: 'trigger-btn' };
      return null;
    },
    getBoundingClientRect() { return opts2.rect || { width: 20, height: 20, top: 0, left: 0, right: 20, bottom: 20 }; },
  };
  return el;
}
/** 让 getComputedStyle 按元素给值（桩默认恒 block/无 blur —— 这里按夹具可控）。 */
function withComputed(map, fn) {
  const orig = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (el) => {
    const v = map.get(el) || map.get('*') || {};
    return Object.assign({ getPropertyValue: () => '', position: 'static', display: 'block', visibility: 'visible', opacity: '1', zIndex: 'auto', backdropFilter: 'none', overflow: 'visible', contain: 'none', isolation: 'auto', willChange: 'auto', color: '', fontSize: '', height: '', overflowY: '', backgroundColor: 'rgba(0,0,0,0)' }, v);
  };
  return Promise.resolve().then(fn).finally(() => { globalThis.getComputedStyle = orig; });
}

console.log('\n== C1. 标记：触发器包装打 data-mpw-pop-ctl；真表面/按钮不受影响 ==');
{
  reset();
  loadPlugin({ quiet: true, settings: { enabled: true, image: 'stub.png' } });
  const tag = globalThis.__mpwPopUntruncTest && globalThis.__mpwPopUntruncTest.tag;
  ok('C0 测试出口在（__mpwPopUntruncTest.tag）', typeof tag === 'function');
  if (typeof tag === 'function') {
    const wrap = makeWrapEl();
    const surface = makeWrapEl({ cls: 'QsffPG_menu', role: 'menu', attrs: { role: 'menu' }, rect: { width: 320, height: 200, top: 0, left: 0, right: 320, bottom: 200 } });
    const btn = makeWrapEl({ cls: '_button_1rv3m_2 _ghost_1rv3m_45 _md_1rv3m_23 zjup-W_trigger', noTriggerChild: true });
    const map = new Map([
      [wrap, { display: 'inline-flex', backdropFilter: 'none' }],
      [surface, { display: 'block', backdropFilter: 'blur(11px)' }],
      [btn, { display: 'inline-flex', backdropFilter: 'none' }],
    ]);
    await withComputed(map, async () => {
      tag(wrap); tag(surface); tag(btn);
      ok('C1a 触发器包装被打 data-mpw-pop-ctl（20px inline 壳 + 内含 aria-haspopup 钮）',
        wrap.getAttribute('data-mpw-pop-ctl') === '1',
        'ctl=' + wrap.getAttribute('data-mpw-pop-ctl'));
      ok('C1b 触发器包装不被打弹层底标记（表面对判定已让位）',
        wrap.getAttribute('data-mpw-pop-bg') === null, 'bg=' + wrap.getAttribute('data-mpw-pop-bg'));
      ok('C1c 真弹层表面照旧走原判定（回归面：无 ctl 标记；blur 表面仍打 bg=empty）',
        surface.getAttribute('data-mpw-pop-ctl') === null && surface.getAttribute('data-mpw-pop-bg') === 'empty',
        'ctl=' + surface.getAttribute('data-mpw-pop-ctl') + ' bg=' + surface.getAttribute('data-mpw-pop-bg'));
      ok('C1d 触发按钮本体（_trigger 类）不被标记（MPW_POP_TAG_NOT 原样排除）',
        btn.getAttribute('data-mpw-pop-ctl') === null && btn.getAttribute('data-mpw-pop-bg') === null,
        'ctl=' + btn.getAttribute('data-mpw-pop-ctl'));
      // 结构变化 ⇒ 旧标记自动撤销（幂等收敛，不留死标记）
      const map2 = new Map([[wrap, { display: 'block', backdropFilter: 'blur(11px)' }]]);
      await withComputed(map2, async () => {
        // 大尺寸 + block ⇒ 不再是控件壳；带 blur ⇒ 走表面判定（与 C1c 同形）
        const big = makeWrapEl({ rect: { width: 320, height: 200, top: 0, left: 0, right: 320, bottom: 200 }, attrs: {} });
        big.setAttribute('data-mpw-pop-ctl', '1');   // 预置旧标记
        const map3 = new Map([[big, { display: 'block', backdropFilter: 'blur(11px)' }]]);
        tag(big);
        ok('C1e 结构不再像控件壳 ⇒ 旧 data-mpw-pop-ctl 自动撤销',
          big.getAttribute('data-mpw-pop-ctl') === null, 'ctl=' + big.getAttribute('data-mpw-pop-ctl'));
      });
    });
  }
}

console.log('\n== C2/C3. CSS 产物带排除 + 独立求值器复核选择器语义 ==');
{
  reset();
  loadPlugin({ quiet: true, settings: { enabled: true, image: 'stub.png' } });
  const css = globalThis.__mpwBuildCss ? String(globalThis.__mpwBuildCss({ enabled: true, image: 'stub.png' })) : '';
  ok('C2 buildCss 产物含 :not([data-mpw-pop-ctl]) 排除（弹层表面规则让位）',
    css.length > 0 && css.indexOf(':not([data-mpw-pop-ctl])') >= 0,
    'cssLen=' + css.length + ' has=' + (css.indexOf(':not([data-mpw-pop-ctl])') >= 0));
  ok('C2b 产物里 [class*="_menu"] 表面选择器与排除同现（同一选择器串）',
    /_menu"\](?::not\([^)]*\))+/.test(css) && /_menu"\](?::not\([^)]*\))*:not\(\[data-mpw-pop-ctl\]\)/.test(css),
    'chain=' + /_menu"\](?::not\([^)]*\))*:not\(\[data-mpw-pop-ctl\]\)/.test(css));

  // 独立裁判：从**源码**读 POP_NOT，重组 `[class*="_menu"]` 那条备选，用迷你求值器判定。
  const src0 = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  const m = /const POP_NOT = `([^`]+)`;/.exec(src0);
  ok('C3a 源码 POP_NOT 可解析（独立求值器的输入真实存在）', !!m);
  if (m) {
    const chain = m[1];   // 如 :not([role="menuitem"]):not([class*="Anchor"])…
    const alt = '[class*="_menu"]' + chain;
    // 迷你求值器：解析 [attr="v"] / [class*="s"] / [data-x] 谓词 + :not(...) 链。
    const evalSel = (sel, el) => {
      const parts = sel.split(/(?=:not\()/);
      const base = parts[0];
      const baseMatch = (() => {
        const cm = /\[class\*="([^"]+)"\]/.exec(base);
        if (cm) return String(el.className || '').indexOf(cm[1]) >= 0;
        const am = /\[([a-zA-Z-]+)="([^"]+)"\]/.exec(base);
        if (am) return el.getAttribute(am[1]) === am[2];
        return false;
      })();
      if (!baseMatch) return false;
      for (const p of parts.slice(1)) {
        const inner = /^:not\((.+)\)$/.exec(p);
        if (!inner) return false;
        const pred = inner[1];
        const cm = /\[class\*="([^"]+)"\]/.exec(pred);
        const hit = cm ? String(el.className || '').indexOf(cm[1]) >= 0
          : (() => { const am = /\[([a-zA-Z-]+)(?:="([^"]+)")?\]/.exec(pred); return am ? (am[2] === undefined ? el.hasAttribute(am[1]) : el.getAttribute(am[1]) === am[2]) : false; })();
        if (hit) return false;   // 任一 not 命中 ⇒ 整条不匹配
      }
      return true;
    };
    const withMark = makeWrapEl({ attrs: { 'data-mpw-pop-ctl': '1' } });
    const withoutMark = makeWrapEl({});
    ok('C3b 带标记的触发器包装不被弹层表面选择器命中（排除生效）',
      evalSel(alt, withMark) === false, 'match=' + evalSel(alt, withMark));
    ok('C3c 同一元素去掉标记 ⇒ 被命中（证明 C3b 是排除在起作用 ⇒ 判据能失败）',
      evalSel(alt, withoutMark) === true, 'match=' + evalSel(alt, withoutMark));
  }
}

/* ---------- 变异自证（隔离副本；锚点必须恰好替换一次且旧串不再存在 —— R2） ---------- */
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');

async function withMutant(id, what, pairs, expectRed, runGroup) {
  const dir = mkTmp('mpw-pop-ctl-mut-');
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

console.log('\n== M. 变异自证（期望红集 == 实际红集，逐条相等）==');

// M7：从 POP_NOT 删掉排除 ⇒ 带标记的包装重新被表面选择器命中 ⇒ C3b 红
await withMutant('M7', 'POP_NOT 删掉 :not([data-mpw-pop-ctl])',
  [[':not([data-mpw-pop-untrunc]):not([data-mpw-pop-ctl])`;', ':not([data-mpw-pop-untrunc])`; /* M7 */']], ['C3b', 'C2', 'C2b'],
  async (f) => {
    const red = [];
    reset();
    loadPlugin({ quiet: true, clientPath: f, settings: { enabled: true, image: 'stub.png' } });
    const css = String(globalThis.__mpwBuildCss({ enabled: true, image: 'stub.png' }));
    if (!(css.length > 0 && css.indexOf(':not([data-mpw-pop-ctl])') >= 0)) red.push('C2');
    if (!/_menu"\](?::not\([^)]*\))*:not\(\[data-mpw-pop-ctl\]\)/.test(css)) red.push('C2b');
    const src1 = fs.readFileSync(f, 'utf8');
    const m = /const POP_NOT = `([^`]+)`;/.exec(src1);
    const chain = m ? m[1] : '';
    const alt = '[class*="_menu"]' + chain;
    const evalSel = (sel, el) => {
      const parts = sel.split(/(?=:not\()/);
      const cm = /\[class\*="([^"]+)"\]/.exec(parts[0]);
      if (!cm || String(el.className || '').indexOf(cm[1]) < 0) return false;
      for (const p of parts.slice(1)) {
        const pred = /^:not\((.+)\)$/.exec(p)[1];
        const c2 = /\[class\*="([^"]+)"\]/.exec(pred);
        const hit = c2 ? String(el.className || '').indexOf(c2[1]) >= 0
          : (() => { const am = /\[([a-zA-Z-]+)(?:="([^"]+)")?\]/.exec(pred); return am ? (am[2] === undefined ? el.hasAttribute(am[1]) : el.getAttribute(am[1]) === am[2]) : false; })();
        if (hit) return false;
      }
      return true;
    };
    const withMark = makeWrapEl({ attrs: { 'data-mpw-pop-ctl': '1' } });
    if (evalSel(alt, withMark) !== false) red.push('C3b');
    return red;
  });

// M8：mpwPopInlineCtl 恒 false ⇒ 包装永远不被标记 ⇒ C1a 红
await withMutant('M8', 'mpwPopInlineCtl 恒 false（标记链路断）',
  [['function mpwPopInlineCtl(el, cs) {\n\t\t\ttry {', 'function mpwPopInlineCtl(el, cs) {\n\t\t\t{ return false; } /* M8 */\n\t\t\ttry {']], ['C1a'],
  async (f) => {
    const red = [];
    reset();
    loadPlugin({ quiet: true, clientPath: f, settings: { enabled: true, image: 'stub.png' } });
    const tag = globalThis.__mpwPopUntruncTest && globalThis.__mpwPopUntruncTest.tag;
    const wrap = makeWrapEl();
    const map = new Map([[wrap, { display: 'inline-flex', backdropFilter: 'none' }]]);
    await withComputed(map, async () => { tag(wrap); });
    if (!(wrap.getAttribute('data-mpw-pop-ctl') === '1')) red.push('C1a');
    return red;
  });

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

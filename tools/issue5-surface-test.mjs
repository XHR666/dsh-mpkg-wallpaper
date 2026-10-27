// tools/issue5-surface-test.mjs —— Issue #5 修复面的回归门禁（2026-10-25）
//
// 覆盖四个症状的修复面（每条都能被"改回坏写法"变红，见文末 M1–M4 变异自证）：
//   A（§2.1/§2.2）「实底保住」标记：宿主 token（--dsw-alias-bg-layer-1/2）被全局半透明化时，
//      用宿主主题自己的原值刷回**打了 data-mpw-solid-surface 标记**的第三方/宿主自绘表面：
//      · 插件市场 stickyHead（l2）  · dsh-conversation 浮窗 dsh-conv-panel（l1）
//      两态对照：有壁纸 ⇒ 规则在 + 标记在；无壁纸 ⇒ 规则不输出（宿主原生表现）。
//   B（§2.3）右栏 guide 条目 hover：静默底被半透明化后，宿主 hover token（#2631480f ≈ 6% 暗纱）
//      会把白底整个换掉 ⇒ 修后 hover 底由 --mpw-guide-hover-light/dark 提供（静默底同族白），
//      规则只打宿主稳定属性 [data-sidebar-right-guide-entry] 的 :hover；无壁纸时变量与规则都不在。
//   C（§2.4②）dsh-session-delete 回收站列表（role=listbox 的页内普通清单）不再被当成弹层表面：
//      z-index:3000 / 弹层模糊 / 弹层底色三条规则全部带 :not([data-dsh-session-delete])；
//      JS 标记跳过该插件自管子树（对照：普通 listbox 会被标记 ⇒ 判据有分辨力）。
//   D（根因留证）applyTokenOverrides 的两态对照：有壁纸 ⇒ 覆写 layer-1/2 为半透明；无壁纸 ⇒ 不覆写。
// 变异自证（期望红集 == 实际红集，逐条相等）：
//   M-solid    实底标记同步失效（stickyHead 选择器锚空）⇒ A1 必红
//   M-hover    guide hover 变量写入断链 ⇒ B3 必红
//   M-listbox  弹层表面规则的 :not([data-dsh-session-delete]) 被去掉 ⇒ C1 必红
//   M-skip     JS 标记的 closest 排除被去掉 ⇒ C2b 必红
// 证据出处（宿主/第三方产物，file:line 见交付报告）：
//   · dshmarket client.js: .nUhMVa_stickyHead{background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
//   · dsh-conversation client.js: .dsh-conv-panel{background:var(--dsw-alias-bg-layer-1,#fff)}
//   · dsh-client-ui-sidebar-right/lib/client.js: .geFEbW_entry:hover{background:var(--dsw-alias-interactive-bg-hover)}
//     （宿主 hover token 亮值 #2631480f，见 dsh-client-ui-theme lib/client.js）
//   · @xrn1997/dsh-session-delete lib/client.js: 回收站列表 div[data-dsh-session-delete="trash-list"][role="listbox"]
// 复现: node tools/issue5-surface-test.mjs
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
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState', '__mpwBsScanKick', '__mpwBsScanMore'];
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k]; } catch {} } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WALL_SETTINGS = { enabled: true, image: 'data:image/png;base64,AAA', converted: 'mp4', dialogBlur: true, opacity: 70 };

/** ctx 装饰：fake theme 服务（记录 overrideTokens 调用）+ 预置宿主/第三方 DOM 样本。
 *  ctxDecorate 在 plugin.apply **之前**跑 ⇒ 预置元素能被 apply 里的首轮扫描看见。 */
function makeDecor(opts2 = {}) {
  const rec = { tokenCalls: [] };
  const seeds = {};
  const decorate = (ctx) => {
    ctx.theme = {
      overrideTokens(source, tokens) { rec.tokenCalls.push({ source, tokens }); return () => { rec.disposed = true; }; },
    };
    try {
      const mk = (tag, cls, attrs) => {
        const el = document.createElement(tag || 'div');
        if (cls) el.className = cls;
        for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
        document.body.appendChild(el);
        return el;
      };
      seeds.stickyHead = mk('div', 'nUhMVa_stickyHead');
      seeds.convPanel = mk('div', 'dsh-conv-panel', { role: 'complementary' });
      seeds.listboxPlain = mk('div', '', { role: 'listbox' });
      seeds.listboxTrash = mk('div', '', { role: 'listbox', 'data-dsh-session-delete': 'trash-list' });
      seeds.trashHost = mk('div', '', { 'data-dsh-session-delete': 'root' });
      seeds.trashHost.appendChild(seeds.listboxTrash);
      // 桩 document 的 querySelectorAll 恒返回 [] ⇒ 文档级扫描在桩里看不见预置元素。
      // 这里把两个类名子串选择器接到预置元素上（其余选择器照旧返回 []，与原桩语义一致）。
      const origQSA = document.querySelectorAll.bind(document);
      document.querySelectorAll = (sel) => {
        const s = String(sel);
        if (s.indexOf('stickyHead') >= 0) return [seeds.stickyHead];
        if (s.indexOf('dsh-conv-panel') >= 0) return [seeds.convPanel];
        return origQSA(sel);
      };
      if (opts2.blurAll) {
        // 让"带 blur 才标记"的判定走到标记分支：普通 listbox 与回收站 listbox 都报告 blur
        const orig = globalThis.getComputedStyle;
        globalThis.getComputedStyle = (el) => {
          const base = orig(el);
          return Object.assign({}, base, {
            backdropFilter: 'blur(10px)',
            backgroundColor: 'rgba(0, 0, 0, 0)',
          });
        };
      }
    } catch (e) {}
  };
  return { decorate, rec, seeds };
}

console.log('\n== A. 实底保住标记（§2.1 stickyHead / §2.2 dsh-conv-panel）==');
{
  reset();
  const dec = makeDecor();
  const r = loadPlugin({ quiet: true, settings: WALL_SETTINGS, ctxDecorate: dec.decorate });
  // 桩 document 的 querySelectorAll 恒空 ⇒ 全文档扫描测不到，经 __mpwPopUntruncTest.solidSync
  // 直接驱动同一实现（与 __mpwPopUntruncTest.tag 同款出口，pop-ctl-guard-test 先例）。
  const solidSync = globalThis.__mpwPopUntruncTest && globalThis.__mpwPopUntruncTest.solidSync;
  ok('A0 测试出口在（__mpwPopUntruncTest.solidSync）', typeof solidSync === 'function');
  solidSync();
  ok('A1 插件市场 stickyHead 被打 data-mpw-solid-surface="l2"',
    dec.seeds.stickyHead.getAttribute('data-mpw-solid-surface') === 'l2',
    'mark=' + dec.seeds.stickyHead.getAttribute('data-mpw-solid-surface'));
  ok('A2 dsh-conv-panel 浮窗被打 data-mpw-solid-surface="l1"',
    dec.seeds.convPanel.getAttribute('data-mpw-solid-surface') === 'l1',
    'mark=' + dec.seeds.convPanel.getAttribute('data-mpw-solid-surface'));

  const cssOn = globalThis.__mpwBuildCss({ image: 'data:image/png;base64,AAA', enabled: true });
  const cssOff = globalThis.__mpwBuildCss({ image: '', webUrl: '', enabled: true });
  /* ①(2026-10-25 任务 4 改向) l2（插件市场顶栏）由「实底」改为「半透明+模糊」且无条件输出
     （两态观感一致）——A3/A4 相应改写：A3 = l1 实底(00/875) + l2 玻璃(specific-menu+blur)；
     A4 = 无壁纸时 l1 实底规则不输出（门控语义不变）、l2 玻璃规则在（改向：刻意无条件）。
     断言没有删，只是随 l2 的观感档演进改写。 */
  /* ①(2026-10-31 任务 §3.2 改向) l1 实底值收敛到单变量 --mpw-conv-panel-bg（默认=宿主原值，
     供将来「透明度可调」覆盖）⇒ 本断言从"直连 00/875"演进为"消费变量 + 变量定义默认仍是
     00/875"——语义不变（稳态观感零变化），判据演进留痕（详见 tools/conv-panel-firstframe-test.mjs A 组）。 */
  ok('A3 有壁纸：l1 实底规则在（消费 --mpw-conv-panel-bg，默认仍 00/875）+ l2 玻璃规则在（specific-menu + menu-backdrop-filter）',
    /\[data-mpw-solid-surface="l1"\]\s*{[^}]*--mpw-conv-panel-bg:\s*var\(--dsw-static-neutral-bluish-00\)/.test(cssOn)
      && /background-color:\s*var\(--mpw-conv-panel-bg,\s*var\(--dsw-static-neutral-bluish-00\)\)\s*!important/.test(cssOn)
      && cssOn.indexOf('--dsw-static-neutral-bluish-875') >= 0
      && cssOn.indexOf('[data-mpw-solid-surface="l2"]') >= 0
      && cssOn.indexOf('var(--dsw-specific-menu') >= 0 && cssOn.indexOf('var(--dsw-menu-backdrop-filter') >= 0,
    'has=' + (cssOn.indexOf('data-mpw-solid-surface') >= 0));
  ok('A4 无壁纸：l1 实底规则不输出（浮窗维持门控）+ l2 玻璃规则在（任务 4 改向：两态观感一致）',
    cssOff.indexOf('data-mpw-solid-surface="l1"') < 0
      && cssOff.indexOf('[data-mpw-solid-surface="l2"]') >= 0
      && cssOff.indexOf('var(--dsw-specific-menu') >= 0,
    'l1leak=' + (cssOff.indexOf('data-mpw-solid-surface="l1"') >= 0) + ' l2glass=' + (cssOff.indexOf('[data-mpw-solid-surface="l2"]') >= 0));
}

console.log('\n== B. 右栏 guide 条目 hover（§2.3；两态对照）==');
{
  reset();
  const dec = makeDecor();
  const r = loadPlugin({ quiet: true, settings: WALL_SETTINGS, ctxDecorate: dec.decorate });
  const cssOn = globalThis.__mpwBuildCss({ image: 'data:image/png;base64,AAA', enabled: true });
  const cssOff = globalThis.__mpwBuildCss({ image: '', webUrl: '', enabled: true });
  ok('B1 有壁纸：guide :hover 规则在（亮/暗两条，吃 --mpw-guide-hover-* 变量）',
    /\[data-sidebar-right-guide-entry\]:hover\s*{\s*background-color:\s*var\(--mpw-guide-hover-light/.test(cssOn)
      && /data-ds-dark-theme\]\s*\[data-sidebar-right-guide-entry\]:hover\s*{\s*background-color:\s*var\(--mpw-guide-hover-dark/.test(cssOn), '');
  ok('B2 无壁纸：guide :hover 规则不输出（宿主原生 hover ⇒ 两态一致）',
    cssOff.indexOf('data-sidebar-right-guide-entry') < 0, 'leak=' + (cssOff.indexOf('data-sidebar-right-guide-entry') >= 0));
  ok('B3 有壁纸（半透明档）：--mpw-guide-hover-light/dark 已写到文档根（值 = 白 base 的 color-mix）',
    String(document.documentElement.style.getPropertyValue('--mpw-guide-hover-light') || '').indexOf('color-mix') >= 0
      && String(document.documentElement.style.getPropertyValue('--mpw-guide-hover-dark') || '').indexOf('color-mix') >= 0,
    'light=' + String(document.documentElement.style.getPropertyValue('--mpw-guide-hover-light')).slice(0, 60));

  reset();
  const dec2 = makeDecor();
  loadPlugin({ quiet: true, settings: { enabled: true, image: '', webUrl: '' }, ctxDecorate: dec2.decorate });
  ok('B4 无壁纸：--mpw-guide-hover-* 变量不存在（早退分支撤干净）',
    !document.documentElement.style.getPropertyValue('--mpw-guide-hover-light')
      && !document.documentElement.style.getPropertyValue('--mpw-guide-hover-dark'), '');
}

console.log('\n== C. dsh-session-delete 回收站清单不再被当弹层（§2.4②）==');
{
  reset();
  const dec = makeDecor({ blurAll: true });
  const r = loadPlugin({ quiet: true, settings: WALL_SETTINGS, ctxDecorate: dec.decorate });
  const cssOn = globalThis.__mpwBuildCss({ image: 'data:image/png;base64,AAA', enabled: true });
  ok('C1 z-index 3000 规则排除 [data-dsh-session-delete]（回收站清单不再被抬到弹窗之上）',
    /\[role="listbox"\]:not\(\[data-dsh-session-delete\]\)/.test(cssOn), '');
  ok('C1b 弹层表面（模糊/底色）规则组同样排除（POP_NOT 追加项在产物里出现 ≥4 处）',
    (cssOn.match(/:not\(\[data-dsh-session-delete\]\)/g) || []).length >= 4,
    'count=' + (cssOn.match(/:not\(\[data-dsh-session-delete\]\)/g) || []).length);
  // JS 标记经 __mpwPopUntruncTest.tag 单元素驱动（同一实现；桩的全文档扫描不可用）
  const tag = globalThis.__mpwPopUntruncTest && globalThis.__mpwPopUntruncTest.tag;
  ok('C2a 对照组：普通 listbox（无插件标记）会被 JS 打弹层底标记（判据有分辨力）',
    typeof tag === 'function' && (tag(dec.seeds.listboxPlain), dec.seeds.listboxPlain.hasAttribute('data-mpw-pop-bg')),
    'marked=' + dec.seeds.listboxPlain.getAttribute('data-mpw-pop-bg'));
  ok('C2b 回收站 listbox（插件自管子树）必须零标记（data-mpw-pop-bg/pop-ctl 都不打）',
    typeof tag === 'function' && (tag(dec.seeds.listboxTrash), !dec.seeds.listboxTrash.hasAttribute('data-mpw-pop-bg') && !dec.seeds.listboxTrash.hasAttribute('data-mpw-pop-ctl')),
    'pop-bg=' + dec.seeds.listboxTrash.hasAttribute('data-mpw-pop-bg'));
}

console.log('\n== D. 根因留证：applyTokenOverrides 的两态对照（layer-1/2 全局半透明化）==');
{
  reset();
  const dec = makeDecor();
  loadPlugin({ quiet: true, settings: WALL_SETTINGS, ctxDecorate: dec.decorate });
  const call = dec.rec.tokenCalls[dec.rec.tokenCalls.length - 1];
  const toks = call ? call.tokens : null;
  ok('D1 有壁纸：覆写了 --dsw-alias-bg-layer-1/-2（值 = color-mix 半透明 ⇒ 症状机制本身）',
    !!toks && toks['--dsw-alias-bg-layer-1'] && String(toks['--dsw-alias-bg-layer-1'].light).indexOf('color-mix') >= 0
      && !!toks['--dsw-alias-bg-layer-2'],
    'keys=' + (toks ? Object.keys(toks).filter((k) => k.indexOf('layer') >= 0).join(',') : 'null'));

  reset();
  const dec2 = makeDecor();
  loadPlugin({ quiet: true, settings: { enabled: true, image: '', webUrl: '' }, ctxDecorate: dec2.decorate });
  ok('D2 无壁纸：不覆写任何 token（overrides 早退 ⇒ 宿主原生）',
    dec2.rec.tokenCalls.length === 0, 'calls=' + dec2.rec.tokenCalls.length);
}

/* ---------- 变异自证（隔离副本；锚点必须恰好替换一次且旧串不再存在 —— R2） ---------- */
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');

async function withMutant(id, what, pairs, expectRed, runGroup) {
  const dir = mkTmp('mpw-issue5-mut-');
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

async function loadOn(f, opts2 = {}) {
  reset();
  const dec = makeDecor({ blurAll: true });
  const opts = { quiet: true, clientPath: f, settings: WALL_SETTINGS, ctxDecorate: (ctx) => { dec.decorate(ctx); } };
  loadPlugin(opts);
  return dec;
}

console.log('\n== M. 变异自证（期望红集 == 实际红集，逐条相等）==');

// M-solid：实底标记同步对 stickyHead 失效（选择器锚改空）⇒ A1 红（A2 conv-panel 不受影响）
await withMutant('M-solid', '实底标记同步失效（stickyHead 锚改空）',
  [['[\'[class*="stickyHead"]\', "l2"],', '[\'[data-mpw-never-matches]\', "l2"], /* M-solid */']], ['A1'],
  async (f) => {
    const red = [];
    const dec = await loadOn(f);
    if (!(dec.seeds.stickyHead.getAttribute('data-mpw-solid-surface') === 'l2')) red.push('A1');
    return red;
  });

// M-hover：guide hover 变量写入断链 ⇒ B3 红（变量不在）
await withMutant('M-hover', 'guide hover 变量写入断链',
  [['document.documentElement.style.setProperty("--mpw-guide-hover-light", (hv && hv.light) ? String(hv.light) : toAlpha("--dsw-static-neutral-bluish-00", hA));',
    '/* M-hover */']], ['B3'],
  async (f) => {
    const red = [];
    await loadOn(f);
    if (!(String(document.documentElement.style.getPropertyValue('--mpw-guide-hover-light') || '').indexOf('color-mix') >= 0)) red.push('B3');
    return red;
  });

// M-listbox：弹层表面规则的 :not([data-dsh-session-delete]) 被去掉 ⇒ C1/C1b 红
await withMutant('M-listbox', '弹层规则的 :not([data-dsh-session-delete]) 被去掉',
  [[':not([data-mpw-pop-untrunc]):not([data-mpw-pop-ctl]):not([data-dsh-session-delete])`',
    ':not([data-mpw-pop-untrunc]):not([data-mpw-pop-ctl])` /* M-listbox */']], ['C1b'],
  async (f) => {
    const red = [];
    const dec = await loadOn(f);
    const css = globalThis.__mpwBuildCss({ image: 'data:image/png;base64,AAA', enabled: true });
    if (!((css.match(/:not\(\[data-dsh-session-delete\]\)/g) || []).length >= 4)) red.push('C1b');
    return red;
  });

// M-skip：JS 标记的父链排除被去掉 ⇒ C2b 红（回收站 listbox 被打标）
await withMutant('M-skip', 'JS 标记的父链排除被去掉',
  [['\t\t\ttry {\n\t\t\t\tfor (let p = el; p; p = p.parentElement) {\n\t\t\t\t\tif (p.hasAttribute && p.hasAttribute("data-dsh-session-delete")) return ctlChanged;\n\t\t\t\t}\n\t\t\t} catch (e) {}',
    '\t\t\t/* M-skip */']], ['C2b'],
  async (f) => {
    const red = [];
    const dec = await loadOn(f);
    const tag = globalThis.__mpwPopUntruncTest && globalThis.__mpwPopUntruncTest.tag;
    tag(dec.seeds.listboxTrash);
    if (!(!dec.seeds.listboxTrash.hasAttribute('data-mpw-pop-bg') && !dec.seeds.listboxTrash.hasAttribute('data-mpw-pop-ctl'))) red.push('C2b');
    return red;
  });

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

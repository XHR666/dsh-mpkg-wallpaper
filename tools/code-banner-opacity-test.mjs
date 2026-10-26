// tools/code-banner-opacity-test.mjs —— 代码块横幅（sticky banner）不被本插件改外观（2026-10-27 任务 §2）
//
// 现象（真机）：会话「代码块」横向标题条（data-code-block-banner="true"，复用宿主标题栏类名
// `_header_*` + `wSkVaW_header`）开着本插件时变透明（滚动前后都透明、吸附时更明显）。
// 根因（产物级取证）：它被本插件所有 `.wSkVaW_header` / `[class*="_header_"]` 系规则连带命中——
//   磨砂半透明底 / 透明底（headerBg&&!headerBlur 档直接 transparent）/ 按钮组 / ::before 磨砂 /
//   position:relative（连 sticky 都被改）；且 wide 桥（['header, [class*="_header_"]', 'wSkVaW_header']）
//   会给它补类/打 data-mpw-side-mark，findHostHeader() 的 querySelector(".wSkVaW_header")
//   会先选中它 ⇒ 磨砂层注错节点。
// 修复：header 系外观规则全部 `:not(:where([data-code-block-banner]))`；wide 桥/findHostHeader 排除；
//   自愈摘除 banner 上残留的我们的标记。吸附是宿主原生行为，不改其定位（排除后原样交还）。
//
// 契约：
//   K1 四态（{有壁纸,无壁纸} × {未吸附,吸附}）：产物中没有任何 header 系背景/磨砂/定位/按钮
//      规则命中 banner 形态 ⇒ banner 的背景完全由宿主原生控制（原生横幅自带不透明主题底，
//      alpha ≥ 0.9 由原生保证；静态判据无法算 computed alpha，经"我们零命中"达成，真机未验）。
//   K2 反向：真标题栏（header.wSkVaW_header 且非 banner）仍被既有磨砂/底色规则命中（行为不变）。
//   K3 桥与打标：wide 桥选择器排除 banner；findHostHeader 排除；自愈分支含 banner 摘标。
//   K4 吸附不改性：产物中不存在对 [data-code-block-banner] 的 position/sticky 改写。
// 变异自证（隔离副本；期望红集 == 实际红集）：
//   M-ungate   主底色规则去掉 :not(:where([data-code-block-banner])) ⇒ K1 红（重新命中 banner）
//   M-bridge   wide 桥恢复旧选择器（重新给 banner 补类/打标）⇒ K3 红
//   M-findhdr  findHostHeader 去掉排除 ⇒ K3 红
// 复现: node tools/code-banner-opacity-test.mjs
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

// 元素形态：banner（div，复用标题栏类名 + 稳定属性）与真标题栏（header tag，无 banner 属性）
const BANNER = { tag: 'div', classes: ['_header_1pq26_10', 'wSkVaW_header'], attrs: { 'data-code-block-banner': 'true', 'data-mpw-side-mark': '' } };
const REAL_HEADER = { tag: 'header', classes: ['wSkVaW_header'], attrs: {} };

/** 段级命中判定（body 前缀视为满足；tagName 直选按形态判定；class 子串与直选类、属性、:not 排除）。 */
function segHits(seg, el) {
  const mTag = /^(?:html\s+)?(?:body\s+)?([a-z]+)[\.\[:\s>]/.exec(seg) || /^(?:html\s+)?(?:body\s+)?([a-z]+)$/.exec(seg);
  if (mTag && mTag[1] !== el.tag && mTag[1] !== '*') return false;
  const bare = seg.replace(/:not\(:where\([^()]*\)\)/g, '').replace(/:not\([^()]*\)/g, '');
  const pos = [...bare.matchAll(/\[class\*="([^"]+)"\]/g)].map((m) => m[1]);
  for (const x of pos) if (!el.classes.some((c) => c.includes(x))) return false;
  if (/\.wSkVaW_header(?![A-Za-z])/.test(bare) && !el.classes.includes('wSkVaW_header')) return false;
  if (/\.wSkVaW_titleRow|\.wSkVaW_crumbs|\.wSkVaW_crumb(?![A-Za-z])|mpw-hdrFrost/.test(seg)) return false; // 子代/后代结构条件：banner/真 header 均不含这些子节点时按不命中计（与 :has 同口径，见下）
  for (const m of bare.matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]/g)) {
    const name = m[1]; if (name === 'class') continue;
    if (el.attrs[name] === undefined) return false;
    if (m[2] !== undefined && el.attrs[name] !== m[2]) return false;
  }
  // :has(...) 结构条件按"子树里没有我们的节点"处理 ⇒ 带结构性 :has 的段对两种形态都不命中
  if (/:has\(/.test(seg) && /(mpw-hdrFrost|dsh-conv-panel)/.test(seg)) return false;
  for (const m of seg.matchAll(/:not\(:where\(([^()]*)\)\)|:not\(([^()]*)\)/g)) {
    const nt = m[1] !== undefined ? m[1] : m[2];
    for (const x of [...nt.matchAll(/\[class\*="([^"]+)"\]/g)].map((v) => v[1]))
      if (el.classes.some((c) => c.includes(x))) return false;
    for (const x of [...nt.matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]/g)]) {
      const name = x[1]; if (name === 'class') continue;
      if (el.attrs[name] !== undefined && (x[2] === undefined || el.attrs[name] === x[2])) return false;
    }
    if (nt === 'header' && el.tag === 'header') return false;
  }
  return pos.length > 0 || /\.wSkVaW_header(?![A-Za-z])/.test(bare) || Object.keys(el.attrs).some((a) => bare.includes('[' + a));
}
/** 产物中命中某形态、且声明含指定外观关键词的规则列表。 */
const APPEARANCE = /background|backdrop-filter|position|opacity|box-shadow/;
function hitsOn(rules, el, appearanceOnly = true) {
  const out = [];
  for (const r of rules) {
    if (!/(wSkVaW_header|_header)/.test(r.sel)) continue;
    for (const seg of r.sel.split(',')) {
      if (segHits(seg.trim(), el)) {
        if (!appearanceOnly || APPEARANCE.test(r.body)) out.push(seg.trim().slice(0, 100) + ' { ' + r.body.replace(/\s+/g, ' ').slice(0, 60) + ' }');
        break;
      }
    }
  }
  return out;
}

const WITH_IMG = { enabled: true, image: 'data:image/png;base64,AAA', headerBlur: true, headerBg: true };
const NO_IMG = { enabled: true, headerBlur: true, headerBg: true };
const STATES = [
  ['有壁纸·未吸附', WITH_IMG], ['有壁纸·吸附', WITH_IMG],
  ['无壁纸·未吸附', NO_IMG], ['无壁纸·吸附', NO_IMG],
];

console.log('== K. 代码块横幅四态契约 ==');
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');
{
  const bannerHitsByState = STATES.map(([label, st]) => [label, hitsOn(rulesOf(cssOf(CLIENT, st)), BANNER)]);
  for (const [label, hits] of bannerHitsByState) {
    ok(`K1[${label}] 我们的外观规则零命中 banner（原生底 alpha 由宿主保证）`, hits.length === 0, hits.length ? hits[0] : '0 条');
  }
  // K2 反向：真标题栏仍被命中（磨砂底规则），且 frost token 在产物
  const wRs = rulesOf(cssOf(CLIENT, WITH_IMG));
  const realHits = hitsOn(wRs, REAL_HEADER);
  ok('K2 反向：真标题栏仍被磨砂/底色规则命中（行为不变）', realHits.some((h) => /background/.test(h)), realHits.length + ' 条');
  ok('K2b --mpw-surface-frost-top token 在产物（磨砂档位未丢）',
    strip(cssOf(CLIENT, WITH_IMG)).includes('--mpw-surface-frost-top'), '');
  // K3 桥与打标（源码断言）
  ok('K3a wide 桥选择器排除 banner', /\['header, \[class\*="_header_"\]:not\(:where\(\[data-code-block-banner\]\)\)'/.test(src0), '');
  ok('K3b findHostHeader 排除 banner', src0.includes('querySelector(".wSkVaW_header:not(:where([data-code-block-banner]))")'), '');
  ok('K3c 自愈摘除 banner 残留标记', src0.includes('const isBanner = (() => { try { return el.hasAttribute("data-code-block-banner"); }'), '');
  // K4 吸附不改性：产物无**肯定**针对 banner 的 position/sticky 写（:not 排除里的引用不算）
  const posHits = [];
  for (const [, st] of STATES) {
    for (const r of rulesOf(cssOf(CLIENT, st))) {
      const bare = r.sel.replace(/:not\(:where\([^()]*\)\)/g, '').replace(/:not\([^()]*\)/g, '');
      if (!bare.includes('[data-code-block-banner]')) continue;
      if (/position|sticky/.test(r.body)) posHits.push(r.sel.slice(0, 60));
    }
  }
  ok('K4 产物无针对 banner 的 position/sticky 改写', posHits.length === 0, posHits[0] ?? 'clean');
}

/* ---------- 变异自证（隔离副本） ---------- */
const TMP_DIRS = [];
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP_DIRS.push(d); return d; };
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

async function withMutant(id, what, pairs, expectRed) {
  const dir = mkTmp('mpw-banner-mut-');
  const f = path.join(dir, 'client.js');
  let mutated = src0;
  const applied = [];
  for (const [anchor, replacement] of pairs) {
    const n = mutated.split(anchor).length - 1;
    const next = mutated.replace(anchor, replacement);
    applied.push(n === 1 && next !== mutated && !next.includes(anchor));
    mutated = next;
  }
  fs.writeFileSync(f, mutated);
  reset();
  let red;
  try {
    red = [];
    const bannerRed = STATES.some(([, st]) => hitsOn(rulesOf(cssOf(f, st)), BANNER).length > 0);
    if (bannerRed) red.push('K1');
    const srcM = fs.readFileSync(f, 'utf8');
    if (!/\['header, \[class\*="_header_"\]:not\(:where\(\[data-code-block-banner\]\)\)'/.test(srcM)) red.push('K3a');
    if (!srcM.includes('querySelector(".wSkVaW_header:not(:where([data-code-block-banner]))")')) red.push('K3b');
  } catch (e) { red = ['THROW:' + String(e && e.message || e).slice(0, 60)]; }
  const eq = applied.every(Boolean) && JSON.stringify(red.slice().sort()) === JSON.stringify(expectRed.slice().sort());
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-MISMATCH') + ' ' + id + ' ' + what);
  console.log('    期望红集=' + JSON.stringify(expectRed.slice().sort()) + ' 实际红集=' + JSON.stringify(red.slice().sort())
    + ' 变异生效=' + JSON.stringify(applied));
  if (!eq) fail++; else pass++;
}

console.log('\n== M. 变异自证（期望红集 == 实际红集）==');
await withMutant('M-ungate', '主底色规则去掉 :not(:where([data-code-block-banner]))（还原连带命中）',
  [['.wSkVaW_header:not(:where([data-code-block-banner])) {\n\tbackground-color: var(--mpw-surface-frost-top) !important;',
    '.wSkVaW_header {\n\tbackground-color: var(--mpw-surface-frost-top) !important; /* M-ungate */']],
  ['K1']);
await withMutant('M-bridge', 'wide 桥恢复旧选择器（重新把 banner 当宽头部）',
  [["['header, [class*=\"_header_\"]:not(:where([data-code-block-banner]))', 'wSkVaW_header', 'wide', false],",
    "['header, [class*=\"_header_\"]', 'wSkVaW_header', 'wide', false] /* M-bridge */,"]],
  ['K3a']);
await withMutant('M-findhdr', 'findHostHeader 去掉排除（磨砂层可注入 banner）',
  [['document.querySelector(".wSkVaW_header:not(:where([data-code-block-banner]))")',
    'document.querySelector(".wSkVaW_header") /* M-findhdr */']],
  ['K3b']);

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);

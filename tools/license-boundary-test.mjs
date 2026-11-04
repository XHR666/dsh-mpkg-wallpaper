// tools/license-boundary-test.mjs — 双许可边界护栏（任务单 P1 新增判据）
//
// 本包包含两个独立许可的部分（任务单：docs/ZCODE-RENDERER-INTEGRATION-TASK-ORDER.md §P1）：
//   · lib/**            = MIT（插件本体）
//   · renderer/**       = GPL-3.0-or-later（内置渲染器，随包分发、iframe 内运行）
// 本判据钉住四件事（任何一件被改坏都必须红）：
//   A. npm pack --dry-run 的发布物**包含** renderer/ 与 LICENSES/（且含 PROVENANCE.md）；
//      package.json 的 license 字段 = "SEE LICENSE IN LICENSE"（不许再标纯 MIT —— 包内含 GPL 却标 MIT 是分发合规问题）。
//   B. 根 LICENSE 含双许可说明；renderer/LICENSE 首行是 GPLv3。
//   C. lib/** 里**不得**出现对 renderer/ 的模块级引用（import / require / 动态 import）——
//      许可边界 = "聚合 + 公开接口调用"；host 路由用 fs/new URL **发渲染器的静态文件**是任务单 P2 明文许可的形态，
//      不算模块级引用，因此扫描只认模块加载语法，不认任意字符串。
//   D. plugin/renderer/ 与开发树 ../renderer/ **逐字节一致**（打包副本不许漂移；渲染器侧改动后必须同步拷贝）。
//
// 演进留痕（任务书 B 2026-10-30：真仓库内嵌布局）：
//   · 旧代码把开发树钉死在 `<仓库父目录>/renderer/`（集成交付的并列目录布局），真仓库里该路径不存在
//     ⇒ B2/D1 红于**路径解析**而非语义。现改为候选序：`env MPW_RENDERER_DEV` → `../renderer` →
//     `../we-scene-demo` → `./renderer`（内嵌副本），首个存在的目录胜出。
//   · B2 的对象改为**随包分发的副本** `renderer/LICENSE`（A4 已钉 pack 含它；此处钉其形态）——
//     分发出去的是副本，开发树 LICENSE 的形态不随包。旧布局里副本==开发树，语义无损。
//   · D1/D2（与开发树逐字节对拍）只在解析到**同步源开发树**（env / `../renderer`）时运行：
//     · 解析到 `../we-scene-demo`（上游项目树）⇒ 对拍无意义：副本 = 上游 + MODIFICATIONS.md 声明的
//       集成增量 + 打包排除（node_modules/.git/reports 等不随包），**不是逐字节复刻关系**，
//       对拍是永久假红 ⇒ 明确 SKIP 并打印原因，改跑"嵌入副本自校验"（不许静默通过）。
//     · 解析到内嵌副本自身（前三候选全缺，真仓库/worktree 的常态）⇒ 对拍是"自己比自己"（空真）
//       ⇒ 同样 SKIP，改跑"嵌入副本自校验"，语义：
//         D1' 副本文件集非空 + 哨兵文件在位（LICENSE / PROVENANCE.md / MODIFICATIONS.md /
//             THIRD-PARTY.md / demo.html / core/we-scene-bundle.js / web/diag-flags.json）；
//         D2' MODIFICATIONS.md **声明的增量真实在位**（demo.html 五个 mpw-* op + tests/props-compat-test.mjs
//             + docs/README-DIAGNOSTICS.md 的旗标登记）——"声明了什么"与"副本里有什么"自洽。
//     · 连内嵌副本都没有 ⇒ D1'/D2' 自然红（副本缺失本就该红），不静默放行。
//
// 自证（工程纪律 R1/R2：判据必须能失败，变异必须真的打上去）：
//   · M1：给扫描器喂一个含 `import … '../renderer/…'` 的临时副本 ⇒ 红集必须**逐条等于**预期（能红且只红该文件）；
//   · M2：把根 LICENSE 的双许可段落删掉的临时副本 ⇒ LICENSE 断言必须红。
// 纯 Node、离线、不动真树（变异一律在临时目录副本上做）。

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));          // plugin/tools
const PLUGIN = resolve(HERE, '..');                            // plugin/（真仓库里 = 仓库根）
const RENDERER_COPY = join(PLUGIN, 'renderer');                // 打包副本（plugin/renderer/；真仓库里即内嵌 renderer/）

/* ── 开发树解析（任务书 B 2026-10-30 候选序）：env → ../renderer → ../we-scene-demo → ./renderer（内嵌） ──
   kind：'sync' = 副本的同步源开发树（可逐字节对拍）；'upstream' = 上游项目树（副本含声明增量，不可对拍）；
   'embedded' = 内嵌副本自身（对拍空真）。找不到任何树 ⇒ null。 */
function resolveRendererTree() {
  const cands = [];
  if (process.env.MPW_RENDERER_DEV) cands.push({ kind: 'sync', label: 'env MPW_RENDERER_DEV=' + process.env.MPW_RENDERER_DEV, p: resolve(PLUGIN, process.env.MPW_RENDERER_DEV) });
  cands.push({ kind: 'sync', label: '../renderer', p: resolve(PLUGIN, '..', 'renderer') });
  cands.push({ kind: 'upstream', label: '../we-scene-demo（上游项目树）', p: resolve(PLUGIN, '..', 'we-scene-demo') });
  cands.push({ kind: 'embedded', label: './renderer（内嵌副本）', p: RENDERER_COPY });
  for (const c of cands) { try { if (statSync(c.p).isDirectory()) return c; } catch { /* 候选不存在 ⇒ 试下一个 */ } }
  return null;
}
const rendererTree = resolveRendererTree();

let pass = 0, fail = 0; const results = [];
const check = (id, ok, detail) => { (ok ? pass++ : fail++); results.push({ id, ok, detail }); };

/* ── 工具：目录遍历（相对路径集合） ─────────────────────────────── */
function walkRel(base, dir = '', out = []) {
  for (const name of readdirSync(join(base, dir))) {
    const rel = dir ? dir + '/' + name : name;
    const st = statSync(join(base, rel));
    if (st.isDirectory()) walkRel(base, rel, out);
    else out.push(rel);
  }
  return out;
}

/* ── C. lib/** 模块级 renderer 引用扫描（独立函数 ⇒ M1 可复用于隔离副本） ── */
const RENDERER_MODULE_REF = [
  /(?:^|[^\w.$])import\s*\(\s*['"][^'"]*renderer\//,   // 动态 import('…/renderer/…')
  /(?:^|[^\w.$])from\s*['"][^'"]*renderer\//,          // import … from '…/renderer/…'
  /(?:^|[^\w.$])import\s*['"][^'"]*renderer\//,        // 侧效 import '…/renderer/…'
  /(?:^|[^\w.$])require\s*\(\s*['"][^'"]*renderer\//,  // require('…/renderer/…')
];
function scanLibRendererRefs(libDir) {
  const hits = [];
  let libRoot;
  try { libRoot = statSync(libDir).isDirectory() ? libDir : null } catch { libRoot = null }
  if (!libRoot) return hits;
  for (const rel of walkRel(libRoot)) {
    if (!/\.(js|mjs|cjs)$/.test(rel)) continue;
    const src = readFileSync(join(libRoot, rel), 'utf8');
    for (const re of RENDERER_MODULE_REF) {
      if (re.test(src)) { hits.push(rel); break }
    }
  }
  return hits;
}

/* ── A. npm pack --dry-run（发布物形状） ─────────────────────────── */
let pack = null, packErr = '';
try {
  const r = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: PLUGIN, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '').trim();
  pack = out ? JSON.parse(out) : null;
  if (!pack) packErr = (r.stderr || ('exit=' + r.status)).slice(0, 300);
} catch (e) { packErr = String(e && e.message || e) }

const packFiles = (pack && pack[0] && Array.isArray(pack[0].files)) ? pack[0].files.map((f) => f.path) : [];
check('A1 npm pack --dry-run 可执行且产出文件清单', Array.isArray(pack) && packFiles.length > 0, packErr || ('files=' + packFiles.length));
check('A2 发布物含 renderer/ 文件', packFiles.some((p) => p.startsWith('renderer/')), packFiles.filter((p) => p.startsWith('renderer/')).length + ' 个 renderer 文件');
check('A3 发布物含 LICENSES/ 两份全文', packFiles.includes('LICENSES/MIT.txt') && packFiles.includes('LICENSES/GPL-3.0-or-later.txt'), 'LICENSES/MIT.txt + GPL-3.0-or-later.txt');
check('A4 发布物含 renderer/LICENSE 与 renderer/PROVENANCE.md', packFiles.includes('renderer/LICENSE') && packFiles.includes('renderer/PROVENANCE.md'), 'GPL 全文 + 边界声明随包分发');
let pkgLicense = '';
try { pkgLicense = String(JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8')).license || '') } catch (e) { packErr = String(e) }
check('A5 package.json license = SEE LICENSE IN LICENSE（不许标纯 MIT）', pkgLicense === 'SEE LICENSE IN LICENSE', 'license=' + JSON.stringify(pkgLicense));

/* ── B. 许可文件形态 ─────────────────────────────────────────────── */
const license = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } };
const rootLicense = license(join(PLUGIN, 'LICENSE'));
check('B1 根 LICENSE 含双许可说明（MIT + GPL-3.0-or-later + 两目录）',
  rootLicense.includes('GPL-3.0-or-later') && rootLicense.includes('MIT')
  && rootLicense.includes('lib/**') && rootLicense.includes('renderer/**')
  && rootLicense.includes('LICENSES/MIT.txt') && rootLicense.includes('LICENSES/GPL-3.0-or-later.txt'),
  '双许可说明页（指向两份全文）');
const gplFirst = (() => {
  // 任务书 B：对象 = 随包分发的副本 renderer/LICENSE（演进留痕见文件头）
  const t = license(join(RENDERER_COPY, 'LICENSE'));
  const line = t.split('\n').map((s) => s.trim()).find((s) => s.length > 0) || '';
  return { line, ok: /GNU GENERAL PUBLIC LICENSE/.test(line) && /Version 3/.test(t.slice(0, 400)) };
})();
check('B2 renderer/LICENSE 首行 GPLv3', gplFirst.ok, '首行=' + JSON.stringify(gplFirst.line));
const mitTxt = license(join(PLUGIN, 'LICENSES', 'MIT.txt'));
check('B3 LICENSES/MIT.txt 是 MIT 全文（含 Permission is hereby granted）', /Permission is hereby granted/.test(mitTxt), 'MIT 全文存在');

/* ── C. lib/** 模块级引用扫描（真树） ─────────────────────────────── */
const libHits = scanLibRendererRefs(join(PLUGIN, 'lib'));
check('C1 lib/** 无 renderer/ 的 import/require/动态 import 引用', libHits.length === 0, libHits.length ? '命中: ' + libHits.join(', ') : '0 命中');

/* ── D. 漂移守卫：同步源开发树在 ⇒ 逐字节对拍；否则 ⇒ 明确 SKIP + 嵌入副本自校验（演进留痕见文件头） ── */
const isSyncTree = rendererTree && rendererTree.kind === 'sync';
if (isSyncTree) {
  const RENDERER_DEV = rendererTree.p;
  let devFiles = [], copyFiles = [], diffSample = [];
  try { devFiles = walkRel(RENDERER_DEV).sort() } catch (e) { diffSample.push('dev 树读取失败: ' + e.message) }
  try { copyFiles = walkRel(RENDERER_COPY).sort() } catch (e) { diffSample.push('打包副本读取失败: ' + e.message) }
  const onlyDev = devFiles.filter((f) => !copyFiles.includes(f));
  const onlyCopy = copyFiles.filter((f) => !devFiles.includes(f));
  const byteDiff = [];
  for (const f of devFiles) {
    if (!copyFiles.includes(f)) continue;
    const a = readFileSync(join(RENDERER_DEV, f));
    const b = readFileSync(join(RENDERER_COPY, f));
    if (!a.equals(b)) { byteDiff.push(f); if (byteDiff.length >= 5) break }
  }
  check('D1 plugin/renderer 与开发树（' + rendererTree.label + '）文件集合一致',
    devFiles.length > 0 && onlyDev.length === 0 && onlyCopy.length === 0,
    'dev=' + devFiles.length + ' copy=' + copyFiles.length
    + (onlyDev.length ? ' 仅dev: ' + onlyDev.slice(0, 3).join(',') : '')
    + (onlyCopy.length ? ' 仅副本: ' + onlyCopy.slice(0, 3).join(',') : ''));
  check('D2 共有文件逐字节一致', byteDiff.length === 0, byteDiff.length ? '差异: ' + byteDiff.join(', ') : '全部一致');
} else {
  /* 嵌入副本自校验（替代逐字节对拍；语义写在文件头）：
     没有同步源开发树可比 ⇒ 副本自身即源头，改钉"完整 + 声明增量真实在位"。 */
  const reason = !rendererTree
    ? '四个候选全缺（连内嵌副本都没有）'
    : rendererTree.kind === 'upstream'
      ? '解析到上游项目树（' + rendererTree.label + '）：副本=上游+MODIFICATIONS.md 声明增量+打包排除，非逐字节复刻关系，对拍是永久假红 ⇒ SKIP'
      : '解析到内嵌副本自身（' + rendererTree.label + '）：对拍=自己比自己（空真）⇒ SKIP';
  const copyFiles = (() => { try { return walkRel(RENDERER_COPY).sort() } catch { return [] } })();
  const sentinels = ['LICENSE', 'PROVENANCE.md', 'MODIFICATIONS.md', 'THIRD-PARTY.md', 'demo.html', 'core/we-scene-bundle.js', 'web/diag-flags.json'];
  const missing = sentinels.filter((f) => !copyFiles.includes(f));
  check("D1' 嵌入副本自校验：文件集非空 + 哨兵文件在位（替代逐字节对拍）",
    copyFiles.length > 0 && missing.length === 0,
    'SKIP 原因：' + reason + '。copy=' + copyFiles.length
    + (missing.length ? ' 缺哨兵: ' + missing.join(',') : ' 哨兵齐'));
  const declared = (() => {
    try {
      const demo = readFileSync(join(RENDERER_COPY, 'demo.html'), 'utf8');
      const ops = ['mpw-props-describe', 'mpw-props-reset', 'mpw-layers-list', 'mpw-layers-set', 'mpw-ui-set'];
      const missingOps = ops.filter((op) => !demo.includes(op));
      const diag = readFileSync(join(RENDERER_COPY, 'docs', 'README-DIAGNOSTICS.md'), 'utf8');
      const flagsOk = diag.includes('noui') && diag.includes('propscompat');
      const propsTest = copyFiles.includes('tests/props-compat-test.mjs');
      return { ok: missingOps.length === 0 && flagsOk && propsTest, detail: missingOps.length ? 'demo.html 缺 op: ' + missingOps.join(',') : (!propsTest ? '缺 tests/props-compat-test.mjs' : (!flagsOk ? 'README-DIAGNOSTICS 未登记 noui/propscompat' : '五个 op + props-compat 判据 + 旗标登记 全在位')) };
    } catch (e) { return { ok: false, detail: '读取失败: ' + (e && e.message || e) } }
  })();
  check("D2' 嵌入副本自校验：MODIFICATIONS.md 声明的增量真实在位（替代逐字节对拍）", declared.ok, declared.detail);
}
if (rendererTree) console.log('# 开发树解析：' + rendererTree.label + '（kind=' + rendererTree.kind + '）⇒ ' + (isSyncTree ? 'D1/D2 逐字节对拍' : "D1/D2 SKIP，以 D1'/D2' 嵌入副本自校验替代"));
else console.log('# 开发树解析：无任何候选在位 ⇒ 自校验按红处理（副本缺失不静默放行）');

/* ══ 自证 M1：扫描器喂含真引用的隔离副本 ⇒ 红集逐条等于预期 ══ */
{
  const tmp = mkdtempSync(join(tmpdir(), 'mpw-licbound-'));
  try {
    mkdirSync(join(tmp, 'lib'), { recursive: true });
    writeFileSync(join(tmp, 'lib', 'clean.js'), 'export const x = 1\n');
    writeFileSync(join(tmp, 'lib', 'bad-import.js'), "import mount from '../renderer/core/we-scene.mjs'\nexport default mount\n");
    writeFileSync(join(tmp, 'lib', 'bad-dyn.js'), "export const load = () => import('../renderer/demo.html')\n");
    // 反向对照：这些**合法**形态不许命中（P2 的静态托管指针 / 无关字符串）
    writeFileSync(join(tmp, 'lib', 'serve-pointer.js'), "import { readFileSync } from 'node:fs'\nexport const root = new URL('../renderer/', import.meta.url)\nconst note = 'renderer 是 GPL 目录'\n");
    const got = scanLibRendererRefs(join(tmp, 'lib')).sort();
    const want = ['bad-dyn.js', 'bad-import.js'].sort();
    check('M1 变异自证：扫描器红集 == 期望红集（能失败、且不误伤静态托管指针）',
      JSON.stringify(got) === JSON.stringify(want),
      '期望=' + JSON.stringify(want) + ' 实际=' + JSON.stringify(got));
  } finally { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* 清理失败不影响判定 */ } }
}
/* ══ 自证 M2：删掉双许可段落的 LICENSE 副本 ⇒ 同一断言必须红 ══ */
{
  const mutated = rootLicense.replace(/GPL-3\.0-or-later/g, '');
  const wouldPass = mutated.includes('GPL-3.0-or-later') && mutated.includes('MIT')
    && mutated.includes('lib/**') && mutated.includes('renderer/**');
  check('M2 变异自证：LICENSE 断言在"双许可段落被删"的副本上变红', !wouldPass, '删段后断言放行=' + wouldPass + '（必须 false）');
}

/* ── 汇总 ────────────────────────────────────────────────────────── */
for (const r of results) console.log((r.ok ? '✓' : '✗') + ' ' + r.id + (r.detail ? '  —— ' + r.detail : ''));
console.log(`===== license-boundary: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);

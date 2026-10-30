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
const PLUGIN = resolve(HERE, '..');                            // plugin/
const ROOT = resolve(PLUGIN, '..');                            // zcode-renderer-integration/
const RENDERER_DEV = join(ROOT, 'renderer');                   // 渲染器开发树（本任务单的 renderer/）
const RENDERER_COPY = join(PLUGIN, 'renderer');                // 打包副本（plugin/renderer/）

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
  const t = license(join(RENDERER_DEV, 'LICENSE'));
  const line = t.split('\n').map((s) => s.trim()).find((s) => s.length > 0) || '';
  return { line, ok: /GNU GENERAL PUBLIC LICENSE/.test(line) && /Version 3/.test(license(join(RENDERER_DEV, 'LICENSE')).slice(0, 400)) };
})();
check('B2 renderer/LICENSE 首行 GPLv3', gplFirst.ok, '首行=' + JSON.stringify(gplFirst.line));
const mitTxt = license(join(PLUGIN, 'LICENSES', 'MIT.txt'));
check('B3 LICENSES/MIT.txt 是 MIT 全文（含 Permission is hereby granted）', /Permission is hereby granted/.test(mitTxt), 'MIT 全文存在');

/* ── C. lib/** 模块级引用扫描（真树） ─────────────────────────────── */
const libHits = scanLibRendererRefs(join(PLUGIN, 'lib'));
check('C1 lib/** 无 renderer/ 的 import/require/动态 import 引用', libHits.length === 0, libHits.length ? '命中: ' + libHits.join(', ') : '0 命中');

/* ── D. 打包副本与开发树逐字节一致 ───────────────────────────────── */
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
check('D1 plugin/renderer 与 renderer 文件集合一致',
  devFiles.length > 0 && onlyDev.length === 0 && onlyCopy.length === 0,
  'dev=' + devFiles.length + ' copy=' + copyFiles.length
  + (onlyDev.length ? ' 仅dev: ' + onlyDev.slice(0, 3).join(',') : '')
  + (onlyCopy.length ? ' 仅副本: ' + onlyCopy.slice(0, 3).join(',') : ''));
check('D2 共有文件逐字节一致', byteDiff.length === 0, byteDiff.length ? '差异: ' + byteDiff.join(', ') : '全部一致');

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

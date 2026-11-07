// tools/scene-static-only-test.mjs —— Z5（2026-11-07 任务书）：scene「只剩静态层」修复的独立核查判据
//
// 性质：独立核查 + 补漏（主会话修复在基线 64476d4；本判据只钉住修复形态，不重写实现）。
// 三根因的修复形态（全部源码级断言，独立于 renderer-view-wiring 的 R 组另钉一层）：
//   F1 token 守卫：__needsRefresh 必须是"真判定"（URL token 缺失/不一致/内存无 token/需 strict 升级
//      的析取式），且命中 ⇒ defer+prefetch（不许恒 false 绕过）。
//   F2 兜底保布局：iframe display:block + opacity:0 + pointer-events:none（无 display:none 分支残留）；
//      静态帧 img z-index:2 盖住透明 iframe；轮询窗口 10 分钟。
//   F3 重载/重试：fresh-token URL + mpwSceneBustUrl buster；__mpwWantReload 显式意图绕过 src 幂等比较。
//   F4 渲染器心跳：mpwHealthPost 模块级（bootInstance 之前）+ ctx-lost/ctx-restored 都发；
//      宿主 mpw-health 消费点存在并触发自动重建（非死代码）。
// 既有判据复跑（E 组，子进程退出码）：renderer-view-wiring / scene-watchdog / scene-sandbox /
//   scene-url-token-guard / bgwrap-visible。
// R-MUT 独立重放：把真树副本复制到 os.tmpdir()，把兜底 CSS 改回 display:none，
//   在副本上跑 tools/renderer-view-wiring-test.mjs ⇒ 必须红（R2）；未变异副本 ⇒ 绿。
// 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）：
//   N1 守卫判定改恒 false ⇒ 红 ["F1"]；N2 buster 去掉（const busted = base）⇒ 红 ["F3"]；
//   N3 删掉渲染器 ctx-restored 心跳 ⇒ 红 ["F4"]。
// 用法: node tools/scene-static-only-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, d = '') => { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) }
const bad = (n, d = '') => { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) }

function runChecks(clientText, rendererText) {
  const r = {}
  /* F1 token 守卫（真判定 + defer 出口） */
  {
    const f = []
    if (!/const __needsRefresh = !__ident \|\| __needStrict \|\| !__urlTok \|\| !__memTok \|\| __urlTok !== __memTok;/.test(clientText)) f.push('F1 守卫判定不是真析取式（可能被改成恒值）')
    if (!/if \(__needsRefresh\) \{\s*\n\s*try \{ mpwSandboxDeferFromUrl\(url, __needStrict \? "showWebEl-guard" : "showWebEl-token-refresh"\) catch/.test(clientText.replace('\) } catch', ') } catch').replace(/(\);\s*\} catch \(e\))/, '$1')) && !/if \(__needsRefresh\) \{[\s\S]{0,180}mpwSandboxDeferFromUrl\(url, __needStrict/.test(clientText)) f.push('F1 守卫命中后没有 defer+prefetch 出口')
    if (!/return;\s*\n\s*\}\s*\n\s*\}\s*\n\s*const \{ img, video, frame, wrap \} = bgElements\(\);/.test(clientText) && !/mpwSandboxDeferFromUrl\(url, __needStrict[\s\S]{0,120}\) catch \(e\)[\s\S]{0,80}\}[\s\S]{0,20}return;/.test(clientText)) f.push('F1 defer 后未 return（旧 URL 仍可能被挂）')
    r['F1'] = f.length === 0
    r.__f1 = f.join('；') || '守卫=真判定（token 缺失/不一致/内存无/需 strict）+ defer+prefetch 出口'
  }
  /* F2 兜底保布局 */
  {
    const f = []
    if (!/\.mpw-bgWrap\.mpw-scene-fallback iframe\.mpw-webFrame \{\s*\n\s*display: block !important;\s*\n\s*opacity: 0 !important;\s*\n\s*pointer-events: none !important;/.test(clientText)) f.push('F2 兜底 CSS 不是保布局形态（block+opacity:0）')
    if (/\.mpw-bgWrap\.mpw-scene-fallback iframe\.mpw-webFrame \{ display: none !important; \}/.test(clientText)) f.push('F2 残留 display:none 单行分支（叠加而非替换）')
    if (!/\.mpw-bgWrap\.mpw-scene-fallback img\.mpw-bgImg \{ display: block !important; z-index: 2 !important; \}/.test(clientText)) f.push('F2 静态帧未盖住透明 iframe（z-index:2 缺失）')
    if (!/wd\.fallback && Date\.now\(\) - wd\.fallbackAt > 10 \* 60 \* 1000/.test(clientText)) f.push('F2 兜底轮询窗口不是 10 分钟')
    r['F2'] = f.length === 0
    r.__f2 = f.join('；') || 'block+opacity:0 / 无 display:none 残留 / img z-index:2 / 10min 窗口'
  }
  /* F3 重载/重试 */
  {
    const f = []
    if (!/const busted = mpwSceneBustUrl\(base\);/.test(clientText)) f.push('F3 重载 URL 无 buster')
    if (!/const tk = ident \? mpwSandboxToken\(ident\) : null; const u2 = tk \? mpwSceneStrictifyUrl\(url, tk\) : ""; if \(u2\) base = u2;/.test(clientText)) f.push('F3 重载未先换 fresh token')
    if (!/let __mpwWantReload = \(__mpwSceneWdBustNext \|\| __forceReloadNoLive\) === true;/.test(clientText)) f.push('F3 显式重载意图缺失（WdBustNext/ForceNoLive）')
    if (!/if \(__mpwWantReload \|\| __urlId\(frame\.getAttribute\("src"\)\) !== __urlId\(mpwEffUrl\)\) frame\.src = mpwEffUrl;/.test(clientText)) f.push('F3 幂等比较未让位给显式重载意图')
    r['F3'] = f.length === 0
    r.__f3 = f.join('；') || 'fresh-token + buster + 显式重载意图绕过幂等比较'
  }
  /* F4 心跳 + 消费点 */
  {
    const f = []
    const ih = rendererText.indexOf('function mpwHealthPost(why)')
    const ib = rendererText.indexOf('async function bootInstance(inst)')
    if (!(ih >= 0 && ib > ih)) f.push('F4 mpwHealthPost 非模块级定义（必须先于 bootInstance）')
    if (!/mpwHealthPost\('ctx-lost'\)/.test(rendererText)) f.push('F4 ctx-lost 心跳缺失')
    if (!/mpwHealthPost\('ctx-restored'\)/.test(rendererText)) f.push('F4 ctx-restored 心跳缺失')
    if (!/d\.type !== "mpw-health"\) return;/.test(clientText)) f.push('F4 宿主消费点缺失')
    if (!/mpwSceneReloadIframe\("ctx-lost-"/.test(clientText)) f.push('F4 mpw-health 未接自动重建（死代码）')
    r['F4'] = f.length === 0
    r.__f4 = f.join('；') || '模块级心跳（bootInstance 前）+ 两事件都发 + 宿主消费点触发自动重建'
  }
  return r
}

console.log('== 主判据（真树源码级）==')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const RENDERER = fs.readFileSync(path.join(ROOT, 'renderer', 'demo.html'), 'utf8')
const main = runChecks(CLIENT, RENDERER)
for (const [id, name] of [['F1', 'F1 token 守卫（真判定 + defer 出口）'], ['F2', 'F2 兜底保布局（block+opacity:0 / 无 none 残留 / z-index / 10min）'], ['F3', 'F3 重载 fresh-token + buster + 显式意图'], ['F4', 'F4 心跳 + 宿主消费点（非死代码）']]) {
  if (main[id]) ok(name, main['__' + id.toLowerCase()])
  else bad(name, main['__' + id.toLowerCase()])
}

console.log('\n== E 既有判据复跑（子进程退出码）==')
for (const t of ['renderer-view-wiring-test', 'scene-watchdog-test', 'scene-sandbox-test', 'scene-url-token-guard-test', 'bgwrap-visible-test']) {
  let exit = 0
  try { execFileSync('node', [path.join(here, t + '.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { exit = 1 }
  if (exit === 0) ok('E ' + t + ' 绿')
  else bad('E ' + t + ' 红（exit=' + exit + '）')
}

console.log('\n== R-MUT 独立重放（tmpdir 仓库副本上跑 renderer-view-wiring-test）==')
{
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-rmut-'))
  for (const d of ['lib', 'renderer', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true })
  const t = path.join(TMP, 'tools', 'renderer-view-wiring-test.mjs')
  let baseExit = 0
  try { execFileSync('node', [t], { cwd: TMP, stdio: ['ignore', 'pipe', 'pipe'] }) } catch { baseExit = 1 }
  // 变异：兜底 CSS 改回 display:none（与 R-MUT 同一变异，独立环境重放）
  const cl = path.join(TMP, 'lib', 'client.js')
  const src = fs.readFileSync(cl, 'utf8')
  const mutated = src.replace(`.mpw-bgWrap.mpw-scene-fallback iframe.mpw-webFrame {
	display: block !important;
	opacity: 0 !important;`, `.mpw-bgWrap.mpw-scene-fallback iframe.mpw-webFrame {
	display: none !important;
	opacity: 0 !important;`)
  const applied = mutated !== src && mutated.includes('display: none !important;\n\topacity: 0 !important;')
  let mutExit = 0
  if (applied) { fs.writeFileSync(cl, mutated); try { execFileSync('node', [t], { cwd: TMP, stdio: ['ignore', 'pipe', 'pipe'] }) } catch { mutExit = 1 } }
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  if (applied && baseExit === 0 && mutExit === 1) ok('R-MUT 重放：副本基线绿(0) → 变异后红(1)（期望红=[R2] 实际红=[R2]）')
  else bad('R-MUT 重放异常', `applied=${applied} baseExit=${baseExit} mutExit=${mutExit}`)
}

console.log('\n== N 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const MUT = [
  { id: 'N1', what: '守卫判定改恒 false ⇒ F1 必红', expect: ['F1'],
    patch: (s) => s.replace('const __needsRefresh = !__ident || __needStrict || !__urlTok || !__memTok || __urlTok !== __memTok;', 'const __needsRefresh = false; /* N1 */'),
    verify: (s) => s.includes('const __needsRefresh = false; /* N1 */') },
  { id: 'N2', what: '重载 buster 去掉（const busted = base）⇒ F3 必红', expect: ['F3'],
    patch: (s) => s.replace('const busted = mpwSceneBustUrl(base);', 'const busted = base; /* N2 */'),
    verify: (s) => s.includes('const busted = base; /* N2 */') },
  { id: 'N3', what: '删渲染器 ctx-restored 心跳 ⇒ F4 必红', expect: ['F4'],
    patch: (s) => s.replace("try { setTimeout(() => { try { mpwHealthPost('ctx-restored') } catch (e) {} }, 0) } catch (e) {}", ''),
    verify: (s) => !s.includes("mpwHealthPost('ctx-restored')") },
]
for (const m of MUT) {
  const mutC = m.id === 'N3' ? CLIENT : m.patch(CLIENT)
  const mutR = m.id === 'N3' ? m.patch(RENDERER) : RENDERER
  if (!m.verify(m.id === 'N3' ? mutR : mutC)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id); continue }
  const r = runChecks(mutC, mutR)
  const red = ['F1', 'F2', 'F3', 'F4'].filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + '  ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red) + (red.length ? ' 细节=' + red.map((x) => r['__' + x.toLowerCase()]).join('；') : '')) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

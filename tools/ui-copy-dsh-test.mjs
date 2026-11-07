// tools/ui-copy-dsh-test.mjs —— Z1（2026-11-07 任务书）：UI 文案里的小写 `dsh` 必须是产品名 DSH；
// 命令/路径/包名语境的小写 dsh 一律保留（反向锚点）。
//
// 断言：
//   A  正向：语言字典 **value** 里的 `\bdsh\b` 只允许白名单形态 ⇒ 违规数 = 0
//      白名单（都是"不该改"的语境，改了反而坏）：
//        命令  `dsh web` / `dsh plugin update` / `dsh --profile`
//        路径  `~/.dsh/`（前缀是 `.` 的 `dsh/`，如 `~/.dsh/.dsh-mpkg-wallpaper/`）
//        包名  `dsh-mpkg-wallpaper`（若出现在 value 里）
//   B  反向：命令形态必须仍存在 —— zh 与 en 各至少 1 处 `dsh web` 与 `dsh plugin update`
//      （有人把命令误改成 `DSH web` ⇒ B 红）
//   C  一致性：zh/en 键集合相等（与 panel-fixes a2 同口径，重复钉一层不冲突）
//   D  回归：panel-fixes-test.mjs 全绿（子进程跑，退出码真实）
// 变异自证（隔离副本 os.tmpdir()；期望红集 == 实际红集，逐条相等）：
//   M1 zh "hybrid" 改回 `dsh` ⇒ 期望红 ["A"]
//   M2 zh "update.applied" 的 `dsh web` 改成 `DSH web` ⇒ 期望红 ["B"]
//   M3 zh/en 各塞一条 "x.y"（含裸 dsh）⇒ 期望红 ["A"]（两套同塞，键集合保持一致，C 不参与）
//
// 用法: node tools/ui-copy-dsh-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadPlugin, cancelWorldTimers } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, d = '') => { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) }
const bad = (n, d = '') => { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) }

/* A 的违规判定：value 里每个 `\bdsh\b`，其后续片段必须命中白名单形态之一。 */
function dshViolations(dict, lang) {
  const out = []
  for (const [k, v] of Object.entries(dict || {})) {
    if (typeof v !== 'string') continue
    for (const m of v.matchAll(/\bdsh\b/g)) {
      const tail = v.slice(m.index, m.index + 40)
      const prev = m.index > 0 ? v[m.index - 1] : ''
      const allowed =
        /^dsh web\b/.test(tail) ||            // 命令：dsh web
        /^dsh plugin update\b/.test(tail) ||  // 命令：dsh plugin update
        /^dsh --profile\b/.test(tail) ||      // 命令：dsh --profile
        (/^dsh[/]/.test(tail) && (prev === '.' || prev === '/')) || // 路径：~/.dsh/…
        /^dsh-mpkg-wallpaper\b/.test(tail)    // 包名（若出现在文案里）
      if (!allowed) out.push(lang + ':' + k + ' = …' + v.slice(Math.max(0, m.index - 12), m.index + 30) + '…')
    }
  }
  return out
}

const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce', '__mpwBuildCss']
function resetGlobals() { for (const k of CLEAR) { try { delete globalThis[k] } catch {} } }

function runChecks(clientPath) {
  resetGlobals()
  cancelWorldTimers()
  const w = loadPlugin({ quiet: true, clientPath })
  const d = w.localeDicts || {}
  const zh = d.zh || {}, en = d.en || {}
  const r = {}
  const vZh = dshViolations(zh, 'zh'), vEn = dshViolations(en, 'en')
  r['A'] = vZh.length === 0 && vEn.length === 0
  r.__viol = vZh.concat(vEn)
  const cnt = (dict, re) => Object.values(dict).filter((x) => typeof x === 'string' && re.test(x)).length
  /* 任务书"必须保留"表：hybrid.desc / update.applied 含命令 `dsh web`；update.readonly 含 `dsh plugin update`；
     zh 与 en 四份都要在（误改成 DSH web / 删键 ⇒ B 红）。 */
  const cmdKeep = (dict, key, re) => typeof dict[key] === 'string' && re.test(dict[key])
  r['B'] = ['zh', 'en'].every((lg) => {
    const dict = lg === 'zh' ? zh : en
    return cmdKeep(dict, 'hybrid.desc', /\bdsh web\b/)
      && cmdKeep(dict, 'update.applied', /\bdsh web\b/)
      && cmdKeep(dict, 'update.readonly', /\bdsh plugin update\b/)
  }) && cnt(zh, /\bdsh plugin update\b/) >= 1 && cnt(en, /\bdsh plugin update\b/) >= 1
  r.__b = `hybrid.desc/update.applied 含 dsh web、update.readonly 含 dsh plugin update（zh+en）；计数 zh web=${cnt(zh, /\bdsh web\b/)} en web=${cnt(en, /\bdsh web\b/)} zh upd=${cnt(zh, /\bdsh plugin update\b/)} en upd=${cnt(en, /\bdsh plugin update\b/)}`
  const zk = Object.keys(zh), ek = Object.keys(en)
  r['C'] = zk.every((k) => k in en) && ek.every((k) => k in zh)
  r.__c = `${zk.length} 键`
  cancelWorldTimers()
  return r
}

console.log('== 主判据（真树）==')
const argClient = process.argv.indexOf('--client')
const mainPath = argClient > 0 ? process.argv[argClient + 1] : path.join(ROOT, 'lib', 'client.js')
if (argClient > 0) console.log('  （--client 指向副本：' + mainPath + ' —— 用于"改前红"对照；变异 M 段仍以真树 CLIENT 为底版）')
const main = runChecks(mainPath)
if (main['A']) ok('A 字典 value 里无白名单外的小写 dsh（违规 0）')
else bad('A 字典 value 存在白名单外的小写 dsh', main.__viol.slice(0, 8).join(' | '))
if (main['B']) ok('B 反向：命令形态 `dsh web` / `dsh plugin update` 在 zh/en 都仍在', main.__b)
else bad('B 命令形态丢失（可能被误改成大写）', main.__b)
if (main['C']) ok('C zh/en 键集合一致', main.__c)
else bad('C zh/en 键集合不一致', main.__c)

console.log('\n== D 回归：panel-fixes-test.mjs（子进程，退出码）==')
try {
  execFileSync('node', [path.join(here, 'panel-fixes-test.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  ok('D panel-fixes-test 全绿（zh/en 键集合 + 静态键 + 渲染面）')
} catch (e) {
  bad('D panel-fixes-test 红', String(e.stdout || e.message).split('\n').filter((l) => l.includes('✗')).slice(0, 3).join(' | '))
}

console.log('\n== M 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const HYB_ZH_OLD = '"hybrid": "上传到 dsh 进程流式播放",'
const HYB_ZH_NEW = '"hybrid": "上传到 DSH 宿主进程流式播放",'
const APPLIED_OLD = '"update.applied": "更新完成！请重启 dsh web 并 Ctrl+F5 生效",'
const APPLIED_MUT = '"update.applied": "更新完成！请重启 DSH web 并 Ctrl+F5 生效", /* M2 */'
const MUT = [
  { id: 'M1', what: 'zh hybrid 改回 `dsh` ⇒ A 必红', expect: ['A'],
    patch: (s) => s.replace(HYB_ZH_NEW, HYB_ZH_OLD), verify: (s) => s.includes(HYB_ZH_OLD) && !s.includes(HYB_ZH_NEW) },
  { id: 'M2', what: 'zh `dsh web` 误改 `DSH web` ⇒ B 必红', expect: ['B'],
    patch: (s) => s.replace(APPLIED_OLD, APPLIED_MUT), verify: (s) => s.includes(APPLIED_MUT) },
  { id: 'M3', what: 'zh/en 各塞 "x.y"（裸 dsh）⇒ A 必红', expect: ['A'],
    patch: (s) => s.replace(HYB_ZH_NEW, HYB_ZH_NEW + '\n\t\t\t"x.y": "dsh 服务不可用",')
      .replace('"hybrid": "Upload to the DSH host for streaming playback",',
        '"hybrid": "Upload to the DSH host for streaming playback",\n\t\t\t"x.y": "dsh service unavailable",'),
    verify: (s) => s.includes('"x.y": "dsh 服务不可用"') && s.includes('"x.y": "dsh service unavailable"') },
]
for (const m of MUT) {
  const mutated = m.patch(CLIENT)
  if (!m.verify(mutated)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id); continue }
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-copy-dsh-mut-'))
  const p = path.join(TMP, 'client-mut.js')
  fs.writeFileSync(p, mutated)
  const r = runChecks(p)
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  const red = ['A', 'B', 'C'].filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + '  ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red) + (red.includes('A') ? '  违规=' + JSON.stringify(r.__viol.slice(0, 3)) : '')) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

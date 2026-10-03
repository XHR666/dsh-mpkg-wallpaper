// anim-guard-test.mjs —— P1B「左栏收起动画卡顿」修复的判据：重活闸门 + ?mpwperf=off 测量开关
//
// 病与读数（tools/sidebar-anim-probe.mjs，2026-10-03 真机 :3080，两组 × 3 次，中位）：
//   插件开 p95=66.5ms / max≈100ms / >50ms 空档 6 个（p95 波动 0.5%）
//   vs 页内中性化 p95=32.6ms / max=34ms / 空档 0 ⇒ 开/中性化 2.04×。
//   **诚实发现**：MutationObserver 回调自身仅 1–6ms ⇒ 卡顿主体不在回调执行，
//   而在观察器**调度的后续全文档扫描 + 强制布局**（sblur 的 check 同步跑、
//   popTag 的 prun / headerBlur 的 hrun 每批突变 querySelectorAll + getBoundingClientRect）。
//
// 修（lib/client.js）：
//   ① `mpwHeavyGate(name, fn)`：document.getAnimations() 有 running ⇒ 本轮重活跳过并登记；
//      400ms 定时器统一**补跑一次**（不会漏收尾状态）。getAnimations 只读动画表、不触发布局。
//   ② 三个工人接闸门：sblur（原写法每批突变**同步** check，另改 rAF 帧内合并）、popTag、hdrBlur。
//      动画期间 (getBoundingClientRect 类) 重活为零。
//   ③ `?mpwperf=off`（apply() 幂等守卫后直接 return）：完全不装 CSS/observer/壁纸 ——
//      P1A 对照组口径的官方开关（此前 lib/client.js 冻结未实现），登记 docs/DIAGNOSTICS.md。
//
// 判据结构（桩世界：_stub.mjs 的 MutationObserver 是空桩 ⇒ "突变→工人"接线用 A 组源码断言，
//           闸门行为用 __mpwHeavyTest 出口直接断言，两层合起来覆盖）：
//   A 组 静态：闸门定义 + 三个工人调用点 + mpwperf=off 在 apply 幂等守卫之后 + 文档登记
//   B 组 行为：动画在跑 ⇒ gate 拦下（登记 + 定时器就位 + **重活零执行** = 零 getBoundingClientRect）；
//             动画停 ⇒ 补跑执行、账目清空（flushNow 与真实 400ms 定时器两条路都验）
//   C 组 行为：?mpwperf=off ⇒ apply 直接 return（__mpwSectionTest 不存在 = 一个 observer 都没装）；
//             不带参数 ⇒ 一切照旧
//   D 组 变异自证：把闸门改成"恒放行"⇒ B 组的"动画期间零重活"必红（真源零改动，mkdtemp 副本）
//
// 用法: node tools/anim-guard-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const DIAG = (() => { try { return fs.readFileSync(path.join(ROOT, 'docs', 'DIAGNOSTICS.md'), 'utf8') } catch { return '' } })()

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) } else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) } }

/* mkdtemp 副本 + 任意 patch（D 组变异用；真源零改动） */
const patchCopy = (reps) => {
  let src = CLIENT
  for (const [a, b] of reps) {
    if (!src.includes(a)) throw new Error('变异锚点缺失 → ' + String(a).slice(0, 60))
    src = src.replace(a, b)
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-anim-guard-'))
  const p = path.join(dir, 'client.js')
  fs.writeFileSync(p, src)
  return p
}

/* 幂等守卫清理（多次 loadPlugin 的铁律，与 fog-model-test 同清单） */
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce',
  '__mpwBuildCss', '__mpwSectionTest', '__mpwHdrFrostTest', '__mpwGlobalWired', '__mpwNpCtlSeq', '__mpwNowPlaying',
  '__mpwNowPlayingSlotAction', '__mpwPersist', '__mpwStyleWatch', '__mpwHeavyTest']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }
let rects = 0
const boot = (clientPath, search) => {
  reset()
  rects = 0
  const w = loadPlugin({ quiet: true, clientPath: clientPath || null, settings: { enabled: true, image: 'stub-wallpaper.png' }, search: search || '' })
  // 桩世界的布局探针计数器（闸门若放行，工人就会碰到它）
  try {
    globalThis.document.getBoundingClientRect = () => { rects++; return { width: 1, height: 1, top: 0, left: 0 } }
    globalThis.document.getAnimations = () => (w.__anims || [])
  } catch { /* ignore */ }
  return w
}

console.log('== A 组：静态（闸门 / 三工人 / mpwperf / 文档登记）==')
ok('A1 闸门定义存在：mpwHeavyGate + mpwHeavyAnimRunning（getAnimations 只读、不强制布局）',
  CLIENT.includes('function mpwHeavyGate(name, fn) {') && CLIENT.includes('function mpwHeavyAnimRunning() {')
  && /document\.getAnimations && document\.getAnimations\(\)\.length/.test(CLIENT))
ok('A2 重活闸门：sblur / hdrBlur / npFit 走闸门；popTag 改为只处理**新增子树**（不再全文档扫描 ⇒ 不再需要闸门，也不该再登记）',
  CLIENT.includes('mpwHeavyGate("sblur"') && CLIENT.includes('mpwHeavyGate("hdrBlur"')
  && CLIENT.includes('npFitGate("npFit", evaluate)')
  && !CLIENT.includes('mpwHeavyGate("popTag"')
  && (CLIENT.match(/\n\s*mpwTagPopoverBg\(\);\n/g) || []).length === 1
  && CLIENT.includes('mpwTagPopoverFast(records)'))
ok('A3 sblur 从"每批突变同步 check"改成 rAF 帧内合并 + 闸门',
  /sblurObserver = new MutationObserver\(\(\) => \{\n\s*if \(sbraf\) return;/.test(CLIENT)
  && CLIENT.includes('const sbrun = () => {'))
ok('A4 ?mpwperf=off 在 apply() 的幂等守卫**之后**（守卫语义不变）且直接 return',
  /__mpwAppliedOnce = 1;\s*\n\s*\/\* ①\(P1A 对照组/.test(CLIENT)
  && /get\("mpwperf"\) === "off"\)/.test(CLIENT))
ok('A5 docs/DIAGNOSTICS.md 已登记 mpwperf=off', DIAG.includes('mpwperf'))

console.log('== B 组：行为（闸门拦下 / 补跑执行）==')
let w = boot()
const H = globalThis.__mpwHeavyTest
ok('B0 __mpwHeavyTest 出口就位（state/gate/flushNow）', !!H && typeof H.gate === 'function' && typeof H.flushNow === 'function' && typeof H.state === 'function')
// 动画在跑：闸门必须拦下（重活零执行 = 零 getBoundingClientRect）
const RUN1 = () => [{ playState: 'running', effect: { getTiming: () => ({ iterations: 1 }) } }]
const FINISHED = () => [{ playState: 'finished', effect: { getTiming: () => ({ iterations: 1 }) } }]
const INFINITE = () => [{ playState: 'running', effect: { getTiming: () => ({ iterations: Infinity }) } }]
w.__anims = RUN1()
let ran = 0
const job = () => { rects++; ran++ }
const allowed = H.gate('probe-job', job)
ok('B1 动画在跑 ⇒ 闸门拦下（返回 false）且重活零执行（零 getBoundingClientRect）',
  allowed === false && rects === 0 && ran === 0, 'allowed=' + allowed + ' rects=' + rects)
ok('B1b 拦下的活已登记 + 400ms 补跑定时器就位',
  H.state().pending.indexOf('probe-job') >= 0 && H.state().timer === true, JSON.stringify(H.state()))
// 动画停：flushNow 补跑（显式路径）
w.__anims = []
const n = H.flushNow()
ok('B2 动画停 ⇒ flushNow 补跑执行（账目清空）', n === 1 && ran === 1 && rects === 1 && H.state().pending.length === 0 && H.state().timer === false, 'ran=' + ran + ' rects=' + rects)
// 动画在跑 → 静静等真实 400ms 定时器 ⇒ 自动补跑
w.__anims = RUN1()
H.gate('probe-job-2', job)
ok('B2b 第二次登记 + 定时器在', H.state().pending.indexOf('probe-job-2') >= 0 && H.state().timer === true)
await new Promise((r) => setTimeout(r, 600))
ok('B3 真实 400ms 定时器到点 ⇒ 补跑自动执行、账目清空', ran === 2 && H.state().pending.length === 0 && H.state().timer === false, 'ran=' + ran)
// 动画没在跑：闸门恒放行（正常路径零开销语义）
w.__anims = []
const allowed2 = H.gate('probe-job-3', job)
ok('B4 动画停 ⇒ gate 直接放行（调用方当场执行，不进补跑账目）', allowed2 === true && H.state().pending.length === 0)
/* ②(2026-10-05 真机回归) 判据必须区分"真在跑"与"只是留在动画表里"，并保证闸门**不会把功能饿死**：
   真机现场是四个弹层全部丢掉兜底底（只剩宿主的不透明白底 + 我们的 blur = "白色滤镜没有玻璃"），
   根因就是旧判据把 finished / 无限循环动画也当成"在动画"⇒ 登记后永不放行。 */
w.__anims = FINISHED()
ok('B5 finished 动画（CSS fill:forwards 会留在动画表里）不算"在跑"⇒ 闸门直接放行',
  H.animRunning() === false && H.gate('probe-job-4', job) === true, 'animRunning=' + H.animRunning())
w.__anims = INFINITE()
ok('B6 无限循环动画（光标闪烁/转圈：永不结束）不算"在跑"⇒ 闸门直接放行（旧写法会永久饿死所有重活）',
  H.animRunning() === false && H.gate('probe-job-5', job) === true, 'animRunning=' + H.animRunning())
w.__anims = RUN1()
let streakAllows = 0
for (let i = 0; i < 6; i++) { if (H.gate('probe-job-6-' + i, job) === true) streakAllows++ }
ok('B7 兜底：连续推迟到上限后**无条件放行一次**（宁可多跑一次重活，也不能永久饿死）',
  streakAllows >= 1, '放行次数=' + streakAllows)
w.__anims = []

console.log('== C 组：?mpwperf=off（apply 直接 return）==')
boot(null, '?mpwperf=off')
ok('C1 mpwperf=off ⇒ applyInner 未执行（__mpwGlobalWired/__mpwNowPlaying/__mpwStyleWatch 等\n    全部缺席 = 全局接线、观察器、壁纸一个都没装；__mpwSectionTest 等模块级钩子本来就在，不算数）',
  globalThis.__mpwGlobalWired === undefined && globalThis.__mpwNowPlaying === undefined && globalThis.__mpwStyleWatch === undefined)
boot(null, '')
ok('C2 不带参数 ⇒ 一切照旧（钩子都在）', !!globalThis.__mpwSectionTest && !!globalThis.__mpwPersist && !!globalThis.__mpwHeavyTest)

console.log('== D 组：变异自证（真源零改动）==')
{
  const mutPath = patchCopy([
    ['function mpwHeavyAnimRunning() {', 'function mpwHeavyAnimRunning() { return false; // 变异：恒放行'],
  ])
  reset()
  const mw = loadPlugin({ quiet: true, clientPath: mutPath, settings: { enabled: true, image: 'stub-wallpaper.png' }, search: '' })
  const MH = globalThis.__mpwHeavyTest
  mw.__anims = [{ fake: 1 }]
  let mutRan = 0
  const allowedMut = MH ? MH.gate('probe-job', () => { mutRan++ }) : null
  ok('D1 闸门改"恒放行" ⇒ B1 必红：动画在跑也放行（放行后重活由调用方当场执行）',
    allowedMut === true, 'allowed=' + allowedMut)
  ok('D2 变异后补跑账目恒空（登记路径被绕过 ⇒ B1b 必红）', MH && MH.state().pending.length === 0 && MH.state().timer === false)
}
reset()

console.log(`\n===== anim-guard: ${pass} 通过 / ${fail} 失败 =====`)
if (!fail) console.log('✓ P1B 收口：动画期间全文档扫描类重活为零（闸门 + 补跑），?mpwperf=off 测量对照档就位')
process.exit(fail ? 1 : 0)

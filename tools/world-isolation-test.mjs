#!/usr/bin/env node
/**
 * world-isolation-test.mjs —— 无浏览器门禁的**世界隔离**判据（顺序/负载无关）
 *
 * 来历（2026-09-25，check.sh 第 2 步 `exit=1` 的真根因）：
 *   `tools/np-control-test.mjs` 单独跑 106 通过 / 0 失败，进门禁却是 105/1 ——
 *   `V4 曲目档 prev 两次 ⇒ 从 2/6 回到 6/6 …且壁纸媒体零变化  — idx=5 video.src=null plays=0→1`。
 *   同一个脚本、同一个 cwd：差别只在**墙钟**（前面步骤把机器弄慢/弄热）⇒ 典型的"顺序/环境敏感"。
 *
 *   根因不在 lib/client.js 的行为，而在**桩的世界模型**：一次 `loadPlugin()` 就是一个"世界"
 *   （新 document / 新 localStorage / 独立求值的 client.js），但 `tools/_stub.mjs` 只换全局对象，
 *   **没让上一个世界停下来**。于是上一个世界排的定时器（补挂校验 1.2s / 12s、boot 3.5s、
 *   np 台账 249ms、系统媒体 2s、rAF 链 ……）还在跑，触发时读到的是**新世界**的全局：
 *     · `bgElements()` 走全局 `document`（lib/client.js:3103-3111）⇒ 打到新世界的 `<video>`；
 *     · `readSection()` 有模块级 `sectionCache`（lib/client.js:673-685）⇒ 旧世界仍按**自己**的
 *       image/mpkgKey 判定"有源但没挂上"，于是 `applyFromStorageInner()` 把**旧壁纸**挂到新世界上，
 *       顺带 `video.play()` —— V4 的 `plays=0→1` 就是这么来的（门禁日志里紧挨着的那条
 *       `[dsh-mpkg-wallpaper] 检测到有壁纸源但媒体未挂上 → 补一次: host:?custom=1&folder=3582362359…`
 *       正是旧世界那条 1.2s 快判，签名还是**旧档位**的 mp4）。
 *
 * 修法（不动生产行为，改桩）：`tools/_stub.mjs` 把六个定时器标识符作为**参数**注入被求值的插件源码
 *   ⇒ 每个世界一张表；新世界开始时把上一世界**还没触发**的定时器全部取消（真浏览器语义：换页 ⇒
 *   旧页的定时器随文档一起消失）。用例自己的 sleep/wait 走全局 setTimeout，不受影响。
 *
 * 本文件是那条修法的**常驻判据**：
 *   · 造一个"会排 1.2s 补挂"的旧世界（mp4 档、apply 时媒体还没 src），紧接着造新世界；
 *   · 新世界自己放一枚 `#mpw-bgVideo`（没有 src）+ `#mpw-bgWrap`（= 旧世界最想补挂的那种现场）；
 *   · 等过 1.2s 的期限，断言旧世界**一个动作都没落到**新世界上（play 0 次 / src 仍空 / 0 条旧签名告警）。
 *   · 控制项：新世界**自己**的定时器必须照常触发（抑制不许退化成"把定时器整个停掉"）。
 *
 * 变异自证（去掉守卫 ⇒ 必红，跑在子进程里）：
 *   `node tools/world-isolation-test.mjs --no-isolate` ⇒ 关掉隔离，同一现场必须抓到旧世界的
 *   补挂落到新世界（cancelled=0 / play=1 / 旧签名告警 1 条），而**控制项仍然绿**（证明变异是定点的）。
 *
 * 用法：
 *   node tools/world-isolation-test.mjs                # 判据（隔离在位 ⇒ 全绿）
 *   node tools/world-isolation-test.mjs --no-isolate   # 变异跑（必须红）
 */
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadPlugin, worldIsolationStats } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ISOLATE = !process.argv.includes('--no-isolate')
let pass = 0, fail = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const VIDEO_SECTION = {
  enabled: true, image: 'host:?custom=1&folder=3582362359&file=Mid-Autumn%20Hoshino.mp4',
  converted: 'mp4', mpkgKey: 'custom|3582362359', mpkgName: 'Hoshino', mute: false,
  info: { title: 'Hoshino' },
}
/* 新世界用"总开关关"的档：插件自己的补挂校验第一行就返回（该档位不挂是对的）⇒ 现场里只可能剩下
   **旧世界**的动作。这样"新世界的 video 有没有被动过"就是一条无噪声的判据。 */
const QUIET_SECTION = { enabled: false }

console.log('[world-isolation] 门禁桩的世界隔离：旧世界的定时器不许打到新世界的 DOM 上'
  + (ISOLATE ? '' : '（--no-isolate 变异跑：必须红）'))

/* ── 世界 1：mp4 档 apply（排下 1.2s 快判"有源但媒体没挂上 ⇒ 补一次"） ── */
/* 插件自带的幂等守卫（注册/加载/apply 各一枚）必须清掉，否则第二个世界注册不上 —— 与
   tools/np-control-test.mjs / tools/props-panel-wiring-test.mjs 同一套守卫清单。 */
function freshWorld(settings) {
  for (const k of ['__mpwAppliedOnce', '__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds',
    '__mpwRegisterErr', '__mpwNpTest', '__mpwSectionTest', '__mpwNowPlaying', '__mpwNpOwnsSound',
    '__mpwGlobalWired', '__mpwBgWrapState', '__mpwBgSrcHeal']) { try { delete globalThis[k] } catch { /* ignore */ } }
  return loadPlugin({ settings, quiet: true, isolateWorlds: ISOLATE })
}
const w1 = freshWorld(VIDEO_SECTION)

/* ── 世界 2：紧接着换代（真机语义 = 换页；旧页的定时器此刻应当全部消失） ── */
const w2 = freshWorld(QUIET_SECTION)
const retired = Number(w2.world.retiredFromPrev || 0)

/* ── 新世界的现场：一枚没有 src 的壁纸 <video>（旧世界最想"补挂"的目标） ── */
const doc = globalThis.document
const wrap = doc.createElement('div'); wrap.id = 'mpw-bgWrap'
const video = doc.createElement('video'); video.id = 'mpw-bgVideo'
video.setAttribute('class', 'mpw-bgVideo')
video.paused = true; video.volume = 1; video.muted = true; video.readyState = 4; video.duration = 20
video.__plays = 0; video.__pauses = 0
video.play = function () { video.__plays++; video.paused = false; return { catch() {} } }
video.pause = function () { video.__pauses++; video.paused = true }
wrap.appendChild(video)
doc.body.appendChild(wrap)

/* 新世界**自己**的定时器（控制项）：同一张表、同一个入口，必须照常触发 */
let ownTick = 0
w2.world.setTimeout(() => { ownTick++ }, 20)

/* ── 收录告警：旧世界补挂时打的那条 warn 带着**旧档位**的签名（sectionCache 所致） ── */
const warns = []
const realWarn = console.warn
console.warn = (...a) => { warns.push(a.map((x) => (x && x.message) || String(x)).join(' ')) }
const leakWarns = () => warns.filter((l) => l.indexOf('补一次') >= 0 && l.indexOf('3582362359') >= 0)

/* 等过 1.2s 的期限（旧世界那条快判的 deadline）——隔离在位 ⇒ 它已经被取消，等多久都不动 */
await sleep(1400)
console.warn = realWarn

const st = worldIsolationStats()
console.log('  · 换代读数：取消上一世界定时器 ' + retired + ' 条；新世界定时器 pending=' + st.pending
  + ' fired=' + st.fired + '；新世界壁纸 play=' + video.__plays + ' src=' + JSON.stringify(video.getAttribute('src')))
console.log('  · 旧签名告警 ' + leakWarns().length + ' 条' + (leakWarns().length ? '：' + leakWarns()[0] : ''))

/* ── L1 换代真的把旧世界的定时器取消了（不是"恰好还没到点"） ── */
check('L1 换代（新世界开始）取消了上一个世界未触发的定时器', retired >= 1, 'retired=' + retired + '（旧世界排了快判 1.2s / 慢判 12s）')

/* ── L2 旧世界一个动作都没落到新世界的壁纸媒体上 ── */
check('L2 新世界的壁纸媒体零动作（play 0 次 / src 仍为空 / 没被 pause 过）',
  video.__plays === 0 && video.__pauses === 0 && !video.getAttribute('src'),
  'plays=' + video.__plays + ' pauses=' + video.__pauses + ' src=' + JSON.stringify(video.getAttribute('src')))

/* ── L3 没有"旧档位补挂到新世界"的告警（签名里带旧世界的 image） ── */
check('L3 没有旧档位（3582362359 / Mid-Autumn）的补挂告警', leakWarns().length === 0,
  '旧签名告警=' + leakWarns().length)

/* ── L4 控制项：新世界自己的定时器照常触发（抑制 == 停掉所有定时器就错了） ── */
check('L4 控制项：新世界自己的定时器照常触发（隔离不是"停掉一切"）', ownTick === 1, 'ownTick=' + ownTick + ' fired=' + st.fired)

/* ── 变异自证：把隔离关掉，同一现场必须红（定点红：L1..L3 红、L4 绿） ── */
if (ISOLATE) {
  console.log('\n== 变异自证：把隔离关掉（isolateWorlds:false）⇒ 上面的判据必须红 ==')
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--no-isolate'], { encoding: 'utf8' })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const reds = [...new Set([...out.matchAll(/✗ (L\d)/g)].map((m) => m[1]))].sort()
  const greens = [...new Set([...out.matchAll(/✓ (L\d)/g)].map((m) => m[1]))].sort()
  check('M 变异 --no-isolate：子进程必红，且红的正是 L1/L2/L3（定点，不是"全红"）',
    r.status === 1 && reds.join(',') === 'L1,L2,L3' && greens.join(',') === 'L4',
    'exit=' + r.status + ' 红=[' + reds.join(',') + '] 绿=[' + greens.join(',') + ']')
  const leakLine = (out.match(/新世界壁纸 play=\d+[^\n]*/) || [''])[0]
  check('M 变异读数：关掉隔离后旧世界真的补挂了（证据：play 从 0 变 1 + 旧签名告警）',
    /play=1/.test(leakLine) && /旧签名告警 1 条/.test(out),
    leakLine.trim())
} else {
  console.log('\n（--no-isolate 变异跑：上面 L1..L3 应当红、L4 应当绿 —— 由父进程核对）')
}

console.log('\n' + (fail === 0 ? '✓ 世界隔离判据通过' : '✗ 世界隔离判据失败') + '：通过 ' + pass + ' / 失败 ' + fail)
if (fails.length) console.log('  失败清单：\n   - ' + fails.join('\n   - '))
process.exit(fail === 0 ? 0 : 1)

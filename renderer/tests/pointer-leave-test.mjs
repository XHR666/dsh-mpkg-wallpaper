// pointer-leave-test.mjs —— ①(§7-H 2026-09-18) 台账缺口：**指针离开画布后，lockToPointer 发射器还在不在发射**
//
// 缺口原文（§7-H）："当指针**离开**画布/舞台后，发射器可能**仍在发射**（把已离开的坐标继续喂给壁纸），
//   我们**没有**一条回归断言把'离开后不再发射'钉死。"
//
// 本文件把这条钉死，方法是**假 DOM + 假事件目标 + mock-GL**（写法与 `tests/mock-gl-test.mjs` 同源：
//   同一仓库、同一 createRenderer 入口、同一个假 canvas/gl 代理），把渲染器真源码切出来跑真帧：
//
//   ① 绿前提（没有它后面的红没有意义）：画布内 `pointermove` ⇒ 发射器**确实发射**，且基准点 = 按
//      "画布归一化 × 相机取景窗口"换算出的**设计坐标**（用"画布正中 ⇒ 投影中心"这个与取景无关的
//      不变量钉死 x/y，而不是把 `__pointerDesignFromNorm` 的公式抄一遍）；
//   ② 核心：`pointerleave` ⇒ 之后**不再新增发射**（累计发射计数冻结；连续 3 帧、每帧推进时间）；
//      ①(P-121) **等价"离开"路径**同一条语义：画布 `pointerout`（relatedTarget=null / 画布外）、
//      页面级 `blur`（窗口失焦）与 `visibilitychange`（切标签）⇒ 同样冻结；且 `focus`/`visible`
//      回来时若指针仍在画布内 ⇒ **继续发射**（不许把"临时失焦"误判成"永久停发"）；
//   ③ 反假绿：再派发一次 `pointermove` ⇒ **恢复发射**（防止有人把功能整个关掉来"通过"）；
//   ④ 不误伤：同帧里**非锁定**粒子层照常发射（离开门只作用在 lockToPointer 发射器上）；
//      `pointerout` 的 relatedTarget 落在画布**内部**子元素时也不许停发（G2a）。
//
// ── 依据（本测试只读渲染器；P-118 的三处修改与 P-121 的两条"等价离开"都已由本文件钉死 + 内置变异复核）──
//   （行号为 **P-121 后**的当前值；括号里是 P-118 落地时的行号，便于对照 git 历史）
//   · `core/we-scene-bundle.js:6827 __hookPointer()`（P-118 时 :6640）：在 `gl.canvas` 上装四个监听
//     ——`pointermove`/`pointerdown`（记录归一坐标、清"已离开"）、`pointerleave`（:6844）与
//     **`pointerout`（:6850，P-121 新增）**：`relatedTarget == null` 或落在画布外 ⇒ 同一个
//     `__pointerLeave(why)`（:6776）＝ `__pointerN = null; __pointerGone = true` + 记下那一刻注入值的指纹；
//   · `core/we-scene-bundle.js:6808 __hookPageLeave()`（P-121 新增）：挂在 `window`（blur/focus）与
//     `document`（visibilitychange）上，**幂等 + 目标可变**（一开始没有 window/document 也能后补装上）；
//     `blur`/`hidden` ⇒ `__pointerSuspend`（保留 `__pointerN`），`focus`/`visible` ⇒ `__pointerResume`
//     （焦点回来时若指针仍在画布内 ⇒ 立刻继续发射）；`__pointerDesign` 首行 :6884 判挂起 ⇒ 两条通道一起让路；
//   · `core/we-scene-bundle.js:6865`（建渲染器即调，**自举**）/ `:9956`（每层帧内幂等兜底）：
//     `if (!CURSOR_OFF) __hookPointer()`，紧随其后 `:6868` / `:9958` 是 `__hookPageLeave()`；
//     钩子安装**不再**挂在"本帧已经有指针"上（P-118 G4）；
//   · `core/we-scene-bundle.js:6892 __pointerDesign(cam)`（P-118 时 :6677）：指针来源优先级 =
//     P-121 页面级挂起 ⇒ null > `window.__mpwPointer` 注入（`inside === false` ⇒ 直接 null，P-118 G5）>
//     画布归一坐标 `__pointerN`；注入值与 pointerleave 那一刻**同一份**（同对象 + 同指纹）⇒ 也 null（P-118 G1）；
//   · `spawnParticle`：`em.__ptrLocked && !sys.pointer` ⇒ **不发射**（`sys.__ptrSkipped++`）。这就是"离开后停发"的落点。
//
// ── 用法 ─────────────────────────────────────────────────────────────────────────────────
//   node tests/pointer-leave-test.mjs [--only <名字子串>]... [--no-mutation] [--verbose]
//     --only <子串>   只跑名字含该子串的断言（可多次；一个都没匹配到 ⇒ 用法错误退出 2）
//     --no-mutation   跳过内置的"红-if-reverted"自检（见下）
//     --verbose       额外打印每帧台账（监听集合 / sys.pointer / 累计发射 / __ptrSkipped）
//   环境变量：
//     MPW_ROOT              工作区根（默认 = 仓库的上一级，WS）—— 只用于真包条件项
//     MPW_POINTER_BUNDLE    备用渲染器**副本**的绝对路径（内置红-if-reverted 用它拉变异体；
//                           平时不要设，设了就等于"测的是副本"）
//   退出码：0 = 全过（含 SKIP / XFAIL）；1 = 有真失败；2 = 用法错误。
//
// ── 条件项约定（不许假绿）────────────────────────────────────────────────────────────────
//   · 缺语料/夹具 ⇒ 打 `SKIP pointer-leave <条目> — <原因>`，**不计票**，不影响退出码；
//     本文件唯一依赖外部数据的是「E 真包」一节（`$MPW_ROOT/allwallpaper/dd/3554161528/scene.pkg`）。
//   · 另一种条件项 = 内置红-if-reverted 的**变异锚点**：若核心那几行被并行线改写导致锚点不命中，
//     打 `SKIP pointer-leave mutation-selfcheck — …`（不计票），绝不把"没法变异"伪装成"变异通过"。
//   · **XFAIL 不计入 pass**（单独计数、结尾单独打印）：用于"记录当前真实行为"的已知缺口（见下）。
//     缺口被修好时它会打 `★ XPASS`，提示把该条改成正断言 —— 两个方向都出声，不会静默。
//
// ── 已知缺口台账（XFAIL 单独计票；修好会打 XPASS 提示改成正断言）────────────────────────────
//   ★ P-118 已闭合的三条（原为 XFAIL，现为真断言，见 G1/G4/G5 断言与 M 阶段变异）：
//   G1 注入通道曾**盖过**画布 `pointerleave`：`__pointerDesign` 先看注入 ⇒ 宿主按"每次 pointermove
//      就写注入值"这种自然写法喂坐标时，指针离开画布后发射器**继续在旧坐标发射**（修复前实测：
//      离开后累计 39→54、基准点仍是 (800,400)）。修法见 `core/we-scene-bundle.js:6897`（注入值与
//      离开那一刻同一份 ⇒ 无指针）。⚠ 同一发 `pointerleave` 在注入撤掉后立刻生效（G1b）⇒ 事件确实到达。
//   G5 `inside:false` 曾**不是"指针不在"**，只是"别信注入值"：注入被丢弃后回落到上一次画布内
//      pointermove 的归一坐标 ⇒ 宿主声明"离开"后继续在旧坐标发射（修复前实测：189→276、仍 (1440,810)）。
//      修法见 `core/we-scene-bundle.js:6892`（显式 inside:false ⇒ 直接 null，不回落）。
//   G4 **自举死锁（原最重）**：`__hookPointer()` 曾经只在 `__ptrNow` 为真时被调用，而 `__ptrNow` 只能
//      来自"注入"或"钩子已经装好"⇒ 页面不注入就永远装不上钩子。全仓库 grep：`__mpwPointer` 的
//      生产者**只有 bundle 自身**（`demo.html` 的 window pointermove 是日志面板拖动，不是它）
//      ⇒ 出货页面（`demo.html` → `./bundle.js` = core/we-scene-bundle.js）里 lockToPointer 发射器
//      **一次都不发射**（"鼠标拖尾"整条特性是死的）。修法见 `core/we-scene-bundle.js:6865`（建渲染器
//      即装钩子）+ `:9956`（帧内幂等兜底）；`?cursor=off` 逃生口语义不变（不装、也不发射，D4 钉住）。
//   ★ **P-121 已闭合的两条**（原为 XFAIL，现为真断言，见 G2/G3 断言与 M5～M8 变异）：
//   G2 只监听 `pointerleave`、**不监听** `pointerout`（+relatedTarget=null）等价路径 ⇒
//      "切窗口/系统弹窗时只发 pointerout"的实现下发射器继续在旧坐标发射（修复前实测：
//      `pointerout` 派发命中 **0** 个监听器、离开后累计 157→173）。修法见 `core/we-scene-bundle.js:6850`
//      （`__pointerLeave('pointerout(null)')`）；同时用 `contains` 排除"relatedTarget 在画布内"
//      （pointerout 会从子元素冒泡）⇒ G2a 钉住"不误伤"。
//   G3 完全不碰 `blur`/`visibilitychange`，也没有 window/document 级监听 ⇒ 切窗口/切标签后仍发射
//      （修复前实测：blur 命中 0 个、累计 173→189）。修法见 `core/we-scene-bundle.js:6808 __hookPageLeave()`
//      + `:6884`（挂起时 `__pointerDesign` 直接 null）。**恢复面**一并钉住：focus / visible 回来后
//      指针仍在画布内 ⇒ 继续发射（G3b/G3d，M8 是"失焦后永久停发"的变异）；失焦期间指针真离开画布
//      ⇒ 回来也不许凭空喂旧坐标（G3e）。
//   ── 当前**没有**开着的缺口（xfail 计数 = 0）；这个记账机制保留：将来发现等效路径就照 G2/G3 的样子登记。
//
// ── 内置红-if-reverted（真跑到；8 个变异，见下方 `M-…` 断言）────────────────────────────────
//   把 `core/` 整目录复制进 `mkdtemp` 临时目录（**绝不改真树**；副本里是**真文件不是软链**，
//   否则 ESM 会把软链解析回真树、变异白做），对副本做**每处修复各一条**的最小"改回旧写法"变异后，
//   用 `MPW_POINTER_BUNDLE=<副本>` 起一个子进程跑本文件，要求：子进程 rc=1 且**对应的那条断言变红**。
//     M1（G4 旧写法）：删掉建渲染器时的自举调用 + 帧内改回 `if (!CURSOR_OFF && __ptrNow) …` ⇒ `G4b` 红
//     M2（G1 旧写法）：注入分支去掉"与离开那一刻同一份"判定 ⇒ `G1` 红
//     M3（G5 旧写法）：去掉 `inside === false ⇒ null` 并把 `inside !== false` 加回条件 ⇒ `G5` 红（`D1b` 仍 ✓）
//     M4（P-118 核心语义）：`pointerleave` 处理器改成空操作 ⇒ `P3a` 红
//     M5（P-121 G2）：删掉画布 `pointerout` 监听 ⇒ `G2c` 红
//     M6（P-121 G3）：删掉 window `blur` 监听 ⇒ `G3a` 红
//     M7（P-121 G3）：删掉 document `visibilitychange` 监听 ⇒ `G3c` 红
//     M8（P-121 G3 恢复面）：删掉 window `focus` 监听 ⇒ `G3b` 红（"修好一个 bug 造出另一个"的反例）
//   八个变异都实测：子进程 rc=1、失败断言就是上面点名的那个，且 `A3a`/`P4a`（绿前提与恢复发射）
//   在变异体里仍为 ✓ ⇒ 变异只打破被点名的那条语义，不是把整条路弄挂。
//   锚点未命中 ⇒ 打 `SKIP pointer-leave mutation-selfcheck`（不计票），绝不把"没法变异"伪装成"变异通过"。
//   退出时 `rmSync` 清理临时目录。
//
// ── 本轮实测证据（本机：Node 24 + mock-GL + 假 DOM，无 GPU/WebGL2）──────────────────────
//   · `node tests/pointer-leave-test.mjs` ⇒ rc=0，`ALL PASS （64 项，缺口 0）`（真树
//     `core/we-scene-bundle.js` sha256 = c7d6d5a4b0732bc9ee1d30c43a7a624de997a090228ab2541ad8af0533c9fbc1）；
//     其中 16 项是内置红-if-reverted 自检（8 个变异 × 「必红 + 绿前提仍成立」）。
//   · P-118 修复前 → 后三条（同一命令 `--only`）：
//     G4：`派发命中 0 个监听器 / alive=0` → `监听在首帧前已装、alive=8、基准点 (960,540)`；
//     G1：`离开后累计 39→54、基准点 (800,400)` → `39→39、基准点 null`；
//     G5：`inside:false 后累计 189→276、基准点 (1440,810)` → `189→189、基准点 null`。
//   · P-121 修复前 → 后两条（XFAIL → 真断言；G2 157→173、G3 173→189 都在旧计数上）：
//     G2：`pointerout 命中 0 个监听器` → `命中 1 个、离开后累计 347→347、ptr=null`（G2a/G2b 另钉两个方向）；
//     G3：`win/doc 零监听` → `{"win":["blur","focus"],"doc":["visibilitychange"]}`；blur 475→475、
//         focus 恢复 475→626 且基准点仍 (640,480)、hidden 785→785、visible 785→968、
//         失焦期间离开画布后 focus 回来 968→968（G3e）。
//   · 关键数字：画布内 move(480,270) ⇒ 基准点 (480.0000,270.0000)、层累计 24→55；
//     pointerleave 后 3 帧累计 55,55,55（冻结）、alive=0,0,0、`__ptrSkipped`=6（被"无指针"门拦下）；
//     重新 move(1440,810) ⇒ 累计 55→118（恢复）。
//   · 真包（3554161528）id389 `cherry blossoms on cursor`：pointerCp=0、全部发射器挂指针；
//     无指针 0 粒（`__ptrSkipped`=60）、指针 (800,400) ⇒ 19 粒、max|Δx|=3.0 max|Δy|=2.7。
//   · ⚠ 真机鼠标时序**未测**（无浏览器/X11，硬约束）：`pointerleave`/`pointerout` 与最后一发
//     `pointermove` 的真实先后、真机 `blur`/`visibilitychange` 的触发时机、以及"鼠标离开画布后
//     宿主是否仍在写 `__mpwPointer`"都只有合成事件证据。
//
// ── 注册待办 ─────────────────────────────────────────────────────────────────────────────
//   注册待办：`add "pointer-leave" "node tests/pointer-leave-test.mjs"`（等 run-all-tests.sh 释放后加）
//   —— 本轮 `tests/run-all-tests.sh` 被另一条线占用（dirty），按纪律**不改它**。
//
// 参照来源许可声明：本文件为原创测试代码，不含第三方实现代码（未复制/未翻译 wer-ref、we-layerd-ref、
//   oneincase/webwallgl）；假 DOM/mock-GL 写法取自**同一仓库**的 tests/mock-gl-test.mjs。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

// ═══════════════════════════ 0. 用法/参数/退出码 ═══════════════════════════
const USAGE = `用法：node tests/pointer-leave-test.mjs [--only <名字子串>]... [--no-mutation] [--verbose]
  --only <子串>   只跑名字含该子串的断言（可多次）
  --no-mutation   跳过内置红-if-reverted 自检
  --verbose       打印每帧台账
退出码：0 全过（含 SKIP/XFAIL）/ 1 有失败 / 2 用法错误`
function usage(msg) { console.error('用法错误：' + msg + '\n' + USAGE); process.exit(2) }
const argv = process.argv.slice(2)
const ONLY = []
let VERBOSE = false, MUTATION = true
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--only') { const v = argv[++i]; if (!v || v.startsWith('--')) usage('--only 后面要跟名字子串'); ONLY.push(v) }
  else if (a === '--no-mutation') MUTATION = false
  else if (a === '--verbose') VERBOSE = true
  else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0) }
  else usage('未知参数 ' + a)
}
const want = (name) => ONLY.length === 0 || ONLY.some((s) => name.includes(s))

// ═══════════════════════════ 1. 真断言助手（真实计票）═══════════════════════════
let pass = 0, fail = 0, skip = 0, xfail = 0, xpass = 0
const failNames = []
const ok = (name, cond, detail) => {
  if (!want(name)) return
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; failNames.push(name); console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const note = (name, detail) => { if (want(name)) console.log('  · ' + name + (detail ? '  [' + detail + ']' : '')) }
const skipItem = (name, reason) => { if (want(name)) { skip++; console.log('  SKIP pointer-leave ' + name + ' — ' + reason) } }
// XFAIL：cond = **期望语义**（当前还没做到 ⇒ 记缺口、不计票）；做到了 ⇒ XPASS，同样不计票但大声报。
const xfailItem = (name, cond, detail) => {
  if (!want(name)) return
  if (cond) { xpass++; console.log('  ★ XPASS（缺口已闭合 ⇒ 请把这条改成 ok() 正断言） ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { xfail++; console.log('  ! XFAIL（已知缺口·不计票） ' + name + (detail ? '  — ' + detail : '')) }
}

// ═══════════════════════════ 2. 被测渲染器（默认真树；变异自检用副本）═══════════════════════════
const BUNDLE = process.env.MPW_POINTER_BUNDLE
  ? path.resolve(process.env.MPW_POINTER_BUNDLE)
  : path.join(ROOT, 'core', 'we-scene-bundle.js')
if (!fs.existsSync(BUNDLE)) usage('渲染器文件不存在：' + BUNDLE)
const IS_MUTANT_RUN = !!process.env.MPW_POINTER_BUNDLE
const lib = await import(pathToFileURL(BUNDLE).href)

// ═══════════════════════════ 3. 假 canvas / 假事件目标 / mock-GL ═══════════════════════════
const FRAME = 1 / 30
const RW = 1920, RH = 1080                 // 渲染尺寸 = 设计画布 = 假 canvas 的 CSS 尺寸（1:1 映射）
const LOCKED_ID = 9001, FREE_ID = 9002     // 9001 = lockToPointer 层；9002 = 普通层（对照）

const CONST = {
  LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0,
}
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i

/** ①(P-121 B-G3) 造一个"假**页面**目标"（window/document 的最小事件目标）：只记监听器，可按类型派发。
 *  与画布分开记 —— 页面级事件（blur/focus/visibilitychange）本来就不该派发到画布上。 */
function makePageTarget(extra) {
  const listeners = new Map()
  return Object.assign({
    __listeners: listeners,
    addEventListener: (t, fn) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn) },
    removeEventListener: (t, fn) => { const a = listeners.get(t) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1) },
  }, extra || {})
}

/** 造一台"假事件目标画布 + mock-GL + 真 createRenderer"的台子。每个台子一个独立 renderer/粒子缓存。 */
function makeRig(tag) {
  const logs = []
  const fired = []
  const pageFired = []
  const listeners = new Map()
  const draws = []
  const rect = { left: 0, top: 0, width: RW, height: RH, right: RW, bottom: RH, x: 0, y: 0 }
  // ①(P-121) 页面级假目标：window（blur/focus）+ document（visibilitychange；带 hidden/visibilityState）
  const win = makePageTarget({})
  const doc = makePageTarget({ hidden: false, visibilityState: 'visible' })
  let ids = 0, curUnit = 0, curProg = null
  const mk = (k) => ({ id: k + '#' + (++ids) })
  const innerEl = { id: 'inner-child' }       // 画布**内部**元素（pointerout 冒泡时 relatedTarget 可能是它）
  const outsideEl = { id: 'outside-el' }      // 画布**外部**元素
  const canvas = {
    width: RW, height: RH, clientWidth: RW, clientHeight: RH, style: {},
    getContext: () => gl,
    getBoundingClientRect: () => rect,
    setAttribute: () => {},
    // 真 canvas 元素有 contains（pointerout 的"relatedTarget 在不在画布内"判定要用它）
    contains: (n) => n === canvas || n === innerEl,
    addEventListener: (t, fn) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn) },
    removeEventListener: (t, fn) => { const a = listeners.get(t) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1) },
  }
  const handlers = {
    canvas,                                    // ← 关键：gl.canvas 必须是"有 addEventListener 的元素"，否则钩子装不上
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'),
    createVertexArray: () => mk('vao'), createShader: () => mk('sh'), createProgram: () => mk('prog'),
    activeTexture: (u) => { curUnit = u }, useProgram: (p) => { curProg = p },
    drawArrays: (m, f, c) => draws.push({ prog: curProg && curProg.id, count: c }),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true
      : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : n === 'a_TexCoordB' ? 2 : n === 'a_Blend' ? 3 : n === 'a_Alpha' ? 4 : -1,
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true,
    checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE, getError: () => CONST.NO_ERROR,
    getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0), getShaderInfoLog: () => '', getProgramInfoLog: () => '',
  }
  const gl = new Proxy({}, {
    get(t, prop) {
      if (prop in handlers) return handlers[prop]
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
      return () => {}
    },
  })
  const shaderResolver = async (rel) => (rel.endsWith('.vert')
    ? 'attribute vec3 a_Position; void main(){ gl_Position = vec4(a_Position,1.0); }'
    : 'void main(){ gl_FragColor = vec4(1.0); }')

  // 两个层用同一份发射参数，唯一差别：9001 的 def 有 `controlpoint[0].flags=1`（lockToPointer）
  // 且发射器显式挂在 cp0；9002 什么都没有（对照：不该被"离开"误伤）。
  const baseDef = (extra) => Object.assign({
    maxcount: 4000,
    emitter: [{ name: 'boxrandom', controlpoint: extra ? 0 : undefined, rate: 240, delay: 0,
      distancemin: '0 0 0', distancemax: '3 3 0', origin: '0 0 0', directions: '1 1 0', speedmin: 0, speedmax: 0 }],
    initializer: [{ name: 'lifetimerandom', min: 30, max: 30 }],   // 寿命 30s ⇒ 测试窗口内只增不减
  }, extra ? { controlpoint: [{ flags: 1, offset: '0 0 0' }] } : {})
  const mkLayer = (id, origin, def) => ({
    id, name: 'ptr-' + id, visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: null, size: [400, 400], scale: [1, 1, 1], origin, angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined, effects: [],
    particle: 'p' + id, particleDef: def, particleTexName: 'ptr_tex', parallaxDepth: null, uvRect: undefined,
  })
  // 9001 的 authored origin 故意放在画布正中 (1920,1080)：旧实现（没实现 lockToPointer 时）的
  // "中心爆"就在那里 ⇒ 断言"出生点不在 origin 附近"= 防回退。
  const scene = {
    general: { orthogonalprojection: { width: RW, height: RH } }, camera: null,
    layers: [mkLayer(LOCKED_ID, [1920, 1080, 0], baseDef(true)), mkLayer(FREE_ID, [100, 100, 0], baseDef(false))],
    properties: {},
  }
  const textures = new Map([['ptr_tex', { glTex: { id: 'ptr_tex_gl' }, width: 64, height: 64 }]])
  const cache = new Map()
  const renderer = lib.createRenderer(canvas, {
    shaderResolver, onLog: (m) => logs.push(String(m)), particleSysCache: cache,
  })

  // ── 累计发射计数：跨"粒子系统重建"也单调 ──
  // 渲染器按输入签名缓存粒子系统；指针坐标一变签名就变 ⇒ 重建 ⇒ `particles` 从 0 重放。
  // 所以不能直接看 `particles.length`（会掉回 0），要按"同一实例内的增量"累加。
  const trackers = new Map()
  const trk = (id) => {
    if (!trackers.has(id)) trackers.set(id, { sys: null, lastLen: 0, emitted: 0 })
    const t = trackers.get(id)
    return {
      sample() {
        const entry = cache.get(id)
        const sys = entry && entry.sys
        if (!sys) return { sys: null, alive: 0, emitted: t.emitted, pointer: null, skipped: 0, rebuilt: false, sig: entry && entry.sig }
        const rebuilt = sys !== t.sys
        if (rebuilt) { t.sys = sys; t.lastLen = 0 }
        const len = sys.particles ? sys.particles.length : 0
        if (len > t.lastLen) t.emitted += len - t.lastLen
        t.lastLen = len
        return { sys, alive: len, emitted: t.emitted, pointer: sys.pointer, skipped: sys.__ptrSkipped || 0, rebuilt, sig: entry.sig }
      },
      reset() { t.sys = null; t.lastLen = 0 },
    }
  }
  let t = 0, frameNo = 0
  return {
    tag, canvas, gl, cache, scene, textures, renderer, logs, draws, listeners, fired, pageFired, trk,
    win, doc, innerEl, outsideEl,
    get time() { return t },
    get frameNo() { return frameNo },
    /** 推进一帧（时间严格递增 1/30s） */
    async frame() { t += FRAME; frameNo++; return renderer.render(scene, textures, RW, RH, t) },
    /** 派发一个画布事件（只给真装上的监听器；没有监听器 = 真事件也到不了） */
    fire(type, ev) {
      const arr = listeners.get(type) || []
      fired.push({ type, n: arr.length, ev })
      for (const fn of arr) fn(ev)
      return arr.length
    },
    /** ①(P-121) 派发一个**页面级**事件（window + document；blur/focus/visibilitychange）→ 命中监听器数 */
    firePage(type, ev) {
      let n = 0
      for (const el of [win, doc]) {
        const arr = el.__listeners.get(type) || []
        n += arr.length
        for (const fn of arr) fn(ev || {})
      }
      pageFired.push({ type, n, ev })
      return n
    },
    /** 页面级监听集合（`?cursor=off` 的"一个都不装"要用它钉） */
    pageListenerNames() { return { win: [...win.__listeners.keys()], doc: [...doc.__listeners.keys()] } },
    snapshot() {
      const l = trk(LOCKED_ID).sample(), f = trk(FREE_ID).sample()
      return { t: +t.toFixed(4), listeners: [...listeners.keys()], locked: l, free: f, stats: renderer.particleStats }
    },
  }
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
/** 安全取首粒位置（粒子为空/系统缺失 ⇒ null；断言失败要可读，不要抛异常） */
const firstPos = (sys) => (sys && sys.particles && sys.particles[0] ? sys.particles[0].pos : null)
const maxDistTo = (sys, p) => (sys && sys.particles.length ? Math.max(...sys.particles.map((q) => dist(q.pos, p))) : -1)
const fmt = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : String(v))
const dump = (rig, label) => {
  if (!VERBOSE) return
  const s = rig.snapshot()
  console.log(`    [台账] ${label}: t=${s.t} 监听=${JSON.stringify(s.listeners)}`
    + ` locked{ptr=${s.locked.pointer ? s.locked.pointer.map((v) => +v.toFixed(2)).join(',') : 'null'} alive=${s.locked.alive} 累计=${s.locked.emitted} 跳过=${s.locked.skipped} 重建=${s.locked.rebuilt ? 1 : 0}}`
    + ` free{累计=${s.free.emitted} alive=${s.free.alive}} 绘制调用=${rig.draws.length}`)
}

console.log('pointer-leave-test —— §7-H：指针离开画布后不再发射（假 DOM + mock-GL；渲染器=' + path.relative(ROOT, BUNDLE) + '）')

// ═══════════════════════════ 4. A 阶段：绿前提（画布内 pointermove ⇒ 真发射 + 坐标正确）═══════════
const rig = makeRig('main')
let emittedAtLeave = 0
{
  // A0：一个指针信息都没有 —— 不发射是"前置语义"，不是本项的结论
  await rig.frame()
  const s0 = rig.snapshot(); dump(rig, 'A0 无指针')
  ok('A0a 无指针信息 ⇒ lockToPointer 层 0 粒（前置语义：没有指针就不发射）',
    s0.locked.alive === 0 && s0.locked.emitted === 0, `alive=${s0.locked.alive} 累计=${s0.locked.emitted}`)
  ok('A0b 同帧非锁定层照常发射（对照层是活的，后面的"冻结"才不是"整类关掉"）',
    s0.free.alive > 0, `free alive=${s0.free.alive}`)

  // A1：按宿主契约注入一次（注入通道本身也在这里被钉住）—— 这也是装上画布钩子的**唯一**现实路径
  globalThis.window = { __mpwPointer: { x: 960, y: 540, inside: true } }
  await rig.frame()
  const s1 = rig.snapshot(); dump(rig, 'A1 注入(960,540)')
  ok('A1a 注入通道 window.__mpwPointer=画面正中 ⇒ lockToPointer 层发射（绿前提①）',
    s1.locked.alive > 0, `alive=${s1.locked.alive}`)
  ok('A1b 发射基准点 = 注入的设计坐标 (960,540) ±0.5px',
    !!s1.locked.pointer && Math.abs(s1.locked.pointer[0] - 960) <= 0.5 && Math.abs(s1.locked.pointer[1] - 540) <= 0.5,
    'ptr=' + JSON.stringify(s1.locked.pointer))
  const L = [...rig.listeners.keys()]
  ok('A1c 画布上装上了 pointermove/pointerdown/pointerleave 三个监听（本项依赖的机制在位）',
    L.includes('pointermove') && L.includes('pointerdown') && L.includes('pointerleave'), '实测=' + JSON.stringify(L))
  const handlerCount = rig.fire('pointermove', { clientX: 960, clientY: 540, pointerId: 1, pointerType: 'mouse' })
  ok('A1d 画布 pointermove 有真监听器接（不是"发了没人听"）', handlerCount >= 1, `监听器数=${handlerCount}`)
  delete globalThis.window

  // A2：撤掉注入 + 画布内 pointermove ⇒ DOM 路径自己跑起来（坐标与画布 1:1 ⇒ 设计坐标 = client 坐标）
  await rig.frame()
  const s2 = rig.snapshot(); dump(rig, 'A2 撤注入（等 DOM 事件）')
  ok('A2a 撤掉注入后、仅靠画布事件：上一条 pointermove(960,540) 已生效 ⇒ 仍发射',
    s2.locked.alive > 0, `alive=${s2.locked.alive}`)
  ok('A2b 画布正中 ⇒ 设计坐标 = 投影中心 (960,540)（与取景窗口无关的不变量；x、y 都钉）',
    !!s2.locked.pointer && Math.abs(s2.locked.pointer[0] - 960) <= 0.05 && Math.abs(s2.locked.pointer[1] - 540) <= 0.05,
    'ptr=' + JSON.stringify(s2.locked.pointer))

  const emBefore = s2.locked.emitted
  const rc = rig.fire('pointermove', { clientX: 480, clientY: 270, pointerId: 1, pointerType: 'mouse' })
  await rig.frame()
  const s3 = rig.snapshot(); dump(rig, 'A3 画布内 move(480,270)')
  ok('A3a ★ 画布内 pointermove ⇒ 真发射（DOM 路径在跑；累计计数严格增长）',
    rc >= 1 && s3.locked.alive > 0 && s3.locked.emitted > emBefore, `累计 ${emBefore}→${s3.locked.emitted}`)
  ok('A3b ★ 发射基准点 = 该 client 点换算出的设计坐标 (480,270) ±1px（画布与帧 1:1）',
    !!s3.locked.pointer && Math.abs(s3.locked.pointer[0] - 480) <= 1 && Math.abs(s3.locked.pointer[1] - 270) <= 1,
    'ptr=' + JSON.stringify(s3.locked.pointer.map((v) => +v.toFixed(4))))
  ok('A3c 坐标方向不反：从 (960,540) 移到 (480,270) ⇒ x、y 都变小',
    !!s2.locked.pointer && !!s3.locked.pointer
      && s3.locked.pointer[0] < s2.locked.pointer[0] && s3.locked.pointer[1] < s2.locked.pointer[1],
    `${JSON.stringify(s2.locked.pointer)} → ${JSON.stringify(s3.locked.pointer)}`)
  // ①(P-136 2026-09-20 **口径收窄**，主对话批准) 判据从"**全部**存活粒子"收窄到"**本帧新生**粒子"。
  //   为什么必须收窄（不是放宽）：
  //     · 旧判据 `maxDistTo(sys, ptr)` 取**全部**存活粒子的 max —— 它等价于"粒子**不得跨指针位置存活**"，
  //       也就是"禁止任何滞后于光标的粒子"。它此前之所以是绿的，靠的是"指针坐标曾经进过粒子缓存签名
  //       ⇒ 指针一动整系统重建 ⇒ 上一帧的粒子被冲掉"这个**副作用**；那个副作用恰恰让**鼠标尾迹**
  //       在定义上不可能存在（尾迹 = 落在光标**身后**的粒子）。
  //     · 用户第 4 项明确要"鼠标尾迹"（并指示照抄上游 oneincase/webwallgl 的实现，见 THIRD-PARTY.md §14），
  //       而照抄后指针是**每帧推进的活输入**、系统只在时间轴上增量前进 ⇒ 滞后粒子**必须**存在
  //       （实测：改前"距指针最远 39.6px"→ 改后 1164.3px，见 P-136 台账）。
  //     · 所以**口径错的是旧断言，不是实现**。断言名本来就是「粒子**出生点**就在指针附近」——
  //       "出生点" = 本帧新生粒子；`firstPos()` 早就是这个意思（A3e 用的就是它）。
  //   两条口径的区别，将来要能一眼看懂：
  //     · 「**全部**粒子必须在 6px 内」= 禁止滞后粒子 ⇒ 禁止尾迹（旧口径，已废）
  //     · 「**新生**粒子在 6px 内」= 出生点正确    ⇒ 允许尾迹（新口径，本条）
  //   反向自证：变异 M9（把发射基准点从"指针"改成"层 authored origin"）⇒ 本条必红。
  //
  //   ⚠ 「本帧新生」怎么取：`stepParticles` 的次序是**先发射、再统一 `p.age += sdt`**
  //   （`core/we-scene-bundle.js` 里 `for (const p of sys.particles) p.age += sdt`），
  //   所以新生的 `age` 不是 0 而是**本步的 sdt**。同一步里出生的粒子 `age` 完全相同 ⇒
  //   "最新一代" = `age == min(age)`（这一代之外的都更老）。用 `age === 0` 会取到 0 粒（实测过）。
  const _all = (s3.locked.sys && s3.locked.sys.particles) ? s3.locked.sys.particles : []
  const _minAge = _all.length ? Math.min(..._all.map((q) => q.age)) : null
  const bornNow = _all.filter((q) => q.age <= _minAge + 1e-9)
  const mdBorn = bornNow.length ? Math.max(...bornNow.map((q) => dist(q.pos, s3.locked.pointer))) : -1
  const mdAll = maxDistTo(s3.locked.sys, s3.locked.pointer)
  const p3 = firstPos(s3.locked.sys)
  ok('A3d 粒子出生点就在指针附近（**本帧新生**粒子 max|Δ| ≤ 6px = distancemax 3 × scale 1 + 余量）',
    bornNow.length > 0 && mdBorn >= 0 && mdBorn <= 6,
    `新生 ${bornNow.length}/${_all.length} 粒（age=${_minAge != null ? _minAge.toFixed(4) : '-'}）max|Δ|=${fmt(mdBorn)}`
    + ` ｜（全部粒子的 max|Δ|=${fmt(mdAll)} —— **允许**大于 6px，那正是尾迹）`
    + ` 首粒=${p3 ? JSON.stringify(p3.map((v) => +v.toFixed(2))) : 'none'}`)
  // ①(P-136) 同一台上把"尾迹允许存在"也钉住（否则上面那条可以靠"每帧清空"假绿：
  //   清空 ⇒ 新生 == 全部 ⇒ mdBorn == mdAll，尾迹整条不存在也会绿）。这里要求**同时**满足：
  //   ① 确实存在**比新生更老**的粒子（滞后的一代还在场上）；② 全部粒子的指标显著大于新生粒子（≥20×）。
  ok('A3d2 同台上尾迹确实存在（有更老的一代仍在场上，且全部粒子 max|Δ| ≥ 新生粒子 max|Δ| 的 20×）',
    bornNow.length > 0 && bornNow.length < _all.length && mdBorn >= 0 && mdAll >= 20 * Math.max(1, mdBorn),
    `全部 max|Δ|=${fmt(mdAll)} ／ 新生 max|Δ|=${fmt(mdBorn)} = ${fmt(mdAll / Math.max(1, mdBorn), 1)}×`
    + `（更老的一代 ${_all.length - bornNow.length} 粒仍在场上）`)
  ok('A3e 出生点**不是**该层 authored origin (1920,1080)（旧"中心爆"回归：不许退回作者原点发射）',
    !!p3 && dist(p3, [1920, 1080]) > 100,
    p3 ? `到 origin 距离=${fmt(dist(p3, [1920, 1080]))}px` : '无粒子')
}

// ═══════════════════════════ 5. B 阶段：pointerleave ⇒ 不再新增发射（本项核心）═══════════════
{
  emittedAtLeave = rig.trk(LOCKED_ID).sample().emitted
  const freeBefore = rig.trk(FREE_ID).sample().emitted
  const n = rig.fire('pointerleave', { pointerId: 1, clientX: 481, clientY: 271 })
  note('B0 pointerleave 派发到 ' + n + ' 个监听器')
  const frames = []
  for (let i = 0; i < 3; i++) { await rig.frame(); const s = rig.snapshot(); dump(rig, 'B' + (i + 1) + ' 离开后'); frames.push(s) }
  const last = frames[frames.length - 1]
  ok('P3a ★★ pointerleave 后连续 3 帧**不再新增发射**（累计发射计数冻结）',
    frames.every((f) => f.locked.emitted === emittedAtLeave),
    `离开前累计=${emittedAtLeave}；离开后=${frames.map((f) => f.locked.emitted).join(',')}`)
  ok('P3b 离开后 lockToPointer 层无存活粒子（无遗留"喂着旧坐标"的粒子）',
    frames.every((f) => f.locked.alive === 0), '每帧 alive=' + frames.map((f) => f.locked.alive).join(','))
  ok('P3c 机制证据：离开后帧内指针为空，且发射尝试被"无指针"门拦下（不是速率/预算把层整个停了）',
    frames.every((f) => f.locked.pointer === null) && last.locked.skipped > 0,
    `sys.pointer=null ×3，__ptrSkipped=${last.locked.skipped}`)
  ok('P3d 离开不误伤：同 3 帧里**非锁定**层照常新增发射（门只作用在 lockToPointer 发射器上）',
    last.free.emitted > freeBefore, `free 累计 ${freeBefore}→${last.free.emitted}`)
}

// ═══════════════════════════ 6. C 阶段：重新进入 ⇒ 恢复发射（反"关掉功能"式假绿）═══════════
{
  const rc = rig.fire('pointermove', { clientX: 1440, clientY: 810, pointerId: 1, pointerType: 'mouse' })
  await rig.frame()
  const s = rig.snapshot(); dump(rig, 'C1 重新进入(1440,810)')
  ok('P4a ★★ 重新 pointermove ⇒ 恢复发射（累计计数越过离开时的水位；防止"整个关掉"来通过）',
    rc >= 1 && s.locked.alive > 0 && s.locked.emitted > emittedAtLeave,
    `累计 ${emittedAtLeave} → ${s.locked.emitted}`)
  ok('P4b 新指针坐标生效：client(1440,810) ⇒ 设计坐标 (1440,810) ±1px',
    !!s.locked.pointer && Math.abs(s.locked.pointer[0] - 1440) <= 1 && Math.abs(s.locked.pointer[1] - 810) <= 1,
    'ptr=' + JSON.stringify(s.locked.pointer.map((v) => +v.toFixed(4))))
  const md = maxDistTo(s.locked.sys, s.locked.pointer)
  const p4 = firstPos(s.locked.sys)
  ok('P4c 粒子出生点跟着新指针（max|Δ| ≤ 6px，且远离旧指针 (480,270)）',
    !!p4 && md >= 0 && md <= 6 && dist(p4, [480, 270]) > 100,
    p4 ? `max|Δ|=${fmt(md)} 到旧指针=${fmt(dist(p4, [480, 270]))}px` : '无粒子')
}

// ═══════════════════════════ 7. D 阶段：等价/相关通道 ═══════════════════════════
{
  // D1：注入通道的 `inside:false` —— P-118 后它是**宿主显式声明"指针不在画布内"** ⇒ 直接停发
  //     （不回落到任何缓存坐标）。这里测"fresh 台子（画布还没记过坐标）"那一半；"画布记过坐标"
  //     那一半在 D3/G5（那才是修复前会继续在旧坐标发射的情形）。
  const savedLoc0 = globalThis.location
  const rigInj = makeRig('inject-inside')
  try {
    globalThis.window = { __mpwPointer: { x: 1440, y: 810, inside: true } }
    await rigInj.frame()
    const a = rigInj.snapshot(); dump(rigInj, 'D1 注入 inside:true（装钩子）')
    ok('D1a 注入 inside:true ⇒ 发射（同一台子上后半段才有对照）', a.locked.alive > 0, `alive=${a.locked.alive}`)
    globalThis.window.__mpwPointer = { x: 1440, y: 810, inside: false }
    await rigInj.frame(); await rigInj.frame()
    const b = rigInj.snapshot(); dump(rigInj, 'D1b 注入 inside:false（画布无回落值）')
    ok('D1b 注入 inside:false ⇒ 停发、指针为空（fresh 台子；P-118 后这条由 `inside:false ⇒ null` 保证）',
      b.locked.alive === 0 && b.locked.emitted === a.locked.emitted && b.locked.pointer === null,
      `累计 ${a.locked.emitted}→${b.locked.emitted} ptr=${JSON.stringify(b.locked.pointer)}`)
  } finally {
    delete globalThis.window
    if (savedLoc0 === undefined) delete globalThis.location; else globalThis.location = savedLoc0
  }

  // D2：注入优先级（**没有** DOM "已离开"事实时）—— 注入仍是最高优先，画布旧坐标被覆盖
  globalThis.window = { __mpwPointer: { x: 300, y: 200, inside: true } }
  await rig.frame()
  const s2 = rig.snapshot(); dump(rig, 'D2 注入(300,200) 覆盖画布坐标')
  ok('D2 注入通道优先于画布事件：注入 (300,200) 后基准点就是 (300,200)（不是画布上的 (1440,810)）',
    !!s2.locked.pointer && Math.abs(s2.locked.pointer[0] - 300) <= 0.5 && Math.abs(s2.locked.pointer[1] - 200) <= 0.5,
    'ptr=' + JSON.stringify(s2.locked.pointer))

  // D3 / G5（修复前是 XFAIL）：注入 inside:false **在有画布回落值时**也必须停发（不许回落到旧坐标）
  const em5 = rig.trk(LOCKED_ID).sample().emitted
  globalThis.window.__mpwPointer = { x: 300, y: 200, inside: false }
  await rig.frame(); await rig.frame()
  const s5 = rig.snapshot(); dump(rig, 'D3/G5 inside:false（画布有旧坐标）')
  delete globalThis.window
  ok('G5 ★ 宿主用 inside:false 声明"指针不在" ⇒ 停发、不回落到旧画布坐标（修复前：189→276 且仍 (1440,810)）',
    s5.locked.emitted === em5 && s5.locked.pointer === null && s5.locked.alive === 0,
    `inside:false 后累计 ${em5}→${s5.locked.emitted}、基准点=${JSON.stringify(s5.locked.pointer)}`
    + '（修复前 = 上一次画布内 pointermove 留下的归一坐标）。'
    + '最小复现：① 注入 {x:300,y:200,inside:true} 渲染一帧 ② 画布 pointermove(1440,810) ③ 注入改 {inside:false} '
    + '⇒ 期望不发射（修法 core/we-scene-bundle.js:6686 `if (inj && inj.inside === false) return null`）')

  // D4：?cursor=off（逃生口）—— 整个 lockToPointer 类都不发射，即使注入指针且画布有事件
  const savedLoc = globalThis.location
  const savedDoc4 = globalThis.document
  globalThis.location = { search: '?cursor=off' }
  const rigOff = makeRig('cursor-off')
  try {
    // ①(P-121 B-G3) 页面级假目标也装上 ⇒ D4c 才能证明"逃生口下页面钩子也不装"（不是"没装是因为没有 window"）
    globalThis.window = rigOff.win; globalThis.document = rigOff.doc
    rigOff.win.__mpwPointer = { x: 960, y: 540, inside: true }
    await rigOff.frame()
    const off1 = rigOff.snapshot(); dump(rigOff, 'D4 ?cursor=off + 注入指针')
    ok('D4 ?cursor=off ⇒ 即使有指针也不发射（lockToPointer 层的总开关；对照层照常）',
      off1.locked.alive === 0 && off1.locked.emitted === 0 && off1.free.alive > 0,
      `locked alive=${off1.locked.alive} free alive=${off1.free.alive}`)
    // ①(P-118 G4) 逃生口的**强语义**：`?cursor=off` 下连 DOM 钩子都不装（一个监听器都不加）——
    //   P-118 的自举只在 `!CURSOR_OFF` 时发生 ⇒ 逃生口语义与改动前**逐条**相同。
    ok('D4b ?cursor=off ⇒ 画布上一个指针监听器都不装（逃生口不接管画布事件；P-118 未改这条语义）',
      rigOff.listeners.size === 0, '监听集合=' + JSON.stringify([...rigOff.listeners.keys()]))
    // ①(P-121 B-G3) 同一语义覆盖**页面级**钩子（window blur/focus、document visibilitychange）：
    //   逃生口下这两类监听同样一个都不许装（假 window/document 在场 ⇒ 这条不是平凡真）。
    const namesOff = rigOff.pageListenerNames()
    ok('D4c ?cursor=off ⇒ 页面级（win blur/focus、doc visibilitychange）也一个监听器都不装（P-121 未改逃生口语义）',
      namesOff.win.length === 0 && namesOff.doc.length === 0,
      '实测=' + JSON.stringify(namesOff) + '（win/document 都是可挂钩的假目标 ⇒ 不是"没目标可挂"）')
  } finally {
    delete globalThis.window
    if (savedDoc4 === undefined) delete globalThis.document; else globalThis.document = savedDoc4
    if (savedLoc === undefined) delete globalThis.location; else globalThis.location = savedLoc
  }
}

// ═══════════════════════════ 8. G 阶段：等价"离开"路径（P-121 起全部是真断言，无 XFAIL）═══════════
{
  const rig2 = makeRig('gaps')

  // G4（修复前 XFAIL，P-118 已闭合）：DOM 通道**自举** —— 从头到尾**不注入**任何指针，只靠画布事件。
  //   两条一起钉：① 建渲染器（第一帧之前）钩子就已装上；② 派发 pointermove 后真发射、坐标对得上。
  ok('G4a ★ 未注入任何指针时，建渲染器那一刻画布钩子就已装上（自举不再依赖"已经有指针"）',
    rig2.listeners.has('pointermove') && rig2.listeners.has('pointerdown') && rig2.listeners.has('pointerleave'),
    '第一帧之前监听集合=' + JSON.stringify([...rig2.listeners.keys()])
    + '（修复前 = []：钩子只在 `__ptrNow` 为真时才装 ⇒ 页面不注入就永远装不上）')
  const n0 = rig2.fire('pointermove', { clientX: 960, clientY: 540, pointerId: 1, pointerType: 'mouse' })
  await rig2.frame()
  const g4 = rig2.snapshot(); dump(rig2, 'G4 未注入 + 画布 pointermove')
  ok('G4b ★ 未注入时画布 pointermove 也能让 lockToPointer 层发射，且基准点 = (960,540) ±1px',
    n0 >= 1 && g4.locked.alive > 0 && !!g4.locked.pointer
    && Math.abs(g4.locked.pointer[0] - 960) <= 1 && Math.abs(g4.locked.pointer[1] - 540) <= 1,
    `实测 alive=${g4.locked.alive}、派发命中 ${n0} 个监听器、基准点=${JSON.stringify(g4.locked.pointer)}`
    + '；出货页面（demo.html → ./bundle.js）走的正是这条路（全仓库 `__mpwPointer` 零生产者 = 修复前"鼠标拖尾"整条死的）')

  // 补一个"注入 + 装钩子"的台子，用来量 G1/G2/G3
  const rig3 = makeRig('inject-gaps')
  globalThis.window = { __mpwPointer: { x: 800, y: 400, inside: true } }
  await rig3.frame()                     // 装钩子（注入通道在场）
  delete globalThis.window
  rig3.fire('pointermove', { clientX: 700, clientY: 500, pointerId: 1, pointerType: 'mouse' })
  await rig3.frame()
  const base = rig3.snapshot(); dump(rig3, 'G 基线（DOM 指针 700,500）')
  ok('G0 缺口用例的前置：DOM 指针已在 (700,500) 且正在发射（下面 G1/G2/G3 才有意义）',
    !!base.locked.pointer && base.locked.alive > 0, `ptr=${JSON.stringify(base.locked.pointer)} alive=${base.locked.alive}`)

  // G1（修复前 XFAIL，P-118 已闭合）：注入通道激活时，画布 pointerleave 也**必须**停发
  globalThis.window = { __mpwPointer: { x: 800, y: 400, inside: true } }
  await rig3.frame()
  const g1Before = rig3.trk(LOCKED_ID).sample().emitted
  rig3.fire('pointerleave', { pointerId: 1, clientX: 701, clientY: 501 })
  await rig3.frame(); await rig3.frame()
  const g1 = rig3.snapshot(); dump(rig3, 'G1 注入激活 + 画布 pointerleave')
  ok('G1 ★ 注入通道激活时，画布 pointerleave 也能停发（注入值没变 ⇒ 不许盖过"已离开"；修复前 39→54 且仍 (800,400)）',
    g1.locked.emitted === g1Before && g1.locked.pointer === null && g1.locked.alive === 0,
    `离开后累计 ${g1Before}→${g1.locked.emitted}（基准点=${JSON.stringify(g1.locked.pointer)}）。`
    + '最小复现 = 本测试 D2/G1 两步：① window.__mpwPointer={x:800,y:400,inside:true} ② 画布派发 pointerleave '
    + '⇒ 修复前指针仍为 (800,400)、累计发射继续增长（修法 core/we-scene-bundle.js:6691）')
  // 同一发 pointerleave 在注入撤掉后立刻生效 ⇒ 证明"事件到了、是优先级盖住的"
  delete globalThis.window
  await rig3.frame()
  const g1b = rig3.snapshot(); dump(rig3, 'G1b 撤注入后同一发 leave 生效')
  ok('G1b 同一发 pointerleave 在注入撤掉后**立刻生效**（事件确实到达并清了 DOM 指针 ⇒ G1 是优先级问题，不是事件没到）',
    g1b.locked.pointer === null && g1b.locked.alive === 0, `ptr=${JSON.stringify(g1b.locked.pointer)} alive=${g1b.locked.alive}`)
  // G1c：注入**变了**（宿主重新给了坐标）⇒ 认注入（纯注入的台子不会被一发 stray leave 永久锁死）
  globalThis.window = { __mpwPointer: { x: 320, y: 240, inside: true } }
  await rig3.frame()
  const g1c = rig3.snapshot(); dump(rig3, 'G1c 注入给了新坐标 ⇒ 恢复认注入')
  delete globalThis.window
  ok('G1c 注入**变了**（宿主给出新坐标） ⇒ 当作新证据恢复认注入、重新发射（不会永久锁死纯注入台子）',
    !!g1c.locked.pointer && Math.abs(g1c.locked.pointer[0] - 320) <= 0.5 && Math.abs(g1c.locked.pointer[1] - 240) <= 0.5
    && g1c.locked.alive > 0,
    `ptr=${JSON.stringify(g1c.locked.pointer)} alive=${g1c.locked.alive}`)

  // ═══════════ G2：`pointerout` 等价"离开"路径（P-118 时是 XFAIL；P-121 转真断言）═══════════
  // 每一条子用例都先**重新进入画布**（pointermove）把发射器叫醒再派发 —— 否则"冻结"会是因为
  // 上一条用例已经停了（假绿：P-121 第一版就撞见过这个坑，G3 的前置被 G2 的冻结吃掉）。
  const reenter = async (cx, cy, label) => {
    const n = rig3.fire('pointermove', { clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse' })
    await rig3.frame()
    const s = rig3.snapshot(); dump(rig3, label)
    return { n, s, emitted: s.locked.emitted }
  }

  {
    const e0 = await reenter(700, 500, 'G2 前置 重新进入 (700,500)')
    ok('G2-pre 前置：指针回到画布内、发射器正在发射（下面三条的"冻结"才不是"本来就停了"）',
      e0.n >= 1 && e0.s.locked.alive > 0 && !!e0.s.locked.pointer, `alive=${e0.s.locked.alive} 累计=${e0.emitted}`)
    // ① relatedTarget 在画布**内部**：pointerout 会从子元素冒泡上来，这**不是**离开 ⇒ 不许误伤
    const nIn = rig3.fire('pointerout', { pointerId: 1, relatedTarget: rig3.innerEl, clientX: 701, clientY: 501 })
    await rig3.frame()
    const sIn = rig3.snapshot(); dump(rig3, 'G2a pointerout(relatedTarget=画布内部元素)')
    ok('G2a pointerout + relatedTarget 在画布**内部** ⇒ **不停发**（防误伤：鼠标还在画布内不该被静音）',
      nIn >= 1 && sIn.locked.emitted > e0.emitted && sIn.locked.pointer !== null,
      `派发命中 ${nIn} 个监听器；累计 ${e0.emitted}→${sIn.locked.emitted} ptr=${JSON.stringify(sIn.locked.pointer)}`)

    // ② relatedTarget 在画布**外部**：等价"移到别的元素上" ⇒ 停发
    const e2 = await reenter(720, 520, 'G2b 前 重新进入 (720,520)')
    const nOutside = rig3.fire('pointerout', { pointerId: 1, relatedTarget: rig3.outsideEl, clientX: 721, clientY: 521 })
    await rig3.frame(); await rig3.frame()
    const sOut = rig3.snapshot(); dump(rig3, 'G2b pointerout(relatedTarget=画布外元素)')
    ok('G2b ★★ pointerout + relatedTarget 在画布**外** ⇒ 停发（`contains` 判定生效）',
      nOutside >= 1 && sOut.locked.emitted === e2.emitted && sOut.locked.pointer === null && sOut.locked.alive === 0,
      `派发命中 ${nOutside} 个监听器；离开后累计 ${e2.emitted}→${sOut.locked.emitted} ptr=${JSON.stringify(sOut.locked.pointer)}`)

    // ③ relatedTarget = null：离开文档/窗口（切窗口/系统弹窗）—— 有的实现这条路径**不发 pointerleave**
    const e3 = await reenter(700, 500, 'G2c 前 重新进入 (700,500)')
    const nOut = rig3.fire('pointerout', { pointerId: 1, relatedTarget: null, clientX: 701, clientY: 501 })
    await rig3.frame(); await rig3.frame()
    const g2 = rig3.snapshot(); dump(rig3, 'G2c pointerout(relatedTarget=null)')
    ok('G2c ★★ pointerout(+relatedTarget=null) 停发（等价"离开"路径：**真断言**，P-118 时这条挂在 XFAIL）',
      nOut >= 1 && g2.locked.emitted === e3.emitted && g2.locked.pointer === null && g2.locked.alive === 0,
      `pointerout 派发命中 ${nOut} 个监听器（修复前 = 0）；离开后累计 ${e3.emitted}→${g2.locked.emitted}`
      + '（修复前 157→173，仍在发射）；实测画布监听集合=' + JSON.stringify(g2.listeners))
  }

  // ═══════════ G3：页面级"离开"（blur / visibilitychange）＋**恢复面**（P-121 转真断言）═══════
  {
    const savedWin = globalThis.window, savedDoc = globalThis.document
    try {
      // 页面级钩子挂在**假 window / 假 document** 上（真浏览器里就是真的那两个全局）；
      // installed 之后靠帧内幂等兜底装上 —— 这也顺带钉住"钩子与'本帧有没有指针'解耦"。
      globalThis.window = rig3.win
      globalThis.document = rig3.doc
      const e1 = await reenter(640, 480, 'G3 前置 重新进入 (640,480) + 装页面钩子')
      const names = rig3.pageListenerNames()
      ok('G3-pre 页面级监听真的装上了（win=blur/focus、doc=visibilitychange；"发了没人听"不算通过）',
        names.win.includes('blur') && names.win.includes('focus') && names.doc.includes('visibilitychange'),
        '实测=' + JSON.stringify(names) + '（修复前 = {"win":[],"doc":[]}：渲染器一行都没引用 window/document 级事件）')

      // ── blur：窗口失去焦点（切窗口/系统弹窗）⇒ 停发 ──
      const nBlur = rig3.firePage('blur', {})
      await rig3.frame(); await rig3.frame()
      const sBlur = rig3.snapshot(); dump(rig3, 'G3a blur')
      ok('G3a ★★ blur（窗口失焦）⇒ 停发：累计冻结 + 无存活粒子 + 指针为空',
        nBlur >= 1 && sBlur.locked.emitted === e1.emitted && sBlur.locked.pointer === null && sBlur.locked.alive === 0,
        `blur 命中 ${nBlur} 个监听器；累计 ${e1.emitted}→${sBlur.locked.emitted} ptr=${JSON.stringify(sBlur.locked.pointer)}`
        + '（修复前：blur 命中 0 个、累计 173→189 仍在发射）')

      // ── G3b ★ 恢复面：焦点回来后**指针仍在画布内** ⇒ 必须继续发射（不许把临时失焦当永久停发）──
      const nFocus = rig3.firePage('focus', {})
      await rig3.frame()
      const sFocus = rig3.snapshot(); dump(rig3, 'G3b focus 恢复')
      ok('G3b ★★ focus 恢复 ⇒ 继续发射，且基准点仍是离开前那个画布内坐标 (640,480)±1px（"修好一个 bug 造出另一个"的反例钉）',
        nFocus >= 1 && sFocus.locked.alive > 0 && sFocus.locked.emitted > e1.emitted && !!sFocus.locked.pointer
        && Math.abs(sFocus.locked.pointer[0] - 640) <= 1 && Math.abs(sFocus.locked.pointer[1] - 480) <= 1,
        `focus 命中 ${nFocus} 个；累计 ${e1.emitted}→${sFocus.locked.emitted} ptr=${JSON.stringify(sFocus.locked.pointer && sFocus.locked.pointer.map((v) => +v.toFixed(3)))}`)

      // ── visibilitychange:hidden / visible 同理 ──
      const e4 = await reenter(660, 500, 'G3c 前 重新进入 (660,500)')
      rig3.doc.hidden = true; rig3.doc.visibilityState = 'hidden'
      const nHidden = rig3.firePage('visibilitychange', {})
      await rig3.frame(); await rig3.frame()
      const sHidden = rig3.snapshot(); dump(rig3, 'G3c visibilitychange:hidden')
      ok('G3c ★★ visibilitychange + document.hidden=true（切标签）⇒ 停发',
        nHidden >= 1 && sHidden.locked.emitted === e4.emitted && sHidden.locked.pointer === null && sHidden.locked.alive === 0,
        `命中 ${nHidden} 个监听器；累计 ${e4.emitted}→${sHidden.locked.emitted} ptr=${JSON.stringify(sHidden.locked.pointer)}`)
      rig3.doc.hidden = false; rig3.doc.visibilityState = 'visible'
      const nVisible = rig3.firePage('visibilitychange', {})
      await rig3.frame()
      const sVisible = rig3.snapshot(); dump(rig3, 'G3d visibilitychange:visible 恢复')
      ok('G3d ★★ visibilitychange + visible 恢复 ⇒ 继续发射（与 G3b 同一条恢复语义的另一条触发路径）',
        nVisible >= 1 && sVisible.locked.alive > 0 && sVisible.locked.emitted > e4.emitted,
        `命中 ${nVisible} 个；累计 ${e4.emitted}→${sVisible.locked.emitted} alive=${sVisible.locked.alive}`)

      // ── G3e ★ 另一面：失焦期间指针**真的离开了画布**（pointerleave 清掉画布坐标）⇒ 回来后不许无中生有 ──
      rig3.fire('pointerleave', { pointerId: 1, clientX: 661, clientY: 501 })
      await rig3.frame()
      const e5 = rig3.snapshot()
      const nBlur2 = rig3.firePage('blur', {})
      await rig3.frame()
      const nFocus2 = rig3.firePage('focus', {})
      await rig3.frame(); await rig3.frame()
      const sBack = rig3.snapshot(); dump(rig3, 'G3e 失焦期间指针已离开画布 ⇒ 焦点回来后仍无指针')
      ok('G3e ★★ 失焦期间指针真离开画布（pointerleave 已清坐标）⇒ 恢复焦点后**仍不发射**（不是"恢复了就凭空喂旧坐标"）',
        nBlur2 >= 1 && nFocus2 >= 1 && e5.locked.pointer === null
        && sBack.locked.pointer === null && sBack.locked.emitted === e5.locked.emitted && sBack.locked.alive === 0,
        `blur ${nBlur2} 个 / focus ${nFocus2} 个监听器；累计 ${e5.locked.emitted}→${sBack.locked.emitted} ptr=${JSON.stringify(sBack.locked.pointer)}`)
    } finally {
      if (savedWin === undefined) delete globalThis.window; else globalThis.window = savedWin
      if (savedDoc === undefined) delete globalThis.document; else globalThis.document = savedDoc
    }
  }
}

// ═══════════════════════════ 9. E 阶段（条件项）：真包 3554161528 的 lockToPointer 层 ═══════════
{
  const MPW_WS = process.env.MPW_ROOT || WS
  const PKG = path.join(MPW_WS, 'allwallpaper', 'dd', '3554161528', 'scene.pkg')
  if (!fs.existsSync(PKG)) {
    skipItem('真包 3554161528 的 lockToPointer 层', '缺语料 ' + PKG)
  } else {
    const dec = new TextDecoder()
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
    const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
    const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
    const scene = lib.parseScene(sj, null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 }, readParticleDef })
    const sysOf = (l) => lib.buildParticleSystem(l.particleDef, {
      origin: l.origin, scale: l.scale, angle: (l.angles && l.angles[2]) || 0, seedStr: 'pointer-leave',
    })
    const lockedLayers = scene.layers.filter((l) => l.particleDef && sysOf(l).emitters.some((e) => e.__ptrLocked))
    const flaggedOnly = scene.layers.filter((l) => {
      const d = l.particleDef; if (!d) return false
      const cp = ((d.controlpoint) || []).some((c) => c && (Number(c.flags) & 1))
      return cp && !sysOf(l).emitters.some((e) => e.__ptrLocked)
    })
    ok('E1 真包里存在 lockToPointer 发射器层（id389 cherry blossoms on cursor —— §7-H 的当事人）',
      lockedLayers.length >= 1, '命中=' + JSON.stringify(lockedLayers.map((l) => l.id + ':' + l.name)))
    if (lockedLayers.length) {
      const l = lockedLayers[0]
      const sys = sysOf(l)
      ok('E2 该层指针控制点 = cp0 且**全部**发射器挂指针（真实数据，不是合成 def）',
        sys.pointerCp === 0 && sys.emitters.length > 0 && sys.emitters.every((e) => e.__ptrLocked),
        `id=${l.id} pointerCp=${sys.pointerCp} 发射器=${sys.emitters.length}`)
      const sNo = sysOf(l); sNo.pointer = null
      lib.simulateParticleSystem(sNo, 3, 400)
      ok('E3 无指针 ⇒ 该层 0 粒（"中心爆"回归：不许退回 authored origin 发射）',
        sNo.particles.length === 0 && (sNo.__ptrSkipped || 0) > 0,
        `alive=${sNo.particles.length} __ptrSkipped=${sNo.__ptrSkipped || 0}`)
      const sYes = sysOf(l); sYes.pointer = [800, 400]
      lib.simulateParticleSystem(sYes, 0.2, 400)
      const ps = sYes.particles.slice(0, 40)
      const mx = ps.length ? Math.max(...ps.map((q) => Math.abs(q.pos[0] - 800))) : -1
      const my = ps.length ? Math.max(...ps.map((q) => Math.abs(q.pos[1] - 400))) : -1
      ok('E4 指针 (800,400) ⇒ 有粒子且出生点就在指针附近（max|Δ| < 60px，与 projection-y-test 同口径）',
        ps.length > 0 && mx < 60 && my < 60, `n=${ps.length} max|Δx|=${fmt(mx, 1)} max|Δy|=${fmt(my, 1)}`)
    } else {
      skipItem('真包 id389 断言（E2-E4）', '本包 scene.json 里找不到 lockToPointer 发射器层')
    }
    ok('E5 真包里"controlpoint[i].flags=1 但发射器不引用该控制点"的层**不**受指针门控（不误伤）',
      flaggedOnly.every((l) => sysOf(l).emitters.every((e) => !e.__ptrLocked)),
      '这类层=' + JSON.stringify(flaggedOnly.map((l) => l.id + ':' + l.name)))
  }
}

// ═══════════════════════════ 10. M 阶段：内置红-if-reverted（临时副本变异）═══════════════════════
if (IS_MUTANT_RUN) {
  note('M0 变异体运行（MPW_POINTER_BUNDLE 已设）⇒ 跳过红-if-reverted 自检，避免递归')
} else if (!MUTATION) {
  note('M0 红-if-reverted 自检被 --no-mutation 跳过（本次运行**未**复核变异必红）')
} else {
  const CORE = path.join(ROOT, 'core')
  const SRC = fs.readFileSync(BUNDLE, 'utf8')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pointer-leave-mut-'))
  const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } }
  process.on('exit', cleanup)
  try {
    // 逐文件复制（fs.cpSync 在本机 /tmp 上抛 EINVAL）；**用 statSync 判类型**（本机 fs 的
    // Dirent.isFile() 对部分普通文件报 false/isSymbolicLink()=true，靠它会漏掉依赖模块）
    const tmpCore = path.join(tmp, 'core')
    fs.mkdirSync(tmpCore, { recursive: true })
    for (const name of fs.readdirSync(CORE)) {
      const src = path.join(CORE, name)
      let st = null
      try { st = fs.statSync(src) } catch { st = null }
      if (!st || !st.isFile()) continue
      fs.writeFileSync(path.join(tmpCore, name), fs.readFileSync(src))
    }
    // P-118/P-121：**每处修复各一条**"改回旧写法"的最小变异；锚点 = 修复那几行的真源码，
    // 命中数必须**恰好 1**（否则 SKIP，不把"没法变异"伪装成"变异通过"）。expect = 该变异必须打红的断言。
    const MUTANTS = [
      {
        id: 'M1', fix: 'G4', expectName: 'G4a/G4b（DOM 路径自举）', expect: /✗ G4[ab]/,
        desc: 'G4 改回旧写法：拆掉"建渲染器即装钩子" + 帧内改回 `if (!CURSOR_OFF && __ptrNow) __hookPointer()`',
        edits: [
          ['\n  if (!CURSOR_OFF) __hookPointer()\n', '\n  /* 变异 M1：自举拆掉 —— 旧写法"没有指针就不装钩子" */\n'],
          ['    if (!CURSOR_OFF) __hookPointer()', '    if (!CURSOR_OFF && __ptrNow) __hookPointer()'],
        ],
      },
      {
        id: 'M2', fix: 'G1', expectName: 'G1（注入不许盖过"已离开"）', expect: /✗ G1 ★/,
        desc: 'G1 改回旧写法：注入分支去掉"与 pointerleave 那一刻同一份"的判定（注入无条件优先）',
        edits: [
          ['        if (__pointerGone && inj === __pointerGoneInj && __injKey(inj) === __pointerGoneKey) return null',
            '        /* 变异 M2：注入盖过 canvas pointerleave（旧写法） */'],
        ],
      },
      {
        id: 'M3', fix: 'G5', expectName: 'G5（inside:false ⇒ 停发）', expect: /✗ G5 ★/,
        desc: 'G5 改回旧写法：去掉 `inside === false ⇒ null`，并把 `inside !== false` 加回注入条件（回落到旧画布坐标）',
        edits: [
          ['      if (inj && inj.inside === false) return null\n', '      /* 变异 M3：inside:false 不再表示"不在画布内" */\n'],
          ['      if (inj && Number.isFinite(inj.x) && Number.isFinite(inj.y)) {',
            '      if (inj && inj.inside !== false && Number.isFinite(inj.x) && Number.isFinite(inj.y)) {'],
        ],
      },
      {
        id: 'M4', fix: 'P-118 核心语义（离开清指针）', expectName: 'P3a/P3b（pointerleave 后不再新增发射）', expect: /✗ P3a/,
        desc: 'pointerleave 处理器改成空操作（监听还在、行为回到"离开不清指针"的旧写法）',
        edits: [
          // ①(P-121) 锚点跟着改法走：pointerleave 现在调统一处置函数 `__pointerLeave('pointerleave')`
          ["el.addEventListener('pointerleave', () => __pointerLeave('pointerleave'), { passive: true })",
            "el.addEventListener('pointerleave', () => { /* 变异 M4：离开不清指针 */ }, { passive: true })"],
        ],
      },
      {
        id: 'M5', fix: 'P-121 G2（pointerout 等价路径）', expectName: 'G2c（pointerout+relatedTarget=null 停发）', expect: /✗ G2c/,
        desc: '删掉画布 `pointerout` 监听（回到"只认 pointerleave"的旧写法）',
        edits: [
          ["      el.addEventListener('pointerout', (ev) => {", "      if (false) el.addEventListener('pointerout', (ev) => { /* 变异 M5：不监听 pointerout */"],
        ],
      },
      {
        id: 'M6', fix: 'P-121 G3（window blur）', expectName: 'G3a（blur ⇒ 停发）', expect: /✗ G3a/,
        desc: '删掉 window `blur` 监听（回到"页面失焦不管"的旧写法；focus 仍在）',
        edits: [
          ["        win.addEventListener('blur', () => __pointerSuspend('blur'), { passive: true })",
            "        /* 变异 M6：不监听 window blur */"],
        ],
      },
      {
        id: 'M7', fix: 'P-121 G3（document visibilitychange）', expectName: 'G3c（hidden ⇒ 停发）', expect: /✗ G3c/,
        desc: '删掉 document `visibilitychange` 监听（回到"切标签不管"的旧写法）',
        edits: [
          ["        doc.addEventListener('visibilitychange', () => {", "        if (false) doc.addEventListener('visibilitychange', () => { /* 变异 M7：不监听 visibilitychange */"],
        ],
      },
      {
        id: 'M8', fix: 'P-121 G3b/G3d（恢复面）', expectName: 'G3b（focus 恢复后仍能发射）', expect: /✗ G3b/,
        desc: '删掉 window `focus` 监听（"修好一个 bug 造出另一个"：失焦后永久停发）',
        edits: [
          ["        win.addEventListener('focus', () => __pointerResume('focus'), { passive: true })",
            "        /* 变异 M8：失焦后永远不解除挂起 */"],
        ],
      },
      {
        // ①(P-136 2026-09-20) A3d **收窄**（"全部粒子" → "本帧新生粒子"）之后必须重新标定一条变异，
        //   否则它就成了一条"永远绿的装饰断言"。这条变异把 lockToPointer 发射器的**发射基准点**
        //   从"指针"改回"层的 authored origin"（= P-69 之前那个"中心爆"的旧写法）：
        //   新生粒子会落在 (1920,1080) 而不是指针上 ⇒ A3d 必红（顺带 A3e 也红，那是同一条语义）。
        id: 'M9', fix: 'P-136 A3d（出生点 = 指针）', expectName: 'A3d（**本帧新生**粒子出生点 = 指针）', expect: /✗ A3d/,
        desc: '发射基准点从"指针"改回"层 authored origin"（A3d 收窄后重新标定的红-if-reverted）',
        edits: [
          ['  const __P = em.__ptrLocked ? sys.pointer : null',
            '  const __P = em.__ptrLocked ? [sys.origin[0], sys.origin[1]] : null   /* 变异 M9：退回 authored origin 发射 */'],
        ],
      },
    ]
    for (const m of MUTANTS) {
      let src = SRC, bad = null
      for (const [from, to] of m.edits) {
        const n = src.split(from).length - 1
        if (n !== 1) { bad = '锚点命中 ' + n + ' 次：' + JSON.stringify(from.slice(0, 70)); break }
        src = src.split(from).join(to)
      }
      if (bad) { skipItem('mutation-selfcheck ' + m.id, bad + '（核心那几行已被改写 ⇒ 需重新标定；不做变异＝不算证据）'); continue }
      const f = path.join(tmp, 'core', 'we-scene-bundle.js')
      fs.writeFileSync(f, src)
      const r = spawnSync(process.execPath, [process.argv[1], '--no-mutation'], {
        encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
        env: Object.assign({}, process.env, { MPW_POINTER_BUNDLE: f }),
      })
      const out = String(r.stdout || '') + String(r.stderr || '')
      const redLine = (out.match(m.expect) || [])[0] || (out.match(/✗ [^\n]*/) || [])[0] || ''
      ok('M-' + m.id + '（' + m.fix + '）变异「' + m.desc + '」⇒ 子进程 rc=1 且 ' + m.expectName + ' 变红',
        r.status === 1 && m.expect.test(out),
        `rc=${r.status} 失败断言=${JSON.stringify(redLine.slice(0, 180))}`)
      ok('M-' + m.id + 'b 变异体只打破被点名的那条语义，绿前提仍成立（A3a/P4a 在变异体里仍为 ✓）',
        /✓ A3a/.test(out) && /✓ P4a/.test(out), 'A3a/P4a 在变异体里仍为 ✓')
    }
  } finally { cleanup() }
}

// ═══════════════════════════ 11. 汇总（真实计票）═══════════════════════════
if (ONLY.length && pass + fail + skip + xfail + xpass === 0) usage('--only ' + JSON.stringify(ONLY) + ' 没有匹配到任何断言')
if (fail) {
  console.log('\n' + fail + ' 项失败：')
  for (const n of failNames) console.log('  - ' + n)
}
console.log(`\n(计票：pass=${pass} fail=${fail} skip=${skip} xfail=${xfail} xpass=${xpass})`)
if (xfail) console.log(`已知缺口 XFAIL ${xfail} 条（不计票；见文件头"已知缺口台账"）`)
else console.log('已知缺口 0 条（P-118 闭合 G1/G4/G5 三条；P-121 闭合 G2/G3 两条 —— 等效"离开"路径已全部转真断言）')
if (fail === 0) console.log(`\nALL PASS （${pass} 项${skip ? '，另 SKIP ' + skip : ''}${xfail ? '，另记录缺口 ' + xfail : '，缺口 0'}）`)
else console.log(`\n${fail} 项失败`)
process.exit(fail ? 1 : 0)

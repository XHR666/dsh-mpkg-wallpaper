#!/usr/bin/env node
// script-wevector-module-test.mjs —— 官方 scene-script 模块（`WEMath` / `WEVector` / `WEColor`）
//   **逐名映射**回归：`import * as X from '<模块名>'` 不再"非 WEMath 一律别名到 WEColor"。
//
// ── 现象（现场，静态复现）──────────────────────────────────────────────────────────────
//   `elysia/scene-scripts.js` 的 `compileScript()` 改前是
//       `mod === 'WEMath' ? '__WEMath' : '__WEColor'`
//   ⇒ **除 `WEMath` 外的一切模块名**都拿到 `__WEColor` 对象。官方 `WEVector` 的
//   `angleVector2`/`vectorAngle2` 因此根本不存在 ⇒ 脚本里调用就抛
//   `WEVector.angleVector2 is not a function`，而 `runScriptValueCached` 的 `update` 分支
//   用 try/catch 吞掉（`elysia/scene-scripts.js` 的 `entry.updateErrors++`）⇒ **不报错、不白屏**，
//   作者意图的那一层停在 authored 值 —— 这就是它长期没被发现的原因。
//
// ── 语料实况（本文件 W1 现场复算，全部 98 个 `.pkg`/`.mpkg` 容器内 scene.json）──────────────
//   | 模块名 | 文本命中 | 容器数 | 其中**活代码** |
//   |---|---|---|---|
//   | `WEMath`   | 60 | 14 | — |
//   | `WEVector` | 57 |  7 | **1**（`wallpaperE/洛茜/洛茜_11.mpkg`） |
//   | `WEColor`  |  3 |  3 | 1 处 `WEColor.hsv2rgb` |
//   **另外 6 个容器的 56 处 `WEVector.angleVector2` 全在注释里**（官方 `script_origin_reflect.js`
//   示例片段被作者注释掉后残留的"尸体"，例：`// var direction = new Vec3(WEVector.angleVector2(…));`
//   —— 与官方 snippet 同源）。**活代码只有 1 处**：
//       `const direction = new Vec3(WEVector.angleVector2(angle)).multiply(circleScale);`
//   （洛茜_11 的 "Circle Audio Visualization" 层，在 `init()` 里排音频条圆环）。
//
// ── 改法（file:line 为改动后）──────────────────────────────────────────────────────────
//   · `elysia/scene-script-apis.js`：新增 `WEVector`（独立实现：`angleVector2` 度→单位圆 Vec2、
//     `vectorAngle2` 反向，共用 `DEG2RAD`/`RAD2DEG`）；`WEColor` 补齐官方模块导出面
//     （`normalizeColor`/`expandColor`；`rgb2hsv`/`hsv2rgb` 原有）；`Vec3` 构造函数补官方签名
//     `Number|Vec2|String` 里的 **Vec2 → z=0**（旧实现取 `x.z` 得 `undefined` ⇒ 下游 NaN）。
//   · `elysia/scene-scripts.js`：`NSL_MODULE_GLOBALS` **逐名表** + `moduleGlobalFor()`；
//     表外模块名 → `__WEEmptyModule`（空命名空间），**不再兜底到 `__WEColor`**。
//   · 同批（让 W6 真包复现**可达**的前置修复）：`scriptProperties` 改成**活引用槽**
//     —— 脚本顶层 `const props = scriptProperties;` 在 run 期间求值，旧实现那一步恒为 `null`
//     ⇒ `props.parabool` 抛 "Cannot read properties of null"，`init` 失败、实例被永久禁用，
//     **正好把 WEVector 的错误挡在后面**（本文件 W5 同时钉这两件事的先后）。
//
// ── 判据（本文件逐条钉住）──────────────────────────────────────────────────────────────
//   W1 模块名清单：语料里出现的每个模块名都有**专属**映射（≠ 空命名空间、≠ 别人的命名空间）；
//      冻结清单 = {WEMath, WEVector, WEColor}；源码级守卫：旧的二元兜底写法已不存在。
//   W2 `WEVector` 数值 = 官方定义（度制单位圆），逐位等于 `Math.cos/sin(deg*π/180)`；往返闭合。
//   W3 命名空间**互不串**：`WEVector.mix`/`WEVector.hsv2rgb` 必须 undefined（证明不是 WEColor 别名）。
//   W4 `WEMath` 四名 + `WEColor` 四名的官方语义与数值（含量纲 255 换算）。
//   W5 未知模块名 → 空命名空间（不抛编译错、也不别名到任何真模块）。
//   W5b scriptProperties 活槽：`.finish()` **之后**的顶层读取拿到声明默认值（旧实现抛 null 读）。
//   W6 真包 `洛茜_11`：跑该层脚本**不再出现 `angleVector2` 相关 TypeError**，且 63 根 bar 的
//      `origin` 与手算 `center + circleScale·(cos θ, sin θ, 0)`（θ = i·360/totalBars）逐条一致
//      （<1e-9）、z **恒等于 0**（不是 NaN）、`angles.z = θ + 90`。缺语料 ⇒ SKIP。
//   W7 红-if-reverted：把映射改回"一律 WEColor"（M1）/ 去掉 `Vec3(Vec2)` 的 z=0（M2）/
//      把 `scriptProperties` 打回 `null`（M3）⇒ 子进程**必红**且红的是被点名的那条断言。
//
// 用法：node tests/script-wevector-module-test.mjs [--no-mutation] [--verbose]
// 环境变量：
//   MPW_SCENE_SCRIPTS  沙箱实现的**副本**路径（内置红-if-reverted 用；平时不要设）
//   MPW_ROOT           工作区根（默认 = 仓库的上一级，WS）—— 只用于真包/语料条件项
// 退出码：0 全过（含 SKIP）/ 1 有失败 / 2 用法错误
//
// 参照来源许可声明：本文件为原创测试代码，不含第三方实现代码（未复制/未翻译 wer-ref、
//   we-layerd-ref、oneincase/webwallgl）；真包只从本机语料读（仓库内 samples 已因版权移除
//   ⇒ 缺语料时 W1 的实扫部分与 W6 SKIP，冻结清单与合成断言照跑）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { readIndexHead, readEntryBytes, walkContainers } from './_pkg-index.mjs'

// ═══════════════════════════ 0. 用法 / 参数 / 退出码 ═══════════════════════════
const USAGE = `用法：node tests/script-wevector-module-test.mjs [--no-mutation] [--verbose]
  --no-mutation   跳过内置红-if-reverted 自检
  --verbose       打印子进程输出全文
环境变量：
  MPW_SCENE_SCRIPTS  沙箱实现的**副本**路径（内置红-if-reverted 用；平时不要设，设了就等于"测的是副本"）
  MPW_ROOT           工作区根（默认 = 仓库的上一级，WS）—— 只用于真包/语料条件项
退出码：0 全过（含 SKIP）/ 1 有失败 / 2 用法错误`
function usage(msg) { process.stderr.write('用法错误：' + msg + '\n' + USAGE + '\n'); process.exit(2) }
const argv = process.argv.slice(2)
let VERBOSE = false, MUTATION = true
for (const a of argv) {
  if (a === '--no-mutation') MUTATION = false
  else if (a === '--verbose') VERBOSE = true
  else if (a === '-h' || a === '--help') { process.stdout.write(USAGE + '\n'); process.exit(0) }
  else usage('未知参数 ' + a)
}
const MPW_ROOT = process.env.MPW_ROOT || WS
const CORPUS = path.join(MPW_ROOT, 'allwallpaper')
// 默认模块 = 仓库真源码；变异自检时指向副本（进程还是本文件）
const SCRIPTS_MODULE = process.env.MPW_SCENE_SCRIPTS || path.join(ROOT, 'elysia', 'scene-scripts.js')
const APIS_MODULE = path.join(path.dirname(SCRIPTS_MODULE), 'scene-script-apis.js')

let pass = 0, fail = 0, skip = 0
const out = (s) => process.stdout.write(s + '\n')
function check(name, cond, extra) {
  if (cond) { pass++; out('  ✓ ' + name) }
  else { fail++; out('  ✗ ' + name + (extra !== undefined ? '  → ' + short(extra) : '')) }
  return !!cond
}
function skipItem(name, why) { skip++; out('  SKIP ' + name + '（' + why + '）') }
function note(label, v) { out('· ' + label + (v !== undefined ? '：' + short(v) : '')) }
function short(v) {
  let s
  try { s = typeof v === 'string' ? v : JSON.stringify(v) } catch { s = String(v) }
  if (s === undefined) s = String(v)
  return s.length > 240 ? s.slice(0, 240) + '…' : s
}

out('script-wevector-module-test —— 官方 scene-script 模块逐名映射 / WEVector 数值 / 红-if-reverted')
note('沙箱实现', SCRIPTS_MODULE)
note('语料根', CORPUS + (fs.existsSync(CORPUS) ? '' : '（**不存在** ⇒ 实扫与真包项 SKIP）'))

// ═══════════════════════════ 1. 载入被测实现 ═══════════════════════════
const SS = await import(pathToFileURL(SCRIPTS_MODULE).href)
const APIS = await import(pathToFileURL(APIS_MODULE).href)
const { applySceneScripts, makeSceneRef, NSL_MODULE_GLOBALS, NSL_UNKNOWN_MODULE_GLOBAL, moduleGlobalFor } = SS
const { WEVector, WEColor, Vec2, Vec3, DEG2RAD, RAD2DEG } = APIS

// ═══════════════════════════ 2. W1 模块名清单与逐名映射 ═══════════════════════════
out('\n[W1] 语料模块名清单 + 每个模块名都有专属映射（不再是"非 WEMath 一律 WEColor"）')
// 冻结清单：2026-09-19 全语料实测（98 个容器）。改动口径：语料新增模块名 ⇒ 这里同步加一条 + 加命名空间。
const FROZEN_MODULES = { WEMath: { hits: 60, pkgs: 14 }, WEVector: { hits: 57, pkgs: 7 }, WEColor: { hits: 3, pkgs: 3 } }
{
  check('W1a 逐名表存在且是**三**个官方模块，不是一个二元兜底',
    !!NSL_MODULE_GLOBALS && Object.keys(NSL_MODULE_GLOBALS).sort().join('|') === 'WEColor|WEMath|WEVector',
    NSL_MODULE_GLOBALS && Object.keys(NSL_MODULE_GLOBALS))
  check('W1b 表外落点是**空命名空间**、且它不是 `__WEColor`（兜底到 WEColor 正是本次要消灭的写法）',
    NSL_UNKNOWN_MODULE_GLOBAL === '__WEEmptyModule' && NSL_UNKNOWN_MODULE_GLOBAL !== '__WEColor',
    NSL_UNKNOWN_MODULE_GLOBAL)
  check('W1c 每个出现的模块名都有**专属**映射：互不相同、都不等于空命名空间',
    Object.entries(FROZEN_MODULES).every(([m]) => {
      const g = moduleGlobalFor(m)
      return g === NSL_MODULE_GLOBALS[m] && g !== NSL_UNKNOWN_MODULE_GLOBAL &&
        Object.entries(NSL_MODULE_GLOBALS).every(([m2, g2]) => m2 === m || g2 !== g)
    }),
    Object.keys(FROZEN_MODULES).map((m) => m + '→' + moduleGlobalFor(m)))
  check('W1d **源码级守卫**：旧的二元兜底写法（`=== \'WEMath\' ? … : \'__WEColor\'`）已不存在于**可执行代码**里',
    // 只看代码：把行注释/块注释剥掉再判 —— 注释里正当地记着"旧写法是什么"（本文件的叙述也引用它），
    // 拿原文正则会把注释当违规（自测踩过）。
    (() => {
      const code = fs.readFileSync(SCRIPTS_MODULE, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
      return !/===\s*'WEMath'\s*\?\s*'__WEMath'\s*:\s*'__WEColor'/.test(code) && /NSL_MODULE_GLOBALS/.test(code)
    })())
  // 每个模块名都要在沙箱里**真的**解析到对象（不是表里有、context 里没有）
  const probes = Object.keys(FROZEN_MODULES).map((m) => `import * as M from '${m}';\nexport function update(v){ if (typeof M !== 'object' || M === null) throw new Error('module ${m} 未落进沙箱'); return v }`)
  let ctxBad = ''
  for (const src of probes) {
    const errs = []
    applySceneScripts({ objects: [{ visible: { script: src, value: false } }] }, 0, { canvasSize: { x: 100, y: 100 }, shared: {}, onError: (p, e) => errs.push(p + ':' + (e && e.message)) })
    if (errs.length) ctxBad += errs.join(';') + ' | '
  }
  check('W1e 三个模块名都能在沙箱里解析成对象（表里有 + context 里也有，覆盖面到 `import * as` 编译路径）', ctxBad === '', ctxBad)
}

// ═══════════════════════════ 3. 语料实扫（有语料才跑）═══════════════════════════
if (!fs.existsSync(CORPUS)) {
  skipItem('W1f/1g 语料实扫（模块名清单复核）', 'MPW_ROOT/allwallpaper 不存在')
} else {
  const files = walkContainers(CORPUS).sort()
  const hits = new Map()          // module -> { n, pkgs:Set }（import 语句命中）
  const calls = new Map()         // module -> { live, comment, pkgsLive:Set }（**调用点**命中）
  const sceneJsonParseFail = []
  let containers = 0, sceneJson = 0
  for (const f of files) {
    let idx = null
    try { idx = readIndexHead(f, 4 << 20) } catch { continue }
    containers++
    const rel = path.relative(CORPUS, f)
    for (const e of idx.entries) {
      if (!/(^|\/)scene\.json$/i.test(e.name)) continue
      let txt = ''
      try { txt = readEntryBytes(f, idx, e).toString('utf8') } catch { continue }
      try { JSON.parse(txt) } catch { sceneJsonParseFail.push(rel); continue }
      sceneJson++
      // ⚠ 分类必须按**转义还原后**的文本：scene.json 里脚本正文的换行是 `\n` **两个字符**，
      //   直接对原文按真换行切行 ⇒ 整个脚本算"一行"、注释里的片段会被误判成活代码（自测踩过：
      //   原来算出来 57 处"活代码"，还原后是 **1 活 / 56 注释**）。下标不跨用途，安全。
      const norm = txt.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
      for (const m of norm.matchAll(/import\s+\*\s+as\s+[\w$]+\s+from\s+['"]([^'"]+)['"]/g)) {
        if (!hits.has(m[1])) hits.set(m[1], { n: 0, pkgs: new Set() })
        const h = hits.get(m[1]); h.n++; h.pkgs.add(rel)
      }
      // **成员调用点**（`WEVector.angleVector2` 之类）按行分类：整行以注释开头 ⇒ 注释里的示例片段
      for (const m of norm.matchAll(/\b(WEMath|WEVector|WEColor)\.[A-Za-z_$][\w$]*/g)) {
        if (!calls.has(m[1])) calls.set(m[1], { live: 0, comment: 0, pkgsLive: new Set() })
        const c = calls.get(m[1])
        const ls = norm.lastIndexOf('\n', m.index) + 1
        const le = norm.indexOf('\n', m.index)
        const line = norm.slice(ls, le < 0 ? norm.length : le)
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) c.comment++
        else { c.live++; c.pkgsLive.add(rel) }
      }
    }
  }
  const found = [...hits.keys()].sort()
  note('语料实扫', containers + ' 个容器 / ' + sceneJson + ' 份 scene.json；模块名 = ' + JSON.stringify(found))
  check('W1f 实扫到的模块名**全在**逐名表里，且每个都拿到专属命名空间（新增模块名 ⇒ 这里会红）',
    found.length > 0 && found.every((m) => moduleGlobalFor(m) === NSL_MODULE_GLOBALS[m]),
    found.map((m) => m + '→' + moduleGlobalFor(m)))
  check('W1g 实扫模块名集合 == 冻结清单（口径漂移要显式改这份清单，不能悄悄变）',
    found.join('|') === Object.keys(FROZEN_MODULES).sort().join('|'),
    '实扫=' + found.join('|') + ' 冻结=' + Object.keys(FROZEN_MODULES).sort().join('|'))
  check('W1h 实扫能解出 scene.json（索引读取口径正确，没有把 LZ4/其它容器布局误判成 0 命中）',
    sceneJsonParseFail.length === 0, sceneJsonParseFail.slice(0, 3))
  const wv = calls.get('WEVector') || { live: 0, comment: 0, pkgsLive: new Set() }
  note('WEVector 调用点（活代码 / 注释）', wv.live + ' / ' + wv.comment + '；活代码容器 = ' + JSON.stringify([...wv.pkgsLive]))
  check('W1i `WEVector` 在语料里**真的有活代码调用点**（≥1 处；否则本任务的动机不成立）',
    wv.live >= 1, { live: wv.live, comment: wv.comment })
  check('W1j 冻结计数与实扫一致（WEVector 57 处文本命中 / 7 个容器；其中**活代码 1 处**，其余 56 处是注释里的示例片段）',
    wv.live === 1 && wv.comment === 56 && wv.pkgsLive.size === 1 && [...wv.pkgsLive][0].endsWith('洛茜_11.mpkg'),
    { live: wv.live, comment: wv.comment, pkgs: [...wv.pkgsLive] })
}

// ═══════════════════════════ 4. W2/W3 WEVector 语义 ═══════════════════════════
out('\n[W2] `WEVector.angleVector2` / `vectorAngle2` = 官方定义（度制单位圆）')
{
  check('W2a `angleVector2` 与 `vectorAngle2` 都是函数', typeof WEVector.angleVector2 === 'function' && typeof WEVector.vectorAngle2 === 'function')
  const cases = [0, 30, 45, 90, 135, 180, -90, 270, 360, 5.625, 123.456]
  const bad = []
  for (const deg of cases) {
    const v = WEVector.angleVector2(deg)
    const ex = Math.cos(deg * DEG2RAD), ey = Math.sin(deg * DEG2RAD)
    if (!(v instanceof Vec2)) bad.push(deg + ':notVec2')
    if (v.x !== ex || v.y !== ey) bad.push(deg + ':(' + v.x + ',' + v.y + ')≠(' + ex + ',' + ey + ')')
    if (v.x !== Math.cos(deg * Math.PI / 180) || v.y !== Math.sin(deg * Math.PI / 180)) bad.push(deg + ':π/180口径不一致')
  }
  check('W2b 11 个角度逐位等于 `Math.cos/sin(deg·π/180)`（含 0/90/180/−90/360/非整数角），返回 `Vec2`', bad.length === 0, bad.slice(0, 4))
  // 算例（手算）：0°→(1,0)；90°→(≈0,1)；180°→(−1,≈0)；270°→(≈0,−1)；45°→(≈√2/2,≈√2/2)。
  // ⚠ 只对**精确**的两个分量判 `===`；含 π 的分量按官方公式（`Math.cos/sin(deg·deg2rad)`）判 `===`，
  //   理想值另用 1e-15 容差比 —— `Math.sin(45°)` 与 `Math.SQRT1_2` 差 1 ULP（本文件自测踩过）。
  const v0 = WEVector.angleVector2(0), v90 = WEVector.angleVector2(90), v45 = WEVector.angleVector2(45)
  const v180 = WEVector.angleVector2(180), v270 = WEVector.angleVector2(270)
  check('W2c 算例：0°→(1,0)、90°→y=1、180°→x=−1、270°→y=−1（精确分量逐位相等）',
    v0.x === 1 && v0.y === 0 && v90.y === 1 && v180.x === -1 && v270.y === -1,
    [v0, v90, v180, v270])
  check('W2d 算例：90°/180°/270° 的"应为 0"分量 == 官方公式值（≈6.1e-17 / 1.2e-16，不是被硬写成 0）',
    v90.x === Math.cos(90 * Math.PI / 180) && v180.y === Math.sin(Math.PI) && v270.x === Math.cos(270 * Math.PI / 180),
    [v90.x, v180.y, v270.x])
  check('W2e 算例：45° 两分量与理想 √2/2 差 <1e-15（方向对角）',
    Math.abs(v45.x - Math.SQRT1_2) < 1e-15 && Math.abs(v45.y - Math.SQRT1_2) < 1e-15 && Math.abs(v45.x - v45.y) < 1e-15,
    v45)
  check('W2f 单位长：`x²+y² === 1`（12 个角度，浮点 1e-12 内）',
    cases.every((d) => { const v = WEVector.angleVector2(d); return Math.abs(v.x * v.x + v.y * v.y - 1) < 1e-12 }))
  check('W2g `vectorAngle2` 是 `angleVector2` 的逆（角度 ∈ (−180,180] 往返闭合到 1e-9）',
    cases.filter((d) => d > -180 && d <= 180).every((d) => Math.abs(WEVector.vectorAngle2(WEVector.angleVector2(d)) - d) < 1e-9),
    cases.map((d) => d + '→' + WEVector.vectorAngle2(WEVector.angleVector2(d))))
  check('W2h `vectorAngle2` 直接算例：+x→0、+y→90、−x→180、−y→−90（度，atan2 口径）',
    WEVector.vectorAngle2({ x: 1, y: 0 }) === 0 && WEVector.vectorAngle2({ x: 0, y: 1 }) === 90 &&
    WEVector.vectorAngle2({ x: -1, y: 0 }) === 180 && WEVector.vectorAngle2({ x: 0, y: -1 }) === -90,
    [WEVector.vectorAngle2({ x: 1, y: 0 }), WEVector.vectorAngle2({ x: 0, y: 1 }), WEVector.vectorAngle2({ x: -1, y: 0 }), WEVector.vectorAngle2({ x: 0, y: -1 })])
}

out('\n[W3] 三个模块命名空间**互不串**（`WEVector` 不是 `WEColor` 的马甲）')
{
  check('W3a `WEVector.mix` / `.hsv2rgb` / `.smoothStep` 必须 undefined（这些只属于 WEColor / WEMath）',
    WEVector.mix === undefined && WEVector.hsv2rgb === undefined && WEVector.smoothStep === undefined)
  check('W3b `WEColor.angleVector2` / `WEMath.angleVector2` 必须 undefined（反向也不能串）',
    WEColor.angleVector2 === undefined)
  // 走真实编译路径验证一次（不是只看导出对象）
  const probe = `import * as WEVector from 'WEVector';\nimport * as WEColor from 'WEColor';\nexport function update(v){\n  shared.__probe = {\n    av: typeof WEVector.angleVector2, va: typeof WEVector.vectorAngle2,\n    mix: typeof WEVector.mix, hsv: typeof WEVector.hsv2rgb,\n    cmix: typeof WEColor.mix, cang: typeof WEColor.angleVector2,\n    deg: WEVector.angleVector2(90).y, rt: WEVector.vectorAngle2({x:0,y:1}),\n  };\n  return v\n}`
  const shared = {}
  const errs = []
  applySceneScripts({ objects: [{ visible: { script: probe, value: false } }] }, 0, { canvasSize: { x: 100, y: 100 }, shared, onError: (p, e) => errs.push(p + ':' + (e && e.message)) })
  const pr = shared.__probe || {}
  check('W3c 编译后的沙箱里：`WEVector.angleVector2`/`vectorAngle2` 是函数、`WEVector.mix`/`hsv2rgb` 是 undefined、`WEColor.mix` 仍在',
    errs.length === 0 && pr.av === 'function' && pr.va === 'function' && pr.mix === 'undefined' && pr.hsv === 'undefined' && pr.cmix === 'function' && pr.cang === 'undefined',
    { errs, pr })
  check('W3d 同一探针的数值经沙箱往返仍是官方值（90°→y=1；vectorAngle2(+y)=90）', pr.deg === 1 && pr.rt === 90, pr)
}

// ═══════════════════════════ 5. W4 WEMath / WEColor 官方导出面 ═══════════════════════════
out('\n[W4] `WEMath` / `WEColor` 官方导出面与数值')
{
  // WEMath 的命名空间**只活在沙箱 context 里**（`scene-scripts.js` 的 `__WEMath`，不是一个导出的模块对象）
  // ⇒ 走真实编译路径取数（这也正是脚本看到的那一份）。
  const probe = `import * as WEMath from 'WEMath';\nexport function update(v){\n  shared.__m = {\n    ss: WEMath.smoothStep(0,1,0.5), ss0: WEMath.smoothStep(0,1,-1), ss1: WEMath.smoothStep(0,1,2),\n    ss2: WEMath.smoothStep(2,10,6), mix: WEMath.mix(2,8,0.25),\n    deg2rad: WEMath.deg2rad, rad2deg: WEMath.rad2deg, ang: typeof WEMath.angleVector2,\n  };\n  return v\n}`
  const sh = {}
  const errs = []
  applySceneScripts({ objects: [{ visible: { script: probe, value: false } }] }, 0, { canvasSize: { x: 100, y: 100 }, shared: sh, onError: (p, e) => errs.push(p + ':' + (e && e.message)) })
  const M = sh.__m || {}
  check('W4a `WEMath`：`smoothStep(0,1,0.5)=0.5`、`(−1)=0`、`(2)=1`、`(2,10,6)=0.5`；`mix(2,8,0.25)=3.5`',
    errs.length === 0 && M.ss === 0.5 && M.ss0 === 0 && M.ss1 === 1 && M.ss2 === 0.5 && M.mix === 3.5,
    { errs, M })
  check('W4b `WEMath.deg2rad === π/180`、`rad2deg === 180/π`（与 WEVector 共用同一对常数）；`WEMath.angleVector2` 不存在（不属于 WEMath）',
    M.deg2rad === DEG2RAD && M.rad2deg === RAD2DEG && DEG2RAD === Math.PI / 180 && RAD2DEG === 180 / Math.PI && M.ang === 'undefined',
    [M.deg2rad, DEG2RAD, M.rad2deg, RAD2DEG, M.ang])
  const c = WEColor
  const rgba2 = c.rgb2hsv({ x: 1, y: 0, z: 0 }), rgbg2 = c.rgb2hsv({ x: 0, y: 1, z: 0 }), rgbb2 = c.rgb2hsv({ x: 0, y: 0, z: 1 })
  check('W4c `WEColor.rgb2hsv` 算例：纯红→(0,1,1)、纯绿→(1/3,1,1)、纯蓝→(2/3,1,1)',
    Math.abs(rgba2.x - 0) < 1e-12 && rgba2.y === 1 && rgba2.z === 1 &&
    Math.abs(rgbg2.x - 1 / 3) < 1e-12 && Math.abs(rgbb2.x - 2 / 3) < 1e-12,
    [rgba2, rgbg2, rgbb2])
  const rt = c.hsv2rgb(c.rgb2hsv({ x: 0.2, y: 0.6, z: 0.9 }))
  check('W4d `hsv2rgb(rgb2hsv(v))` 往返回到 v（1e-12 内）',
    Math.abs(rt.x - 0.2) < 1e-12 && Math.abs(rt.y - 0.6) < 1e-12 && Math.abs(rt.z - 0.9) < 1e-12, rt)
  const nm = c.normalizeColor({ x: 255, y: 128, z: 0 }), ep = c.expandColor({ x: 1, y: 0.5, z: 0 })
  check('W4e `normalizeColor` 255→1（÷255）、`expandColor` 1→255（×255），返回带 x/y/z 的向量',
    nm.x === 1 && Math.abs(nm.y - 128 / 255) < 1e-12 && nm.z === 0 && ep.x === 255 && ep.y === 127.5 && ep.z === 0,
    [nm, ep])
}

// ═══════════════════════════ 6. W5 未知模块名 + W5b scriptProperties 活槽 ═══════════════════════════
out('\n[W5] 表外模块名 → 空命名空间；scriptProperties 活槽')
{
  const probe = `import * as Foo from 'NoSuchModule';\nexport function update(v){ shared.__probe = { t: typeof Foo, mix: typeof Foo.mix, av: typeof Foo.angleVector2 }; return v }`
  const shared = {}
  const errs = []
  applySceneScripts({ objects: [{ visible: { script: probe, value: false } }] }, 0, { canvasSize: { x: 100, y: 100 }, shared, onError: (p, e) => errs.push(p + ':' + (e && e.message)) })
  check('W5a 未知模块名不抛编译错、且拿到的是**空**命名空间（`Foo.mix`/`Foo.angleVector2` 都 undefined ⇒ 没有别名到 WEColor）',
    errs.length === 0 && shared.__probe && shared.__probe.t === 'object' && shared.__probe.mix === 'undefined' && shared.__probe.av === 'undefined',
    { errs, pr: shared.__probe })
  // W5b：`.finish()` **之后**的顶层读取（语料里确有这种写法）
  const probe2 = `export var scriptProperties = createScriptProperties()\n  .addSlider({ name: 'step', label: 's', value: 16 })\n  .addCheckbox({ name: 'on', label: 'o', value: true })\n  .finish();\nconst TOPSTEP = scriptProperties.step / 1000;\nconst props = scriptProperties;\nexport function init(){ shared.__initStep = props.step; return 0 }\nexport function update(v){ shared.__probe = { top: TOPSTEP, captured: props.on }; return v }`
  const shared2 = {}
  const errs2 = []
  applySceneScripts({ objects: [{ visible: { script: probe2, value: 0, scriptproperties: { step: 20 } } }] }, 0, { canvasSize: { x: 100, y: 100 }, shared: shared2, onError: (p, e) => errs2.push(p + ':' + (e && e.message)) })
  check('W5b 顶层 `.finish()` 之后的 `scriptProperties.<x>` 读取拿到声明默认值（旧实现是 `null.x` → TypeError）',
    errs2.length === 0 && shared2.__probe && shared2.__probe.top === 0.016,
    { errs: errs2, pr: shared2.__probe })
  check('W5c 顶层 `const props = scriptProperties` 捕获到的是**活对象**：对象级覆盖（step:20）对它可见',
    shared2.__probe && shared2.__probe.captured === true && shared2.__initStep === 20,
    { pr: shared2.__probe, initStep: shared2.__initStep })
  check('W5d `new Vec3(Vec2)` ⇒ z 分量是 **0**（官方构造签名；旧实现取 `x.z` 得 undefined ⇒ 下游 NaN）',
    (() => { const v = new Vec3(new Vec2(3, 4)); return v.x === 3 && v.y === 4 && v.z === 0 })() &&
    (() => { const v = new Vec3(new Vec3(1, 2, 3)); return v.z === 3 })())
}

// ═══════════════════════════ 7. W6 真包 洛茜_11 ═══════════════════════════
out('\n[W6] 真包 `wallpaperE/洛茜/洛茜_11.mpkg`：该层脚本不再抛 `angleVector2` TypeError + 数值对齐手算')
const LUOQIAN = path.join(CORPUS, 'wallpaperE', '洛茜', '洛茜_11.mpkg')
if (!fs.existsSync(LUOQIAN)) {
  skipItem('W6 真包 洛茜_11（WEVector 活代码容器）', '文件不存在：' + LUOQIAN)
} else {
  const idx = readIndexHead(LUOQIAN, 4 << 20)
  const sjEntry = idx.entries.find((e) => /(^|\/)scene\.json$/i.test(e.name))
  const scene = JSON.parse(readEntryBytes(LUOQIAN, idx, sjEntry).toString('utf8'))
  const obj = (scene.objects || []).find((o) => o && o.visible && typeof o.visible.script === 'string' && /WEVector\.angleVector2/.test(o.visible.script) && !/^\s*\/\//m.test(o.visible.script.split('\n').find((l) => /WEVector\.angleVector2/.test(l)) || ''))
  check('W6a 在包里定位到那条**活代码**调用（不是注释里的示例片段）',
    !!obj && /const direction = new Vec3\(WEVector\.angleVector2\(angle\)\)/.test(obj.visible.script), obj && obj.name)
  if (obj) {
    // 手算口径（官方定义）：θ_i = i·(props.angle / totalBars)，totalBars = targetAudioBuffer×cloneMultiplier
    const sp = typeof obj.visible.scriptproperties === 'string' ? JSON.parse(obj.visible.scriptproperties) : (obj.visible.scriptproperties || {})
    const center = String(obj.origin).trim().split(/\s+/).map(Number)
    const K = Number(sp.circleScale), TOTAL = Math.round(Number(sp.targetAudioBuffer) * Number(sp.cloneMultiplier || 1)), PER = Number(sp.angle) / TOTAL
    // thisScene 桩：只补 `makeSceneRef` 里**尚未实现**的方法（ANSWER §2.5 表B#4：createLayer 4 次/
    //   getLayerIndex 2 次/sortLayer 2 次），好让"WEVector 这一条"能被**单独**观察 —— 不补的话
    //   init 会先死在 `thisScene.getLayerIndex is not a function`（那是另一个缺口，属 #4）。
    const objects = (scene.objects || []).map((o) => ({ ...o }))
    const ref = makeSceneRef(objects)
    const created = []
    ref.getLayerIndex = (l) => objects.findIndex((o) => o && o.id === (l && l.id))
    ref.sortLayer = () => {}
    ref.createLayer = () => {
      const rec = { id: 20000 + created.length, name: '', image: '', scale: '1 1 1', size: '0 0', color: '1 1 1', visible: true, alpha: 1, firstOrigin: null, firstAngles: null }
      let _o = null, _a = null
      Object.defineProperty(rec, 'origin', { get: () => _o, set: (v) => { if (rec.firstOrigin === null) rec.firstOrigin = v; _o = v }, enumerable: true })
      Object.defineProperty(rec, 'angles', { get: () => _a, set: (v) => { if (rec.firstAngles === null) rec.firstAngles = v; _a = v }, enumerable: true })
      objects.push(rec); created.push(rec); return rec
    }
    const errs = []
    applySceneScripts({ objects: [obj] }, 0, { canvasSize: { x: 1920, y: 1080 }, userProps: {}, shared: {}, thisScene: ref, onError: (p, e) => errs.push(p + ' :: ' + String(e && (e.message || e))) })
    check('W6b 跑该层脚本 **0 错误**（旧实现这里抛 `WEVector.angleVector2 is not a function`）',
      errs.length === 0, errs.slice(0, 3))
    check('W6c 报错串里**不含** `angleVector2`（判据的字面口径）',
      !errs.some((e) => /angleVector2/.test(e)), errs.filter((e) => /angleVector2/.test(e)).slice(0, 2))
    check('W6d 建出 ' + (TOTAL - 1) + ' 根 bar（`totalBars − 1`，第 0 根就是 thisLayer 自己）', created.length === TOTAL - 1, created.length)
    const bad = [], nan = []
    for (let i = 1; i < created.length + 1; i++) {
      const rec = created[i - 1]
      const th = PER * i, rad = th * Math.PI / 180
      const ex = center[0] + K * Math.cos(rad), ey = center[1] + K * Math.sin(rad)
      const go = rec.firstOrigin
      if (!go || !(Math.abs(go.x - ex) < 1e-9 && Math.abs(go.y - ey) < 1e-9 && go.z === 0)) bad.push(i + ':' + JSON.stringify(go) + '≠(' + ex + ',' + ey + ',0)')
      if (go && (!Number.isFinite(go.x) || !Number.isFinite(go.y) || !Number.isFinite(go.z))) nan.push(i + ':' + JSON.stringify(go))
      if (!rec.firstAngles || rec.firstAngles.z !== th + 90) bad.push(i + ':angles.z=' + (rec.firstAngles && rec.firstAngles.z))
    }
    check('W6e 每根 bar 的 `origin` == 手算 `center + circleScale·(cos θᵢ, sin θᵢ, 0)`（θᵢ = i·' + PER + '°），1e-9 内一致', bad.length === 0, bad.slice(0, 3))
    check('W6f 没有一个分量是 NaN（`Vec3(Vec2)` 的 z 必须是 0 而不是 undefined）', nan.length === 0, nan.slice(0, 3))
    check('W6g 每根 bar 的 `angles.z` == θᵢ + 90（与 origin 同一套角度口径）', bad.filter((s) => /angles/.test(s)).length === 0, bad.filter((s) => /angles/.test(s)).slice(0, 3))
    note('bar#1 实测', JSON.stringify(created[0] && created[0].firstOrigin) + '（center=' + JSON.stringify(center) + ', circleScale=' + K + ', θ₁=' + PER + '°）')
  }
}

// ═══════════════════════════ 8. W7 红-if-reverted（内置变异自检）═══════════════════════════
out('\n[W7] 红-if-reverted：把三处修复分别改回去 ⇒ 子进程必红，且红的正是被点名的那条')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-wevector-'))
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ } })
if (process.env.MPW_SCENE_SCRIPTS) {
  note('W7 变异体运行（MPW_SCENE_SCRIPTS 已设）⇒ 跳过红-if-reverted 自检，避免递归')
} else if (!MUTATION) {
  note('W7 红-if-reverted 自检被 --no-mutation 跳过（本次运行**未**复核变异必红）')
} else {
  const copyTree = (fromDir, toDir) => {
    fs.mkdirSync(toDir, { recursive: true })
    for (const name of fs.readdirSync(fromDir)) {
      const src = path.join(fromDir, name), dst = path.join(toDir, name)
      let st = null
      try { st = fs.statSync(src) } catch { st = null }
      if (!st) continue
      if (st.isDirectory()) { copyTree(src, dst); continue }
      if (!st.isFile()) continue
      fs.writeFileSync(dst, fs.readFileSync(src))
    }
  }
  const tmpEly = path.join(TMP, 'elysia')
  copyTree(path.join(ROOT, 'elysia'), tmpEly)
  const MUTANTS = [
    {
      id: 'M1', file: 'scene-scripts.js', fix: '模块逐名映射',
      expectName: 'W3c/W6b（WEVector 命名空间与真包 0 错误）', expect: /✗ (W3c|W6b)/,
      desc: '把映射改回旧写法「非 WEMath 一律 WEColor」',
      edits: [["  return Object.prototype.hasOwnProperty.call(NSL_MODULE_GLOBALS, mod)\n    ? NSL_MODULE_GLOBALS[mod]\n    : NSL_UNKNOWN_MODULE_GLOBAL;", "  return mod === 'WEMath' ? '__WEMath' : '__WEColor';"]],
    },
    {
      id: 'M2', file: 'scene-script-apis.js', fix: '`Vec3(Vec2)` 的 z=0',
      expectName: 'W5d/W6f（z 必须是 0 而不是 undefined/NaN）', expect: /✗ (W5d|W6f)/,
      desc: '去掉 Vec3 构造里对 Vec2 的 z 补 0',
      edits: [['this.z = x.z !== undefined ? x.z : 0;', 'this.z = x.z;']],
    },
    {
      id: 'M3', file: 'scene-scripts.js', fix: '`scriptProperties` 活槽',
      expectName: 'W5b/W5c（顶层读取不再是 null 读）', expect: /✗ (W5b|W5c)/,
      desc: '把 `__scriptProperties` 打回改动前的 `null`（顶层捕获/顶层读取恒 null）',
      edits: [['__scriptProperties: scriptPropsSlot, // 脚本内 scriptProperties 引用（①P-127 A① 活槽，见上）', '__scriptProperties: null,']],
    },
  ]
  for (const m of MUTANTS) {
    const target = path.join(tmpEly, m.file)
    const base = fs.readFileSync(target, 'utf8')
    let src = base, bad = null
    for (const [from, to] of m.edits) {
      const n = src.split(from).length - 1
      if (n !== 1) { bad = '锚点命中 ' + n + ' 次：' + JSON.stringify(from.slice(0, 70)); break }
      src = src.split(from).join(to)
    }
    if (bad) { skipItem('W7-' + m.id, bad + '（实现那几行已被改写 ⇒ 需重新标定；不做变异＝不算证据）'); continue }
    fs.writeFileSync(target, src)
    const r = spawnSync(process.execPath, [process.argv[1], '--no-mutation'], {
      encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
      env: Object.assign({}, process.env, { MPW_SCENE_SCRIPTS: path.join(tmpEly, 'scene-scripts.js') }),
    })
    const so = String(r.stdout || '') + String(r.stderr || '')
    const redLine = (so.match(/✗ [^\n]*/g) || []).slice(0, 3).join(' ｜ ') || ''
    check('W7-' + m.id + '（' + m.fix + '）变异「' + m.desc + '」⇒ 子进程 rc=1 且 ' + m.expectName + ' 变红',
      r.status === 1 && m.expect.test(so), 'rc=' + r.status + ' 红=' + JSON.stringify(redLine.slice(0, 220)))
    check('W7-' + m.id + 'b 变异体里基线仍 ✓（W2b 在变异体里仍成立 ⇒ 红是被点名的那条，不是副本加载不起来）',
      /✓ W2b/.test(so) && /✓ W1a/.test(so), '')
    if (VERBOSE) note('W7-' + m.id + ' 子进程输出尾部', JSON.stringify(so.slice(-700)))
    fs.writeFileSync(target, base)   // 复位，供下一个变异体用（每个变异体独立）
  }
}

// ═══════════════════════════ 9. 汇总 ═══════════════════════════
const peak = (() => { try { const m = fs.readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\s*(\d+)/); return m ? Math.round(+m[1] / 1024) + 'MB' : '?' } catch { return '?' } })()
out('\n(计票：pass=' + pass + ' fail=' + fail + ' skip=' + skip + '；PeakRSS=' + peak + ')')
if (fail) {
  out('\n' + fail + ' 项失败')
  process.exit(1)
}
out('\nALL PASS （' + pass + ' 项' + (skip ? '，另 SKIP ' + skip : '') + '）')
process.exit(0)

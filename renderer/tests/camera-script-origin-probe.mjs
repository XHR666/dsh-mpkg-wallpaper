// camera-script-origin-probe.mjs — 相机对象「逐属性脚本 origin」离线取证（P1-1 缺口的量化工具）
//
// 这个工具回答一个问题（用真实数据 + 真实脚本宿主，不猜）：
//   「语料里哪些**相机对象**的 origin 是 `{script:…, value:…}`？那些脚本真跑起来会把 origin 算成多少？
//     和今天渲染器读到的**静态快照**差多少？」
//
// 现状依据（**读实现得出，不是听说的**；行号是本次实测时的行号）：
//   · `core/we-scene-bundle.js` 解析对象 origin：`:1236`（对象属性可能是 {animation:…}/{script:…}）、
//     图层静态快照取 `.value` 的地方在 `:1340`；相机对象识别 = `:1512-1513`
//     `(sceneJson.objects||[]).find(x => x && typeof x.camera === 'string')`。
//   · 相机节点只接 `zoom` 的**用户绑定**、**明确不接 origin 脚本**：`:2202-2204` 的注释写着
//     「语料 6/7 个包的 `origin` 是逐属性脚本（`{script:…, value:"2434.38 725.25 500"}`），
//      其静态基值是编辑器残留 —— 实测若按它平移，取景会整体偏 2434px（P-69 因此明确保持 inert）」。
//     ⇒ 本工具就是对这句话的**独立量化复核**：脚本真跑起来并不是那个残留值。
//     ⚠ 实测口径差一处，如实记下：那句注释说「6/7 个包」，按全语料（含 `0917/**` 与 `wallpapertest1/*.mpkg`
//       等此前没扫进去的容器）**实际是 14 个包**；`-2434px` 那条平移量的量级则被本次求值复现（Δx=−2434.38477）。
//   · 脚本宿主**存在且在跑**：`elysia/scene-scripts.js` 的 `applySceneScripts`（`:635`）、
//     `runScriptValueCached`（`:491`，按脚本源缓存 + init 一趟/update 每趟）、
//     对象级 `scriptproperties` 覆盖（`:537-560`，`{user:名}` 优先取 userProps，否则回退 `value`）。
//     `demo.html:2851` 的调用形状 = `applySceneScripts(sceneObj /* 原始 scene.json */, tSec, {
//     renderObjects: sceneObj.objects, userProps: window.__mpwUserProps, canvasSize, frametime, shared })`
//     —— 本工具按其形状离线复刻（canvasSize 用参考分辨率，默认 3840×2160）。
//
// 【只读、无浏览器、无像素结论】
//   · 只 **import** `elysia/scene-scripts.js` 与 `core/we-scene-bundle.js` 的导出；不改任何文件
//     （唯一写盘 = reports/ 下的 JSON，reports/ 已被 .gitignore 忽略；本工具**不写临时文件**，无 mkdtemp）。
//   · 不碰 `core/**`、`demo.html`、`tests/run-all-tests.sh`；渲染路径一行未动。
//   · 本机无 GPU / 无 WebGL2，且**禁止启动浏览器**（两次宿主机死机的教训）⇒ 全部结论都是
//     **文本/数值级**（脚本求值结果、字符串 diff、计数），**不含任何像素/成像声明**。
//
// 【命中判据（从真实数据确认，不是拍脑袋）】
//   相机对象 := `scene.json` 的 `objects[]` 里 `typeof o.camera === 'string'`（与渲染器 `:1513` 同一判据）。
//   命中     := 该对象上 `origin` 或 `zoom` 是 `{script: <字符串>}` 形态的节点（`origin` 为主动脉）。
//   语料实测（2026-09-18 本机）：98 个包容器（53 个含 scene.json；45 个 PKGM0014 视频壁纸没有 scene.json）
//   + 171 个散装 scene.json ⇒ **16 个相机对象**，其中 **14 个命中**（全部来自 `origin.script`；
//   `zoom` 在所有相机对象上都是 `{user:…}` 用户绑定，没有一个是脚本）。
//   剩下 2 个相机对象：`0917/3509243656`（origin 是普通字符串）、`dd/3554161528`（origin 关键帧 `{animation:…}`）⇒ 不在本工具射程。
//
// 【资源纪律（这台机器内存吃紧）】
//   从不整包读入（语料单包最大 793MB）。只读"表头前缀"（64KB 起、不够按 4 倍增长，实测 98/98 个包 64KB 就够）
//   + `scene.json` 精确切片（最大约 1MB）；脚本求值只对**命中包**做。实测整轮 0.9–1.3 秒、
//   RSS ≈ 111 MB（实测值也写进 JSON 的 `env.peakRssMb` / `env.elapsedMs`）。
//   **不跑** run-all-tests.sh，也不启动任何浏览器。
//
// 【用法】
//   node tests/camera-script-origin-probe.mjs [选项]
//     --id=<包id>       只处理一个包。id 形如 `dd/3327063360`、`0917/3448877775`、
//                       `wallpaperE/伊蕾娜/夜莺…day_night`；也接受末段名（`3327063360`）。
//                       不唯一 → 退 2 并列出候选；一个都没匹配上 → 退 2。
//     --out=<路径>      机读 JSON 落盘路径（默认 reports/camera-script-origin/<epochms>.json）
//     --json            stdout **只**输出机读 JSON（人读表改走 stderr；便于 `| jq`）
//     --script          人读表里打印脚本**全文**（默认只打 sha256 + 折叠预览；JSON 里永远有全文）
//     --canvas=<WxH>    传给脚本的 engine.canvasSize（默认 3840x2160，与仓库其它测试同一参考分辨率）
//     --ticks=<N>       init/update 各跑几趟（默认 3 ⇒ t=0,1,2）
//     --userprops=<project|none>  脚本宿主收到的用户属性表来源（默认 project = project.json 的
//                       general.properties 经 lib.propsDefaults 规范化后的默认值；none = 传 {}，
//                       此时宿主会回退到对象 scriptproperties 里存的 value）
//     --no-ab           跳过「无 userProps」A/B 变体（少跑一趟，只影响信息量）
//     --root=<目录>     覆盖语料根（默认 env MPW_ROOT，再退工作区根 WS = 仓库的上一级）
//     -h | --help       用法
//
// 【退出码】
//   0 = 正常出表。**包括「一个命中都没有」**：那种情况打一行
//       `SKIP camera-script-origin-probe（语料里没有 origin.script 相机）` 并退 0（不冒充通过）。
//   1 = 工具自身出错：语料读不了、宿主 `applySceneScripts` 自己抛异常、自检 FAIL、或 JSON 落盘写不进去
//       （都会打印是哪个包 / 哪条自检 / 哪个路径）。
//   2 = 用法错误（未知开关、--id 匹配不上或不唯一、--canvas/--ticks/--userprops 值非法、--out= 为空）。
//
// 注册待办：add "camera-script-origin" "node tests/camera-script-origin-probe.mjs" "" "^SKIP camera-script-origin"
//   （等 run-all-tests.sh 释放后加；本文件**不改** run-all-tests.sh）
//
// 【自检（真计票，无恒真断言）】
//   每条 `check(name, cond, detail)` 都是 `cond ? pass++ : fail++`；纯信息用 `note()`，**不计数**。
//   反向自证三条（故意把宿主换成空实现 / 换输入，看结论会不会跟着变）：
//     · nohost  : 用**空宿主**（`applySceneScripts` 什么都不做）跑同一段管线 ⇒ 值必须与静态快照**逐字相同**
//                 ⇒ 证明「差」是宿主算出来的，不是读取/克隆路径自己造的。
//     · isolate : 只留相机对象一个对象跑宿主 ⇒ 求值结果必须与全场景跑一致，且**仍然 ≠ 静态**
//                 ⇒ 证明这个「差」来自**相机自己的脚本**，不是别的层顺手改了相机。
//     · mutate  : 把相机脚本绑定的用户属性往 min/max 内挪一格再跑 ⇒ 求值结果必须**跟着变**
//                 ⇒ 证明宿主真的在用脚本算（照抄静态快照的假实现会被这条抓住）。
//   语料变化时的明确态度：0 命中 ⇒ 打 `^SKIP camera-script-origin` 行退 0；自检红 ⇒ 退 1；不静默变绿。
//   ⑤ 命中数：**不写成恒真的 check**。0 命中时任务书要求"打 SKIP 行退 0"，写成 check 要么恒真、
//      要么把"语料确实没有"误判成故障 ⇒ 0 命中走显式 `skip`（JSON 里 corpus.hits=0 可查），
//      ≥1 时改跑一条**可假**的"命中判据自洽"检查（判据漂了会红）。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT, WS } from './_root.mjs'

// ── 渲染器 import 前的最小环境（bundle 顶层读 location/search，Node 里没有）──
globalThis.location = globalThis.location || { search: '', href: 'http://localhost/' }
const lib = await import('../core/we-scene-bundle.js')
const host = await import('../elysia/scene-scripts.js')

const DEC = new TextDecoder()

// ════════════════════════════════════════════════════════════════════════════
// ① 参数解析（用法错误一律退 2，打印原因）
// ════════════════════════════════════════════════════════════════════════════
const USAGE = `用法：node tests/camera-script-origin-probe.mjs [选项]
  --id=<包id>        只处理一个包（如 dd/3327063360 / 3327063360）
  --out=<路径>       机读 JSON 落盘路径（默认 reports/camera-script-origin/<epochms>.json）
  --json             stdout 只输出机读 JSON（人读表走 stderr）
  --script           人读表打印脚本全文
  --canvas=<WxH>     脚本 engine.canvasSize（默认 3840x2160）
  --ticks=<N>        init/update 各跑 N 趟（默认 3）
  --userprops=<project|none>  脚本宿主收到的用户属性表（默认 project）
  --no-ab            跳过「无 userProps」A/B 变体
  --root=<目录>      覆盖语料根（默认 $MPW_ROOT）
  -h | --help        本帮助
退出码：0 正常（含 0 命中 ⇒ SKIP 行）；1 工具自身出错/自检 FAIL；2 用法错误`

const argv = process.argv.slice(2)
const opt = { id: null, out: null, json: false, script: false, canvas: [3840, 2160], ticks: 3, userprops: 'project', ab: true, root: null }
for (const a of argv) {
  if (a === '-h' || a === '--help') { fs.writeSync(1, USAGE + '\n'); process.exit(0) }
  else if (a === '--json') opt.json = true
  else if (a === '--script') opt.script = true
  else if (a === '--no-ab') opt.ab = false
  else if (a.startsWith('--id=')) opt.id = a.slice(5)
  else if (a.startsWith('--out=')) opt.out = a.slice(6)
  else if (a.startsWith('--root=')) opt.root = a.slice(7)
  else if (a.startsWith('--canvas=')) {
    const m = /^(\d+)x(\d+)$/.exec(a.slice(9))
    if (!m) { fs.writeSync(2, '用法错误：--canvas 需要 WxH 形态（例 --canvas=3840x2160），收到 ' + JSON.stringify(a.slice(9)) + '\n'); process.exit(2) }
    opt.canvas = [Number(m[1]), Number(m[2])]
    if (!(opt.canvas[0] > 0 && opt.canvas[1] > 0)) { fs.writeSync(2, '用法错误：--canvas 长宽必须为正\n'); process.exit(2) }
  } else if (a.startsWith('--ticks=')) {
    const n = Number(a.slice(8))
    if (!Number.isInteger(n) || n < 1 || n > 600) { fs.writeSync(2, '用法错误：--ticks 需要 1..600 的整数，收到 ' + JSON.stringify(a.slice(8)) + '\n'); process.exit(2) }
    opt.ticks = n
  } else if (a.startsWith('--userprops=')) {
    const v = a.slice(12)
    if (v !== 'project' && v !== 'none') { fs.writeSync(2, '用法错误：--userprops 只认 project|none，收到 ' + JSON.stringify(v) + '\n'); process.exit(2) }
    opt.userprops = v
  } else { fs.writeSync(2, '用法错误：未知开关 ' + JSON.stringify(a) + '\n' + USAGE + '\n'); process.exit(2) }
}
if (opt.out === '') { fs.writeSync(2, '用法错误：--out= 不能为空\n'); process.exit(2) }

const MPW = opt.root || process.env.MPW_ROOT || WS
const CORPUS = path.join(MPW, 'allwallpaper')
const ASSETS = path.join(MPW, 'wallpaper_engine', 'assets')

// ════════════════════════════════════════════════════════════════════════════
// ② 计票与输出（check = 真计票；note = 纯信息不计票，避免"看着像通过"的假绿）
// ════════════════════════════════════════════════════════════════════════════
let pass = 0, fail = 0, skipN = 0
const fails = []
const checkItems = []                  // 供 JSON 落盘：每条自检的名字 + 结果（不丢信息）
const human = []                       // 人读表（最后一次性同步写出，避免 process.exit 截断管道）
const say = (s) => human.push(s)
const check = (name, cond, detail) => {
  if (cond) { pass++; say('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); say('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
  checkItems.push({ name, ok: !!cond, detail: detail || '' })
  return !!cond
}
const skip = (name, detail) => {
  skipN++
  say('  ↷ SKIP ' + name + (detail ? '  [' + detail + ']' : ''))
  checkItems.push({ name, skipped: true, detail: detail || '' })
}
const note = (s) => say('  · ' + s)
const die = (msg, code = 1) => { flush(); fs.writeSync(2, msg + '\n'); process.exit(code) }
function flush() {
  const text = human.join('\n') + '\n'
  if (opt.json) fs.writeSync(2, text)          // --json ⇒ 人读表走 stderr
  else fs.writeSync(1, text)
}

// ════════════════════════════════════════════════════════════════════════════
// ③ 语料枚举 + 包内条目读取
//    为什么不用 fs.readFileSync(pkg)：语料里有 793MB 的 .mpkg，全量读进内存会爆。
//    这里只读"表头前缀"（parsePkg 只依赖表头；前缀不够就按 4 倍增长重读），
//    再按条目 offset/size **精确切片** —— 仍然复用本仓库的 parsePkg / getEntry。
// ════════════════════════════════════════════════════════════════════════════
function walkFiles(dir, out = []) {
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else out.push(p)
  }
  return out
}
/** 包 id：`scene.pkg` 用所在目录（dd/3327063360），其它容器用去掉扩展名的相对路径。 */
function pkgIdOf(file) {
  const rel = path.relative(CORPUS, file)
  const base = path.basename(rel)
  return /^scene\.pkg$/i.test(base) ? path.dirname(rel) : rel.replace(/\.(mpkg|pkg)$/i, '')
}
function enumerateCorpus() {
  const packs = []
  for (const f of walkFiles(CORPUS)) if (/\.(mpkg|pkg)$/i.test(f)) packs.push({ id: pkgIdOf(f), kind: 'pack', file: f })
  packs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const loose = []
  for (const f of walkFiles(ASSETS)) if (path.basename(f) === 'scene.json') loose.push({ id: 'assets/' + path.relative(ASSETS, f), kind: 'loose', file: f })
  loose.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { packs, loose }
}
/** 读一个包容器：表头（parsePkg）+ 想要的条目切片（getEntry）。返回 { magic, entries, parts }。 */
function readContainer(file, want) {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    let cap = 1 << 16, pkg = null, lastErr = null
    for (;;) {
      const buf = Buffer.alloc(Math.min(cap, size))
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      try { pkg = lib.parsePkg(new Uint8Array(buf.buffer, buf.byteOffset, n)); break } catch (e) {
        lastErr = e
        if (cap >= (1 << 26)) throw new Error('表头读不出来（已读到 ' + cap + ' 字节）: ' + e.message)
        cap *= 4
      }
    }
    const parts = {}
    for (const name of want) {
      const e = pkg.entries.find((x) => x.name === name)
      if (!e) { parts[name] = null; continue }
      const off = pkg.dataStart + e.offset
      if (off + e.size > size) throw new Error('条目 ' + name + ' 越界（' + off + '+' + e.size + ' > ' + size + '）')
      const slice = Buffer.alloc(e.size)
      const got = fs.readSync(fd, slice, 0, e.size, off)
      if (got !== e.size) throw new Error('条目 ' + name + ' 只读到 ' + got + '/' + e.size + ' 字节')
      // 复用仓库自有访问器：造一个"只含该条目"的迷你 pkg（dataStart=0 ⇒ getEntry 就地切片）
      const mini = { ...pkg, dataStart: 0, fileSize: slice.length, entries: [{ name, offset: 0, size: e.size }], buf: slice }
      parts[name] = lib.getEntry(mini, name)
    }
    return { magic: pkg.magic, entryCount: pkg.entries.length, parts, lastErr: lastErr ? String(lastErr.message) : null }
  } finally { fs.closeSync(fd) }
}
const parseJsonBytes = (u8) => JSON.parse(DEC.decode(u8).replace(/^\uFEFF/, ''))

// ── 用户属性来源（与 demo 的 window.__mpwUserProps 同口径：project.json 的默认值）──
function userPropsFor(pk, container) {
  let proj = null, from = 'none'
  const onDisk = path.join(path.dirname(pk.file), 'project.json')
  if (fs.existsSync(onDisk)) { try { proj = JSON.parse(fs.readFileSync(onDisk, 'utf8').replace(/^\uFEFF/, '')); from = 'project.json(盘上)' } catch { proj = null } }
  if (!proj && container && container.parts['project.json']) {
    try { proj = parseJsonBytes(container.parts['project.json']); from = 'project.json(包内)' } catch { proj = null }
  }
  const schema = (proj && proj.general && proj.general.properties) || null
  if (opt.userprops === 'none') return { props: {}, source: 'none(--userprops=none)', schema }
  if (!schema) return { props: {}, source: from === 'none' ? 'none(无 project.json)' : from + ' 但缺 general.properties', schema: null }
  return { props: lib.propsDefaults(schema), source: from + ' general.properties 默认值(' + Object.keys(schema).length + ' 项)', schema }
}

// ════════════════════════════════════════════════════════════════════════════
// ④ 宿主离线求值（同一段管线可换宿主实现 ⇒ nohost 反向自证）
// ════════════════════════════════════════════════════════════════════════════
const EMPTY_HOST = { createScriptCache: () => ({ map: new Map(), shared: {} }), applySceneScripts: () => {} }
const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug }
function muteConsole(sink) {
  for (const k of Object.keys(realConsole)) console[k] = (...a) => { try { sink.push(a.map(String).join(' ')) } catch { /* ignore */ } }
}
function unmuteConsole() { for (const k of Object.keys(realConsole)) console[k] = realConsole[k] }

const clone = (v) => JSON.parse(JSON.stringify(v))
const findCam = (scene, id) => (scene.objects || []).find((o) => o && o.id === id && typeof o.camera === 'string')
/** 属性节点的"人读值"：{script,value} 取 .value；被脚本直接赋值改写成字符串时就是那个字符串。 */
const propVal = (node) => (node && typeof node === 'object' && !Array.isArray(node)) ? ('value' in node ? node.value : null) : (node === undefined ? null : node)
/** 逐键 diff（只比相机对象自己的键）⇒ "脚本实际改动的字段"。
 *  值一律收敛到"人读值"（{script,value} 取 .value）—— 否则打印出来两条都是脚本原文前 40 字，看着像没变。 */
function diffKeys(before, after) {
  const out = []
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = JSON.stringify(before ? before[k] : null), b = JSON.stringify(after ? after[k] : null)
    if (a !== b) out.push({ key: k, beforeVal: propVal(before ? before[k] : null), afterVal: propVal(after ? after[k] : null), beforeJson: a.slice(0, 80), afterJson: b.slice(0, 80) })
  }
  return out
}
/**
 * 跑一个变体。opts: { mode:'full'|'isolate', hostImpl, userProps }
 * 返回 { originRaw, changedKeys, scriptErrors, hostThrew, entry, cacheSize }
 */
/** 脚本缓存 entry → 可落盘的诊断（"这条命中的脚本到底跑起来没有"就看它）。 */
function entryOf(entry) {
  return entry ? {
    compiled: true,
    compileError: entry.error ? String(entry.error).slice(0, 200) : null,
    disabled: !!entry.disabled,
    initError: entry.initError ? String(entry.initError).slice(0, 200) : null,
    initialized: !!entry.initialized,
    updateErrors: entry.updateErrors || 0,
    hasInit: typeof (entry.exports || {}).init === 'function',
    hasUpdate: typeof (entry.exports || {}).update === 'function',
    hasApplyUserProperties: typeof (entry.exports || {}).applyUserProperties === 'function',
  } : { compiled: false }
}
/** 一条脚本是否"真的跑起来了"：编译成功、init 没失败、update 没抛错。 */
const entryHealthy = (e) => !!(e && e.compiled && !e.compileError && !e.disabled && e.updateErrors === 0)
function runVariant(sceneJson, camId, scriptKeyOf, o) {
  const h = o.hostImpl || host
  const scene = o.mode === 'isolate'
    ? { objects: [clone(findCam(sceneJson, camId))], general: clone(sceneJson.general || {}) }
    : clone(sceneJson)
  const before = clone(findCam(scene, camId))
  const cache = h.createScriptCache()
  const errs = []
  const scriptLogs = []
  let hostThrew = null
  muteConsole(scriptLogs)
  try {
    for (let i = 0; i < opt.ticks; i++) {
      try {
        h.applySceneScripts(scene, i, {
          renderObjects: scene.objects || [],
          userProps: o.userProps || {},
          canvasSize: { x: opt.canvas[0], y: opt.canvas[1] },
          frametime: 1 / 60,
          runtime: i,
          scriptCache: cache,
          shared: {},
          onError: (stage, e) => errs.push(stage + ': ' + String((e && e.message) || e).slice(0, 160)),
        })
      } catch (e) { hostThrew = String((e && e.message) || e); break }
    }
  } finally { unmuteConsole() }
  const after = findCam(scene, camId)
  const src = scriptKeyOf ? (before[scriptKeyOf] && before[scriptKeyOf].script) : null
  const entry = src ? cache.map.get(src) : null
  return {
    originRaw: propVal(after.origin),
    zoomRaw: propVal(after.zoom),
    changedKeys: diffKeys(before, after),
    scriptErrors: [...new Set(errs)],
    scriptLogs: [...new Set(scriptLogs)].slice(0, 5),
    hostThrew,
    entry: entryOf(entry),
    cacheSize: cache.map.size,
  }
}
const numsOf = (s) => {
  if (typeof s !== 'string') return null
  const p = s.trim().split(/[\s,]+/).map(Number)
  return p.length >= 2 && p.every((x) => isFinite(x)) ? p : null
}
const vec = (s) => { const p = numsOf(s); return p ? [p[0], p[1], p.length > 2 ? p[2] : 0] : null }
const sub = (a, b) => (a && b) ? [a[0] - b[0], a[1] - b[1], a[2] - b[2]] : null
const fmtD = (d) => d ? 'x ' + (Math.abs(d[0]) < 5e-7 ? 0 : d[0]).toFixed(5) + '  y ' + (Math.abs(d[1]) < 5e-7 ? 0 : d[1]).toFixed(5) + '  z ' + (Math.abs(d[2]) < 5e-7 ? 0 : d[2]).toFixed(5) : '(n/a)'
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
const oneLine = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)
const near = (a, b, eps = 1e-9) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= eps)

// ════════════════════════════════════════════════════════════════════════════
// ⑤ 扫描：找出所有「相机对象 + origin/zoom 是脚本」的包
// ════════════════════════════════════════════════════════════════════════════
const sayErr = (s) => fs.writeSync(2, s + '\n')
const t0 = Date.now()
const { packs, loose } = enumerateCorpus()
// 语料根错了 ⇒ 这是"数据读不了"，交给下面的自检 ① 判红退 1（不在这里提前 exit，免得自检 ① 变成恒真）
// --id 过滤：先解析成具体文件，避免为了一个包去读全语料
let only = null
if (opt.id) {
  const allIds = [...packs.map((p) => p.id), ...loose.map((p) => p.id)]
  let hit = allIds.filter((id) => id === opt.id)
  if (!hit.length) hit = allIds.filter((id) => id.endsWith('/' + opt.id) || id.split('/').pop() === opt.id)
  if (!hit.length) { sayErr('用法错误：--id=' + opt.id + ' 在语料里匹配不到任何包/场景（共 ' + allIds.length + ' 个）\n'); process.exit(2) }
  if (hit.length > 1) { sayErr('用法错误：--id=' + opt.id + ' 不唯一，候选 ' + hit.length + ' 个：\n  ' + hit.join('\n  ') + '\n'); process.exit(2) }
  only = hit[0]
}
const packList = only ? packs.filter((p) => p.id === only) : packs
const looseList = only ? loose.filter((p) => p.id === only) : loose

let hitRows = []           // 命中明细（供 JSON 落盘；在 ⑥ 里填）
const readErrors = []      // 数据读不了 ⇒ 退 1
const noScene = []         // 容器读得动但没有 scene.json（PKGM0014 视频壁纸）⇒ 正常跳过
const sceneErrors = []     // scene.json 在但 JSON 坏了
const camObjects = []      // 所有相机对象（含未命中）
const hits = []            // 命中
const looseErrors = []

for (const pk of packList) {
  let c = null
  try { c = readContainer(pk.file, ['scene.json', 'project.json']) } catch (e) { readErrors.push({ id: pk.id, err: String((e && e.message) || e) }); continue }
  if (!c.parts['scene.json']) { noScene.push({ id: pk.id, magic: c.magic, entryCount: c.entryCount }); continue }
  let sj = null
  try { sj = parseJsonBytes(c.parts['scene.json']) } catch (e) { sceneErrors.push({ id: pk.id, err: 'scene.json 解析失败: ' + String((e && e.message) || e) }); continue }
  const up = userPropsFor(pk, c)
  scanScene({ id: pk.id, kind: 'pack', file: path.relative(MPW, pk.file), sj, up, container: c })
}
for (const pk of looseList) {
  let sj = null
  try { sj = JSON.parse(fs.readFileSync(pk.file, 'utf8').replace(/^\uFEFF/, '')) } catch (e) { looseErrors.push({ id: pk.id, err: String((e && e.message) || e) }); continue }
  const up = userPropsFor({ id: pk.id, file: pk.file }, null)
  scanScene({ id: pk.id, kind: 'loose', file: path.relative(MPW, pk.file), sj, up, container: null })
}

function scanScene(ctx) {
  const objs = (ctx.sj && ctx.sj.objects) || []
  for (const o of objs) {
    if (!o || typeof o.camera !== 'string') continue
    const isScript = (k) => !!(o[k] && typeof o[k] === 'object' && typeof o[k].script === 'string' && o[k].script.trim())
    const scriptKeys = ['origin', 'zoom', 'fov', 'angles', 'scale', 'visible', 'alpha'].filter(isScript)
    const rec = {
      id: ctx.id, kind: ctx.kind, file: ctx.file, cameraObjectId: o.id, camera: o.camera, name: o.name || '',
      originScript: isScript('origin'), zoomScript: isScript('zoom'), scriptKeys,
      hitReason: isScript('origin') ? 'origin.script' : (isScript('zoom') ? 'zoom.script' : null),
    }
    camObjects.push(rec)
    if (rec.hitReason) hits.push({ ...ctx, ...rec })
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ⑥ 对每个命中求值 + 三条反向自证
// ════════════════════════════════════════════════════════════════════════════
say('camera-script-origin-probe — 相机对象 origin.script 离线取证（只读渲染器；无像素结论）')
say('语料根 $MPW_ROOT = ' + MPW + (opt.root ? '（--root 覆盖）' : ''))
say('扫描：' + packs.length + ' 个包容器 + ' + loose.length + ' 个散装 scene.json ⇒ ' + camObjects.length + ' 个相机对象' +
  '（判据 typeof o.camera === \'string\'，与 core/we-scene-bundle.js:1513 同）')
const hitPkgs = new Set(hits.map((h) => h.id)).size
say('命中：' + hitPkgs + ' 个包 / ' + hits.length + ' 个相机对象（origin 或 zoom 是 {script:…}）')
say('宿主：elysia/scene-scripts.js applySceneScripts + createScriptCache；canvasSize=' + opt.canvas[0] + 'x' + opt.canvas[1] +
  '；跑 t=0..' + (opt.ticks - 1) + '（init 一趟 + update 每趟）；userProps 口径 = ' + opt.userprops)
say('')
say('── 自检（真计票；纯信息用 · 不计数）──')

// ── 数据完整性 ──
check('① 语料枚举非空（包容器 ' + packs.length + ' / 散装 scene.json ' + loose.length + '）', packs.length + loose.length > 0,
  packs.length + loose.length > 0 ? '语料根 ' + MPW : '语料根下什么都没有 —— 期望 ' + CORPUS + ' 与 ' + ASSETS + '（--root 写错？）')
check('② 没有读不动的包（读不了会打印是哪个包，并退 1）', readErrors.length === 0,
  readErrors.length ? readErrors.map((r) => r.id + ':' + r.err).join(' | ') : '0 个')
check('③ 没有 scene.json 坏掉的包', sceneErrors.length === 0,
  sceneErrors.length ? sceneErrors.map((r) => r.id + ':' + r.err).join(' | ') : '0 个')
check('④ 没有 scene.json 坏掉的散装场景', looseErrors.length === 0,
  looseErrors.length ? looseErrors.map((r) => r.id + ':' + r.err).join(' | ') : '0 个')
note('容器读得动但没有 scene.json（PKGM0014 视频壁纸等，正常跳过）：' + noScene.length + ' 个' +
  (noScene.length ? '，例 ' + noScene.slice(0, 3).map((x) => x.id + '(' + x.magic + '/' + x.entryCount + ' 条目)').join(', ') : ''))

// ── 命中数 ──
// 为什么"命中数 ≥ 1"本身**不**写成一条恒真的 check：命中数 == 0 时任务书要求"打 SKIP 行并退 0"，
// 若把它写成 check 就必然要么恒真（在 hits≥1 分支里）、要么把"语料确实没有"误判成工具故障。
// 所以：0 命中 ⇒ 显式 skip（既不算通过也不算失败，JSON 里 corpus.hits=0 可查）；≥1 ⇒ 跑下面那条
// **可假**的判据自洽检查（判据若漂了会红），命中数本身只作为 detail 打印。
if (hits.length === 0) {
  skip('⑤ 命中数 ≥ 1', '语料里没有 origin.script / zoom.script 的相机对象 —— 按口径打 SKIP 行退 0（JSON 里 corpus.hits=0，不冒充通过）')
  say('')
  say('SKIP camera-script-origin-probe（语料里没有 origin.script 相机）')
} else {
  check('⑤ 命中判据自洽（每条命中都真的带脚本原文，且 hitReason 与实测字段一致）',
    hits.every((h) => h.scriptKeys.length > 0 && h.hitReason === (h.originScript ? 'origin.script' : 'zoom.script')),
    hitPkgs + ' 个包 / ' + hits.length + ' 个相机对象，脚本字段 ' + JSON.stringify([...new Set(hits.flatMap((h) => h.scriptKeys))]))
  say('')
  say('── 命中明细（静态快照 = 不跑脚本时渲染器读到的 `.value`；求值 = 宿主真跑）──')

  const rows = hitRows
  let evalChanged = 0, isolateChanged = 0, mutateChanged = 0, mutateTested = 0, noHostSame = 0, crossOk = 0
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]
    const scriptKeyOf = h.scriptKeys[0]                    // 命中判据决定至少有一个（origin 优先，见①判据顺序）
    const camNode = ((h.sj.objects) || []).find((o) => o && o.id === h.cameraObjectId && typeof o.camera === 'string')
    const staticRaw = propVal(camNode.origin)
    const staticVec = vec(staticRaw)
    const scriptSrc = camNode[scriptKeyOf].script

    // 变体 1：全场景 + 真实宿主 + 配置的 userProps（头条口径）
    const base = runVariant(h.sj, h.cameraObjectId, scriptKeyOf, { mode: 'full', hostImpl: host, userProps: h.up.props })
    // 变体 2：全场景 + 空宿主（反向自证：必须逐字等于静态快照）
    const noHost = runVariant(h.sj, h.cameraObjectId, scriptKeyOf, { mode: 'full', hostImpl: EMPTY_HOST, userProps: h.up.props })
    // 变体 3：只留相机对象 + 真实宿主（归属自证）
    const iso = runVariant(h.sj, h.cameraObjectId, scriptKeyOf, { mode: 'isolate', hostImpl: host, userProps: h.up.props })
    // 变体 4：隔离 + 挪一格用户属性（存在性自证）
    const mutNames = Object.keys((camNode[scriptKeyOf] && camNode[scriptKeyOf].scriptproperties) || {})
      .map((k) => { const v = (camNode[scriptKeyOf].scriptproperties || {})[k]; return v && typeof v === 'object' && typeof v.user === 'string' ? v.user : null })
      .filter((n) => n && Object.prototype.hasOwnProperty.call(h.up.props, n) && isFinite(Number(h.up.props[n])))
    let mutate = null, mutateProps = null
    if (mutNames.length) {
      mutateProps = Object.assign({}, h.up.props)
      for (const n of mutNames) {
        const sch = (h.up.schema || {})[n] || {}
        const lo = isFinite(Number(sch.min)) ? Number(sch.min) : -Infinity
        const hi = isFinite(Number(sch.max)) ? Number(sch.max) : Infinity
        const v = Number(mutateProps[n])
        const step = isFinite(lo) && isFinite(hi) ? Math.max(1e-6, (hi - lo) / 8) : 0.25
        let nv = v + step
        if (nv > hi) nv = v - step
        if (nv < lo || nv === v) nv = v === 0 ? step : 0
        mutateProps[n] = isFinite(lo) && isFinite(hi) ? Math.min(hi, Math.max(lo, nv)) : nv
      }
      mutate = runVariant(h.sj, h.cameraObjectId, scriptKeyOf, { mode: 'isolate', hostImpl: host, userProps: mutateProps })
      mutateTested++
    }
    // 变体 5（可选 A/B）：全场景 + 空 userProps（宿主回退到对象 scriptproperties 的 value）
    const noUser = opt.ab ? runVariant(h.sj, h.cameraObjectId, scriptKeyOf, { mode: 'full', hostImpl: host, userProps: {} }) : null

    // 渲染器侧交叉判据（lib.parseScene 的 cameraNode 用的是同一句 find ⇒ 一致性交叉检查，不是独立真值）
    let crossId = null, crossErr = null
    try { const ps = lib.parseScene(h.sj, null, {}); crossId = ps.cameraNode ? ps.cameraNode.id : null } catch (e) { crossErr = String((e && e.message) || e) }
    if (crossId === h.cameraObjectId) crossOk++

    const evalVec = vec(base.originRaw)
    const d = sub(evalVec, staticVec)
    const dNoUser = noUser ? sub(vec(noUser.originRaw), staticVec) : null
    const dMut = mutate ? sub(vec(mutate.originRaw), vec(iso.originRaw)) : null
    const sameAsStatic = base.originRaw === staticRaw
    const isoEqualsFull = iso.originRaw === base.originRaw
    if (!sameAsStatic) evalChanged++
    if (iso.originRaw !== staticRaw) isolateChanged++
    if (mutate && dMut && dMut.some((x) => Math.abs(x) > 1e-9)) mutateChanged++
    if (noHost.originRaw === staticRaw) noHostSame++

    const row = {
      pkgId: h.id, kind: h.kind, file: h.file, hitReason: h.hitReason,
      cameraObjectId: h.cameraObjectId, camera: h.camera, cameraName: h.name,
      script: { key: scriptKeyOf, chars: scriptSrc.length, sha256: sha(scriptSrc), source: scriptSrc, preview: oneLine(scriptSrc, 200) },
      scriptProperties: camNode[scriptKeyOf].scriptproperties || null,
      userProps: { source: h.up.source, count: Object.keys(h.up.props).length, bound: mutNames },
      static: {
        origin: staticRaw === undefined ? null : staticRaw, originVec: staticVec,
        zoom: propVal(camNode.zoom), zoomKind: (camNode.zoom && typeof camNode.zoom === 'object') ? ('object{' + Object.keys(camNode.zoom).join(',') + '}') : typeof camNode.zoom,
        fov: propVal(camNode.fov),
      },
      eval: {
        origin: base.originRaw === undefined ? null : base.originRaw, originVec: evalVec, deltaVec: d,
        equalsStatic: sameAsStatic, changedKeys: base.changedKeys,
        hostErrors: base.scriptErrors, hostThrew: base.hostThrew, scriptLogs: base.scriptLogs,
        entry: base.entry, cacheSize: base.cacheSize,
      },
      abNoUserProps: noUser ? { origin: noUser.originRaw, originVec: vec(noUser.originRaw), deltaVec: dNoUser, hostErrors: noUser.scriptErrors, hostThrew: noUser.hostThrew } : null,
      noHost: { origin: noHost.originRaw === undefined ? null : noHost.originRaw, equalsStatic: noHost.originRaw === staticRaw, changedKeys: noHost.changedKeys },
      isolate: { origin: iso.originRaw, originVec: vec(iso.originRaw), equalsFull: isoEqualsFull, equalsStatic: iso.originRaw === staticRaw, hostErrors: iso.scriptErrors, entry: iso.entry, hostThrew: iso.hostThrew },
      mutate: mutate ? { props: Object.fromEntries(mutNames.map((n) => [n, mutateProps[n]])), origin: mutate.originRaw, deltaVsIsolate: dMut, moved: !!(dMut && dMut.some((x) => Math.abs(x) > 1e-9)), hostErrors: mutate.scriptErrors, hostThrew: mutate.hostThrew } : null,
      rendererCrossCheck: { parseSceneCameraNodeId: crossId, match: crossId === h.cameraObjectId, error: crossErr },
    }
    rows.push(row)

    // ── 人读小节 ──
    say('')
    say('── [' + (i + 1) + '/' + hits.length + '] ' + h.id + '  （' + h.file + '）')
    say('   相机对象 id=' + h.cameraObjectId + '  camera=' + JSON.stringify(h.camera) + (h.name ? '  name=' + JSON.stringify(h.name) : '') + '  命中=' + h.hitReason)
    say('   脚本字段 ' + scriptKeyOf + '：' + scriptSrc.length + ' 字符  sha256=' + row.script.sha256.slice(0, 16) + '…' +
      '  脚本自定义属性=' + JSON.stringify(row.scriptProperties))
    if (opt.script) say(scriptSrc.split('\n').map((l) => '   | ' + l).join('\n'))
    else say('   预览：' + row.script.preview + (scriptSrc.length > 200 ? ' …' : '') + '   （全文见 JSON / --script）')
    say('   静态快照（不跑脚本，渲染器今天读到的 .value）: ' + staticRaw)
    say('   宿主求值（userProps=' + h.up.source + '）: ' + base.originRaw)
    say('   Δ（求值 − 静态）                          : ' + fmtD(d))
    if (noUser) say('   A/B 无 userProps（宿主回退对象内存的 value）: ' + noUser.originRaw + '   Δ ' + fmtD(dNoUser) +
      (noUser.scriptErrors.length ? '   ⚠ 该变体下其它脚本报错 ' + noUser.scriptErrors.length + ' 类（口径不忠实，仅作对照）' : ''))
    say('   反向自证：空宿主 ⇒ ' + JSON.stringify(noHost.originRaw) + '（' + (noHost.originRaw === staticRaw ? '与静态逐字相同 ✓' : '与静态不同 ✗') + '）' +
      '；只留相机对象 ⇒ ' + JSON.stringify(iso.originRaw) + '（' + (isoEqualsFull ? '与全场景一致 ✓' : '与全场景不同 ⚠') + '）')
    if (mutate) say('   变异自证：' + mutNames.map((n) => n + ' ' + h.up.props[n] + '→' + mutateProps[n]).join(', ') + ' ⇒ ' + mutate.originRaw + '（Δ vs 未变异 ' + fmtD(dMut) + '）')
    else skip('变异自证（' + h.id + '）', '该脚本未绑定可数值化的用户属性 ⇒ 无输入可挪')
    say('   脚本实际改动的字段：' + (base.changedKeys.length
      ? base.changedKeys.map((k) => k.key + '（' + JSON.stringify(k.beforeVal) + ' → ' + JSON.stringify(k.afterVal) + '）').join('；')
      : '无'))
    say('   相机 zoom：' + JSON.stringify(propVal(camNode.zoom)) + '（' + row.static.zoomKind + '，非脚本 ⇒ 本工具不求值）；fov=' + JSON.stringify(propVal(camNode.fov)))
    say('   宿主诊断：全场景趟错误 ' + base.scriptErrors.length + ' 类' + (base.scriptErrors.length ? '（' + base.scriptErrors.slice(0, 2).join(' / ') + '）' : '') +
      '；隔离趟错误 ' + iso.scriptErrors.length + ' 类；相机脚本缓存条目 ' + (base.entry.compiled ? '有（hasUpdate=' + base.entry.hasUpdate + ', 编译错误=' + (base.entry.compileError || '无') + ', disabled=' + base.entry.disabled + ', update 抛错=' + base.entry.updateErrors + '）' : '**无**') +
      (base.scriptLogs.length ? '；脚本 console 输出 ' + base.scriptLogs.length + ' 类（已拦截，不污染 stdout）' : ''))
  }

  // ── 一页速览表（人读主表）──
  say('')
  say('── 速览：包 id → 对象 id → 静态/求值 origin → Δ ──')
  for (const r of rows) {
    say('   ' + r.pkgId.slice(0, 46).padEnd(46) + '  id=' + String(r.cameraObjectId).padEnd(8) +
      '  static[' + (r.static.origin || '').padEnd(32) + ']  eval[' + (r.eval.origin || '').padEnd(32) + ']  Δ ' + fmtD(r.eval.deltaVec))
  }

  // ── 逐命中 + 汇总自检 ──
  say('')
  say('── 逐命中自检 ──')
  check('⑥ 每条命中都能被宿主求值（隔离趟缓存里有该脚本源、编译无错、init 未失败、update 未抛错）',
    rows.every((r) => entryHealthy(r.isolate.entry)),
    rows.filter((r) => !entryHealthy(r.isolate.entry)).map((r) => r.pkgId + ':' + JSON.stringify(r.isolate.entry)).join(', ') || '全部 ' + rows.length + ' 条')
  check('⑦ 隔离跑（只留相机对象）也求值成功，无宿主错误', rows.every((r) => r.isolate.hostErrors.length === 0),
    rows.filter((r) => r.isolate.hostErrors.length).map((r) => r.pkgId + ':' + r.isolate.hostErrors[0]).join(' | ') || '0 条有错')
  check('⑧ 反向自证·空宿主：每条命中的值都与静态快照**逐字相同**（⇒ 差是宿主算出来的）', noHostSame === rows.length,
    noHostSame + '/' + rows.length + ' 条相同')
  check('⑨ 反向自证·隔离：相机自己的脚本就能造出这个差（隔离值 ≠ 静态）', isolateChanged === rows.length,
    isolateChanged + '/' + rows.length + ' 条 ≠ 静态')
  // 变异自证：`--userprops=none` 下**按构造**没有用户属性可挪 ⇒ 显式 SKIP（不是失败，也不是通过）
  if (opt.userprops === 'none') {
    skip('⑩ 反向自证·变异（挪动绑定的用户属性，看求值是否跟着变）', '--userprops=none 下没有用户属性可挪；要拿这条自证请用默认的 --userprops=project')
  } else {
    check('⑩ 反向自证·变异：挪动绑定的用户属性后求值结果必须跟着变', mutateTested > 0 && mutateChanged === mutateTested,
      mutateChanged + '/' + mutateTested + ' 条跟着变' + (mutateTested < rows.length ? '（' + (rows.length - mutateTested) + ' 条无可挪输入，另计 SKIP）' : ''))
    if (mutateTested < rows.length) skip('⑩ 变异自证覆盖面', (rows.length - mutateTested) + ' 条没有可数值化的用户属性绑定')
  }
  check('⑪ 与渲染器同一判据交叉一致（lib.parseScene().cameraNode.id 命中同一个对象）', crossOk === rows.length,
    crossOk + '/' + rows.length + ' 条一致')
  check('⑫ Δ 如实（落盘的 deltaVec == 求值向量 − 静态向量，逐分量 1e-9 内；任一侧解析不出分量即判红，不放过）',
    rows.every((r) => Array.isArray(r.static.originVec) && Array.isArray(r.eval.originVec) && near(r.eval.deltaVec, sub(r.eval.originVec, r.static.originVec))),
    '校验 ' + rows.length + ' 条')
  check('⑬ 命中确实改变了取景（至少一条 求值 ≠ 静态；全等则本工具无话可说 ⇒ 应显式 SKIP 而不是报通过）',
    evalChanged > 0, evalChanged + '/' + rows.length + ' 条 ≠ 静态')
  if (evalChanged === 0) skip('⑬ 命中的取景变化', '所有命中脚本求值后与静态快照相同 ⇒ 本项目当前口径下无差异可报')
  // 宿主调用**本身**抛异常 = 工具级故障（任务书：退 1 并打印是哪个包）；与"宿主容错记录的脚本错误"分开判
  const threw = rows.filter((r) => r.eval.hostThrew || r.isolate.hostThrew || r.mutate && r.mutate.hostThrew || r.abNoUserProps && r.abNoUserProps.hostThrew)
  check('⑭ applySceneScripts 调用本身没有抛异常（抛了 = 工具自身出错 ⇒ 退 1，并打印是哪个包）', threw.length === 0,
    threw.length ? threw.map((r) => r.pkgId + ':' + (r.eval.hostThrew || r.isolate.hostThrew || (r.mutate && r.mutate.hostThrew) || (r.abNoUserProps && r.abNoUserProps.hostThrew))).join(' | ') : '0 个包')
  note('全场景趟里的**其它层脚本**报错（与相机无关、宿主已知缺口，不影响本工具结论）：' +
    ([...new Set(rows.flatMap((r) => r.eval.hostErrors))].slice(0, 4).join(' / ') || '无'))
}

// ════════════════════════════════════════════════════════════════════════════
// ⑦ 落盘 + 汇总
// ════════════════════════════════════════════════════════════════════════════
const epoch = Date.now()
const report = {
  tool: 'camera-script-origin-probe',
  schemaVersion: 1,
  generatedAt: new Date(epoch).toISOString(),
  epochMs: epoch,
  env: {
    mpwRoot: MPW, repoRoot: ROOT, node: process.version,
    canvas: opt.canvas, ticks: opt.ticks, userPropsMode: opt.userprops, abVariant: opt.ab, idFilter: opt.id,
    // 资源实测量（这台机器内存吃紧：本工具只读"表头前缀 + scene.json 切片"，从不整包读入）
    peakRssMb: Math.round(process.memoryUsage().rss / 1048576 * 10) / 10,
    elapsedMs: Date.now() - t0,
  },
  corpus: {
    packs: packs.length, looseScenes: loose.length,
    packsWithoutSceneJson: noScene.length, cameraObjects: camObjects.length, hits: hits.length,
  },
  criteria: {
    cameraObject: "scene.json objects[] 里 typeof o.camera === 'string'（与 core/we-scene-bundle.js:1513 同判据）",
    hit: '相机对象的 origin 或 zoom 是 {script:<字符串>} 节点',
    staticSnapshot: '不跑脚本时该属性节点的 .value（= 渲染器今天解析到的 authored 值）',
    host: 'elysia/scene-scripts.js applySceneScripts + createScriptCache（离线；只 import 不修改）',
  },
  checks: { pass, fail, skip: skipN, failures: fails, items: checkItems },
  objects: camObjects,
  rows: hitRows,
  noSceneJson: noScene,
  readErrors, sceneErrors, looseErrors,
}
const outPath = opt.out || path.join(ROOT, 'reports', 'camera-script-origin', epoch + '.json')
try {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(report, null, 1))
} catch (e) {
  die('工具出错：机读 JSON 写不进去 ' + outPath + ' —— ' + String((e && e.message) || e))
}
say('')
say('机读 JSON：' + outPath + '（' + fs.statSync(outPath).size + ' 字节）' +
  (path.relative(ROOT, outPath).startsWith('..') ? '' : '  ※ reports/ 已被 .gitignore 忽略，未污染工作树'))
say('自检：' + pass + ' 通过 / ' + fail + ' 失败 / ' + skipN + ' 跳过')
if (fail) {
  say('失败项：')
  for (const f of fails) say('  - ' + f)
}
say('口径声明：本工具全程无浏览器、无 GPU/WebGL，输出只有脚本文本与数值；**不含任何像素/成像结论**。')
flush()
// --json：stdout 只给机读 JSON（人读表已走 stderr）⇒ 可直接 `| jq`。用 writeSync 一次性写出，避免 process.exit 截断。
if (opt.json) fs.writeSync(1, JSON.stringify(report, null, 1) + '\n')
process.exit(fail ? 1 : 0)

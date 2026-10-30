// clock-coords-all-test.mjs —— ③ 一个壁纸里**所有**时间/日期控件的坐标都要对上（逐个断言，不许只看第一个）
//
// 靶子（真包，用户实时库）：`allwallpaper/1004/夜莺night——blue_archive_小鸟游星野_窗畔弦歌.mpkg`
//   —— 含 **63** 个时间/日期控件对象（Clock×6 / Date×11 / D a y×17 / 早中晚×2 / 帧率显示×2 …），
//   每族由 `visible:{user:{condition:"N",name:"<属性>"},value:false}` 门控。默认属性
//   （`b1="6"`/`day="5"`/`newproperty57="6"`/`day1="2"`/`week1="2"`/`hrbigbgeneralcomponentswitch="1"`）
//   下**正确**应同时可见 **4 个**时间控件（fps + Clock + Date + D a y 各一）。
//
// 判据（任一不满足 → 退出码 1）：
//   P1  逐个控件：实际落点 == **解析期合成 oracle**（内部自洽）±0.5px
//   P1b 逐个控件：实际落点 == **作者声明**（`p × 场景尺寸` 经父链合成）±0.5px —— 裁判与我们的脚本引擎无关
//   P2  可见的作者声明控件必须都落在设计画布内（+ 打印逐控件对照表）
//   V1  可见性**级联**：逐个断言默认属性下可见的时间控件 == 手算的 4 个；V2 反向（无级联 ⇒ 13 个）
//   V3  接线：帧循环调用 `mpwCascadeVisibility(scene)`；V4 回退位 `?viscascade=legacy` **行为化**（返回 0、可见 13）
//   P3  反向：两口径都回旧档 ⇒ 全部偏离作者声明（必红）
//   M1  "只修第一个控件" ⇒ 必红；M2 canvasSize 回渲染口径 ⇒ 必红；M3 origin 回世界增量 ⇒ 必红；
//   M5  关掉可见性级联 ⇒ 可见集断言必红；M4 反向自证：现役必须全绿（判据不是恒红）
//   P4  打印「期望红集 == 实际红集」（5 组）
//
// 用法: node tests/clock-coords-all-test.mjs [--pkg <path>] [--json <file>]
import fs from 'node:fs'
import path from 'node:path'
import { WS } from './_root.mjs'
import * as lib from '../core/we-scene-bundle.js'
import { applySceneScripts, createScriptCache } from '../elysia/scene-scripts.js'

const REPO = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const argOf = (n) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null }
const PKG = argOf('pkg') || path.join(WS, 'allwallpaper', '1004', '夜莺night——blue_archive_小鸟游星野_窗畔弦歌.mpkg')
const JSON_OUT = argOf('json')

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (label, why) => console.log('SKIP ' + label + ' —— ' + why)
const TIME_RE = /new\s+Date|getHours|getMinutes|getSeconds|getDay\(|getDate\(|getMonth\(|getFullYear|toLocaleTimeString|toLocaleDateString/
const d2 = (x) => Math.round(x * 100) / 100

if (!fs.existsSync(PKG)) {
  skip('全部判据', '靶子包不在：<工作区>/allwallpaper/1004/夜莺night——blue_archive_小鸟游星野_窗畔弦歌.mpkg')
  console.log('\n结果: PASS 0 / FAIL 0（SKIP）')
  process.exit(0)
}
const { parsePkg, readPkgEntry, entryNames, getEntry } = await import(path.join(REPO, 'packages/we-core/src/pkg.js'))
const pkg = parsePkg(new Uint8Array(fs.readFileSync(PKG)))
const names = entryNames(pkg)
const readByName = (n) => {
  const e = pkg.entries.find((x) => (x.name || x.path) === n)
  return e ? Buffer.from(readPkgEntry(pkg, e)).toString('utf8').replace(/^\uFEFF/, '') : null
}
const SCENE_SRC = readByName('scene.json')
const PJ = JSON.parse(readByName('project.json') || '{}')
const readEntry = (n) => getEntry(pkg, n)
/** 属性表默认值（= 用户没动过滑杆时的真值）⇒ 决定哪些变体可见、以及 `{user:…}` 绑定的取值。 */
const DEFAULTS = (() => {
  const out = {}
  const props = (PJ.general && PJ.general.properties) || {}
  for (const [k, v] of Object.entries(props)) if (v && v.value !== undefined && v.type !== 'group') out[k] = v.value
  return out
})()
const ORTHO = (() => {
  const op = (JSON.parse(SCENE_SRC).general || {}).orthogonalprojection
  return op && op.width > 0 ? { x: op.width, y: op.height } : { x: 1920, y: 1080 }
})()
const RENDER = { x: 1832, y: 1030 }   // 真机 `?res=dpr` 读数（旧缺省口径）

/** 时间/日期控件 = `text` 由脚本驱动且脚本文本里有时间/日期 API 的对象。 */
const ALL = JSON.parse(SCENE_SRC).objects || []
const CONTROLS = ALL.filter((o) => o.text && typeof o.text === 'object' && typeof o.text.script === 'string' && TIME_RE.test(o.text.script))

/** 作者声明：`origin` 脚本里的 `p × engine.canvasSize` 形态；`{user:"x1"}` 取**属性表**的值（用户属性优先）。 */
function declaredLocal(o, up) {
  const or = o.origin
  if (!(or && typeof or === 'object' && typeof or.script === 'string')) return null
  if (!/engine\.canvasSize\.x/.test(or.script)) return null
  const sp = or.scriptproperties || {}
  const num = (v) => {
    if (v && typeof v === 'object') {
      const u = v.user
      if (typeof u === 'string' && up && up[u] !== undefined && up[u] !== null && up[u] !== '') return Number(up[u])
      return Number(v.value)
    }
    return Number(v)
  }
  const px = num(sp.x), py = num(sp.y)
  return (isFinite(px) && isFinite(py)) ? [px, py] : null
}
/** **作者声明 oracle**：把声明型控件的 origin 换成作者声明的字面量（p × 场景尺寸，编辑器 y-up 空间）后 parseScene。 */
function authorOracleLayers(up) {
  const j = JSON.parse(SCENE_SRC)
  for (const o of (j.objects || [])) {
    const d = declaredLocal(o, up)
    if (!d) continue
    o.origin = String(d[0] * ORTHO.x) + ' ' + String(d[1] * ORTHO.y) + ' 0.00000'
  }
  const sc = lib.parseScene(j, up, { attachCtx: { readEntry, time: 0 } })
  return new Map(sc.layers.map((l) => [l.id, l]))
}
/** 跑真链路（脚本 → syncScriptOrigins）；`mangle` 可在 parse 之前改 sceneObj（模拟变异）。 */
function runPipeline({ canvasSize, scrOpts, userProps, mangle }) {
  const sceneObj = JSON.parse(SCENE_SRC)
  if (typeof mangle === 'function') mangle(sceneObj)
  const scene = lib.parseScene(sceneObj, userProps, { attachCtx: { readEntry, time: 0 } })
  const base = lib.snapshotAuthoredOrigins(sceneObj.objects)
  const cache = createScriptCache(); cache.shared = {}
  for (let i = 0; i < 3; i++) {
    applySceneScripts(sceneObj, i * 0.25, { renderObjects: sceneObj.objects, userProps: userProps || {}, canvasSize, cache, frametime: 1 / 60 })
    lib.syncScriptOrigins(scene, sceneObj.objects, base, null, scrOpts || null)
  }
  return { sceneObj, scene, layers: new Map(scene.layers.map((l) => [l.id, l])) }
}
/* 作者声明 oracle 只对 **`p×canvasSize` 形态**的控件成立（其余 7 个控件的 origin 不是这个形态，
   它们的落点由 P1 的"解析期 oracle"覆盖）⇒ 比较时按 id 过滤，不靠 oracle 里有没有这一项。 */
const DECLARED_IDS = new Set(CONTROLS.filter((o) => declaredLocal(o, DEFAULTS)).map((o) => o.id))
const passes = (res, oracleMap) => {
  let n = 0, seen = 0
  for (const o of CONTROLS) {
    if (!DECLARED_IDS.has(o.id)) continue
    const ol = oracleMap.get(o.id)
    if (!ol) continue
    const l = res.layers.get(o.id)
    if (!l) return false
    seen++
    if (Math.max(Math.abs(l.origin[0] - ol.origin[0]), Math.abs(l.origin[1] - ol.origin[1])) > 0.5) n++
  }
  return seen > 0 && n === 0
}

console.log('靶子: ' + path.basename(PKG))
console.log('场景尺寸(正交): ' + ORTHO.x + '×' + ORTHO.y + '；属性表默认值（节选）: ' +
  JSON.stringify({ b1: DEFAULTS.b1, day: DEFAULTS.day, day1: DEFAULTS.day1, week1: DEFAULTS.week1, time: DEFAULTS.time, x1: DEFAULTS.x1, y2: DEFAULTS.y2 }))
console.log('时间/日期控件对象总数: ' + CONTROLS.length)

/* ── V 组：可见性级联 ──────────────────────────────────────────────────────────
   官方语义：父隐藏 ⇒ 整棵子树不画。本仓 `renderScene` 只看本层 `layer.visible`、`parseScene` 也只解析本层
   ⇒ 写在**容器**上的 `visible:{user:{condition,name}}` 对子层无效 ✗。本包默认属性下：
     · `508「组件镜像」`(condition==2，实际 =1) **必须隐藏**：整枝 6 个时间控件，且 `483` 的 `scale=-1 1 1` 是镜像
     · `2856「横Date」`/`573「横Day」`/`4881「横Day」`(day1==1 / week1==1，实际 ="2") 也必须隐藏
   ⇒ 期望同时可见的时间控件 = **4**（手算，不来自被测实现）：#1293 fps / #531 Clock / #272 Date / #260 D a y6 */
const HTML = fs.readFileSync(path.join(REPO, 'demo.html'), 'utf8')
const cascadeBlock = (() => {
  const a = HTML.indexOf('const VIS_CASCADE_LEGACY')
  const b = HTML.indexOf('function mpwCascadeVisibility(', a)
  if (a < 0 || b < 0) return null
  let i = HTML.indexOf('{', b), depth = 0
  for (; i < HTML.length; i++) { if (HTML[i] === '{') depth++; else if (HTML[i] === '}') { depth--; if (depth === 0) break } }
  return HTML.slice(a, i + 1)
})()
const makeCascade = (search) => {
  if (!cascadeBlock) return null
  try { return new Function('location', cascadeBlock + '\nreturn mpwCascadeVisibility')({ search: search || '' }) } catch (e) { return null }
}
/* ── 跑现役（缺省档）与两个 oracle ── */
const NOW = runPipeline({ canvasSize: ORTHO, userProps: DEFAULTS })
const CASCADE_FN_EARLY = makeCascade('')
if (CASCADE_FN_EARLY) { try { CASCADE_FN_EARLY(NOW.scene) } catch (e) { /* 级联不可用 ⇒ 保持 parse 结果 */ } }
const ORACLE = (() => {
  const sc = lib.parseScene(JSON.parse(JSON.stringify(NOW.sceneObj)), DEFAULTS, { attachCtx: { readEntry, time: 0 } })
  return new Map(sc.layers.map((l) => [l.id, l]))
})()
const AUTHOR = authorOracleLayers(DEFAULTS)

const rows = []
for (const o of CONTROLS) {
  const l = NOW.layers.get(o.id), ol = ORACLE.get(o.id), al = AUTHOR.get(o.id)
  if (!l) { rows.push({ id: o.id, name: o.name, missing: true }); continue }
  const dd = (m, id) => m.get(id) ? Math.max(Math.abs(l.origin[0] - m.get(id).origin[0]), Math.abs(l.origin[1] - m.get(id).origin[1])) : null
  rows.push({
    id: o.id, name: o.name, parent: o.parent === undefined ? null : o.parent,
    actual: [d2(l.origin[0]), d2(l.origin[1])],
    oracle: ol ? [d2(ol.origin[0]), d2(ol.origin[1])] : null,
    author: al ? [d2(al.origin[0]), d2(al.origin[1])] : null,
    d: dd(ORACLE, o.id), dAuth: dd(AUTHOR, o.id), declared: declaredLocal(o, DEFAULTS),
    visible: l.visible !== false,
  })
}
const badO = rows.filter((r) => r.missing || r.d === null || r.d > 0.5)
const declRows = rows.filter((r) => r.declared)
const badA = declRows.filter((r) => r.dAuth === null || r.dAuth > 0.5)

console.log('\n【逐控件对照表】（前 14 行；全量在 --json）')
console.log('  id      控件名            父级     实际(x,y)            作者声明(x,y)          Δ作者  可见')
for (const r of rows.slice(0, 14)) {
  console.log('  ' + String(r.id).padEnd(7) + String(r.name || '').slice(0, 14).padEnd(16)
    + String(r.parent === null ? '-' : r.parent).padEnd(8)
    + (r.actual ? (r.actual.join(', ')).padEnd(20) : '缺失'.padEnd(20))
    + (r.author ? (r.author.join(', ')).padEnd(20) : '(非 p×canvasSize 形态)'.padEnd(20))
    + String(r.dAuth === null || r.dAuth === undefined ? '-' : r.dAuth).padEnd(7)
    + (r.visible ? '✓' : '·'))
}

ok(rows.length >= 2, 'P0 靶子含 ≥2 个时间/日期控件（不是拿单钟包凑数）', '控件数=' + rows.length)
ok(badO.length === 0, 'P1 **逐个控件**落点 == 解析期 oracle（内部自洽，±0.5px）',
  badO.length ? ('不通过 ' + badO.length + '/' + rows.length + '：' + badO.slice(0, 5).map((r) => r.id + '「' + r.name + '」Δ=' + r.d).join(' / ')) : ('全部 ' + rows.length + ' 个通过'))
ok(declRows.length >= 2 && badA.length === 0,
  'P1b **逐个控件**落点 == **作者声明**（p×场景尺寸 经父链合成，±0.5px）——不是只看第一个',
  badA.length ? ('不通过 ' + badA.length + '/' + declRows.length + '：' + badA.slice(0, 6).map((r) => r.id + '「' + r.name + '」Δ=' + r.dAuth).join(' / ')) : ('全部 ' + declRows.length + ' 个通过'))

/* ── P2 可见的作者声明控件必须落在设计画布内 ── */
const visRows = rows.filter((r) => r.visible)
const visDecl = visRows.filter((r) => r.declared && r.author)
const outOfCanvas = visDecl.filter((r) => !(r.author[0] >= 0 && r.author[1] >= 0 && r.author[0] <= ORTHO.x && r.author[1] <= ORTHO.y))
ok(visDecl.length >= 2 && outOfCanvas.length === 0,
  'P2 **可见**的作者声明控件必须都落在设计画布内（' + ORTHO.x + '×' + ORTHO.y + '）',
  '可见且声明型 ' + visDecl.length + ' 个；越界 ' + outOfCanvas.length + (outOfCanvas.length ? ('：' + outOfCanvas.map((r) => r.id + '「' + r.name + '」' + JSON.stringify(r.author)).join(' / ')) : ''))
console.log('    · 可见控件的作者声明坐标（p × 场景尺寸 ⇒ 局部 ⇒ 经父链 ⇒ 屏幕）：')
for (const r of visDecl) console.log('      #' + r.id + ' ' + String(r.name || '').padEnd(10) + ' p=' + JSON.stringify(r.declared) + ' ⇒ 局部(' + d2(r.declared[0] * ORTHO.x) + ', ' + d2(r.declared[1] * ORTHO.y) + ') ⇒ 屏幕 ' + JSON.stringify(r.author) + '（实际 ' + JSON.stringify(r.actual) + '）')

const EXPECT_VISIBLE = [1293, 531, 272, 260]
const visibleTimeIds = (sc) => new Set(sc.layers.filter((l) => CONTROLS.some((c) => c.id === l.id) && l.visible !== false).map((l) => l.id))
const cascadeFn = CASCADE_FN_EARLY
const scCascade = lib.parseScene(JSON.parse(SCENE_SRC), DEFAULTS, { attachCtx: { readEntry, time: 0 } })
if (cascadeFn) cascadeFn(scCascade)
const gotVis = visibleTimeIds(scCascade)
const missingVis = EXPECT_VISIBLE.filter((id) => !gotVis.has(id))
const extraVis = [...gotVis].filter((id) => EXPECT_VISIBLE.indexOf(id) < 0)
ok(!!cascadeFn && missingVis.length === 0 && extraVis.length === 0,
  'V1 可见性级联：**逐个断言**默认属性下同时可见的时间控件 == 手算的 4 个（fps#1293 / Clock#531 / Date#272 / D a y6#260）',
  cascadeFn ? ('可见=' + JSON.stringify([...gotVis].sort((a, b) => a - b)) + (missingVis.length ? ' 少了' + JSON.stringify(missingVis) : '') + (extraVis.length ? ' 多了' + JSON.stringify(extraVis) : '')) : '未切到 mpwCascadeVisibility（实现缺失）')
{
  const sc0 = lib.parseScene(JSON.parse(SCENE_SRC), DEFAULTS, { attachCtx: { readEntry, time: 0 } })
  const got0 = visibleTimeIds(sc0)
  ok(got0.size > EXPECT_VISIBLE.length, 'V2 反向：不做级联时可见数必须更多（= 用户看到的"不止一个时钟"）',
    '无级联可见=' + got0.size + ' vs 级联后=' + EXPECT_VISIBLE.length + '（多出 ' + [...got0].filter((id) => EXPECT_VISIBLE.indexOf(id) < 0).length + ' 个）')
}
ok(/mpwCascadeVisibility\(scene\)/.test(HTML), 'V3 接线：帧循环里确实调用了 `mpwCascadeVisibility(scene)`')
{
  const legacyFn = makeCascade('?viscascade=legacy')
  const scL = lib.parseScene(JSON.parse(SCENE_SRC), DEFAULTS, { attachCtx: { readEntry, time: 0 } })
  const n = legacyFn ? legacyFn(scL) : -1
  const got = visibleTimeIds(scL)
  ok(n === 0 && got.size > EXPECT_VISIBLE.length,
    'V4 回退位 `?viscascade=legacy` **行为化**：级联不动作（返回 0）、可见数回到改动前的 13',
    '返回=' + n + ' 可见=' + got.size)
}

/* ── P3/M1/M2/M3/M5 变异 + M4 反向自证 + P4 红集 ── */
console.log('\n【反向与变异自证】')
const LEGACY = runPipeline({ canvasSize: RENDER, scrOpts: { legacy: true }, userProps: DEFAULTS })
const legacyRed = !passes(LEGACY, AUTHOR)
ok(legacyRed, 'P3 反向：两口径都回旧档（渲染口径 canvasSize + scrorigin legacy）⇒ 逐个断言偏离作者声明（必红）', '红=' + legacyRed)
const M2 = runPipeline({ canvasSize: RENDER, userProps: DEFAULTS })
const m2Red = !passes(M2, AUTHOR)
ok(m2Red, 'M2 变异：canvasSize 回渲染分辨率（?csz=render 等效）⇒ 偏离作者声明（必红）', '红=' + m2Red)
const M3 = runPipeline({ canvasSize: ORTHO, scrOpts: { legacy: true }, userProps: DEFAULTS })
const m3Red = !passes(M3, AUTHOR)
ok(m3Red, 'M3 变异：脚本 origin 回"世界增量"（?scrorigin=legacy）⇒ 偏离作者声明（必红）', '红=' + m3Red)
const firstId = declRows.length ? declRows[0].id : CONTROLS[0].id
const M1 = (() => {
  const res = runPipeline({
    canvasSize: ORTHO, userProps: DEFAULTS,
    mangle: (sceneObj) => { for (const o of (sceneObj.objects || [])) if (o.id !== firstId) { const d = declaredLocal(o, DEFAULTS); if (d) o.origin = '0 0 0' } },
  })
  return !passes(res, AUTHOR)
})()
ok(M1, 'M1 变异："只修第一个控件"（其余声明型控件的 origin 不再走脚本）⇒ 必红', '红=' + M1)
const M5 = (() => {
  const sc = lib.parseScene(JSON.parse(SCENE_SRC), DEFAULTS, { attachCtx: { readEntry, time: 0 } })
  const got = visibleTimeIds(sc)
  return !(EXPECT_VISIBLE.every((id) => got.has(id)) && got.size === EXPECT_VISIBLE.length)
})()
ok(M5, 'M5 变异：关掉可见性级联（= 改动前）⇒ 可见集断言必红', '红=' + M5)
ok(passes(NOW, AUTHOR), 'M4 反向自证：现役口径下必须全绿（判据不是恒红）', '现役 vs 作者声明=' + passes(NOW, AUTHOR))
const expectedRed = new Set(['P3', 'M1', 'M2', 'M3', 'M5'])
const actualRed = new Set()
if (legacyRed) actualRed.add('P3')
if (M1) actualRed.add('M1')
if (m2Red) actualRed.add('M2')
if (m3Red) actualRed.add('M3')
if (M5) actualRed.add('M5')
const sameSets = expectedRed.size === actualRed.size && [...expectedRed].every((k) => actualRed.has(k))
ok(sameSets, 'P4 期望红集 == 实际红集（5 组：P3 反向 / M1 只修一个 / M2 渲染口径 / M3 世界增量 / M5 级联关）',
  '期望=' + JSON.stringify([...expectedRed]) + ' 实际=' + JSON.stringify([...actualRed]))

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ pkg: path.basename(PKG), ortho: ORTHO, expectVisible: EXPECT_VISIBLE, rows }, null, 1))
  console.log('\n逐控件读数已写: ' + JSON_OUT)
}
console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)

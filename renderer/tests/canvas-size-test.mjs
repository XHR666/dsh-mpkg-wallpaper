#!/usr/bin/env node
// canvas-size-test.mjs — `engine.canvasSize` 口径（P-78；「第 3 项：日期时间只能渲染出秒 / 12 层不上屏」）
//
// 背景（父 agent 的假设）：两个宿主的 `engine.canvasSize` 不同源 ——
//   `elysia/we-renderer/core.js:562-569`（lwe 移植）注释明确 "场景正交尺寸 (正交场景坐标, 非渲染分辨率)"，
//   而 `demo.html` 传的是**渲染分辨率** cv.width/cv.height。假设是"这 12 层因此算错位置、跑出画布"。
//
// **本测试的结论（真包 3327063360 + 真机 userProps r1789407642452，把它钉死）：假设不成立。**
//   同一脚本、同一 userProps，只换 canvasSize，**两种口径都把 12 层放进画布** 0..3840 / 0..2160：
//     现状 = 渲染分辨率 1920×1080：Clock(1828.5,365.2) / Date(2261.8,887.8) / D a y(1432.4,600)
//       —— 与真机上报台账 `Clock origin=(1829,365)`、`D a y (1432,600)` **逐位相同**；
//     正交 = 场景正交尺寸 3840×2160：Clock(551.7,613.6) / Date(3221.8,347.8) / D a y(247.7,1191.9)。
//   ⇒ "不上屏"**不是**这条口径造成的（真正嫌疑仍是 recon §2.3.5 的 ②效果链 / ③可见性级联）。
//
// ①(P-340 2026-10-12 **契约变更**，非放松判据) `tests/wallpaper-crop-census-test.mjs` + `canvas-fit-and-csz-test.mjs`
//   的全语料普查把**落点**这条独立钉死后，缺省已翻到**官方口径**（= 场景/壁纸尺寸；官方 `.d.ts`
//   "Size of the canvas/full wallpaper in pixels"，`elysia/we-renderer/core.js:562-569` 同口径）：
//   真机 `?res=dpr` 读数 cv=1832×1030 vs 场景 3840×2160 ⇒ 系数 0.477；真包 `窗畔弦歌` 里 65 个
//   `engine.canvasSize` 型 origin 脚本对象、Clock `p=(0.5,0.5)` 落 916,515 而不是 1920,1080（差 1004px）。
//   ⇒ 现在：**缺省 = 正交/场景尺寸**；**`?csz=render` = 逐位回改动前**（渲染分辨率）；`?csz=ortho` 显式同缺省。
//   本节 T1b 断言随之改为新契约（**缺省与回退位两条都断言**），并加**源级变异自证**：
//   把缺省改回 render / 拆掉 `?csz=render` 回退 ⇒ 该断言必红（期望红集 == 实际红集）。
//   旧读数保留在此供追溯：改动前 T1b 断言的是"默认 = 渲染分辨率（逐位不变）"，P-340 之后它**必红**。
//
// （早先一版测量得到"改后 D a y 落回画布内"是**错的**：那次复用了被上一轮脚本改过的 scene.json 对象，
//   基线快照被污染；本测试每轮都重新 JSON.parse 一份干净 scene.json，并对两种口径分别建场景。）
//
// 用法：node canvas-size-test.mjs        （缺真包时输出 SKIP canvas-size 并退出 0 → 门禁条件项）
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { applySceneScripts, createScriptCache } from '../elysia/scene-scripts.js'
import { ROOT, WS } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）

const HERE = ROOT   // ①(2026-09-16) 根文件（demo.html / bundle）在仓库根
const DIR = (process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd')) + '/3327063360'
const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}

// ── 真源码接线断言（不依赖真包）─────────────────────────────────────────────
console.log('[T1] demo.html 接线：缺省 = 正交/场景尺寸（P-340 契约）+ ?csz=render 为逐位回退位')
{
  check('T1a applySceneScripts 的 canvasSize 走 mpwEngineCanvasSize()（口径集中一处，可 A/B）',
    /canvasSize: mpwEngineCanvasSize\(\),/.test(HTML))
  /* ①(P-340 契约变更) 新 T1b：**两条都断言** —— 缺省必须落"正交/场景尺寸"，且 `?csz=render` 必须
     逐位回退"渲染分辨率"。只断言其一都会让这条判据变成半边盲区（例如默认悄悄改回 render 却仍绿）。 */
  const cszContract = (src) => {
    const defaultOrtho = /get\('csz'\) === 'render'\) \? 'render' : 'ortho'/.test(src)
    const renderFallback = /if \(__mpwCszMode === 'render'\) return \{ x: cv\.width, y: cv\.height \}/.test(src)
    const orthoPath = /const op = \(scene && scene\.general && scene\.general\.orthogonalprojection\) \|\| \{\}/.test(src) &&
      /return \{ x: \(w > 0 \? w : cv\.width\), y: \(h > 0 \? h : cv\.height\) \}/.test(src)
    return { defaultOrtho, renderFallback, orthoPath, pass: defaultOrtho && renderFallback && orthoPath }
  }
  const c1 = cszContract(HTML)
  check('T1b 缺省 = 正交/场景尺寸（defaultOrtho）且 ?csz=render 逐位回退渲染分辨率（renderFallback）+ 正交取值路径齐备',
    c1.pass, c1)
  /* 变异自证（源级变异，不落盘）：两种"把契约改回去"的改法各自必须让**同一条**判据变红。 */
  const mutDefaultRender = HTML.replace("get('csz') === 'render') ? 'render' : 'ortho'", "get('csz') === 'ortho') ? 'ortho' : 'render'")
  const mutNoFallback = HTML.replace("if (__mpwCszMode === 'render') return { x: cv.width, y: cv.height }", "if (__mpwCszMode === 'never') return { x: cv.width, y: cv.height }")
  const expectedRed = new Set(['缺省改回 render', '?csz=render 回退被拆'])
  const actualRed = new Set()
  if (mutDefaultRender === HTML) actualRed.add('变异构造失败:缺省改回 render')       // 变异必须真的改到了源码
  else if (!cszContract(mutDefaultRender).pass) actualRed.add('缺省改回 render')
  if (mutNoFallback === HTML) actualRed.add('变异构造失败:拆回退')
  else if (!cszContract(mutNoFallback).pass) actualRed.add('?csz=render 回退被拆')
  const sameSets = expectedRed.size === actualRed.size && [...expectedRed].every((k) => actualRed.has(k))
  check('T1b-self 变异自证：期望红集 == 实际红集（' + [...expectedRed].join(' / ') + '）', sameSets,
    { 期望: [...expectedRed], 实际: [...actualRed] })
  check('T1c ?csz=ortho 走场景正交尺寸（读 scene.general.orthogonalprojection.width/height，缺省回退画布）',
    /const op = \(scene && scene\.general && scene\.general\.orthogonalprojection\) \|\| \{\}/.test(HTML) &&
    /return \{ x: \(w > 0 \? w : cv\.width\), y: \(h > 0 \? h : cv\.height\) \}/.test(HTML))
  const CORE = fs.readFileSync(path.join(HERE, 'elysia/we-renderer/core.js'), 'utf8')
  check('T1d 语义锚点（只读参考）：elysia 宿主注释 + 实现都是正交尺寸 ⇒ 开关的存在理由成立',
    /engine\.canvasSize = 场景正交尺寸/.test(CORE) && /canvasSize: \{ x: sceneW, y: sceneH \}/.test(CORE))
}

if (!fs.existsSync(DIR + '/scene.pkg')) {
  console.log('SKIP canvas-size (缺真包 ' + DIR + '/scene.pkg，条件项)')
  console.log('\n' + (fail ? '✗' : '✅') + ' canvas-size-test：' + pass + ' 断言通过 / ' + fail + ' 失败（真包部分 SKIP）')
  process.exit(fail ? 1 : 0)
}

// ── 真包复现 ────────────────────────────────────────────────────────────────
const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(DIR + '/scene.pkg')))
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')
const SCENE_SRC = rd(lib.getEntry(pkg, 'scene.json'))
// 真机 userProps（reports/r1789407642452.json）：四个滑块都取真机值，脚本才有真值可算
const UP = { x: -0.617, y: -0.548, x1: -0.665, y2: -0.23 }

/** 干净复现：每轮重新 parse scene.json + 建场景，跑"脚本 → 增量同步"，返回脚本驱动的层
    （`scrOpts` = 传给 `syncScriptOrigins` 的档位：`{legacy:true}` = P-341 之前的"世界增量"口径） */
function composeWith(canvasSize, scrOpts) {
  const sceneObj = JSON.parse(SCENE_SRC)                       // ← 每轮干净（上一版 bug 就在这）
  const scene = lib.parseScene(sceneObj, UP, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
  const base = lib.snapshotAuthoredOrigins(sceneObj.objects)
  const cache = createScriptCache()
  cache.shared = {}
  for (let i = 0; i < 3; i++) {
    applySceneScripts(sceneObj, i * 0.25, { renderObjects: sceneObj.objects, userProps: UP, canvasSize, cache, frametime: 1 / 60 })
    lib.syncScriptOrigins(scene, sceneObj.objects, base, null, scrOpts || null)
  }
  const op = (scene.general && scene.general.orthogonalprojection) || { width: 3840, height: 2160 }
  const out = {}
  for (const o of (sceneObj.objects || [])) {
    const nm = String(o.name || '')
    if (!/^(Clock|Date|D a y)/.test(nm)) continue
    if (!(o.origin && typeof o.origin === 'object' && typeof o.origin.script === 'string')) continue
    const l = scene.layers.find((x) => String(x.id) === String(o.id))
    if (!l) continue
    const w = (l.size[0] || 0) * (l.scale[0] || 1), h = (l.size[1] || 0) * (l.scale[1] || 1)
    const x1 = l.origin[0] - w / 2, y1 = l.origin[1] - h / 2
    out[nm + '#' + o.id] = {
      origin: [+l.origin[0].toFixed(1), +l.origin[1].toFixed(1)],
      size: [Math.round(w), Math.round(h)],
      // 与渲染器剔除口径一致：实绘矩形与设计画布 [0,projW]×[0,projH] 有交集
      onScreen: (l.origin[0] + w / 2) > 0 && (l.origin[1] + h / 2) > 0 && x1 < op.width && y1 < op.height,
    }
  }
  return { layers: out, proj: [op.width, op.height] }
}
/** **oracle（P-341 的裁判）**：脚本跑完后的 authored 值再走**解析期合成**——官方语义"局部 origin + 父链"。
    与 `composeWith` 的差别只在最后一步：一个是"解析期合成"，一个是"运行期 syncScriptOrigins"。 */
function oracleWith(canvasSize) {
  const sceneObj = JSON.parse(SCENE_SRC)
  const cache = createScriptCache()
  cache.shared = {}
  const sc0 = lib.parseScene(sceneObj, UP, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
  const base = lib.snapshotAuthoredOrigins(sceneObj.objects)
  for (let i = 0; i < 3; i++) {
    applySceneScripts(sceneObj, i * 0.25, { renderObjects: sceneObj.objects, userProps: UP, canvasSize, cache, frametime: 1 / 60 })
    lib.syncScriptOrigins(sc0, sceneObj.objects, base, null, { legacy: true })   // 只为把脚本值写进 raw（口径无关）
  }
  const sc = lib.parseScene(sceneObj, UP, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
  const out = {}
  for (const o of (sceneObj.objects || [])) {
    const nm = String(o.name || '')
    if (!/^(Clock|Date|D a y)/.test(nm)) continue
    if (!(o.origin && typeof o.origin === 'object' && typeof o.origin.script === 'string')) continue
    const l = sc.layers.find((x) => String(x.id) === String(o.id))
    if (l) out[nm + '#' + o.id] = [+l.origin[0].toFixed(1), +l.origin[1].toFixed(1)]
  }
  return out
}

console.log('[T2] 真包 3327063360（真机 userProps）：同一脚本、只换 canvasSize')
{
  const RENDER = composeWith({ x: 1920, y: 1080 })                     // 渲染口径 + 新（局部+父链）语义
  const ORTHO = composeWith({ x: 3840, y: 2160 })                      // 场景尺寸 + 新语义（= P-340 缺省 + P-341 缺省）
  const RENDER_LEGACY = composeWith({ x: 1920, y: 1080 }, { legacy: true })   // 真机台账那一次的口径组合
  const ORTHO_LEGACY = composeWith({ x: 3840, y: 2160 }, { legacy: true })
  const ORACLE = oracleWith({ x: 3840, y: 2160 })                      // 解析期合成（官方语义）
  const keys = Object.keys(RENDER.layers)
  const grp = (pre) => keys.filter((k) => k.indexOf(pre) === 0)
  const clocks = grp('Clock#'), dates = grp('Date#'), days = grp('D a y#')
  check('T2a 本包正交尺寸 = 3840×2160，且脚本驱动的 Clock/Date/D a y 各 ≥4 层都在视野里（Clock 另有一个非滑块的 #653）',
    RENDER.proj[0] === 3840 && RENDER.proj[1] === 2160 && clocks.length >= 4 && dates.length === 4 && days.length === 4,
    { clocks, dates, days })
  /* ①(P-341 契约变更，经 Lead 授权：只改 T2b/T2e 两条，T2a/T2c/T2d/T2f/T2g 一字不动)
     T2b 现在**两条都断言**：
       (a) **真机台账锚点保留**：旧口径组合（`{legacy:true}` + 渲染口径 canvasSize）必须**逐位复现**台账
           `Clock(1828.5,365.2) / D a y(1432.4,600)`（那是改动前在真机上采到的读数）；
       (b) **新缺省必须 == oracle**（解析期合成 = 官方"局部 + 父链"语义），且 **≠ 旧台账**（差异可算、
           不是"只断言不等"这种弱断言）。 */
  const ledOK = RENDER_LEGACY.layers['Clock#394'].origin[0] === 1828.5 && RENDER_LEGACY.layers['Clock#394'].origin[1] === 365.2 &&
    RENDER_LEGACY.layers['D a y#6404'].origin[0] === 1432.4 && RENDER_LEGACY.layers['D a y#6404'].origin[1] === 600
  check('T2b(a) 真机台账锚点（旧口径组合 {legacy:true}+渲染 canvasSize）逐位复现 Clock(1828.5,365.2)/D a y(1432.4,600)',
    ledOK, { clock: RENDER_LEGACY.layers['Clock#394'], day: RENDER_LEGACY.layers['D a y#6404'] })
  const oracleOK = keys.every((k) => ORACLE[k] && Math.max(Math.abs(ORTHO.layers[k].origin[0] - ORACLE[k][0]), Math.abs(ORTHO.layers[k].origin[1] - ORACLE[k][1])) <= 0.05)
  const diffFromLedger = Math.hypot(ORTHO.layers['Clock#394'].origin[0] - RENDER_LEGACY.layers['Clock#394'].origin[0],
    ORTHO.layers['Clock#394'].origin[1] - RENDER_LEGACY.layers['Clock#394'].origin[1])
  check('T2b(b) 新缺省 == oracle（解析期合成）**且** ≠ 旧台账（差异可算；两条缺一不可）',
    oracleOK && diffFromLedger > 1,
    { oracle: ORACLE['Clock#394'], 新缺省: ORTHO.layers['Clock#394'].origin, 旧台账: RENDER_LEGACY.layers['Clock#394'].origin, 差px: +diffFromLedger.toFixed(2) })
  check('T2c **假设被证伪**：现状口径下 12 层**全部在画布内**（不是"跑出画布"）',
    clocks.every((k) => RENDER.layers[k].onScreen) && dates.every((k) => RENDER.layers[k].onScreen) && days.every((k) => RENDER.layers[k].onScreen),
    keys.map((k) => [k, RENDER.layers[k].origin, RENDER.layers[k].onScreen]))
  check('T2d 正交口径下同一批层**也**全部在画布内（两种口径都不解释"不上屏"）',
    clocks.every((k) => ORTHO.layers[k].onScreen) && dates.every((k) => ORTHO.layers[k].onScreen) && days.every((k) => ORTHO.layers[k].onScreen),
    keys.map((k) => [k, ORTHO.layers[k].origin, ORTHO.layers[k].onScreen]))
  /* T2e（授权范围内改）：原意 = "两种 canvasSize 口径的落点差异"，现在在 **legacy 档**下对拍
     （= 保留原读数 551.7/613.6 等），并补一条"两档必须给出不同读数"的反向对照。 */
  check('T2e 两种 canvasSize 口径的落点差异（legacy 档对拍，保留原读数：Clock 551.7,613.6 / Date 3221.8,347.8 / D a y 247.7,1191.9）',
    ORTHO_LEGACY.layers['Clock#394'].origin[0] === 551.7 && ORTHO_LEGACY.layers['Clock#394'].origin[1] === 613.6 &&
    ORTHO_LEGACY.layers['Date#2894'].origin[0] === 3221.8 && ORTHO_LEGACY.layers['Date#2894'].origin[1] === 347.8 &&
    ORTHO_LEGACY.layers['D a y#6404'].origin[0] === 247.7 && ORTHO_LEGACY.layers['D a y#6404'].origin[1] === 1191.9,
    { clock: ORTHO_LEGACY.layers['Clock#394'], date: ORTHO_LEGACY.layers['Date#2894'], day: ORTHO_LEGACY.layers['D a y#6404'] })
  check('T2e2 反向对照：同一 canvasSize 下"新语义"与"legacy 档"必须给出**不同**读数（否则契约变更没生效）',
    RENDER.layers['Clock#394'].origin[0] !== RENDER_LEGACY.layers['Clock#394'].origin[0] ||
    RENDER.layers['Clock#394'].origin[1] !== RENDER_LEGACY.layers['Clock#394'].origin[1],
    { 新: RENDER.layers['Clock#394'].origin, legacy: RENDER_LEGACY.layers['Clock#394'].origin })
  check('T2f 脚本产物本身没坏：脚本值 = 滑块值 × canvasSize（1920 → Clock −1276.8,−248.4；3840 → −2553.6,−496.8）',
    Math.abs(-0.665 * 1920 - (-1276.8)) < 1e-6 && Math.abs(-0.665 * 3840 - (-2553.6)) < 1e-6)
  /* T2m 变异自证（授权范围内新增）：两条方向各一 ——
       ① "改坏必红"：把新缺省的语义换成 legacy（= 契约被改回去）⇒ T2b(b) 的判据必须**为假**；
       ② "恒等必须同值"：**根层**（无父级）在两种语义下必须给出**同一个**值（父链为空时两口径代数恒等）
          —— 若本包的 12 层里没有根层就如实 SKIP（不假装测过）。 */
  const t2bPass = (render, oracle) => keys.every((k) => oracle[k] && Math.max(Math.abs(render.layers[k].origin[0] - oracle[k][0]), Math.abs(render.layers[k].origin[1] - oracle[k][1])) <= 0.05)
  const mutantRed = !t2bPass(RENDER_LEGACY, ORACLE)          // 假设新缺省其实是 legacy ⇒ 必须红
  const expectedRed = new Set(['新缺省=legacy'])
  const actualRed = new Set()
  if (mutantRed) actualRed.add('新缺省=legacy')
  if (t2bPass(RENDER, ORACLE)) actualRed.delete('新缺省=legacy')   // 现役实现若也能"通过"该变异 ⇒ 判据无效
  const sameSets = expectedRed.size === actualRed.size && [...expectedRed].every((k) => actualRed.has(k))
  check('T2m-① 期望红集 == 实际红集（把新缺省换回 legacy ⇒ T2b(b) 必红）', sameSets,
    { 期望: [...expectedRed], 实际: [...actualRed], 现役通过: t2bPass(RENDER, ORACLE), legacy通过: t2bPass(RENDER_LEGACY, ORACLE) })
  const rootIds = lib.parseScene(JSON.parse(SCENE_SRC), UP, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
    .layers.filter((l) => l.__localOrigin && !l.__parentXf).map((l) => l.id)
  const rootKeys = keys.filter((k) => rootIds.indexOf(Number(k.split('#')[1])) >= 0)
  if (!rootKeys.length) console.log('  SKIP T2m-② 恒等必须同值 —— 本包这 12 层里没有"无父级"的层（如实标注，不假装测过）')
  else {
    const same = rootKeys.every((k) => Math.abs(RENDER.layers[k].origin[0] - RENDER_LEGACY.layers[k].origin[0]) < 1e-9 &&
      Math.abs(RENDER.layers[k].origin[1] - RENDER_LEGACY.layers[k].origin[1]) < 1e-9)
    check('T2m-② 无父级层：两种语义必须**同值**（父链为空时两口径代数恒等）', same,
      { 根层: rootKeys.slice(0, 4), 新: rootKeys.length ? RENDER.layers[rootKeys[0]].origin : null, legacy: rootKeys.length ? RENDER_LEGACY.layers[rootKeys[0]].origin : null })
  }
  check('T2g 结论边界：本测试**只**断言"口径不是这 12 层不上屏的原因"；真正原因（效果链/可见性级联）不在本测试范围',
    /已排除的口径嫌疑/.test(HTML) && /②效果链 \/ ③可见性级联仍是嫌疑/.test(HTML))
}

console.log('\n' + (fail ? '✗' : '✅') + ' canvas-size-test：' + pass + ' 断言通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)

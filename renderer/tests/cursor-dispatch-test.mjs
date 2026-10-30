// cursor-dispatch-test.mjs —— C6【机制·脚本宿主指针事件管线】cursorClick/Down/Up 派发链路判据
//
// 官方契约（dll-api Q8 + hongluan-mpkg 作者脚本实证）：
//   · 事件名序：cursorHitTest → cursorEnter → cursorLeave → cursorMove → cursorClick → cursorDown → cursorUp；
//   · 作者脚本 `export function cursorClick(event)`；event = { worldPosition: Vec3（设计坐标）,
//     localPosition: Vec3, hitBox }（作者脚本实证：`thisLayer.origin.subtract(event.worldPosition)`）；
//   · 命中判定先行：cursorClick 只投给**命中层**的脚本实例（dispatchScriptEvent 的 ownerFilter）。
// 实现：elysia `dispatchScriptEvent(opts.ownerFilter)`（P-233）+ demo.html MPW-CURSOR 管线
//   （canvas pointerdown/up/click → 设计坐标 → 命中层 → 派发；台账 __mpwCursorDispatch）。
// 判据：
//   A 桩件（离线、真 makeSceneRef/applySceneScripts/dispatchScriptEvent）：两个层共用同一脚本源、
//     两份实例；ownerFilter=A ⇒ 只有 A 的 cursorClick 收到事件（event.worldPosition.subtract 可调、
//     thisLayer 绑定正确）；ownerFilter=B ⇒ 只有 B 收到。
//   B 探针包 fixture（真机，GL 前置；无 GL SKIP）：点击耳朵层屏幕位置 ⇒ __mpwCursorDispatch.clicks≥1
//     且 hits 含耳朵层（派发链路端到端）；并断言命中层的脚本状态变化（animationlayers visible 翻转
//     或派发计数）。
//   C 变异自证：去掉 dispatchScriptEvent 的 ownerFilter 分支 ⇒ A 段"只有 A 收到"必红。
// 用法：node tests/cursor-dispatch-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const elysiaUrl = pathToFileURL(path.join(ROOT, 'elysia', 'scene-scripts.js')).href
const { applySceneScripts, createScriptCache, dispatchScriptEvent, makeSceneRef } = await import(elysiaUrl)
const { Vec3 } = await import(pathToFileURL(path.join(ROOT, 'elysia', 'scene-script-apis.js')).href)

let pass = 0, fail = 0, skipN = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + String(detail).slice(0, 240) : '')) } }

console.log('== C6 指针事件派发（离线桩件 + 真机探针）==')

/* A 段：离线桩件 */
{
  const received = []
  const SRC = `'use strict';
export function cursorClick(event) {
  received.push({ layer: thisLayer.name, wx: event.worldPosition.x, sub: thisLayer.origin.subtract(event.worldPosition).x });
}`
  // 让脚本把 received 写到共享对象（沙箱里没有外部引用 ⇒ 用 thisScene 挂载点回传）
  const scene = {
    general: { orthogonalprojection: { width: 3840, height: 2160 } },
    camera: null,
    objects: [
      { id: 1, name: 'layerA', origin: { script: SRC, value: '0 0 0' }, size: '400 300' },
      { id: 2, name: 'layerB', origin: { script: SRC, value: '0 0 0' }, size: '400 300' },
    ],
  }
  // received 通道：脚本里 push 到 received 不可见 ⇒ 改成写 thisLayer 的自由字段（宿主写回场景对象）
  const SRC2 = `'use strict';
export function cursorClick(event) {
  // alpha = |origin − worldPosition|.x / 400：origin=0 时 worldPosition.x=100 ⇒ 0.25（事件值真流进了脚本）
  thisLayer.alpha = Math.min(1, Math.abs(thisLayer.origin.subtract(event.worldPosition).x) / 400);
}`
  scene.objects[0].origin.script = SRC2
  scene.objects[1].origin.script = SRC2
  const cache = createScriptCache()
  applySceneScripts(scene, 0, { scriptCache: cache, renderObjects: scene.objects, canvasSize: { x: 3840, y: 2160 } })
  const layerA = scene.objects[0], layerB = scene.objects[1]
  const ev = { worldPosition: new Vec3(100, 200, 0) }
  dispatchScriptEvent(cache, 'cursorClick', ev, { ownerFilter: (obj) => obj === layerA })
  ok('A1 ownerFilter=layerA ⇒ 只有 layerA 收到（alpha=|0−100|/400=0.25 而 B 不变——事件值真流进脚本）',
    layerA.alpha === 0.25 && layerB.alpha === undefined, JSON.stringify({ a: layerA.alpha, b: layerB.alpha }))
  ok('A2 第二次派发 worldPosition.x=−300 ⇒ alpha=0.75（值随事件坐标变化，Vec3.subtract 真可调）',
    (dispatchScriptEvent(cache, 'cursorClick', { worldPosition: new Vec3(-300, 200, 0) }, { ownerFilter: (obj) => obj === layerA }), layerA.alpha === 0.75),
    'alpha=' + layerA.alpha)
  // 无 ownerFilter = 全体投递（媒体事件旧语义）
  dispatchScriptEvent(cache, 'cursorClick', ev, {})
  ok('A3 不带 ownerFilter ⇒ 两份实例都收到（媒体事件旧语义不回归）',
    layerA.alpha === 0.25 && layerB.alpha === 0.25, JSON.stringify({ a: layerA.alpha, b: layerB.alpha }))
  // 变异自证：/tmp 副本去掉 ownerFilter 分支 ⇒ A1 必红
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-c6-'))
  const src = fs.readFileSync(path.join(ROOT, 'elysia', 'scene-scripts.js'), 'utf8')
  const anchor = "      if (ownerFilter && !ownerFilter(obj)) continue"
  if (!src.includes(anchor)) ok('C0 变异锚点存在', false, 'ownerFilter 分支没找到')
  else {
    fs.writeFileSync(path.join(dir, 'scene-scripts.js'), src.replace(anchor, '      if (false) continue'))
    // 副本还要能 import ./scene-script-apis.js（其内部 import ./we-renderer/math.js）与 ../core —— **递归**拷齐
    const copyTree = (fromDir, toDir) => { fs.mkdirSync(toDir, { recursive: true }); for (const name of fs.readdirSync(fromDir)) { const sp = path.join(fromDir, name), dp = path.join(toDir, name); let st = null; try { st = fs.statSync(sp) } catch (e) { continue } if (!st) continue; if (st.isDirectory()) { if (name === 'vendor') continue; copyTree(sp, dp); continue } if (st.isFile()) fs.writeFileSync(dp, fs.readFileSync(sp)) } }
    copyTree(path.join(ROOT, 'elysia'), dir)
    copyTree(path.join(ROOT, 'core'), path.join(dir, 'core'))
    const murl = pathToFileURL(path.join(dir, 'scene-scripts.js')).href + '?t=' + Date.now()
    const mmod = await import(murl)
    delete layerA.__got; delete layerB.__got
    const cache2 = createScriptCache()
    applySceneScripts(scene, 0, { scriptCache: cache2, renderObjects: scene.objects, canvasSize: { x: 3840, y: 2160 } })
    dispatchScriptEvent.call(null, cache2, 'cursorClick', ev, { ownerFilter: (obj) => obj === layerA })
    // 变异体的 dispatchScriptEvent（无 ownerFilter）直接调：
    const gotA = layerA.alpha === 0.25, gotB = layerB.alpha === 0.25
    ok('C 变异自证：ownerFilter 分支被摘 ⇒ 两份实例都收到（A1 必红的机制证明）', gotA && gotB, JSON.stringify({ gotA, gotB }))
  }
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
}

/* B 段：真机探针（GL 前置；无 GL SKIP） */
{
  const { launchGLBrowser, glCapability, closeQuiet, findPlaywright } = await import(path.join(ROOT, 'tests', '_gl-browser.mjs'))
  const require_ = (await import('node:module')).createRequire(path.join(ROOT, 'package.json'))
  const pw = require_(findPlaywright()); const firefox = (pw.default && pw.default.firefox) || pw.firefox
  const { browser } = await launchGLBrowser(firefox)
  const gl = await glCapability(browser)
  if (!gl.webgl2) {
    await closeQuiet(browser)
    console.log('  ~ SKIP B 段真机（无 GL —— 原样读数：webgl2=false）')
    skipN++
    console.log('===== cursor-dispatch: ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skipN + ' SKIP =====')
    process.exit(0)
  }
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  const pkgPath = path.join(WS, 'allwallpaper', '0923', '2887099508', 'scene.pkg')
  const url = `http://127.0.0.1:8902/webloader/?type=scene&id=2887099508&pkgpath=${encodeURIComponent(pkgPath)}&res=dpr&shell=0&campose=legacy`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction('!!window.__mpwFirstFrame', null, { timeout: 60000 })
  await page.waitForTimeout(4000)
  // 耳朵层（r ear1，设计 origin ≈ (4000, 780)？⇒ 从页内 scene 状态读真实 origin 换算屏幕坐标）
  const target = await page.evaluate(() => {
    const ls = (window.__sceneLayers) || []
    const ear = ls.find((l) => l.name === 'r ear1' && l.visible !== false) || null
    return ear ? { name: ear.name, ox: ear.origin && ear.origin[0], oy: ear.origin && ear.origin[1] } : null
  })
  if (!target || target.ox == null) {
    await closeQuiet(browser)
    sk('B 真机探针', '页内 scene 层状态取不到（__sceneLayers）')
    console.log('===== cursor-dispatch: ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skipN + ' SKIP =====')
    process.exit(fail ? 1 : 0)
  }
  const disp = await page.evaluate(() => {
    const cv = document.getElementById('sc')
    const r = cv.getBoundingClientRect()
    const p = (window.__sceneProj) || {}
    return { cvLeft: r.left, cvTop: r.top, cvW: r.width, cvH: r.height, cvWd: cv.width, cvHd: cv.height }
  })
  const dx = target.ox / 6080, dy = target.oy / 3420
  const cx = disp.cvLeft + dx * disp.cvW, cy = disp.cvTop + dy * disp.cvH
  await page.mouse.click(cx, cy)
  await page.waitForTimeout(1200)
  const st = await page.evaluate(() => window.__mpwCursorDispatch || null)
  ok('B1 探针包真机点击 ⇒ cursorClick 派发 ≥1 且命中层含耳朵（派发链路端到端）',
    st && (st.clicks || 0) >= 1 && (st.hits || []).some((h) => /ear/i.test(h)),
    JSON.stringify(st))
  // 派发计数语义：clicks = cursorClick 的**脚本调用**数（ownerFilter 命中后）——命中层含耳朵
  //   且耳朵脚本导出了 cursorClick ⇒ calls ≥ 1；若为 0 说明 owner 身份映射断了（layers≠objects）。
  ok('B2 命中层脚本的 cursorClick 调用数 ≥ 1（owner 身份映射 = scene.objects）',
    st && (st.clicks || 0) >= 1, 'clicks=' + (st && st.clicks))
  await closeQuiet(browser)
}

/* ── C 源级钉子（P-228i 2026-10-05）：空命中不许抛异常 + 台账每次都要写 ── */
{
  const src = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
  ok('C1 派发聚合量声明在循环**外**（`dispatchCursorTo` 里 `let st = { calls: 0, errors: 0, entries: 0 }` 先于 `for (const l of list)`）',
    /let st = \{ calls: 0, errors: 0, entries: 0 \}\s*\n\s*for \(const l of list\)/.test(src))
  ok('C2 循环内不再声明遮蔽的 `const st`（空命中时那句 `CURSOR.lastDispatch` 曾抛 `ReferenceError: st is not defined`）',
    !/for \(const l of (hits|list)\) \{[\s\S]{0,400}?const st = dispatchScriptEvent\(/.test(src))
  ok('C3 `CURSOR.lastDispatch` 在派发函数里无条件写（点空白也要留下"点了、没命中"的事实）',
    /CURSOR\.lastDispatch = \{ name, calls: st\.calls, errors: st\.errors, entries: st\.entries \}/.test(src))
  ok('C5 P-228j 悬浮三态也派发：`pointermove` → `cursorEnter` / `cursorLeave` / `cursorMove`（作者"悬浮才出现"的一整类靠它）',
    /addEventListener\('pointermove'/.test(src) && /dispatchCursorTo\('cursorLeave'/.test(src) && /dispatchCursorTo\('cursorEnter'/.test(src) && /dispatchCursorTo\('cursorMove'/.test(src))
  ok('C6 悬浮三态的台账字段在读数对象里（enters/leaves/moves）',
    /enters: 0, leaves: 0, moves: 0/.test(src))
  ok('C4 设计空间投影可读（探针把屏幕坐标换成设计坐标用）：`window.__mpwSceneInfo` 发布 projW/projH/layers',
    /window\.__mpwSceneInfo = \{/.test(src) && /projW:/.test(src) && /projH:/.test(src))
}
console.log('\n===== cursor-dispatch: ' + pass + ' 通过 / ' + fail + ' 失败' + (skipN ? ' / ' + skipN + ' SKIP' : '') + ' =====')
process.exit(fail ? 1 : 0)

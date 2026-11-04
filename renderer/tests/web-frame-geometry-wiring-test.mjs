// web-frame-geometry-wiring-test.mjs — P-112-BANDGEOM（任务书 §5-4）帧几何**接线**验收
//
// 断言对象是接线，不是模块本身（模块契约另有 50 断言在 tests/web-frame-geometry-test.mjs）：
//   ① `demo.html` 的 `MPW-FRAMEGEOM` 块（`?framegeom=`）→ video 壁纸帧盒（cover/contain/stretch 三态）
//   ② `core/we-scene-bundle.js` 的指针口径（`frameGeomMode` / `framePointerMap`）：DOM pointer 事件
//      与 `__mpwPointer.space='css'` 注入两条路径。
// 手法同 baseline/props-panel 那套：**真源码切片 + 注入桩**，不碰 DOM/GPU/网络。
//
// 缺证据的部分（写清楚，不猜）：web 壁纸 iframe 的**尺寸**路径在本仓库不存在可注入点 ——
//   三方 minified 渲染器自己算（`demo/assets/renderer-BOSoB05I.js` 的 `nw`/`Y1`），插件侧在另一棵树
//   ⇒ 本测试**不**假设它已接线（见 docs/AUDIO-BAND-WIRING.md §4）。
//
// 运行：node tests/web-frame-geometry-wiring-test.mjs   （全过输出 ALL PASS，退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeFrameFit, contentAspectOf, coverViewport, frameVisibleRect, frameClientPoint,
  FRAME_ASPECT_EPS, FRAME_ASPECT_MIN, FRAME_ASPECT_MAX, FRAME_FIT,
} from '../core/web-frame-geometry.mjs'
import { frameGeomMode, framePointerMap, FRAME_GEOM_MODES } from '../core/we-scene-bundle.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const ok = (cond, label, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  ' + detail : ''))
  if (!cond) failed++
}
const near = (a, b, eps = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps

const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const BUNDLE = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
function slice(src, begin, end) {
  const i = src.indexOf(begin)
  if (i < 0) throw new Error('切片起点缺失: ' + begin)
  const j = src.indexOf(end, i)
  if (j < 0) throw new Error('切片终点缺失: ' + end)
  return src.slice(i, j + end.length)
}
const GEO_BLOCK = slice(HTML, '// ═══ MPW-FRAMEGEOM-BEGIN', '// ═══ MPW-FRAMEGEOM-END ═══')

/* ── 假 video 元素（只需要 applyVideoFrameBox 读的那几个字段） ── */
function fakeVideo(vw, vh, cssW, cssH) {
  return { videoWidth: vw, videoHeight: vh, clientWidth: cssW, clientHeight: cssH, style: { cssText: 'LEGACY' } }
}
/** 把真源码切片跑起来（依赖全注入） */
function makeVideoEnv(opts = {}) {
  const logs = []
  const stageW = opts.stageW || 1280, stageH = opts.stageH || 720
  const win = { innerWidth: stageW, innerHeight: stageH }
  const doc = { documentElement: { clientWidth: stageW, clientHeight: stageH } }
  const body = GEO_BLOCK + '\nreturn { FRAME_GEOM_FIT, videoFramePlan, applyVideoFrameBox }'
  const api = new Function('normalizeFrameFit', 'contentAspectOf', 'coverViewport', 'frameVisibleRect',
    'location', 'window', 'document', 'logf', body)(
    normalizeFrameFit, contentAspectOf, coverViewport, frameVisibleRect,
    { search: opts.search || '' }, win, doc, (m) => logs.push(m))
  return { api, logs, win, doc }
}

console.log('\n== T1 开关真值表（?framegeom=）与"缺省不动" ==')
{
  const cases = [
    ['', 'legacy'], ['?framegeom=legacy', 'legacy'], ['?framegeom=off', 'legacy'], ['?framegeom=0', 'legacy'],
    ['?framegeom=cover', 'cover'], ['?framegeom=frame', 'cover'], ['?framegeom=COVER', 'cover'],
    ['?framegeom=contain', 'contain'], ['?framegeom=fit', 'contain'], ['?framegeom=stretch', 'stretch'],
    ['?framegeom=fill', 'stretch'], ['?framegeom=banana', 'cover'],   // 未知值回落 cover（规格 §4）
  ]
  let bad = 0
  for (const [s, want] of cases) { const e = makeVideoEnv({ search: s }); if (e.api.FRAME_GEOM_FIT !== want) { bad++; console.log('   ✗ ' + s + ' → ' + e.api.FRAME_GEOM_FIT + '（期望 ' + want + '）') } }
  ok(bad === 0, 'T1a 12 条真值表全部命中（`FRAME_FIT` 三态 = ' + FRAME_FIT.join('/') + '；未知值回落 cover）', '坏 ' + bad + ' 条')
  const e = makeVideoEnv({})
  const v = fakeVideo(1000, 1000, 1280, 720)
  ok(e.api.applyVideoFrameBox(v, 'legacy') === null && v.style.cssText === 'LEGACY',
    'T1b 缺省 legacy：**不返回计划、不碰样式**（video 元素样式逐字等于改动前）')
}

console.log('\n== T2 cover/contain/stretch 的**文档化矩形**（规格 §2/§4）==')
{
  // ① 舞台更"宽"（1280×720 vs 1:1 内容）⇒ 对齐宽度、高度溢出居中裁掉
  const e = makeVideoEnv({ search: '?framegeom=cover' })
  const v = fakeVideo(1000, 1000, 1280, 720)
  const p = e.api.applyVideoFrameBox(v, 'cover-1')
  ok(p && near(p.aspect, 1) && p.box && near(p.box.width, 1280) && near(p.box.height, 1280) && near(p.box.left, 0) && near(p.box.top, -280),
    'T2a cover：帧盒 1280×1280 @(0,−280)（= `coverViewport(1280,720,1)`，规格 §2.2 第 2 支）',
    p && p.box ? (p.box.width + 'x' + p.box.height + ' @(' + p.box.left + ',' + p.box.top + ')') : 'null')
  ok(p && p.visible && near(p.visible.x, 0) && near(p.visible.y, 0) && near(p.visible.width, 1280) && near(p.visible.height, 720),
    'T2b 可见子矩形 = 整舞台（裁掉的部分在舞台外；`frameVisibleRect` 与 `coverViewport` 同一套几何）')
  ok(/left:0px;top:-280px;width:1280px;height:1280px;object-fit:cover/.test(v.style.cssText),
    'T2c 真的写进元素样式（position:fixed + 帧盒 + object-fit:cover）', v.style.cssText.slice(0, 70) + '…')
  ok(e.logs.length === 1 && /帧几何\(cover\)/.test(e.logs[0]), 'T2d 量测结果进 #log（真机/上报可复核）')

  // ② 舞台更"高"（1000×1000 vs 2:1 内容）⇒ 对齐高度、宽度溢出居中裁掉
  const e2 = makeVideoEnv({ search: '?framegeom=cover', stageW: 1000, stageH: 1000 })
  const v2 = fakeVideo(2000, 1000, 1000, 1000)
  const p2 = e2.api.applyVideoFrameBox(v2, 'cover-2')
  ok(p2 && near(p2.aspect, 2) && near(p2.box.width, 2000) && near(p2.box.height, 1000) && near(p2.box.left, -500) && near(p2.box.top, 0),
    'T2e cover 镜像支：帧盒 2000×1000 @(−500,0)（规格 §2.3 不变量 4：两方向互为镜像）')

  // ③ 已贴合（比例差在容差内）⇒ 不动
  const e3 = makeVideoEnv({ search: '?framegeom=cover' })
  const v3 = fakeVideo(1920, 1080, 1280, 720)
  const p3 = e3.api.applyVideoFrameBox(v3, 'cover-fit')
  ok(p3 && p3.box && near(p3.box.width, 1280) && near(p3.box.height, 720) && near(p3.box.left, 0) && near(p3.box.top, 0),
    'T2f 比例已贴合（1920×1080 内容 vs 1280×720 舞台）⇒ 帧盒 = 舞台全幅（`coverViewport` 的 null 支：不裁一刀）')
  ok(FRAME_ASPECT_EPS === 0.005 && FRAME_ASPECT_MIN === 0.2 && FRAME_ASPECT_MAX === 6,
    'T2f 容差/限幅常量与规格 §2.2/§3 一致（0.005 / [0.2, 6]）')

  // ④ contain / stretch：视口 100%×100%，差别只在 object-fit
  const e4 = makeVideoEnv({ search: '?framegeom=contain' })
  const v4 = fakeVideo(1000, 1000, 1280, 720)
  const p4 = e4.api.applyVideoFrameBox(v4, 'contain')
  ok(p4 && positiveFull(p4.box, 1280, 720) && /object-fit:contain/.test(v4.style.cssText),
    'T2g contain：视口 100%×100%（1280×720 @0,0）+ object-fit:contain（露出的边由页面底色承担）')
  const e5 = makeVideoEnv({ search: '?framegeom=stretch' })
  const v5 = fakeVideo(1000, 1000, 1280, 720)
  const p5 = e5.api.applyVideoFrameBox(v5, 'stretch')
  ok(p5 && positiveFull(p5.box, 1280, 720) && /object-fit:fill/.test(v5.style.cssText),
    'T2h stretch：视口 100%×100% + object-fit:fill（内容按舞台比例拉伸）')
  function positiveFull(b, w, h) { return b && near(b.width, w) && near(b.height, h) && near(b.left, 0) && near(b.top, 0) }
}

console.log('\n== T3 内容比例只认内在尺寸（规格 §3：不拿渲染盒当设计比例）==')
{
  const e = makeVideoEnv({ search: '?framegeom=cover' })
  // 内在 1:1，渲染盒是 2:1 的占位（元数据未到时的经典形态）⇒ 必须用 1
  const p = e.api.videoFramePlan({ width: 1000, height: 1000 }, { width: 300, height: 150 }, 1280, 720, 'cover')
  ok(p && near(p.aspect, 1) && near(p.box.height, 1280),
    'T3a 内在尺寸优先：占位盒 300×150(2:1) 不参与 ⇒ 比例 1、帧盒 1280 高', 'aspect=' + (p && p.aspect))
  const p2 = e.api.videoFramePlan({ width: 0, height: 0 }, { width: 300, height: 150 }, 1280, 720, 'cover')
  ok(p2 && near(p2.aspect, 2), 'T3b 无内在尺寸 ⇒ 退回渲染盒比例（兜底支，规格 §3 第 3 支）')
  const p3 = e.api.videoFramePlan({ width: 0, height: 0 }, { width: 3000, height: 30 }, 1280, 720, 'cover')
  ok(p3 && p3.aspect === null && p3.box === null,
    'T3c 量错（比例 100 超出 [0.2,6]）⇒ aspect/box 均为 null ⇒ 不处理（不拿错比例算 15360×1200 那种视口）')
  const v = fakeVideo(0, 0, 3000, 30)
  ok(e.api.applyVideoFrameBox(v, 'bogus') === null || v.style.cssText === 'LEGACY', 'T3d 量不到 ⇒ 样式保持原样（交给 CSS，不猜）')
}

// 假画布：显示盒 400×200（被祖先 transform 缩到一半），内部视口 800×400；plain = 未缩放的对照
const SCALED = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 200 }), clientWidth: 800, clientHeight: 400 }
const PLAIN = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 400 }), clientWidth: 800, clientHeight: 400 }
const EV = { clientX: 300, clientY: 150 }

console.log('\n== T4 渲染器指针口径（core/we-scene-bundle.js 的真导出）==')
{
  ok(Array.isArray(FRAME_GEOM_MODES) && FRAME_GEOM_MODES.join(',') === 'legacy,cover', 'T4a 档位常量 = legacy/cover（缺省 legacy）')
  const modeCases = [
    ['', 'legacy'], ['?framegeom=cover', 'cover'], ['?framegeom=COVER', 'cover'], ['?framegeom=frame', 'cover'],
    ['?framegeom=cover&frame=legacy', 'legacy'],       // 模块规格 §5 的回退开关优先级最高
    ['?framegeom=cover&frame=off', 'legacy'], ['?framegeom=cover&frame=0', 'legacy'],
    ['?framegeom=legacy', 'legacy'], ['?framegeom=banana', 'legacy'], ['?frame=legacy', 'legacy'],
  ]
  let bad = 0
  for (const [s, want] of modeCases) if (frameGeomMode(s) !== want) { bad++; console.log('   ✗ ' + s + ' → ' + frameGeomMode(s)) }
  ok(bad === 0, 'T4b 10 条档位真值表命中（含 `?frame=legacy|off|0` 的**最高优先**回退）', '坏 ' + bad)

  const scaled = SCALED, plain = PLAIN, ev = EV
  const legacy = framePointerMap(ev, scaled, 'legacy')
  ok(legacy && near(legacy.nx, (ev.clientX - 100) / 400) && near(legacy.ny, (ev.clientY - 50) / 200),
    'T4c legacy 档 = **改动前的内联算式** `(clientX−left)/width`（逐位同式，可对拍）',
    'nx=' + legacy.nx + ' ny=' + legacy.ny)
  const cover = framePointerMap(ev, scaled, 'cover')
  ok(cover && near(cover.scaleX, 0.5) && near(cover.scaleY, 0.5) && near(cover.x, 400) && near(cover.y, 200),
    'T4d cover 档补偿祖先 CSS transform：显示盒 400/内部 800 ⇒ scale=0.5、帧内 client x=400（legacy 只给 200）',
    'x=' + cover.x + ' scaleX=' + cover.scaleX)
  ok(near(cover.nx, legacy.nx) && near(cover.ny, legacy.ny),
    'T4e 归一化结果两档相同（归一量对缩放不敏感；差别在**帧内 client 像素**这一层 —— 正是 `space:css` 需要的那层）')
  const plainPt = framePointerMap({ clientX: 410, clientY: 220 }, plain, 'cover')
  ok(near(plainPt.x, 400) && near(plainPt.y, 200) && near(plainPt.scaleX, 1) && plainPt.inside === true,
    'T4f 1:1 情形（规格 §1.4 不变量 1）：x = clientX − left、scale=1、inside=true')
  const out = framePointerMap({ clientX: 5, clientY: 5 }, plain, 'cover')
  ok(out && out.inside === false && Number.isFinite(out.x), 'T4g 越界仍返回数值但 inside=false（调用方靠它维护 hover，不丢事件）')
  ok(framePointerMap({ clientX: NaN, clientY: 10 }, plain, 'cover') === null, 'T4h 非有限值 ⇒ null（NaN 不许污染调用方状态）')
  ok(framePointerMap(ev, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }), clientWidth: 0, clientHeight: 0 }, 'cover') === null,
    'T4i 零尺寸 ⇒ null（尚未布局）')
  ok(framePointerMap(ev, null, 'cover') === null && framePointerMap(ev, null, 'legacy') === null, 'T4j 无元素 ⇒ null（两档都不抛错）')
  ok(Number.isNaN(framePointerMap({ clientX: NaN, clientY: 10 }, plain, 'legacy').nx),
    'T4k legacy 档照旧透传 NaN（不新增丢弃行为 ⇒ "关=逐位不变"含边界）')
  // 独立复算：模块契约面（frameClientPoint）与接线面同一结果
  const direct = frameClientPoint(ev, scaled.getBoundingClientRect(), { width: 800, height: 400 })
  ok(near(direct.x, cover.x) && near(direct.y, cover.y) && direct.inside === cover.inside,
    'T4l 接线结果 === 模块 `frameClientPoint` 的直接调用（没有中间再算一遍）')
}

console.log('\n== T5 接线落点 + 反向变异 ==')
{
  ok(/from '\.\/web-frame-geometry\.mjs'/.test(BUNDLE), 'T5a 内核真源码 import 模块（唯一实现处；落点 1/3）')
  ok(/const FRAME_GEOM = frameGeomMode\(/.test(BUNDLE) && /framePointerMap\(ev, el, FRAME_GEOM(?:, [^)]*)?\)/.test(BUNDLE),
    'T5a `__hookPointer` 的 DOM 路径真的走 `framePointerMap`（不是旁边留了个没用的 helper；'
    // ①(P-113) 断言放宽成"前三个实参固定、第四个可选"：第四个是水平翻转（`__pointerFlip()`），
    //   缺省 false ⇒ 与改动前逐位同值；原正则写死了三参形态，加参数就假红。
    + '第四实参 = P-113 的翻转口径，可选）')
  ok(/inj\.space === 'css' && cam && FRAME_GEOM === 'cover'/.test(BUNDLE) && /framePointerMap\(\{ clientX: inj\.x, clientY: inj\.y \}/.test(BUNDLE),
    'T5b `__mpwPointer.space=\'css\'` 注入路径接了（口径见 docs/AUDIO-BAND-WIRING.md §4）')
  ok(/from '\.\/web-frame-geometry\.mjs'/.test(HTML) && /applyVideoFrameBox\(v, 'type=video'\)/.test(HTML) && /applyVideoFrameBox\(v, '\?video=1'\)/.test(HTML),
    'T5c demo.html 两条 video 壁纸路径都接了帧盒（落点 2/3）')
  const server = fs.readFileSync(path.join(ROOT, 'server', 'we-scene-demo-server.mjs'), 'utf8')
  ok(server.indexOf("p === '/web-frame-geometry.mjs'") > 0, 'T5c 自带服务器同名路由（落点 3/3）')
  ok(/core\/web-frame-geometry\.mjs', 'web-frame-geometry\.mjs'/.test(fs.readFileSync(path.join(ROOT, 'build-pages.mjs'), 'utf8')),
    'T5c 产物根映射在位（Pages 下 200）')
  const spec = fs.readFileSync(path.join(ROOT, 'docs', 'WEB-FRAME-GEOMETRY-SPEC.md'), 'utf8')
  ok(spec.indexOf('AUDIO-BAND-WIRING.md') > 0, 'T5d 规格 §5 已指向接线文档（"尚未接线"口径不再陈旧）')

  /* ── 反向变异 ①：把帧盒块改回"什么都不做"（legacy）⇒ T2a 必红 ── */
  const red = []
  const mutA = GEO_BLOCK.replace("const v = String(new URLSearchParams(location.search).get('framegeom') || '').trim().toLowerCase()",
    "const v = ''")
  ok(mutA !== GEO_BLOCK, 'T5e 变异①生效（开关解析确有可改之处）')
  {
    const body = mutA + '\nreturn { FRAME_GEOM_FIT, applyVideoFrameBox, videoFramePlan }'
    const api = new Function('normalizeFrameFit', 'contentAspectOf', 'coverViewport', 'frameVisibleRect',
      'location', 'window', 'document', 'logf', body)(normalizeFrameFit, contentAspectOf, coverViewport, frameVisibleRect,
      { search: '?framegeom=cover' }, { innerWidth: 1280, innerHeight: 720 }, { documentElement: { clientWidth: 1280, clientHeight: 720 } }, () => {})
    const v = fakeVideo(1000, 1000, 1280, 720)
    const r = api.applyVideoFrameBox(v, 'mut')
    if (api.FRAME_GEOM_FIT === 'legacy' && r === null && v.style.cssText === 'LEGACY') red.push('变异①(帧盒块强制 legacy)：cover 帧盒不再计算（返回 null、样式未动）⇒ T2a/T2c 变红')
  }
  /* ── 反向变异 ②：把 `framePointerMap` 的 cover 支改成旧算式 ⇒ T4d 必红 ── */
  const i0 = BUNDLE.indexOf('export function framePointerMap(')
  const i1 = BUNDLE.indexOf('\n}', i0)
  const fnSrc = BUNDLE.slice(i0, i1 + 2)
  ok(i0 > 0 && fnSrc.indexOf("if (mode === 'cover') {") > 0, 'T5e 变异②生效（指针换算函数已切出）')
  const mutFn = fnSrc.replace('export function framePointerMap(', 'function framePointerMap(').replace("if (mode === 'cover') {", 'if (false) {')
  const mutMap = new Function('frameClientPoint', mutFn + '\nreturn framePointerMap')(frameClientPoint)
  const mm = mutMap(EV, SCALED, 'cover')
  if (near(mm.scaleX, 1) && near(mm.x, 200) && !near(mm.x, 400)) red.push('变异②(cover 支退化成旧算式)：x=200（无祖先缩放补偿）⇒ T4d 变红')
  ok(red.length === 2, 'T5e RED-IF-REVERTED：两条最关键的断言在"改回旧行为"后确实变红')
  for (const r of red) console.log('   RED ' + r)
}

console.log(failed ? `\n${failed} 项失败` : '\nALL PASS')
process.exit(failed ? 1 : 0)

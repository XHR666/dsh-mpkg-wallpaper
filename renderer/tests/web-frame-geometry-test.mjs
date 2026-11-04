// web-frame-geometry-test.mjs — P-102 帧几何（帧内坐标契约 + 覆盖式视口）验收
//
// 规格：docs/WEB-FRAME-GEOMETRY-SPEC.md（先写规格、再按规格实现；差异清单见规格 §6）
// 参照：oneincase/webwallgl（MIT © oneincase，commit b61e8910ae0a176288aed99ce9a93a13ea07df57）
//       的 `renderer/src/web.ts` —— 只对齐**行为契约**，未复制代码（台账 docs/COPYING-RULES.md §4 #9）
//
// 断言四组：
//   T1 frameClientPoint：1:1 / 只看 client 坐标 / 祖先缩放 / 负偏移 / 越界仍给值 / 非有限与零尺寸 → null
//   T2 coverViewport：覆盖面判定 / 居中裁切 / 容差内不动 / 比例互换镜像 / 非法输入 → null
//   T3 contentAspectOf + frameVisibleRect：内在尺寸优先（元数据未到不拿占位盒当比例）/ 限幅 / 可见子矩形
//   T4 回退开关与登记：?frame=legacy 解析 + README-DIAGNOSTICS 主表有该开关行 + 规格文档在位
//
// 运行：node tests/web-frame-geometry-test.mjs   （全过输出 ALL PASS，退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FRAME_ASPECT_EPS, FRAME_ASPECT_MIN, FRAME_ASPECT_MAX,
  normalizeFrameFit, frameClientPoint, contentAspectOf, coverViewport, frameVisibleRect,
  frameGeomModeFromQuery,
} from '../core/web-frame-geometry.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const ok = (cond, label, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  ' + detail : ''))
  if (!cond) failed++
}
const near = (a, b, eps = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps

/* ══════════════ T1 帧内坐标契约 ══════════════ */
console.log('\n== T1 frameClientPoint：窗口 client 坐标 → 帧内 client 像素 ==')
{
  const rect = { left: 100, top: 50, width: 800, height: 600 }
  const vp = { width: 800, height: 600 }
  const p = frameClientPoint({ clientX: 300, clientY: 150 }, rect, vp)
  ok(p && near(p.x, 200) && near(p.y, 100) && p.inside === true, 'T1a 1:1 对齐：x/y = client − 偏移')
  ok(p && near(p.scaleX, 1) && near(p.scaleY, 1), 'T1a 缩放系数 = 1')

  const withPage = frameClientPoint({ clientX: 300, clientY: 150, pageX: 300, pageY: 2150 }, rect, vp)
  ok(withPage && near(withPage.x, 200) && near(withPage.y, 100), 'T1b 同时带 pageX/pageY 时结果不受影响（只认 client 空间）')

  const scaled = frameClientPoint({ clientX: 300, clientY: 150 }, { left: 100, top: 50, width: 400, height: 300 }, vp)
  ok(scaled && near(scaled.x, 400) && near(scaled.y, 200), 'T1c 祖先缩放 0.5：坐标放大一倍（400/800）')
  ok(scaled && near(scaled.scaleX, 0.5), 'T1c scaleX = 0.5（供诊断）')

  const shifted = frameClientPoint({ clientX: 0, clientY: 0 }, { left: -50, top: 0, width: 900, height: 600 }, { width: 900, height: 600 })
  ok(shifted && near(shifted.x, 50) && shifted.inside === true, 'T1d 帧左移 −50：窗口原点落在帧内 +50')

  const out = frameClientPoint({ clientX: 2000, clientY: 900 }, rect, vp)
  ok(out && out.inside === false && Number.isFinite(out.x), 'T1e 帧外坐标：仍给数值（inside=false 由调用方维护 hover 态）')

  ok(frameClientPoint({ clientX: NaN, clientY: 10 }, rect, vp) === null, 'T1f NaN 坐标 → null（必须丢弃）')
  ok(frameClientPoint({ clientX: 'x', clientY: 10 }, rect, vp) === null, 'T1f 非数值坐标 → null')
  ok(frameClientPoint({ clientX: 10, clientY: 10 }, { left: 0, top: 0, width: 0, height: 0 }, vp) === null, 'T1f 显示盒为 0 → null')
  ok(frameClientPoint({ clientX: 10, clientY: 10 }, rect, { width: 0, height: 0 }) === null, 'T1f 内部视口为 0（未布局）→ null')
  ok(frameClientPoint(null, rect, vp) === null, 'T1f 无事件 → null')
}

/* ══════════════ T2 覆盖式视口 ══════════════ */
console.log('\n== T2 coverViewport：内容比例铺满舞台 + 溢出居中裁切 ==')
{
  // 16:9 内容放在 16:10 舞台（1920×1200）：对齐高度、宽度溢出居中裁
  const a = coverViewport(1920, 1200, 16 / 9)
  ok(a && near(a.height, 1200) && near(a.width, 1200 * 16 / 9), 'T2a 舞台更"高"：高度对齐，宽度 = 舞台高 × 内容比例')
  ok(a && near(a.left, (1920 - a.width) / 2) && a.left < 0 && near(a.top, 0), 'T2a 宽度溢出量平分为左右（居中裁切），top=0')

  // 32:9 舞台放 16:9 内容：对齐宽度、高度溢出居中裁
  const b = coverViewport(3840, 1080, 16 / 9)
  ok(b && near(b.width, 3840) && near(b.height, 3840 / (16 / 9)), 'T2b 舞台更"宽"：宽度对齐，高度 = 舞台宽 / 内容比例')
  ok(b && near(b.top, (1080 - b.height) / 2) && b.top < 0 && near(b.left, 0), 'T2b 高度溢出量平分（居中裁切），left=0')

  // 覆盖不变量：任一维必须铺满，另一维恰好等于舞台
  for (const [sw, sh, ca] of [[1920, 1200, 16 / 9], [1280, 720, 4 / 3], [800, 1200, 21 / 9], [2560, 1080, 1], [1000, 1000, 2.39]]) {
    const v = coverViewport(sw, sh, ca)
    const covers = v && v.width >= sw - 1e-9 && v.height >= sh - 1e-9
    const touches = v && (near(v.width, sw) || near(v.height, sh))
    ok(covers && touches, `T2c 覆盖不变量 [${sw}×${sh} @ ${ca.toFixed(3)}]：两维都 ≥ 舞台且至少一维恰好相等`)
  }

  // 容差内不动（DPR 取整误差：0.4% 差异）
  const ca = 16 / 9
  const sw = 1920, sh = 1082            // 舞台比例 1.7712 与内容 1.7778 差 0.0037 < EPS
  const stageAspect = sw / sh
  ok(Math.abs(stageAspect - ca) < FRAME_ASPECT_EPS, 'T2d 夹具比例差 ' + Math.abs(stageAspect - ca).toFixed(4) + ' < EPS（夹具本身自洽）')
  ok(coverViewport(sw, sh, ca) === null, 'T2d 比例差 ≤ ' + FRAME_ASPECT_EPS + ' → null（已贴合，不再裁一刀）')
  ok(coverViewport(1920, 1000, ca) !== null, 'T2d 比例差 > EPS（1.92 vs 1.778）→ 给出覆盖式视口')

  // 比例互换的镜像
  const x = coverViewport(1600, 900, 4 / 3)      // 舞台 16:9、内容 4:3 → 更"宽"
  const y = coverViewport(900, 1600, 3 / 4)      // 舞台 9:16、内容 3:4 → 更"高"
  ok(x && y && near(x.width, y.height) && near(x.height, y.width) && near(x.left, y.top) && near(x.top, y.left),
    'T2e 比例互换：width/height 与 left/top 对调（镜像自洽）')

  ok(coverViewport(0, 100, 1.5) === null && coverViewport(100, 0, 1.5) === null, 'T2f 舞台尺寸 ≤0 → null')
  ok(coverViewport(100, 100, 0) === null && coverViewport(100, 100, NaN) === null, 'T2f 内容比例非法 → null')
}

/* ══════════════ T3 内容比例与可见子矩形 ══════════════ */
console.log('\n== T3 contentAspectOf / frameVisibleRect ==')
{
  ok(near(contentAspectOf({ width: 300, height: 150 }, { width: 1920, height: 1080 }), 16 / 9),
    'T3a 内在尺寸优先（元数据已到：渲染盒占位 300×150 不作数）')
  ok(near(contentAspectOf({ width: 800, height: 600 }, null), 4 / 3), 'T3a 无内在尺寸时退回渲染盒')
  ok(near(contentAspectOf({ width: 300, height: 150 }, null), 2), 'T3a 内在尺寸缺失且盒子比例在限幅内 → 按盒子取（2:1）')
  ok(contentAspectOf({ width: 0, height: 0 }, { width: 0, height: 0 }) === null, 'T3b 全 0 → null')
  ok(contentAspectOf({ width: 15360, height: 1000 }, null) === null, 'T3b 荒谬比例（15.36）超出上限 → null（视为量错）')
  ok(contentAspectOf({ width: 10, height: 100 }, null) === null, 'T3b 细条比例（0.1）低于下限 → null')
  ok(FRAME_ASPECT_MIN < 1 && FRAME_ASPECT_MAX > 2.4, 'T3b 限幅区间覆盖常见屏幕比例（' + FRAME_ASPECT_MIN + '–' + FRAME_ASPECT_MAX + '）')

  const vis = frameVisibleRect(1920, 1200, { left: -107, top: 0, width: 2133, height: 1200 })
  ok(vis && near(vis.x, 0) && near(vis.y, 0) && near(vis.width, 1920) && near(vis.height, 1200),
    'T3c 覆盖式视口（比舞台大且左移）的可见子矩形 = 整个舞台')
  const vis2 = frameVisibleRect(1920, 1200, { left: 0, top: 0, width: 960, height: 600 })
  ok(vis2 && near(vis2.width, 960) && near(vis2.height, 600), 'T3c 小于舞台的帧：可见区 = 帧自身')
  ok(frameVisibleRect(1920, 1200, { left: 2000, top: 0, width: 100, height: 100 }) === null,
    'T3c 完全在舞台外（无交集）→ null')
  ok(frameVisibleRect(0, 0, { left: 0, top: 0, width: 10, height: 10 }) === null, 'T3c 舞台为 0 → null')
}

/* ══════════════ T4 适配模式 + 回退开关 + 登记 ══════════════ */
console.log('\n== T4 normalizeFrameFit / ?frame=legacy / 文档登记 ==')
{
  ok(normalizeFrameFit('cover') === 'cover' && normalizeFrameFit(undefined) === 'cover' && normalizeFrameFit('乱写') === 'cover',
    'T4a 缺省与未知值一律回落 cover（宁裁不留边）')
  ok(normalizeFrameFit('contain') === 'contain' && normalizeFrameFit('fit') === 'contain', 'T4a contain / fit → contain')
  ok(normalizeFrameFit('stretch') === 'stretch' && normalizeFrameFit('FILL') === 'stretch', 'T4a stretch / fill → stretch（大小写无关）')

  ok(frameGeomModeFromQuery('?frame=legacy') === 'legacy', 'T4b ?frame=legacy → legacy（调用方回到 iframe 100%×100%）')
  ok(frameGeomModeFromQuery('?a=1&frame=off') === 'legacy' && frameGeomModeFromQuery('?frame=0') === 'legacy', 'T4b off/0 也算 legacy')
  ok(frameGeomModeFromQuery('') === 'cover' && frameGeomModeFromQuery('?x=1') === 'cover' && frameGeomModeFromQuery('?frame=x') === 'cover',
    'T4b 缺省/未知 → cover（默认走本模块）')

  // 本模块**尚未接线**到渲染器启动路径（规格 §5 写明了这一点）⇒ 不要求 README-DIAGNOSTICS 主表登记
  // （diag-flag-check 只抓"真实解析点"所在的四个来源，独立模块里的开关不在其口径内；
  //   接线后再登记主表行，届时 diag-flag-check 会把它算进来）。这里只断言模块自身的契约。
  ok(frameGeomModeFromQuery('?frame=LEGACY') === 'legacy' && frameGeomModeFromQuery('?frame=%20cover%20') === 'cover',
    'T4c 解析大小写/空白无关（URLSearchParams 口径）')
  ok(frameGeomModeFromQuery('?a=1&frame=legacy&b=2') === 'legacy', 'T4c 多参数串里定位 frame（参数边界正确）')
  const spec = (() => { try { return fs.readFileSync(path.join(ROOT, 'docs', 'WEB-FRAME-GEOMETRY-SPEC.md'), 'utf8') } catch { return '' } })()
  ok(spec.length > 2000 && spec.indexOf('frameClientPoint') >= 0 && spec.indexOf('coverViewport') >= 0,
    'T4d 规格文档在位且写明两个函数的契约（规格先行）')
  const tp = (() => { try { return fs.readFileSync(path.join(ROOT, 'THIRD-PARTY.md'), 'utf8') } catch { return '' } })()
  ok(tp.indexOf('web-frame-geometry') >= 0, 'T4e THIRD-PARTY.md 已登记本模块（署名 + 台账指针）')
  const ledger = (() => { try { return fs.readFileSync(path.join(ROOT, 'docs', 'COPYING-RULES.md'), 'utf8') } catch { return '' } })()
  ok(ledger.indexOf('web-frame-geometry') >= 0, 'T4e docs/COPYING-RULES.md §4 台账含本模块条目')
}

console.log(failed ? `\n${failed} 项失败` : '\nALL PASS')
process.exit(failed ? 1 : 0)

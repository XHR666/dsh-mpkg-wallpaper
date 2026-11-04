// elysia-firstframe-test.mjs —— 台账 §1.1 第 22 项判据：CPU 路（elysia）首帧上报（2026-10-11）
// 背景：`window.__mpwFirstFrame` 此前只在 demo.html 置位，`elysia/*.js` 0 命中 ⇒ `?mode=elysia` 的 CPU 路
// 永远不报首帧（7s 看门狗、mpw-cap{firstFrame}、data-mpw-frame 握手都会误判）。修法 = 与 demo.html:2753
// 同口径，在 CPU 路**首帧真正上屏之后**（putImageData 之后）置位一次。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'
const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })
const src = fs.readFileSync(path.join(ROOT, 'elysia', 'demo-elysia.js'), 'utf8')
const iMark = src.indexOf('__elysiaFirstFrameMarked = true')
const iPut = src.indexOf('ctx.putImageData(imgData, 0, 0)')
const iSched = src.indexOf('schedule();')
ok('E1', '存在首帧上报代码（`__mpwFirstFrame = 1` + `__mpwCapMarkFrame`）',
  /window\.__mpwFirstFrame = 1; window\.__mpwCapMarkFrame && window\.__mpwCapMarkFrame\(\)/.test(src), '与 demo.html:2753 同口径')
ok('E2', '上报点在**首帧上屏之后**（putImageData 之后）', iPut > 0 && iMark > iPut, `put@${iPut} mark@${iMark}`)
ok('E3', '只报一次（有 `__elysiaFirstFrameMarked` 守卫，不会每帧写全局）',
  /let __elysiaFirstFrameMarked = false/.test(src) && /if \(!__elysiaFirstFrameMarked\)/.test(src), '')
ok('E4', '渲染出错路径不误报（上报不在 catch 分支里）',
  /catch \(e\) \{\s*\n\s*logf\('❌ 渲染错误/.test(src) && !/catch \(e\) \{[^}]*__mpwFirstFrame/.test(src), '')
ok('E5', '仍保留自调度（schedule() 调用未被破坏）', iSched > 0, '')
const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + (r.detail ? ' — ' + r.detail : ''))
console.log(`===== elysia-firstframe: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

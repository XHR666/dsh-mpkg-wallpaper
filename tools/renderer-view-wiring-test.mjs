// tools/renderer-view-wiring-test.mjs —— ⑨(2026-11-07 #4) 镜头/滤镜 → 渲染器等价接线 + 本轮 UI 修复的静态判据
// 覆盖：
//   V  渲染器侧：view op / setView / 合成顺序 / 钳位；filter op；协议注释同步
//   H  宿主侧：mpwSceneViewPatch / mpwSceneFilterCss / push 下发 view+filter / 清残留 CSS 变换变量
//   G  光晕：#6 根因 = web/scene 分支提前 return 跳过 glow sync ⇒ 共享入口 mpwGlowApplyAll 在三处调用
//   S  扫描页：#2 占位层（白色滤镜+类型字）只在 data-mpw-thumb-shown 时显示；#3 已应用角标换 SVG
// 纪律：每条都配变异自证（期望红集 == 实际红集）；不跑浏览器。
//
// 判据演进留痕（R19，2026-11-07 Z5 对抗核查）：
//   原断言：`const ok = (n) => { pass++; … }` —— ok 只收 1 参，全文件 24 处 `ok('…', 条件)` 的
//           第二个参数被**静默丢弃**，任何条件都打印 ✓ ⇒ 整个 V/H/G/S/R 组是"恒绿"假门禁
//           （独立重放：把兜底 CSS 改回 display:none 后本判据仍 24/0 "全绿"，见
//           tools/scene-static-only-test.mjs 的 R-MUT 重放段——假绿证据链）。
//   新断言：`ok(n, cond, d)` 真评估条件（cond 假 ⇒ fail++ 并打 ✗），全部断言文本/正则一字未改。
//   为什么：R1（判据必须能失败）——不能失败的判据=没有判据；Z5 任务书"反假绿硬要求"。
//   语义如何保持：断言集合与期望值零改动，只是把"已经算好的条件"真正接进 pass/fail 计数。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..')
const CLIENT = fs.readFileSync(path.join(repo, 'lib', 'client.js'), 'utf8')
const RENDERER = fs.readFileSync(path.join(repo, 'renderer', 'demo.html'), 'utf8')

let pass = 0, fail = 0
const ok = (n, cond, d) => { if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')) }
const has = (src, re) => re.test(src)

/* ---------- V. 渲染器 ---------- */
{
  ok('V1 op view / op filter 在宿主命令通道里', has(RENDERER, /else if \(op === 'view'\) \{ if \(typeof api\.setView === 'function'\)/) && has(RENDERER, /else if \(op === 'filter'\) \{ if \(typeof api\.setFilter === 'function'\)/))
  ok('V2 __wp.setView / viewState 已发布', has(RENDERER, /WP\.setView = \(patch\) => mpwViewSet\(patch\)/) && has(RENDERER, /WP\.viewState = \(\) => mpwViewState\(\)/))
  ok('V3 MPW_VIEW 合成：translate → scale → scaleY(-1)（顺序判据）', (() => {
    const i = RENDERER.indexOf('function mpwViewTransform()')
    if (i < 0) return false
    const seg = RENDERER.slice(i, i + 900)
    const a = seg.indexOf("parts.push('translate("), b = seg.indexOf("parts.push('scale("), c = seg.indexOf("parts.push('scaleY(-1)')")
    return a >= 0 && b > a && c > b
  })())
  ok('V4 view 钳位存在（zoom 0.1–10 / pan ±4000）', has(RENDERER, /mpwViewNum\(MPW_VIEW\.zoom, 0\.1, 10, 1\)/) && has(RENDERER, /mpwViewNum\(MPW_VIEW\.panX, -4000, 4000, 0\)/))
  ok('V5 display transform 合成 view（从快照重算，不套娃）', has(RENDERER, /const vt = mpwViewTransform\(\)[\s\S]{0,300}?vt \+ ' ' \+ base/))
  /* 变异：把 view op 分支删掉 ⇒ V1 必红 */
  const mut = RENDERER.replace("else if (op === 'view') { if (typeof api.setView === 'function') { rec.ok = true; keepRes(api.setView(d.patch || d.v || {})) } }", '')
  ok('V-MUT 删掉 view op ⇒ V1 必红', !mut.includes("op === 'view'") && mut !== RENDERER)
}

/* ---------- H. 宿主 ---------- */
{
  ok('H1 宿主 view/filter 纯函数在位', has(CLIENT, /function mpwSceneViewPatch\(sec\)/) && has(CLIENT, /function mpwSceneFilterCss\(sec\)/))
  ok('H2 display patch 带 view + filter', has(CLIENT, /const view = mpwSceneViewPatch\(sec\)/) && has(CLIENT, /const filterCss = mpwSceneFilterCss\(sec\)/) && has(CLIENT, /view: view, filter: filterCss/))
  ok('H3 push 下发 view + filter 并记回执', has(CLIENT, /mpwSceneHostCmd\("view", \{ patch: p\.view \}\)/) && has(CLIENT, /mpwSceneHostCmd\("filter", \{ v: p\.filter \|\| "" \}\)/) && has(CLIENT, /okV: okV, okB: okB/))
  ok('H4 web/scene 帧清掉宿主残留 CSS 变换变量（避免双重/陈旧）', has(CLIENT, /wrap\.classList\.remove\("mpw-sharp"\)/) && has(CLIENT, /"--mpw-zoom", "--mpw-flip-x", "--mpw-flip-y"/))
  /* 变异：删掉 push 里的 filter 下发 ⇒ H3 必红 */
  const mut = CLIENT.replace('const okB = mpwSceneHostCmd("filter", { v: p.filter || "" });', '')
  ok('H-MUT 删掉 filter 下发 ⇒ H3 必红', !mut.includes('mpwSceneHostCmd("filter"') && mut !== CLIENT)
}

/* ---------- G. 光晕 ---------- */
{
  const CALLS = (CLIENT.match(/mpwGlowApplyAll\(section\)/g) || []).length
  ok('G1 光晕共享入口存在（sync + 亮度/颜色变量）', has(CLIENT, /function mpwGlowApplyAll\(section\)/) && has(CLIENT, /--mpw-glow-peak-scale/))
  ok('G2 共享尾 + web 分支 + scene 合成分支都调用同一入口（≥3 处）', CALLS >= 3, 'calls=' + CALLS)
  /* 变异：删掉 web 分支那处调用 ⇒ G2 必红（计数降到 2） */
  const one = '/* ⑨(2026-11-07 #6) web 分支提前 return：光晕必须在这里落地（否则用 web 壁纸期间光晕全灭） */\n\t\t\t\ttry { mpwGlowApplyAll(section) } catch (e) {}\n\t\t\t\treturn;'
  const mut = CLIENT.replace(one, '\t\t\t\treturn;')
  const mutCalls = (mut.match(/mpwGlowApplyAll\(section\)/g) || []).length
  ok('G-MUT 删掉 web 分支调用（原样锚点）⇒ 调用数 3→2（判据必红）', mut !== CLIENT && mutCalls === CALLS - 1, 'mutCalls=' + mutCalls)
}

/* ---------- S. 扫描页 ---------- */
{
  ok('S1 占位层只在 data-mpw-thumb-shown 时显示（详情预览不再被白色滤镜+scene 盖住）',
    has(CLIENT, /\.mpw_scanSelThumb \[data-mpw-thumb-ph\]:not\(\[data-mpw-thumb-shown\]\) \{\s*\n\s*display: none !important;/))
  ok('S2 网格缩略图同一规则（防止同类覆盖层）',
    has(CLIENT, /\[data-mpw-scan-grid\] \.mpw_scanThumb \[data-mpw-thumb-ph\]:not\(\[data-mpw-thumb-shown\]\) \{\s*\n\s*display: none !important;/))
  ok('S3 已应用角标 = SVG 勾（不再用 content:"✓" 字符）',
    has(CLIENT, /\.mpw_scanCellApplied::after \{\s*\n\tcontent: "";/)
    && has(CLIENT, /data:image\/svg\+xml,%3Csvg%20xmlns='http:\/\/www\.w3\.org\/2000\/svg'/)
    && !has(CLIENT, /\.mpw_scanCellApplied::after \{[\s\S]{0,200}?content: "✓"/))
  /* 变异：把 S1 的 :not 去掉 ⇒ S1 必红 */
  const mut = CLIENT.replace('.mpw_scanSelThumb [data-mpw-thumb-ph]:not([data-mpw-thumb-shown]) {', '.mpw_scanSelThumb [data-mpw-thumb-ph] {')
  ok('S-MUT 去掉 :not([data-mpw-thumb-shown]) ⇒ S1 必红', mut !== CLIENT && !has(mut, /\.mpw_scanSelThumb \[data-mpw-thumb-ph\]:not\(\[data-mpw-thumb-shown\]\) \{/))
}


/* ---------- R. 长时运行 scene 动态层不出画（#1） ---------- */
{
  ok('R1 场景 URL token 新鲜度守卫在位（过期/不匹配 ⇒ defer+prefetch 换新 token）',
    has(CLIENT, /showWebEl-token-refresh/) && has(CLIENT, /const __needsRefresh = !__ident \|\| __needStrict \|\| !__urlTok \|\| !__memTok \|\| __urlTok !== __memTok/))
  ok('R2 兜底期保布局：iframe display:block + opacity:0（不再 display:none ⇒ rAF 不停）',
    has(CLIENT, /\.mpw-bgWrap\.mpw-scene-fallback iframe\.mpw-webFrame \{\s*\n\tdisplay: block !important;\s*\n\topacity: 0 !important;/)
    && !has(CLIENT, /\.mpw-bgWrap\.mpw-scene-fallback iframe\.mpw-webFrame \{ display: none !important; \}/))
  ok('R3 兜底轮询窗口 10 分钟（长时运行可自愈；不再 120s 停摆）',
    has(CLIENT, /wd\.fallback && Date\.now\(\) - wd\.fallbackAt > 10 \* 60 \* 1000/))
  ok('R4 重载/重试：fresh token + buster，且显式重载意图绕过 src 幂等比较',
    has(CLIENT, /const busted = mpwSceneBustUrl\(base\)/) && has(CLIENT, /__mpwWantReload/) && has(CLIENT, /if \(__mpwWantReload \|\| __urlId\(frame\.getAttribute\("src"\)\) !== __urlId\(mpwEffUrl\)\)/))
  ok('R5 渲染器侧 mpw-health 心跳（模块级定义；ctxLost/restored 都发 ⇒ 宿主自动重建不再是死代码）',
    has(RENDERER, /function mpwHealthPost\(why\)/) && has(RENDERER, /mpwHealthPost\('ctx-lost'\)/) && has(RENDERER, /mpwHealthPost\('ctx-restored'\)/)
    && RENDERER.indexOf('function mpwHealthPost') < RENDERER.indexOf('async function bootInstance'))
  /* 变异：把兜底 CSS 改回 display:none ⇒ R2 必红 */
  const mut = CLIENT.replace(`.mpw-bgWrap.mpw-scene-fallback iframe.mpw-webFrame {
	display: block !important;
	opacity: 0 !important;`, `.mpw-bgWrap.mpw-scene-fallback iframe.mpw-webFrame {
	display: none !important;
	opacity: 0 !important;`)
  ok('R-MUT 兜底改回 display:none ⇒ R2 必红', mut !== CLIENT && !has(mut, /display: block !important;\s*\n\topacity: 0 !important;/) )
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) process.exit(1)
console.log('✓ 渲染器 view/filter 接线 + 光晕 web/scene 分支 + 扫描页覆盖层/角标 判据通过')

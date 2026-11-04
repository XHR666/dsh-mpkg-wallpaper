// bench-upstream-handoff-test.mjs —— ①(2026-10-04 P-228c) 8902 测试台「上游产物」档的**包交接**判据
//
// 背景（实测）：上游渲染器（2.0.2 / 2.1.0 同）在 `type=scene` 下要求 **`mediaBase` 与 `src` 同时存在** ——
//   它内部拼 `${mediaBase}/${src}`，再取 `${base}/scene.pkg` 与 `${base}/project.json`；缺 `mediaBase`
//   时抛「场景壁纸缺少 mediaBase/src」⇒ iframe 里 `canvases: []`、**一个包请求都不发**。
//   而 `demo/bench-patch.js` 的 `rendererSourceUrl()` 在**本仓档**用白名单重建查询串时把 `mediaBase`
//   洗掉了；而它是一条**往返**改写（本仓 URL 会被再切回上游档）⇒ 缺的参数永远补不回来。
//
// 本文件钉三件事：
//   A 纯函数（`rendererSourceUrl`，Node 直接 import，无浏览器）：
//     A1 产物 URL → 本仓 URL：`mediaBase` **恰好出现一次**（原值保留，不重复追加）
//     A2 产物 URL 缺 `mediaBase` → 本仓 URL 必须补上（值 = `location.origin`/参数里的 origin + `/media/dev`）
//     A3 本仓 URL → 产物 URL（反向映射）：路径换回 `renderer/index.html`，且 `mediaBase`+`src` 都在
//     A4 已带 `mediaBase` 的产物 URL → 上游档**逐字返回**（不许改写既有正确 URL）
//     A5 非 scene 档（web/video）**不许**被塞 `mediaBase`（大小写不敏感地判存在性）
//   B 变异自证：把两处 `mediaBase` 守卫删掉 ⇒ A2/A3 必红（证明确实有分辨力）
//   C 真机（可选；缺 GL/测试台 ⇒ SKIP）：在 :8902 页面上走一次真实改写链 + 直挂一次上游档，
//     断言 iframe 出现画布且**真的发出了** `/media/dev/<id>/scene.pkg` 的 200 请求
//
// 复现: flock /tmp/.mpw-firefox.lock -c 'node tests/bench-upstream-handoff-test.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) } else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) } }
const bad = (name, detail) => { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
const SEARCH = 'type=scene&src=2887099508&fit=cover&renderDpr=1&sceneFps=60&filter=none&muted=true&loop=true'
const ORIGIN = 'http://127.0.0.1:8902'

const mod = await import(pathToFileURL(path.join(ROOT, 'demo', 'bench-patch.js')).href)
const { rendererSourceUrl } = mod

console.log('── A 纯函数：往返改写里的 mediaBase')
const prodWith = `${ORIGIN}/wallpaper-engine-webgl/renderer/index.html?${SEARCH}&mediaBase=${encodeURIComponent(ORIGIN + '/media/dev')}`
const repoFromProd = rendererSourceUrl(prodWith, 'repo', {})
ok('A1 产物 URL → 本仓 URL：mediaBase 恰好一次且保留原值',
  (repoFromProd.match(/mediaBase/gi) || []).length === 1 && repoFromProd.includes('mediaBase=' + encodeURIComponent(ORIGIN + '/media/dev')),
  repoFromProd.slice(repoFromProd.indexOf('mediaBase')))

const prodNoMb = `${ORIGIN}/wallpaper-engine-webgl/renderer/index.html?${SEARCH}`
const repoNoMb = rendererSourceUrl(prodNoMb, 'repo', {})
ok('A2 产物 URL 缺 mediaBase → 本仓 URL 补上（值 = origin + /media/dev）',
  (repoNoMb.match(/mediaBase/gi) || []).length === 1 && repoNoMb.includes('mediaBase=' + encodeURIComponent(ORIGIN + '/media/dev')),
  repoNoMb.slice(repoNoMb.indexOf('mediaBase')))

const repoUrl = `/webloader/?${SEARCH}&id=2887099508&res=dpr&shell=0`
const upFromRepo = rendererSourceUrl(repoUrl, 'upstream', {})
ok('A3 本仓 URL → 产物 URL：路径换回 + mediaBase 与 src 都在',
  upFromRepo.includes('/wallpaper-engine-webgl/renderer/index.html') && /[?&]mediaBase=/.test(upFromRepo) && /[?&]src=2887099508(&|$)/.test(upFromRepo),
  upFromRepo.slice(upFromRepo.indexOf('?')))

const upPassthrough = rendererSourceUrl(prodWith, 'upstream', {})
ok('A4 已带 mediaBase 的产物 URL 上游档逐字返回', upPassthrough === prodWith, upPassthrough === prodWith ? 'identical' : upPassthrough)

const webRepo = rendererSourceUrl(`/webloader/?type=web&src=${encodeURIComponent('/web/dev/1/index.html')}&id=1&res=dpr&shell=0`, 'upstream', {})
ok('A5 非 scene 档不许被塞 mediaBase', !/mediaBase/i.test(webRepo), webRepo.slice(webRepo.indexOf('?')))

console.log('── B 变异自证：删掉 mediaBase 守卫 ⇒ A2/A3 必红')
try {
  const farm = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-handoff-mut-'))
  // 变异体要求"整块 demo/ 的 .js|.mjs"都在（bench-patch.js → mpw-select.js → mpw-select-math.mjs 有依赖链）
  for (const f of fs.readdirSync(path.join(ROOT, 'demo'))) {
    if (/\.(js|mjs)$/.test(f)) fs.copyFileSync(path.join(ROOT, 'demo', f), path.join(farm, f))
  }
  let src = fs.readFileSync(path.join(farm, 'bench-patch.js'), 'utf8')
  const before = src
  src = src.replace(/if \(typeParam === 'scene' && srcParam && !hasCI\('mediaBase'\)\) \{[\s\S]*?\n  \}/, '/* 变异体：删掉本仓档的 mediaBase 守卫 */')
  src = src.replace(/if \(String\(qget\('type'\) \|\| 'scene'\)\.toLowerCase\(\) === 'scene' && qget\('src'\) && !qhasCI\('mediaBase'\)\) \{[\s\S]*?\n    \}/, '/* 变异体：删掉上游档的 mediaBase 守卫 */')
  ok('B0 两处变异注入点都匹配上（实现形状变了要同步本判据）', src !== before && !/hasCI\('mediaBase'\)\) \{/.test(src))
  fs.writeFileSync(path.join(farm, 'bench-patch.js'), src)
  const mut = await import(pathToFileURL(path.join(farm, 'bench-patch.js')).href + '?t=' + Date.now())
  const mRepo = mut.rendererSourceUrl(prodNoMb, 'repo', {})
  const mUp = mut.rendererSourceUrl(repoUrl, 'upstream', {})
  ok('B1 变异体下 A2 会红（本仓 URL 里没有 mediaBase）', (mRepo.match(/mediaBase/gi) || []).length === 0, mRepo.slice(mRepo.indexOf('?')))
  ok('B2 变异体下 A3 会红（上游 URL 里没有 mediaBase）', !/[?&]mediaBase=/.test(mUp), mUp.slice(mUp.indexOf('?')))
  fs.rmSync(farm, { recursive: true, force: true })
} catch (e) { bad('B 变异体没跑起来', String(e && e.message || e)) }

console.log('── C 真机（缺 GL/测试台 ⇒ SKIP）')
/* ①(P-350 2026-10-16 用户口径「把上游渲染器移除，留一个可扩展的接口」) 上游产物已移出仓库
   （`demo/assets/renderer-*.js` 0 份；`tests/renderer-adapter-test.mjs` D1/D2 钉住）
   ⇒ C 段（"直挂上游档后真的出现画布 + 200 取到 scene.pkg"）**没有对象了**：
   产物不在 **且** 没配外部上游来源 ⇒ 该段**明确 SKIP**（A/B 纯函数段与变异自证照跑，文件不整体跳过）。
   为什么不是删掉：产物放回来 / 接上外部上游（`MPW_RENDERER_UPSTREAM=<URL>`）时，这一段就该照旧生效。 */
/** C 段出口判据。**函数化** ⇒ 反向守卫能对两个方向各断言一次：
   配了外部上游（`MPW_RENDERER_UPSTREAM`）⇒ C 段**必须真跑**（不是拿 SKIP 把失败藏起来）。 */
function upstreamHandoffGate(artifactCount, externalUpstream) {
  return (artifactCount > 0 || String(externalUpstream || '').trim() !== '') ? 'run' : 'skip'
}
const UPSTREAM_ARTIFACT = (() => {
  try { return fs.readdirSync(path.join(ROOT, 'demo', 'assets')).filter((n) => /^renderer-.*\.js$/.test(n)) }
  catch (e) { return [] }
})()
const EXTERNAL_UPSTREAM = String(process.env.MPW_RENDERER_UPSTREAM || process.env.MPW_RENDERER_8899 || '').trim()
const C_GATE = upstreamHandoffGate(UPSTREAM_ARTIFACT.length, EXTERNAL_UPSTREAM)
ok('C0 反向守卫：产物塞回 / 配外部上游 ⇒ C 段**真跑**；两者都无 ⇒ 明确 SKIP（门不许恒开、也不许恒关）',
  upstreamHandoffGate(1, '') === 'run' && upstreamHandoffGate(0, 'http://127.0.0.1:8899') === 'run' && upstreamHandoffGate(0, '') === 'skip',
  'C_GATE=' + C_GATE + '（产物 ' + UPSTREAM_ARTIFACT.length + ' 份 / 外部上游=' + (EXTERNAL_UPSTREAM ? '有' : '无') + '）')
if (C_GATE === 'skip') {
  console.log('  ⊘ SKIP C 真机段（仓库内不再内置上游渲染器产物：demo/assets/renderer-*.js 0 份；也没配外部上游来源）')
  console.log('     复跑：放回产物（备份 staging/upstream-2.1.0/assets/demo/assets/）或设 MPW_RENDERER_UPSTREAM=<URL>')
} else {
  const { launchGLBrowser, glCapability, closeQuiet, findPlaywright } = await import('./_gl-browser.mjs')
  const { createRequire } = await import('node:module')
  const require_ = createRequire(path.join(ROOT, 'package.json'))
  const pw = require_(findPlaywright()); const firefox = (pw.default && pw.default.firefox) || pw.firefox
  const { browser, launchNote } = await launchGLBrowser(firefox)
  const gl = await glCapability(browser)
  if (!gl.webgl2) { console.log('  ⊘ SKIP 真机段（' + launchNote + '）'); await closeQuiet(browser) } else {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
    let probeId = null
    try { const lib = await (await page.request.get(ORIGIN + '/api/library')).json(); probeId = (lib.items || []).find((x) => x.hasScene && /^\d/.test(x.itemId))?.itemId || null } catch { /* 取不到就不跑真机段 */ }
    if (!probeId) { console.log('  ⊘ SKIP 真机段（/api/library 取不到 scene 项）'); await closeQuiet(browser) } else {
      const pkgHits = []
      page.on('response', (r) => { const u = r.url(); if (/\/media\/dev\/[^/]+\/(scene\.pkg|project\.json)$/.test(u)) pkgHits.push(r.status() + ' ' + u.replace(ORIGIN, '')) })
      await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(3000)
      // C1 真实改写链：上游档下把一条本仓 URL 写进 iframe.src，读回必须是带 mediaBase 的产物 URL
      const rewritten = await page.evaluate(({ search }) => {
        const sel = document.getElementById('renderer-src')
        if (sel) { sel.value = 'upstream'; sel.dispatchEvent(new Event('change', { bubbles: true })) }
        const f = document.createElement('iframe')
        f.src = '/webloader/?' + search + '&id=2887099508&res=dpr&shell=0'
        return { src: f.getAttribute('src'), mode: sel ? sel.value : null }
      }, { search: SEARCH })
      ok('C1 页面内改写链：本仓 URL → 产物 URL 且带 mediaBase', rewritten.mode === 'upstream' && /[?&]mediaBase=/.test(rewritten.src), String(rewritten.src).slice(0, 120))
      // C2 端到端：直挂上游档（mediaBase + src）⇒ 出现画布 + 真的 200 取到 scene.pkg / project.json
      const frameSrc = `${ORIGIN}/wallpaper-engine-webgl/renderer/index.html?type=scene&src=${encodeURIComponent(probeId)}&mediaBase=${encodeURIComponent(ORIGIN + '/media/dev')}&fit=cover&renderDpr=1&sceneFps=60&filter=none&muted=true&loop=true`
      await page.evaluate((src) => { const f = document.querySelector('iframe'); if (f) f.src = src }, frameSrc)
      await page.waitForTimeout(9000)
      const st = await page.evaluate(() => {
        const f = [...document.querySelectorAll('iframe')].find((x) => /renderer\/index\.html/.test(x.getAttribute('src') || '')) || document.querySelector('iframe')
        let canvases = []
        try { canvases = f && f.contentWindow ? [...f.contentWindow.document.querySelectorAll('canvas')].map((c) => c.width + 'x' + c.height) : [] } catch { /* 跨源 */ }
        return { src: f ? f.getAttribute('src') : null, canvases }
      })
      ok('C2a 上游档 iframe 出现画布（非 300×150 空画布）', st.canvases.some((s) => !/^300x150$/.test(s)), JSON.stringify(st.canvases))
      ok('C2b 真的取到了该包的 scene.pkg 与 project.json（HTTP 200）',
        pkgHits.some((h) => h.startsWith('200') && h.endsWith('/scene.pkg')) && pkgHits.some((h) => h.startsWith('200') && h.endsWith('/project.json')),
        pkgHits.slice(-4).join(' | '))
      await closeQuiet(browser)
    }
  }
}

console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过') + '  （pass=' + pass + ' fail=' + fail + '）')
process.exit(fail ? 1 : 0)

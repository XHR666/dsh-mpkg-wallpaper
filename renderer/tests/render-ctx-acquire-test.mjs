/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案。 */
// render-ctx-acquire-test.mjs —— ①(2026-09-24 任务 ⑭ 第 2 半) **"无 WebGL2"不许冒充能力缺失**门禁
//
// 现象（真机）：同一个测试台页里主包已经建好 WebGL2 并出画，切到**合成样例**（同一预览 iframe 的
//   第二次挂载）却打 `❌ 无 WebGL2！` + `❌ 启动失败: 当前浏览器不支持 WebGL2`。
// 已排除的假设（本机实测，读数见报告 §⑭）：
//   · "同一个 canvas 上第二次 getContext 之争"：webgl2 之后再 `getContext('2d')` 恒 **null**
//     （旧代码 `demo.html:6930` 那行本来就是死代码），webgl2 再要 webgl2 返回**同一个**上下文；
//     只有"先 2d 再 webgl2"才会永久 null（本仓没有这条路径，已加注释禁止）。
//   · "上下文数达到上限"：本机 Firefox 连续建 24 个 WebGL2 上下文全部成功 ⇒ 本机无法复现该机制。
// 因此本档钉的是**我们自己的错报机制**（改动前 demo.html 一次 `getContext` 定生死）：
//   [A] 前 2 次 `getContext('webgl2')` 返回 null（并派发 webglcontextcreationerror 带 statusMessage）
//       ⇒ 页面必须**仍然启动出帧**（退避重试拿到上下文），台账 reason=ok / nullReturns=2，
//       且日志里**不得**出现"不支持 WebGL2"这种能力断言；重试行要点明"瞬时/资源性"。
//   [B] 本画布**始终**拿不到、新 canvas 能拿（资源/本画布问题）⇒ reason=canvas-context-failed，
//       日志明确说"不是浏览器不支持"。
//   [C] 连新 canvas 都拿不到（真不支持）⇒ reason=no-webgl2，日志才允许说"确实不支持"。
// 判据敏感性（"改回去必红"）：[A] 的启动断言本身就是反例 —— 改动前一次尝试即失败 ⇒ `__mpwFrameNo`
//   恒 0 ⇒ [A1] 必红；[A4]/[A5] 也随日志文案一起红。
//
// 用法：node tests/render-ctx-acquire-test.mjs
//   需要 8899 上的渲染器页（`MPW_RENDERER_URL` 可覆盖）；不可达 ⇒ SKIP（不谎报红）。
//   浏览器口径：有头优先 + 能力前置探针（tests/_gl-browser.mjs）；拿不到 WebGL2 ⇒ SKIP + 原样读数。
import { launchGLBrowser, glCapability, glReading, logGLSkip, closeQuiet, findPlaywright } from './_gl-browser.mjs'

const URL_BASE = process.env.MPW_RENDERER_URL || 'http://127.0.0.1:8899/'
const ID = process.env.MPW_CTX_ID || 'sample-synthetic'
const PAGE = URL_BASE + '?id=' + ID + '&noreport&shell=0'

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) }
}

let reachable = false
try { const r = await fetch(URL_BASE, { signal: AbortSignal.timeout(4000) }); reachable = r.ok } catch (e) { reachable = false }
if (!reachable) { console.log('SKIP render-ctx-acquire —— 渲染器页不可达：' + URL_BASE + '（先起 `node server/we-scene-demo-server.mjs 8899`）'); process.exit(0) }

const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP render-ctx-acquire —— 找不到 playwright（MPW_PLAYWRIGHT 可指定）'); process.exit(0) }
const pw = (await import(pwPath)).default || (await import(pwPath))
const firefox = pw.firefox || (pw.default && pw.default.firefox)
if (!firefox) { console.log('SKIP render-ctx-acquire —— playwright 里没有 firefox'); process.exit(0) }

const { browser, launchNote } = await launchGLBrowser(firefox)
const gl = await glCapability(browser)
if (!gl.webgl2) { await closeQuiet(browser); logGLSkip('render-ctx-acquire（全部断言）', launchNote, gl) ; process.exit(0) }
console.log('渲染器页：' + PAGE + '；浏览器：' + glReading(launchNote, gl))

/** 注入：按 mode 让 #sc 上前 N 次 / 全部 webgl2 取上下文返回 null（并派发 creationerror）。 */
async function probe(mode, failFirst) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const logs = []
  page.on('console', (m) => logs.push(m.text()))
  page.on('pageerror', (e) => logs.push('[js-error] ' + String(e.message)))
  await page.addInitScript(({ mode, failFirst }) => {
    const orig = HTMLCanvasElement.prototype.getContext
    let fails = 0
    window.__mpwInjected = { mode, tries: 0, fails: 0 }
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      const isMain = this && this.id === 'sc'
      const isWebgl2 = String(type).toLowerCase() === 'webgl2'
      const isWebgl1 = String(type).toLowerCase() === 'webgl' || String(type).toLowerCase() === 'experimental-webgl'
      // 'always' = 连新 canvas 的 webgl2/webgl1 都建不出（真·不支持的等价夹具）
      const shouldFail = (isWebgl2 || (mode === 'always' && isWebgl1)) && (mode === 'always' ? true : (isMain && fails < failFirst))
      if (shouldFail) {
        fails++
        window.__mpwInjected.tries++
        window.__mpwInjected.fails = fails
        try {
          const ev = new Event('webglcontextcreationerror')
          ev.statusMessage = 'injected: transient context creation failure (test)'
          this.dispatchEvent(ev)
        } catch (e) {}
        return null
      }
      return orig.call(this, type, attrs)
    }
  }, { mode, failFirst })
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  try { await page.waitForFunction(() => (window.__mpwFrameNo || 0) > 0, null, { timeout: 90000 }) } catch (e) { logs.push('[timeout] 等首帧超时') }
  const r = await page.evaluate(() => ({
    ctxAcq: window.__mpwCtxAcquire || null,
    frames: window.__mpwFrameNo || 0,
    injected: window.__mpwInjected || null,
    ctxLostHint: window.__mpwCtxLostHint || null,
    hasGL: (() => { try { return typeof window.__mpwAudioBandInfo === 'function' } catch (e) { return null } })(),
  }))
  await ctx.close()
  return { r, logs }
}

/* ══════════════ [A] 前 2 次失败 ⇒ 仍要出帧、不许说"不支持" ══════════════ */
console.log('== [A] 瞬时失败（前 2 次 getContext 返回 null + creationerror）==')
{
  const { r, logs } = await probe('first', 2)
  check('[A1] 页面仍然启动出帧（改动前：一次尝试即失败 ⇒ 恒 0 帧）', r.frames > 0, 'frames=' + r.frames)
  check('[A2] 台账如实记：nullReturns=2 / attempts=3 / reason=ok',
    !!r.ctxAcq && r.ctxAcq.nullReturns === 2 && r.ctxAcq.attempts === 3 && r.ctxAcq.reason === 'ok',
    JSON.stringify(r.ctxAcq))
  check('[A3] 捕获驱动/浏览器原话（webglcontextcreationerror.statusMessage）',
    !!r.ctxAcq && String(r.ctxAcq.lastStatus || '').indexOf('transient context creation failure') >= 0,
    JSON.stringify(r.ctxAcq && r.ctxAcq.lastStatus))
  const all = logs.join('\n')
  // 只禁**能力断言**的两种旧形态（"❌ 无 WebGL2！" / "❌ 启动失败: 当前浏览器不支持 WebGL2"）；
  // 本档自己的重试行里那句「不是"浏览器不支持 WebGL2"」是**否定**，不算断言。
  const claim = (l) => /^❌/.test(l) && /不支持 WebGL2|无 WebGL2！/.test(l)
  check('[A4] 日志**不得**出现能力断言（❌ 无 WebGL2！ / ❌ 启动失败: 当前浏览器不支持 WebGL2）',
    !logs.some(claim), JSON.stringify(logs.filter((l) => /WebGL2/.test(l)).slice(0, 4)))
  check('[A5] 重试行点明"瞬时/资源性，不是不支持"', logs.some((l) => /第 3 次尝试才拿到/.test(l) && /瞬时\/资源性/.test(l)), JSON.stringify(logs.filter((l) => /尝试/.test(l)).slice(0, 3)))
}

/* ══════════════ [B] 本画布始终失败、新 canvas 正常 ⇒ canvas-context-failed ══════════════ */
console.log('== [B] 本画布拿不到、新 canvas 能拿 ==')
{
  const { r, logs } = await probe('main-always', 99)
  check('[B1] 归因 = canvas-context-failed（不是能力缺失）', !!r.ctxAcq && r.ctxAcq.reason === 'canvas-context-failed', JSON.stringify(r.ctxAcq))
  const all = logs.join('\n')
  check('[B2] 日志说明"新 canvas 能建、本画布建不出（瞬时/资源性失败，不是浏览器不支持）"',
    /本画布建不出/.test(all) && /不是"浏览器不支持"/.test(all) && all.indexOf('确实不支持') < 0,
    JSON.stringify(logs.filter((l) => /WebGL2|上下文/.test(l)).slice(-2)))
  check('[B3] 探针读数如实（probe.webgl2=true）', !!r.ctxAcq && !!r.ctxAcq.probe && r.ctxAcq.probe.webgl2 === true, JSON.stringify(r.ctxAcq && r.ctxAcq.probe))
}

/* ══════════════ [C] 连新 canvas 都没有 ⇒ 只有这时才允许说"确实不支持" ══════════════ */
console.log('== [C] 真不支持（连新 canvas 也拿不到）==')
{
  const { r, logs } = await probe('always', 0)
  check('[C1] 归因 = no-webgl2', !!r.ctxAcq && r.ctxAcq.reason === 'no-webgl2', JSON.stringify(r.ctxAcq))
  const all = logs.join('\n')
  check('[C2] 这条分支才允许出现"确实不支持"（能力断言只在证据充分时出现）',
    /确实不支持/.test(all) && /无 WebGL2/.test(all), JSON.stringify(logs.filter((l) => /WebGL2/.test(l)).slice(-2)))
  check('[C2b] 渲染器的旧归因文案（"当前浏览器不支持 WebGL2"）已被抹掉：核心只如实说"本画布拿不到 WebGL2 上下文"',
    all.indexOf('当前浏览器不支持 WebGL2') < 0 && /本画布拿不到 WebGL2 上下文/.test(all), JSON.stringify(logs.filter((l) => /启动失败/.test(l)).slice(-1)))
  check('[C3] 没有帧是**如实**的（不得伪造首帧）', r.frames === 0, 'frames=' + r.frames)
}

await closeQuiet(browser)
console.log('\n══ render-ctx-acquire-test：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)

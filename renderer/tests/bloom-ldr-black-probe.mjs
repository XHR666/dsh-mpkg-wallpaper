// bloom-ldr-black-probe.mjs — ①(第 18 条续) **LDR bloom / FXAA 整屏黑** 的活体回归闸门。
//
// 被钉住的 Bug（实锤）：
//   `alpha:false` 的默认帧缓冲上 `copyTexSubImage2D` 在 Firefox 报 0x502 **且目标纹理保持全零**
//   （同场景 `alpha:true` 拷贝成功；`antialias`/`premultipliedAlpha`/`preserveDrawingBuffer` 三项无关）。
//   老实现不看错误码 ⇒ bloom 的 compose（唯一覆盖整屏的一步）把**全零纹理当场景色**写满屏
//   = **整屏黑**，而层其实全部画对了：同包 `?pp=off` 同帧画面完全正常（这条对照就是判据）。
//   语料里 `bloom:true + hdr:false`（= 走 LDR 回读分支）的包只有 2 个，`3778592720` 是其一。
//
// 闸门读的是**真画布像素**（`#sc` 元素截图，先藏外壳 ⇒ 不含日志面板文字，这一点踩过坑：
//   整页截图会把面板文字算进亮度，得到"不黑"的假读数）。
//
// 判据：
//   L1 基线（bloom 开、默认 pp）：画布**不黑**（meanL ≥ 10 且 maxL ≥ 30）
//   L2 `?pp=off`（对照组）：同样不黑 —— L1 若黑而 L2 不黑，就说明是后处理链写黑的
//   L3 `?bloomcap=skip`（只关 bloom）：不黑
//   L4 `?aa=fxaa`（同一回读手法的第二处：FXAA 直写全屏）：不黑
//   L5 诊断一致：`__mpwBloomInfo.skipped` 只能是已知值；回读档位要能在 `__mpwCanvasCapture` 里读到
//   L6 反面自证（`--selftest`）：把"纯黑帧"喂给判据必须判红（否则闸门是假的）
//
// 用法：
//   node tests/bloom-ldr-black-probe.mjs --selftest
//   node tests/bloom-ldr-black-probe.mjs [--id 3778592720] [--authority 127.0.0.1:8902]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ROOT, WS } from './_root.mjs'
/* ①(2026-09-23 全仓清扫) 「有头优先 + 能力前置探针 + 无 GL 打 SKIP」这套口径的**唯一实现**
   （照抄 `tests/bench-renderer-source-test.mjs` 的 D 段；见 `tests/_gl-browser.mjs` 的文件头）。 */
import { launchGLBrowser, glCapability, logGLSkip, glSkipWhy } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const SELFTEST = argv.includes('--selftest')
const WANT_ID = (() => { const i = argv.indexOf('--id'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '3778592720' })()
const AUTHORITY = (() => { const i = argv.indexOf('--authority'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '127.0.0.1:8902' })()
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (label, why) => console.log('SKIP ' + label + ' —— ' + why)

/**
 * **纯判据**：一帧亮度统计 → `'black' | 'ok'`。
 * 为什么用 meanL+maxL 两个量：纯黑帧两者同为 0；只有零星亮点（粒子/文字）的帧 meanL 很小但 maxL 高，
 * 那种情况**不是**本条要抓的"整屏黑"（会误伤）⇒ 要求 meanL 与 maxL **同时**低才算黑。
 */
export function blacknessVerdict(meanL, maxL) {
  const m = Number(meanL), x = Number(maxL)
  if (!Number.isFinite(m) || !Number.isFinite(x)) return 'nodata'
  return (m < 8 && x < 30) ? 'black' : 'ok'
}
/** `__mpwBloomInfo.skipped` 的合法取值（新增分支必须同步登记，避免"悄悄跳过"变成静默降级）。 */
export const KNOWN_SKIPS = ['capture-fail', 'pass1', 'pass3']

if (SELFTEST) {
  console.log('[S] 纯判据自证（不起浏览器）')
  ok(blacknessVerdict(0, 0) === 'black', 'S1 全黑帧（0,0）⇒ black')
  ok(blacknessVerdict(2, 12) === 'black', 'S2 近乎全黑（2,12）⇒ black')
  ok(blacknessVerdict(115, 255) === 'ok', 'S3 正常帧（115,255）⇒ ok')
  ok(blacknessVerdict(7.9, 200) === 'ok', 'S4 暗场景但有亮点（7.9,200）⇒ ok（不许误伤）')
  ok(blacknessVerdict(80, 29) === 'ok', 'S5 有细节但无高光（80,29）⇒ ok')
  ok(blacknessVerdict(NaN, 0) === 'nodata' && blacknessVerdict(0, undefined) === 'nodata', 'S6 读不出数 ⇒ nodata（不许当 0/不许当黑）')
  ok(KNOWN_SKIPS.indexOf('capture-fail') >= 0, 'S7 skipped 已知值表含 capture-fail')
  console.log('\n── selftest 汇总：PASS=' + pass + ' FAIL=' + fail + '（未起浏览器）')
  process.exit(fail > 0 ? 1 : 0)
}

// 语料里找 `3778592720`（缺语料 = 诚实 SKIP，不假装通过）
const corpus = (() => {
  const base = path.join(WS, 'allwallpaper')
  try {
    for (const shard of fs.readdirSync(base)) {
      const p = path.join(base, shard, WANT_ID, 'scene.pkg')
      if (fs.existsSync(p)) return p
    }
  } catch (e) {}
  return null
})()
if (!corpus) { skip('bloom-ldr-black', '语料里没有 ' + WANT_ID + '/scene.pkg（MPW_ROOT=' + WS + '）'); process.exit(0) }

const pwPath = [process.env.MPW_PLAYWRIGHT, path.join(ROOT, 'node_modules/playwright/index.js'),
  path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js')]
  .filter((p) => { try { return !!p && fs.existsSync(p) } catch (e) { return false } })[0]
if (!pwPath) { skip('bloom-ldr-black', '找不到 playwright（可用 MPW_PLAYWRIGHT=<path> 指定）'); process.exit(0) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { skip('bloom-ldr-black', 'playwright 没有 firefox 导出'); process.exit(0) }

const CASE = [
  ['L1 基线（bloom 开 + 默认 pp=high）', ''],
  ['L2 对照 ?pp=off（整条后处理链关）', '&pp=off'],
  ['L3 ?bloomcap=skip（只关 bloom）', '&bloomcap=skip'],
  ['L4 ?aa=fxaa（同一回读手法的 FXAA）', '&aa=fxaa'],
]
/* ⚠ 前置不是"有没有浏览器"，而是"这台浏览器能不能建 WebGL2"（2026-09-23 归因，口径照抄
   `tests/bench-renderer-source-test.mjs` 的 D 段，见 `tests/_gl-browser.mjs`）：本机（Android/PRoot，无
   `/dev/dri`）**无头 Firefox 连 WebGL1 都建不了** ⇒ `#sc` 停在 300×150 空画布、四档全读到
   `meanL=0 maxL=0`（实测 L1–L4 全红）——那是**环境缺能力**，不是"后处理链把画面写黑了"。
   所以：**有头优先**（`DISPLAY=:0`，`MPW_X11_DISPLAY` 可换），有头起不来才回落无头；
   `MPW_BENCH_HEADLESS=1` 强制无头。拿不到 WebGL2 ⇒ 四档打 **SKIP + 原样读数**（读数照采，只是不当判据）。 */
const { browser, launchNote } = await launchGLBrowser(firefox)
try {
  /* 能力前置探针（读一次，不猜）：webgl2/webgl1 到底能不能建 —— L1–L4 是断言还是 SKIP 由它决定。 */
  const gl = await glCapability(browser)
  if (!gl.webgl2) { logGLSkip('bloom-ldr-black L1–L4（画布像素：整屏黑）', launchNote, gl, '下面四档仍照采读数作证据'); glSkipWhy() }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  for (const [label, extra] of CASE) {
    const page = await ctx.newPage()
    try {
      await page.goto('http://' + AUTHORITY + '/webloader/?id=' + encodeURIComponent(WANT_ID) + '&res=1280x720&nopanel&time=06:30:00' + extra,
        { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(11000)
      // 藏外壳（画布是 fixed inset:0）：整页截图会把日志面板文字算成"亮度"，那是假绿（踩过）
      await page.evaluate(() => {
        for (const el of [...document.body.children]) {
          if (el.tagName === 'CANVAS') continue
          if (el.querySelector && el.querySelector('canvas')) continue
          el.style.display = 'none'
        }
      })
      await page.waitForTimeout(400)
      const buf = await page.locator('#sc').screenshot()
      const st = await page.evaluate(() => ({
        canvas: document.getElementById('sc').width + 'x' + document.getElementById('sc').height,
        bloomInfo: window.__mpwBloomInfo || null,
        cap: window.__mpwCanvasCapture || null,
        bloomRuns: window.__mpwBloomRuns || 0,
      }))
      const stat = await page.evaluate(async (b64) => {
        const img = new Image()
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); img.src = 'data:image/png;base64,' + b64 })
        const c = document.createElement('canvas'); c.width = 320; c.height = 180
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, 320, 180)
        const d = g.getImageData(0, 0, 320, 180).data
        let sum = 0, mx = 0
        for (let i = 0; i < 320 * 180; i++) {
          const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
          sum += l; if (l > mx) mx = l
        }
        return { meanL: +(sum / (320 * 180)).toFixed(2), maxL: Math.round(mx) }
      }, buf.toString('base64'))
      const v = blacknessVerdict(stat.meanL, stat.maxL)
      console.log(`  ${label} → canvas=${st.canvas} meanL=${stat.meanL} maxL=${stat.maxL} bloomRuns=${st.bloomRuns}`
        + ` bloomInfo=${JSON.stringify(st.bloomInfo)} cap=${JSON.stringify(st.cap && { modes: st.cap.modes, copy: st.cap.copy, readpixels: st.cap.readpixels, fail: st.cap.fail })}`)
      /* 有 WebGL2 ⇒ 照旧断言；拿不到 ⇒ **SKIP + 原样读数**（读数照采：空画布的签名正是 meanL=0/maxL=0）。 */
      if (!gl.webgl2) logGLSkip(label + ' 画布不是整屏黑', launchNote, gl, '原样读数 canvas=' + st.canvas + ' meanL=' + stat.meanL + ' maxL=' + stat.maxL + ' bloomRuns=' + st.bloomRuns)
      else ok(v === 'ok', label + ' 画布不是整屏黑', 'meanL=' + stat.meanL + ' maxL=' + stat.maxL)
      // L5 诊断一致：跳过只能是已知原因；回读档位必须能在诊断面读到（静默降级 = 不许）
      const sk = (st.bloomInfo && st.bloomInfo.skipped) || undefined
      ok(sk === undefined || KNOWN_SKIPS.indexOf(sk) >= 0, label + ' skipped 取值合法', 'skipped=' + String(sk))
      if (st.bloomRuns > 0) {
        ok(!!st.cap && (st.cap.modes || []).length > 0, label + ' 回读档位可读（__mpwCanvasCapture.modes 非空）', JSON.stringify(st.cap && st.cap.modes))
        ok(!(st.cap && st.cap.fail > 0 && !st.bloomInfo), label + ' 回读失败必须留痕（要么 skipped、要么 modes 里有失败模式）')
      }
    } catch (e) {
      ok(false, label + ' 执行', String(e && e.message).slice(0, 90))
    } finally { await page.close().catch(() => {}) }
  }
} finally { await browser.close().catch(() => {}) }

console.log(fail === 0 ? `ALL PASS (${pass} 项)` : `${pass} PASS / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)

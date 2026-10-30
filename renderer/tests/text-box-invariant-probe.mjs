// text-box-invariant-probe.mjs —— 文本层「绘制四边形 == 光栅化位图盒」不变量（第 11 条取证用，2026-09-23）
//
// 为什么要有它：`3326873240` 报「星期文字的 M/Y 被切一半、秒数区只露 1/5」。逐层读数（`__sceneLayers`
// + 现场裁图）显示**字形是完整的**，但发现一个可断言的不变量很值得钉住：
//   文本层绘制四边形（`layer.size`）必须等于**这次**光栅化的位图盒（`boxW/boxH`）。
//   两者一旦不一致，画面上就是"字被拉伸 / 像被切掉"—— 而这类不一致不会报错、也不会白屏，
//   只会在某些壁纸某些字号下"看起来怪"，正是最难靠肉眼归因的那一类。
// 页面侧读数：`window.__mpwTextBoxWant = 1` ⇒ `window.__mpwTextBoxes = [{n,text,box,size,k,pt,limw}]`
// （默认零开销，只在开关打开时采集，见 `demo.html` 的 `ensureTextTexture`）。
//
// 判据分两层（诚实边界）：
//   · **纯函数**（`boxInvariantViolations`）：一张表里哪些行违反了不变量 —— `--selftest` 常驻，含分辨力自证；
//   · **真机**（默认模式，需 :8899/:8902）：挂一张壁纸，开开关，读表并断言 0 违反，且文本层确实产出了纹理。
//     缺 playwright 或服务不在 ⇒ 如实 SKIP（**不假装通过**）。
//
// 用法：node tests/text-box-invariant-probe.mjs [--selftest] [--id 3326873245] [--authority 127.0.0.1:8902]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ROOT, WS } from './_root.mjs'
/* ①(2026-09-23 全仓清扫) 「有头优先 + 能力前置探针 + 无 GL 打 SKIP」这套口径的**唯一实现**
   （照抄 `tests/bench-renderer-source-test.mjs` 的 D 段；见 `tests/_gl-browser.mjs` 的文件头）。 */
import { launchGLBrowser, glCapability, glReading, skipGL } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const SELFTEST = argv.includes('--selftest')
const WANT_ID = (() => { const i = argv.indexOf('--id'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '3326873240' })()
const AUTHORITY = (() => { const i = argv.indexOf('--authority'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '127.0.0.1:8902' })()
/** `--viewport WxH`：按宿主的预览尺寸跑（测试台的预览面板实测 624×351；文本不变量在**小视口**下最容易出问题）。 */
const VIEWPORT = (() => {
  const i = argv.indexOf('--viewport')
  const m = i >= 0 && argv[i + 1] ? /^(\d{3,5})x(\d{3,5})$/.exec(argv[i + 1]) : null
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1280, height: 720 }
})()
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (label, why) => console.log('SKIP ' + label + ' —— ' + why)

/**
 * 纯判据：表里哪些行违反了「绘制四边形 == 位图盒」。
 * 容差 1px（两条路各自四舍五入，差 1 是正常的）；`box`/`size` 缺失或非正数也算违反（读不出来的不算"通过"）。
 * @returns {{total:number, bad:Array<object>}}
 */
export function boxInvariantViolations(rows, tol = 1) {
  const list = Array.isArray(rows) ? rows : []
  const bad = []
  for (const r of list) {
    const b = (r && Array.isArray(r.box)) ? r.box : null
    const s = (r && Array.isArray(r.size)) ? r.size : null
    if (!b || !s || b.length < 2 || s.length < 2) { bad.push({ n: r && r.n, why: 'missing' }); continue }
    if (!(b[0] > 0) || !(b[1] > 0)) { bad.push({ n: r && r.n, why: 'box<=0', box: b }); continue }
    if (Math.abs(b[0] - s[0]) > tol || Math.abs(b[1] - s[1]) > tol) bad.push({ n: r && r.n, why: 'mismatch', box: b, size: s, text: r && r.text })
  }
  return { total: list.length, bad }
}

if (SELFTEST) {
  console.log('== S 纯判据自证 ==')
  ok(boxInvariantViolations([{ n: 'a', box: [100, 50], size: [100, 50] }]).bad.length === 0, 'S1 完全一致 ⇒ 0 违反')
  ok(boxInvariantViolations([{ n: 'a', box: [100, 50], size: [101, 50] }]).bad.length === 0, 'S2 差 1px（两边各自取整）⇒ 不算违反')
  const v = boxInvariantViolations([{ n: 'a', box: [193, 173], size: [265, 173] }])
  ok(v.bad.length === 1 && v.bad[0].why === 'mismatch', 'S3 位图盒 193 画在 265 的四边形上 ⇒ 违反（这正是"像被拉伸/切掉"的签名）', JSON.stringify(v.bad[0]))
  ok(boxInvariantViolations([{ n: 'a', box: [0, 173], size: [0, 173] }]).bad[0].why === 'box<=0', 'S4 盒退化（0/负）⇒ 违反，不许当通过')
  ok(boxInvariantViolations([{ n: 'a' }]).bad[0].why === 'missing', 'S5 读数缺失 ⇒ 违反（读不出来 ≠ 没问题）')
  ok(boxInvariantViolations([]).total === 0 && boxInvariantViolations(null).bad.length === 0, 'S6 空表/null ⇒ 不崩（调用方据此 SKIP）')
  console.log('\n── selftest 汇总：PASS=' + pass + ' FAIL=' + fail + '（未起浏览器）')
  process.exit(fail > 0 ? 1 : 0)
}

const pwPath = [process.env.MPW_PLAYWRIGHT, path.join(ROOT, 'node_modules/playwright/index.js'),
  path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js')]
  .filter((p) => { try { return !!p && fs.existsSync(p) } catch (e) { return false } })[0]
if (!pwPath) { skip('text-box-invariant', '找不到 playwright（可用 MPW_PLAYWRIGHT=<path> 指定）'); process.exit(0) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { skip('text-box-invariant', 'playwright 没有 firefox 导出'); process.exit(0) }

/* ⚠ 前置不是"有没有浏览器"，而是"这台浏览器能不能建 WebGL2"（2026-09-23 归因，口径照抄
   `tests/bench-renderer-source-test.mjs` 的 D 段，见 `tests/_gl-browser.mjs`）：本机（Android/PRoot，无
   `/dev/dri`）**无头 Firefox 连 WebGL1 都建不了** ⇒ 场景根本起不来、`__mpwTextBoxes` 是空表
   ⇒ 硬断言 W1 会把环境缺能力说成产品坏（实测假红：W1 FAIL + W2/W4 rows=0），而 W3「0 违反」还会
   **假绿**（空表当然 0 违反）。所以：**有头优先**（`DISPLAY=:0`，`MPW_X11_DISPLAY` 可换），有头起不来才
   回落无头；`MPW_BENCH_HEADLESS=1` 强制无头。拿不到 WebGL2 ⇒ W1–W4 整组 **SKIP + 原样读数**
   （不谎报成红、也不静默通过）。 */
const { browser, launchNote } = await launchGLBrowser(firefox)
try {
  /* 能力前置探针（读一次，不猜）：webgl2/webgl1 到底能不能建 —— W 组是断言还是 SKIP 由它决定。 */
  const gl = await glCapability(browser)
  if (!gl.webgl2) await skipGL(browser, 'text-box-invariant W1–W4（文本层读数：绘制四边形 == 位图盒）', launchNote, gl)
  const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
  await page.addInitScript(() => { window.__mpwTextBoxWant = 1 })
  const url = 'http://' + AUTHORITY + '/webloader/?id=' + encodeURIComponent(WANT_ID) + '&res=dpr&nopanel'
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(12000)
  /* 有 WebGL2（上面已探到）⇒ W1 照旧**显式断言**（门禁不放水）。 */
  ok(gl.webgl2 === true, 'W1 宿主浏览器拿得到 WebGL2（否则场景起不来、读数全空 ⇒ 不许静默 SKIP）', glReading(launchNote, gl))
  const rows = await page.evaluate(() => (window.__mpwTextBoxes || []).slice(0, 200))
  ok(Array.isArray(rows) && rows.length > 0, 'W2 文本层产出了读数（挂了 ' + WANT_ID + '）', 'rows=' + (rows ? rows.length : 0))
  const rep = boxInvariantViolations(rows)
  ok(rep.bad.length === 0, 'W3 「绘制四边形 == 光栅化位图盒」全部成立（0 违反）@' + VIEWPORT.width + 'x' + VIEWPORT.height,
    JSON.stringify({ total: rep.total, bad: rep.bad.slice(0, 3) }))
  /* 分辨力：同一批读数里至少要有一条**真的被检查过**（否则空表/全 missing 也会"通过"） */
  const checked = rows.filter((r) => Array.isArray(r.box) && r.box[0] > 0).length
  ok(checked === rows.length && checked > 0, 'W4 每一行都真的被检查过（没有 missing/退化盒混进"通过"）',
    JSON.stringify({ checked, total: rows.length }))
} finally {
  await browser.close().catch(() => {})
  console.log('\ntext-box-invariant-probe：PASS=' + pass + ' FAIL=' + fail)
  process.exit(fail > 0 ? 1 : 0)
}

// cover-ab-probe.mjs —— 「同一张壁纸、同一个窗口，本仓渲染器与上游产物画出来的**内容**是否同尺度同位置」
// （2026-09-23 · 本仓渲染器缺"内容包围盒 cover 填充 / 画面偏小右移"那条）
//
// 为什么要这条：两边都只肯自报零散读数（上游 `fit cover: view … scene … canvas …` + `cover peek gate:
// content 4249x3076`；本仓是 ortho 矩形 + 层矩形），谁也没把"**画在屏幕上的内容**"量出来 ⇒ 只能靠眼睛说
// "看起来小一圈、往右偏"，既不能复现也不能回归。这里改成**像素级 A/B**：同一个 `#frame` 盒、同一时刻、
// 两种渲染器来源各截一张，在页面内解码 PNG、算"非背景像素"的包围盒（宽高 + 质心 + 面积占比），
// 再给出尺度比与偏移量。
//
// 判据分两层（诚实边界）：
//   · **读数层**（本文件先跑出来的东西）：`bbox` 宽高比 `scaleRatio = w_repo/w_upstream`、
//     质心偏移 `dx/dy`（像素）、非背景像素占比 `cover`。这些是纯读数，不带"应该多少"的臆断。
//   · **断言层**：只有拿到基线读数之后才写（`--expect` 传入目标比值区间），否则本探针只打印读数并
//     如实标 `SKIP`——**不假装通过**（上一轮 DPR 那组就是被"缺能力的静默 SKIP"骗过一次）。
//
// 用法：
//   node tests/cover-ab-probe.mjs                 # 用库里第一张场景壁纸，两种档位各截一张，打印读数
//   node tests/cover-ab-probe.mjs --id 3544152633 # 指定 itemId
//   node tests/cover-ab-probe.mjs --selftest      # 纯判据自证（不起浏览器）
//   node tests/cover-ab-probe.mjs --expect 0.97,1.03   # 断言层：尺度比必须落在这个闭区间内
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { ROOT, WS } from './_root.mjs'
/* ①(2026-09-23 全仓清扫) 「有头优先 + 能力前置探针 + 无 GL 打 SKIP」这套口径的**唯一实现**
   （照抄 `tests/bench-renderer-source-test.mjs` 的 D 段；见 `tests/_gl-browser.mjs` 的文件头）。 */
import { launchGLBrowser, glCapability, glReading, logGLSkip, glSkipWhy } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const SELFTEST = argv.includes('--selftest')
const WANT_ID = (() => { const i = argv.indexOf('--id'); return i >= 0 && argv[i + 1] ? argv[i + 1] : null })()
const EXPECT = (() => {
  const i = argv.indexOf('--expect')
  if (i < 0 || !argv[i + 1]) return null
  const [lo, hi] = String(argv[i + 1]).split(',').map(Number)
  return (Number.isFinite(lo) && Number.isFinite(hi)) ? { lo, hi } : null
})()
const DIRECT = argv.includes('--direct')
const VP_W = (() => { const i = argv.indexOf('--vp'); return i >= 0 && argv[i + 1] ? Number(String(argv[i + 1]).split('x')[0]) : 960 })()
const VP_H = (() => { const i = argv.indexOf('--vp'); return i >= 0 && argv[i + 1] ? Number(String(argv[i + 1]).split('x')[1]) : 540 })()
const PIN_FRAME = (() => { const i = argv.indexOf('--pin-frame'); return i >= 0 && argv[i + 1] ? argv[i + 1] : null })()
const FIXED_TIME = (() => { const i = argv.indexOf('--time'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '06:30:00' })()
const SRC = (() => { const i = argv.indexOf('--src'); return i >= 0 && argv[i + 1] ? argv[i + 1] : null })()
const STAGE = (() => { const i = argv.indexOf('--stage'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '1920x1080' })()
const SAVE = (() => { const i = argv.indexOf('--save'); return i >= 0 && argv[i + 1] ? argv[i + 1] : null })()
const AUTHORITY = (() => { const i = argv.indexOf('--authority'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '127.0.0.1:8902' })()
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (label, why) => console.log('SKIP ' + label + ' —— ' + why)

/** 纯判据：像素包围盒（`data` = RGBA，`w`/`h` = 像素尺寸，`bg` = 背景色 [r,g,b]，`tol` = 通道容差）。
    判据只认"和背景色差得足够远"的像素 —— 背景取四角与四边中点的中位数（壁纸常常自己带黑边，
    取单一角落会误判）。返回 `null` = 没有可判像素（整幅都是背景 ⇒ 无从判定，不许当通过）。 */
export function contentBBox(data, w, h, bg, tol = 24) {
  if (!data || !(w > 0) || !(h > 0)) return null
  const at = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]] }
  if (!bg) {
    const samples = []
    const xs = [0, (w - 1) >> 1, w - 1], ys = [0, (h - 1) >> 1, h - 1]
    for (const y of ys) for (const x of xs) samples.push(at(x, y))
    const med = (k) => { const v = samples.map((s) => s[k]).sort((a, b) => a - b); return v[v.length >> 1] }
    bg = [med(0), med(1), med(2)]
  }
  let minX = w, minY = h, maxX = -1, maxY = -1, n = 0, sx = 0, sy = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = at(x, y)
      if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) <= tol) continue
      n++
      sx += x; sy += y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return {
    bg, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
    cx: +(sx / n).toFixed(2), cy: +(sy / n).toFixed(2), pixels: n, cover: +(n / (w * h)).toFixed(4),
  }
}

/** 纯判据：两张图的尺度比与质心偏移（`a` = 本仓、`b` = 上游）。`null` = 有一侧量不到。 */
export function compareBBox(a, b) {
  if (!a || !b || !(a.w > 0) || !(b.w > 0) || !(a.h > 0) || !(b.h > 0)) return null
  return {
    scaleRatio: +(a.w / b.w).toFixed(4), scaleRatioH: +(a.h / b.h).toFixed(4),
    dx: +(a.cx - b.cx).toFixed(2), dy: +(a.cy - b.cy).toFixed(2),
    coverRepo: a.cover, coverUpstream: b.cover,
  }
}

if (SELFTEST) {
  console.log('== S 纯判据自证 ==')
  /* S1：8×8 全黑底，中间 4×4 白块 ⇒ 包围盒 = 那一块、质心 = 块中心。 */
  {
    const w = 8, h = 8, d = new Uint8Array(w * h * 4)
    for (let i = 3; i < d.length; i += 4) d[i] = 255
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255 }
    const b = contentBBox(d, w, h, [0, 0, 0])
    ok(b && b.x === 2 && b.y === 2 && b.w === 4 && b.h === 4 && b.cx === 3.5 && b.cy === 3.5,
      'S1 黑底白块的包围盒与质心', JSON.stringify(b))
  }
  /* S2：整幅都是背景 ⇒ null（无从判定，不许当通过）。 */
  {
    const w = 4, h = 4, d = new Uint8Array(w * h * 4)
    for (let i = 3; i < d.length; i += 4) d[i] = 255
    ok(contentBBox(d, w, h, [0, 0, 0]) === null, 'S2 整幅同色 ⇒ null')
    ok(contentBBox(null, 0, 0, null) === null, 'S2b 空数据 ⇒ null')
  }
  /* S3：本仓小一圈且右移 ⇒ 比值 <1、dx >0（正是"偏小右移"的读数形态）。 */
  {
    const a = { w: 80, h: 60, cx: 60.5, cy: 40, cover: 0.2 }
    const b = { w: 100, h: 75, cx: 50.5, cy: 40, cover: 0.3 }
    const c = compareBBox(a, b)
    ok(c && c.scaleRatio === 0.8 && c.scaleRatioH === 0.8 && c.dx === 10 && c.dy === 0,
      'S3 尺度比/偏移的符号与数值', JSON.stringify(c))
    ok(compareBBox(a, null) === null, 'S3b 缺一侧 ⇒ null')
  }
  /* S4：背景中位数对"四角不全是背景"的图也稳（左黑右白各半 ⇒ 中位数取到黑，白半边成为内容）。 */
  {
    const w = 8, h = 4, d = new Uint8Array(w * h * 4)
    for (let i = 3; i < d.length; i += 4) d[i] = 255
    for (let y = 0; y < h; y++) for (let x = 4; x < 8; x++) { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255 }
    const b = contentBBox(d, w, h, null)
    ok(b && b.w === 4 && b.x === 4, 'S4 背景取边角中位数（半幅内容也能量出另一半）', JSON.stringify(b))
  }
  console.log('\n── selftest 汇总：PASS=' + pass + ' FAIL=' + fail + '（未起浏览器）')
  process.exit(fail > 0 ? 1 : 0)
}

const pwPath = [process.env.MPW_PLAYWRIGHT, path.join(ROOT, 'node_modules/playwright/index.js'),
  path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js']
  .filter((p) => { try { return !!p && fs.existsSync(p) } catch (e) { return false } })[0]
if (!pwPath) { console.log('SKIP cover-ab-probe — 找不到 playwright（可用 MPW_PLAYWRIGHT=<path> 指定）'); process.exit(0) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP cover-ab-probe — playwright 没有 firefox 导出'); process.exit(0) }
/* ⚠ 前置不是"有没有浏览器"，而是"这台浏览器能不能建 WebGL2"（2026-09-23 归因，口径照抄
   `tests/bench-renderer-source-test.mjs` 的 D 段，见 `tests/_gl-browser.mjs`）：本机（Android/PRoot，无
   `/dev/dri`）**无头 Firefox 连 WebGL1 都建不了** ⇒ 页面停在「启动失败: 当前浏览器不支持 WebGL2」，
   两种档位都截到同一张"错误页" ⇒ W1/W2 的像素读数全是噪声（实测 `webgl2:false` + `repoBlank:true`）。
   所以**有头优先**（`DISPLAY=:0`，`MPW_X11_DISPLAY` 可换），有头起不来才回落无头；`MPW_BENCH_HEADLESS=1`
   强制无头。拿不到 WebGL2 ⇒ W1/W2 打 **SKIP + 原样读数**（不谎报成红、也不静默通过）。 */
const { browser, launchNote } = await launchGLBrowser(firefox)
try {
  /* 能力前置探针（读一次，不猜）：webgl2/webgl1 到底能不能建 —— 决定下面像素类判据是断言还是 SKIP。 */
  const gl = await glCapability(browser)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  /* 舞台逻辑分辨率钉死（等价工具条「分辨率」下拉）：不钉的话切渲染器来源时 `#frame` 的 CSS 盒会变
     （实测 529×297 → 558×314），两档就不是同一个取景框了。 */
  const q = []
  if (WANT_ID && DIRECT) q.push('id=' + encodeURIComponent(WANT_ID))
  if (STAGE) q.push('res=' + encodeURIComponent(STAGE))
  const entry = 'http://' + AUTHORITY + '/' + (q.length ? ('?' + q.join('&')) : '')
  await page.goto(entry, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(9000)

  {
    /* 有 WebGL2 ⇒ 照旧**显式断言**；拿不到 ⇒ **SKIP + 原样读数**（不是 FAIL：无头 Firefox 无 `/dev/dri`
       时连 WebGL1 都建不了，那是环境缺能力；但 SKIP 行带着 launch/读数，不静默通过）。 */
    if (!gl.webgl2) {
      logGLSkip('W1 宿主浏览器拿得到 WebGL2', launchNote, gl, '本探针余下读数作废')
      glSkipWhy()
    } else {
      ok(gl.webgl2 === true, 'W1 宿主浏览器拿得到 WebGL2（否则像素读数一律不可信 —— 不许静默 SKIP）', glReading(launchNote, gl))
    }
  }

  /* ── `--direct`：**直接开两个渲染器页**、同一个 viewport 做 A/B ─────────────────────────────
     为什么需要这条：测试台里两边 `#frame` 的 CSS 盒由**不同来源**驱动（本仓档能把画布尺寸读回去、
     上游档读不到 ⇒ 面板给出不同大小，实测 529×297 vs 558×314），取景框都不同就没法比构图。
     直接开两个页面时 viewport 由本探针指定 ⇒ 画布盒 = 一样的。 */
  if (DIRECT) {
    const VP = { width: VP_W, height: VP_H }
    const repoCtx = await browser.newContext({ viewport: VP })
    const upCtx = await browser.newContext({ viewport: VP })
    const repoPage = await repoCtx.newPage()
    const upPage = await upCtx.newPage()
    /* `:8899/` 就是本仓渲染器页（`index.html`）；`/demo.html` 是 404 —— 别再猜路径。 */
    /* 时钟钉同一时刻：样例场景里有个大时钟，两侧时间不同会让像素/质心比较带上无关差异。 */
    const pin = '&time=' + encodeURIComponent(FIXED_TIME)
    const rUrl = 'http://127.0.0.1:8899/?type=scene&src=' + encodeURIComponent(WANT_ID || 'sample-synthetic')
      + '&id=' + encodeURIComponent(WANT_ID || 'sample-synthetic') + '&fit=cover&res=dpr&renderDpr=1' + pin
    const uUrl = 'http://127.0.0.1:8902/wallpaper-engine-webgl/renderer/index.html?type=scene&src='
      /* ⚠ 上游侧的 `src` 必须与 repo 侧**同一个对象**：测试台给上游档的 URL 也是 `src=<itemId>`
         （产品页经 `:8902` 的宿主路由取包）⇒ 这里 `--src` 优先，否则跟 `--id` 走，最后才回落到样例。
         上一版忘了这条，拿"样例"去比"Girl and Cat"，两边根本不是一张图。 */
      + encodeURIComponent(SRC || WANT_ID || '/samples/sample-synthetic/scene.pkg') + '&fit=cover&renderDpr=1' + pin
    console.log('  repo 页 = ' + rUrl)
    console.log('  up   页 = ' + uUrl)
    const shot = async (pg, label) => {
      await pg.goto(label === 'repo' ? rUrl : uUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await pg.waitForTimeout(13000)
      /* 本仓渲染器页自带外壳（属性面板 / 输出区 / 工具条 / 帧率）—— 它们是**页面的 UI**，不是渲染结果，
         留在截图里就会把画布盖掉（上一版 repo 那张就是这么废掉的）。这里只在本仓页把外壳摘掉：
         保留画布本身与含画布的祖先，其余 body 子元素 `display:none`。上游产物页不动（它的外壳本来就是
         产品页的一部分，而且实测截图是干净的）。 */
      if (label === 'repo') {
        await pg.evaluate(() => {
          for (const el of [...document.body.children]) {
            if (el.tagName === 'CANVAS') continue
            if (el.querySelector && el.querySelector('canvas')) continue
            el.style.display = 'none'
          }
        })
        await pg.waitForTimeout(600)
      }
      return snap(pg, label)
    }
    /** 截图 + 解码 + 包围盒（`shot()` 的后半段；重试时只重截、**不重新导航**）。 */
    const snap = async (pg, label) => {
      const buf = await pg.screenshot({ clip: { x: 0, y: 0, width: VP.width, height: VP.height } })
      const probe = await ctx.newPage()
      try {
        await probe.goto('about:blank')
        const r = await probe.evaluate(async (dataUrl) => {
          const img = new Image()
          await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); img.src = dataUrl })
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
          const g = c.getContext('2d'); g.drawImage(img, 0, 0)
          const im = g.getImageData(0, 0, c.width, c.height)
          return { w: c.width, h: c.height, data: Array.from(im.data) }
        }, 'data:image/png;base64,' + buf.toString('base64'))
        const bbox = contentBBox(Uint8Array.from(r.data), r.w, r.h, null)
        if (SAVE) { try { fs.mkdirSync(SAVE, { recursive: true }); fs.writeFileSync(path.join(SAVE, 'direct-' + label + '.png'), buf) } catch (e) {} }
        const st = await pg.evaluate(() => {
          const c = document.querySelector('canvas')
          const log = document.getElementById('log')
          return { canvas: c ? c.width + 'x' + c.height + ' css ' + c.clientWidth + 'x' + c.clientHeight : null,
            tail: log ? String(log.textContent || '').trim().split('\n').slice(-2).map((x) => x.slice(0, 80)) : null }
        })
        return { label, box: { x: 0, y: 0, width: VP.width, height: VP.height }, shot: { w: r.w, h: r.h }, bbox, state: st, blank: !bbox || bbox.cover < 0.05 }
      } finally { await probe.close().catch(() => {}) }
    }
    /* 就绪轮询（**不盲等**）：软件 GL 下"首帧"可能晚于固定等待 —— 实测上游产物页在测试台里
       +12s 仍是全黑（mean=0/std=0）、+15s 才画出内容 ⇒ 固定 13s 会把"还没画"读成"没画"（W2 假红）。
       这里空白帧就再等再截（有上限；超时照读照断言，判据不放松）。口径同
       `bench-renderer-source-test.mjs` 的 D 段（"轮询到读数出现为止"）。 */
    const shotReady = async (pg, label, tries = 5, gapMs = 5000) => {
      let last = await shot(pg, label)
      for (let i = 1; i < tries && last.blank; i++) {
        console.log('  ⏳ direct ' + label + ' 仍空白（第 ' + i + ' 次读数）⇒ 再等 ' + (gapMs / 1000) + 's 重截')
        await pg.waitForTimeout(gapMs)
        last = await snap(pg, label)
      }
      return last
    }
    const dRepo = await shotReady(repoPage, 'repo')
    const dUp = await shotReady(upPage, 'upstream')
    console.log('  repo 档读数: ' + JSON.stringify({ bbox: dRepo.bbox, blank: dRepo.blank, state: dRepo.state }))
    console.log('  upstream 档读数: ' + JSON.stringify({ bbox: dUp.bbox, blank: dUp.blank, state: dUp.state }))
    /* 有 WebGL2 ⇒ 照旧断言；拿不到 ⇒ **SKIP + 原样读数**（读数照采，只是不当判据 —— 空画布的签名就是
       `blank:true / cover:null`，把它当红就是把环境缺能力说成产品坏）。 */
    if (!gl.webgl2) logGLSkip('W2 两档都画出了内容（背景占比 <95%）[direct]', launchNote, gl,
      '原样读数 ' + JSON.stringify({ repo: { blank: dRepo.blank, cover: dRepo.bbox && dRepo.bbox.cover, canvas: dRepo.state && dRepo.state.canvas }, upstream: { blank: dUp.blank, cover: dUp.bbox && dUp.bbox.cover, canvas: dUp.state && dUp.state.canvas } }))
    else ok(!dRepo.blank && !dUp.blank, 'W2 两档都画出了内容（背景占比 <95%）', JSON.stringify({ repo: dRepo.bbox && dRepo.bbox.cover, up: dUp.bbox && dUp.bbox.cover }))
    const dcmp = (!dRepo.blank && !dUp.blank) ? compareBBox(dRepo.bbox, dUp.bbox) : null
    if (!dcmp) skip('内容包围盒 A/B（direct）', '有一侧量不到内容像素 —— 不假装通过')
    else {
      console.log('  ══ A/B 读数（direct，viewport ' + VP.width + 'x' + VP.height + '）══ ' + JSON.stringify(dcmp))
      if (EXPECT) ok(dcmp.scaleRatio >= EXPECT.lo && dcmp.scaleRatio <= EXPECT.hi, 'A/B 尺度比落在 [' + EXPECT.lo + ', ' + EXPECT.hi + '] 内', JSON.stringify({ scaleRatio: dcmp.scaleRatio }))
      else skip('A/B 尺度比断言', '没给 --expect（只取基线读数）')
    }
    await repoCtx.close().catch(() => {})
    await upCtx.close().catch(() => {})
    console.log('\ncover-ab-probe：PASS=' + pass + ' FAIL=' + fail)
    process.exit(fail > 0 ? 1 : 0)
  }

  /* 选壁纸：优先 `--id`；否则点列表里**第一张 scene**（`#list li` 里带 scene 标记的项）。 */
  /* ⚠ `?id=` 只进"预览 URL 构造"，**不选库内壁纸**（实测给了 `?id=3544152633` 挂的还是合成样例）⇒
     要真壁纸就得点列表行；只有 `--direct` 那条路才用 URL 选（渲染器页本身认 `?id=`）。 */
  const picked = (WANT_ID && DIRECT) ? { count: -1, sample: [], clicked: '?id=' + WANT_ID } : await page.evaluate((wantId) => {
    const items = [...document.querySelectorAll('#list li')]
    const info = items.map((el) => ({ text: String(el.textContent || '').slice(0, 40), id: el.getAttribute('data-id') || el.getAttribute('data-item') || '' }))
    const target = wantId
      ? items.find((el) => String(el.getAttribute('data-id') || '') === wantId || String(el.textContent || '').includes(wantId))
      : items.find((el) => /scene/i.test(String(el.getAttribute('data-kind') || el.className || '')) || el.querySelector('[data-kind]')) || items[0]
    if (target && target.click) target.click()
    return { count: items.length, sample: info.slice(0, 4), clicked: target ? String(target.textContent || '').slice(0, 40) : null }
  }, WANT_ID)
  console.log('  库里列表项=' + picked.count + ' 选中=' + JSON.stringify(picked.clicked) + ' 样例=' + JSON.stringify(picked.sample))
  await page.waitForTimeout(9000)

  /** 截图 `#frame` 盒 → 在页面内解码 → 算包围盒读数。 */
  /* ⚠ 截图盒必须**两档共用同一个**：`#frame` 的 CSS 盒会随界面状态变（实测 repo 529×297 vs
     upstream 558×314），各测各的盒子等于在比"盒子大小"而不是"内容构图"（上一版就是这样得出
     0.948 这个看着很具体、其实只是盒子比值的数）。 */
  const frameBox = () => page.evaluate(() => {
    const fr = document.getElementById('frame')
    if (!fr) return null
    const r = fr.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  })
  const measure = async (label, box) => {
    if (!box || box.width < 40 || box.height < 40) return { label, err: 'no-frame-box', box }
    const state = await page.evaluate(() => {
      const fr = document.getElementById('frame')
      const w = fr && fr.contentWindow, d = fr && fr.contentDocument
      const cvs = d ? [...d.querySelectorAll('canvas')].map((c) => c.width + 'x' + c.height) : []
      const log = d && d.getElementById('log')
      return { src: String((fr && fr.getAttribute('src')) || '').slice(0, 120), canvases: cvs,
        layers: (() => { try { return Array.isArray(w.__sceneLayers) ? w.__sceneLayers.length : null } catch (e) { return null } })(),
        live: (() => { try { return w.__mpwLiveRes ? (w.__mpwLiveRes.width + 'x' + w.__mpwLiveRes.height + '@' + w.__mpwLiveRes.dpr) : null } catch (e) { return null } })(),
        tail: log ? String(log.textContent || '').trim().split('\n').slice(-2).map((x) => x.slice(0, 90)) : null }
    })
    const buf = await page.screenshot({ clip: box })
    const b64 = buf.toString('base64')
    /* 用页面自己解码 PNG（Node 侧不引额外依赖）：空白页 + <img> + 2D canvas。 */
    const probe = await ctx.newPage()
    try {
      await probe.goto('about:blank')
      const r = await probe.evaluate(async (dataUrl) => {
        const img = new Image()
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); img.src = dataUrl })
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
        const g = c.getContext('2d'); g.drawImage(img, 0, 0)
        const im = g.getImageData(0, 0, c.width, c.height)
        return { w: c.width, h: c.height, data: Array.from(im.data) }
      }, 'data:image/png;base64,' + b64)
      const bbox = contentBBox(Uint8Array.from(r.data), r.w, r.h, null)
      /* ⚠ 「这一档没画出来」必须与「画出来了但构图不同」分开：空白帧（背景占比 >95%）的包围盒
         只有几像素高，拿去比会得出一个**看着很具体**的假比值（上一版就得到 scaleRatio 0.9391 /
         dy -165.68 这种数字，实际是上游档只截到一条 1px 的边）。 */
      const blank = !bbox || bbox.cover < 0.05
      if (SAVE) { try { fs.mkdirSync(SAVE, { recursive: true }); fs.writeFileSync(path.join(SAVE, label + '.png'), buf) } catch (e) {} }
      return { label, box, shot: { w: r.w, h: r.h }, bbox, state, blank }
    } finally { await probe.close().catch(() => {}) }
  }

  /* `--pin-frame WxH`：把 `#frame` 的 CSS 盒**钉死**（`!important` 压过测试台的尺寸耦合 —— 实测切档时
     它会从 529×297 变成 558×314，两侧各用各的盒子就没法比构图）。针脚只钉盒，不改渲染器行为。 */
  /* 把测试台余下的外壳（侧栏/输出区/工具条行）全部藏掉，只留 `#frame` 与它的祖先链 ——
     实测 `#frame` 的 DOM 盒比它的可见容器大，直接按盒截图会把工具条/诊断条一起框进来，
     那些浅灰像素会被当成"渲染出来的背景"（前一版就是这么把读数弄脏的）。 */
  await page.evaluate(() => {
    const fr = document.getElementById('frame')
    if (!fr) return
    const keep = new Set()
    for (let el = fr; el && el !== document.body; el = el.parentElement) {
      keep.add(el)
      for (const sib of [...el.parentElement.children]) {
        if (sib !== el && !(sib.contains && sib.contains(fr))) sib.style.display = 'none'
      }
    }
    for (const c of [...document.body.children]) if (!keep.has(c) && !(c.contains && c.contains(fr))) c.style.display = 'none'
  })
  await page.waitForTimeout(800)
  if (PIN_FRAME) {
    const [pw, ph] = PIN_FRAME.split('x').map(Number)
    await page.addStyleTag({ content: '#frame{width:' + pw + 'px!important;height:' + ph + 'px!important}' })
    await page.waitForTimeout(1200)
  }
  const baseBox = await frameBox()
  console.log('  基准截图盒（两档共用）= ' + JSON.stringify(baseBox))
  /* 就绪轮询（**不盲等**）：上游产物页在软件 GL 下首帧晚于固定等待 —— 实测测试台切到上游档后
     +12s 仍是全黑（mean=0/std=0）、+15s 才画出内容 ⇒ 固定 9s 会把"还没画"读成"没画"（W2 假红）。
     空白帧就再等再量（有上限；超时照读照断言，判据不放松）。口径同 `bench-renderer-source-test.mjs` D 段。 */
  const measureReady = async (label, box, tries = 5, gapMs = 5000) => {
    let last = null
    for (let i = 0; i < tries; i++) {
      last = await measure(label, box)
      if (!last.blank) return last
      if (i < tries - 1) {
        console.log('  ⏳ ' + label + ' 仍空白（第 ' + (i + 1) + ' 次读数）⇒ 再等 ' + (gapMs / 1000) + 's 重量')
        await page.waitForTimeout(gapMs)
      }
    }
    return last
  }
  const repo = await measureReady('repo', baseBox)
  console.log('  repo 档读数: ' + JSON.stringify({ bbox: repo.bbox, blank: repo.blank, state: repo.state }))

  /* 切到上游产物档：同一条重挂载链（`#renderer-src` + `#reload`），与 DPR 那组同一路径。 */
  await page.evaluate(() => {
    const el = document.getElementById('renderer-src')
    if (el) { el.value = 'upstream'; el.dispatchEvent(new Event('change', { bubbles: true })) }
    const b = document.getElementById('reload'); if (b) b.click()
  })
  await page.waitForTimeout(3000)
  const upstream = await measureReady('upstream', baseBox)
  /* 切档后盒子若变了，就把 repo 侧**按新盒子再量一次**（此时布局已稳定）——两侧始终同一个取景框。 */
  const box2 = await frameBox()
  const boxChanged = !(box2 && baseBox && box2.width === baseBox.width && box2.height === baseBox.height)
  const repo2 = boxChanged ? await measure('repo-remount', box2) : null
  if (repo2) console.log('  ⚠ 切档后 #frame 盒变了（' + JSON.stringify(baseBox) + ' → ' + JSON.stringify(box2) + '）⇒ repo 侧按新盒子重量：' + JSON.stringify(repo2.bbox))
  console.log('  upstream 档读数: ' + JSON.stringify({ bbox: upstream.bbox, blank: upstream.blank, state: upstream.state }))

  const repoUse = (repo2 && !repo2.blank) ? repo2 : repo
  /* W3 前置：同一个截图盒 ⇒ 两张图同尺寸，像素级比较才有意义。 */
  ok(repoUse.shot && upstream.shot && repoUse.shot.w === upstream.shot.w && repoUse.shot.h === upstream.shot.h,
    'W3 两档截图尺寸一致（共用同一个 #frame 盒）',
    JSON.stringify({ repo: repoUse.shot, upstream: upstream.shot, box: repoUse.box, boxChanged }))

  /* W2 前置：两档都得**真的画出内容**，否则谈不上构图对比。
     ⚠ 有 WebGL2 ⇒ 照旧断言（这条会红）；拿不到 ⇒ **SKIP + 原样读数**（不是 FAIL —— 见 `tests/_gl-browser.mjs`）。 */
  if (!gl.webgl2) logGLSkip('W2 两档都画出了内容（背景占比 <95%）', launchNote, gl,
    '原样读数 ' + JSON.stringify({ repoBlank: !!repo.blank, upstreamBlank: !!upstream.blank, repoCover: repo.bbox && repo.bbox.cover, upstreamCover: upstream.bbox && upstream.bbox.cover, canvas: { repo: repo.state && repo.state.canvas, upstream: upstream.state && upstream.state.canvas } }))
  else ok(!repo.blank && !upstream.blank, 'W2 两档都画出了内容（背景占比 <95%）—— 否则 A/B 读数无意义',
    JSON.stringify({ repoBlank: !!repo.blank, upstreamBlank: !!upstream.blank, repoCover: repo.bbox && repo.bbox.cover, upstreamCover: upstream.bbox && upstream.bbox.cover }))
  const cmp = (!repoUse.blank && !upstream.blank) ? compareBBox(repoUse.bbox, upstream.bbox) : null
  if (!cmp) {
    skip('内容包围盒 A/B', '有一侧量不到内容像素（repo=' + JSON.stringify(repo.err || repo.bbox) + ' upstream=' + JSON.stringify(upstream.err || upstream.bbox) + '）—— 不假装通过')
  } else {
    console.log('  ══ A/B 读数 ══ ' + JSON.stringify(cmp))
    console.log('     （scaleRatio = 本仓内容宽/上游内容宽；dx>0 = 本仓偏右；dy>0 = 本仓偏下）')
    if (EXPECT) {
      ok(cmp.scaleRatio >= EXPECT.lo && cmp.scaleRatio <= EXPECT.hi,
        'A/B 本仓/上游内容尺度比落在 [' + EXPECT.lo + ', ' + EXPECT.hi + '] 内',
        JSON.stringify({ scaleRatio: cmp.scaleRatio, expect: EXPECT }))
    } else {
      skip('A/B 尺度比断言', '没给 --expect（本轮只取基线读数；拿到基线后才写死区间）—— 读数见上一行')
    }
  }
} catch (e) {
  /* ⚠ 探针自己的异常**必须**算失败并打出原文：上一版有个 `repoUse` 先用后声明的 TDZ 错误被
     `finally` + `process.exit` 吞掉，读数全没跑却打印 `PASS=1` —— 与"缺能力的静默 SKIP"同一类假绿。 */
  fail++
  console.log('FAIL cover-ab-probe 自身异常：' + String((e && e.stack) || e).slice(0, 600))
} finally {
  await browser.close().catch(() => {})
  console.log('\ncover-ab-probe：PASS=' + pass + ' FAIL=' + fail)
  void os
  process.exit(fail > 0 ? 1 : 0)
}

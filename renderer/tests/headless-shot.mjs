// headless-shot.mjs — 渲染截图取证（MERGED-2 第 3 项 A 加固版）
//
// 用法: node headless-shot.mjs <url> <out.png> [waitMs] [width] [height]
//   例: node headless-shot.mjs "http://127.0.0.1:8899/?id=3719111841" /tmp/kalt.png 8000 960 540
//
// 两级策略：
// ① Playwright/Chromium(SwiftShader) 真跑 demo 的 WebGL 路径：低内存参数 → 降级链逐档重试
//    （base → +single-process/no-zygote → 小视口 → disable-gpu CPU 光栅 → old headless → swiftshader GL）。
//    每档独立子进程 + 硬超时（挂起可杀）；证据（失败档位/耗时/错误）记 /tmp/headless-evidence.json。
//    成功 → PNG（≤1280 宽）+ 页面日志（console+pageerror+#log）+ 画布像素统计。
// ② 全部档位失败（本机 PRoot 环境实测：多进程 newPage 挂起、单进程启动即崩，6 组参数全败——
//    证据自动落盘）→ **CPU 预览兜底**（preview.mjs 软光栅）。
//    ⚠ CPU 预览局限：不画 puppet 蒙皮网格（网格层是简化路径）、无效果链 FBO、粒子关——
//    只能验证"层几何/纹理绑定/可见性"，不能验证 GPU 着色语义。输出标注 mode=cpu-preview。
//
// 退出码：0=拿到截图；1=截图成功但页面有 error 级日志（仅 headless 路径）；2=连兜底也失败。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import { ROOT, WS } from './_root.mjs'   // ①(2026-09-16 目录整理) 根文件（demo.html / bundle / icons）在仓库根

const url = process.argv[2] || 'http://127.0.0.1:8899/?id=3719111841'
const out = process.argv[3] || path.join(os.tmpdir(), 'headless.png')
const waitMs = Number(process.argv[4] || 6000)
const W = Math.min(1280, Number(process.argv[5] || 640))
const H = Math.min(720, Number(process.argv[6] || 360))

const ONE_CHILD_MS = 90_000 // 单档总预算（launch+newPage+goto+wait）

// ── ① headless 降级链（每档一个子进程，--one 模式由本文件递归调用）──
const ARGSETS = [
  ['A-base', ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu-process-crash-limit', '--js-flags=--max-old-space-size=768']],
  ['B-single', ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote', '--disable-gpu-process-crash-limit']],
  ['C-smallvp', ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu-process-crash-limit', '--js-flags=--max-old-space-size=512']],
  ['D-nogpu', ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote']],
  ['E-oldheadless', ['--headless=old', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu-process-crash-limit']],
  ['F-swiftshader-gl', ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu-process-crash-limit', '--disable-features=VizDisplayCompositor']],
]

if (process.argv.includes('--one')) {
  // 子进程：单档尝试（url/out/尺寸经环境变量传入，避免 argv 位置被 --one 挤占）
  const setIdx = Number(process.argv[process.argv.indexOf('--one') + 1])
  await runOneAttempt(ARGSETS[setIdx][0], ARGSETS[setIdx][1])
  process.exit(0)
}

async function runOneAttempt(name, args) {
  const PW = process.env.MPW_PLAYWRIGHT || path.join(WS, 'dsh-mpkg-wallpaper', 'node_modules', 'playwright', 'index.mjs'); // ①(去个人化) 可覆盖
  const { chromium } = await import(PW)
  const t0 = Date.now()
  let browser
  try {
    browser = await chromium.launch({ args, timeout: 30_000 })
    const page = await browser.newPage({ viewport: { width: Number(process.env.SHOT_W || 640), height: Number(process.env.SHOT_H || 360) }, deviceScaleFactor: 1 })
    const logs = []
    page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()))
    page.on('pageerror', (e) => logs.push('[js-error] ' + e.message))
    page.on('requestfailed', (r) => logs.push('[reqfail] ' + r.url() + ' ' + (r.failure() && r.failure().errorText)))
    // domcontentloaded 而非 load：demo 有长连接式资源（视频/轮询），'load' 可能永不触发
    await page.goto(process.env.SHOT_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(Number(process.env.SHOT_WAIT || 6000))
    const pageLog = await page.evaluate(() => (document.getElementById('log') ? document.getElementById('log').textContent : '(无 #log)'))
    await page.screenshot({ path: process.env.SHOT_OUT })
    /*  ①(2026-09-25 P-182 同类普查) **读像素这一步绝不许成为第一个 getContext 的调用者**：
        同一个 canvas 只有第一次 getContext 的参数生效，而 `#sc` 在 `?mode=elysia` 档走 **2d**
        （`elysia/demo-elysia.js` 的 `canvas.getContext('2d')`，且在它之前还有两个真实 await）——
        原来这里无条件 `cv.getContext('webgl2')`：轻则拿到 null（那页已是 2d）⇒ `readPixels` 抛错，
        重则**抢在 elysia 前面**把画布锁成 webgl2 ⇒ 它自己的 `getContext('2d')` 返回 null、那条路直接死。
        现在的口径：WebGL 档先等**渲染器自己回报出过帧**（`__mpwFirstFrame` / `__mpwFrameNo>0`，
        帧本身就是"上下文已存在"的证据）再读；elysia 档按它自己的 2d 读；等不到就**如实写明 why 不读**。 */
    const MODE = await page.evaluate(() => { try { return String(new URLSearchParams(location.search).get('mode') || '') } catch { return '' } })
    let frameSeen = false
    if (MODE !== 'elysia') {
      try {
        await page.waitForFunction(() => !!(window.__mpwFirstFrame || (window.__mpwFrameNo || 0) > 0), null, { timeout: 20000 })
        frameSeen = true
      } catch { frameSeen = false }
    }
    const stats = await page.evaluate((o) => {
      const cv = document.getElementById('sc')
      if (!cv) return null
      const w = cv.width, h = cv.height
      const pct = (t, n) => ({ w, h, opaquePct: +(t.o / n * 100).toFixed(1), whitePct: +(t.w / n * 100).toFixed(1), nonblackPct: +(t.nb / n * 100).toFixed(1) })
      const tally = (px, stride) => {
        let o = 0, wh = 0, nb = 0
        for (let i = 0; i < px.length; i += stride) {
          if (px[i + 3] > 16) o++
          if (px[i] > 240 && px[i + 1] > 240 && px[i + 2] > 240 && px[i + 3] > 200) wh++
          if (px[i] > 8 || px[i + 1] > 8 || px[i + 2] > 8) nb++
        }
        return { o, w: wh, nb }
      }
      if (o.elysia) {
        /*  elysia 档：**只读它自己的 2d**（`getContext('2d')` 返回它建好的那一个；即使它还没建，
            无参 2d 的属性与它随后要的完全相同 ⇒ 不改变行为）。 */
        const ctx = cv.getContext('2d')
        if (!ctx) return { w, h, why: 'elysia 档：拿不到 2d 上下文（页面可能还没走到那一步）' }
        try { return Object.assign({ mode: 'elysia' }, pct(tally(ctx.getImageData(0, 0, w, h).data, 4), w * h)) } catch (e) { return { w, h, why: 'elysia 档：getImageData 失败 ' + String(e && e.message) } }
      }
      if (!o.frameSeen) return { w, h, why: '没等到首帧信号（`__mpwFirstFrame`/`__mpwFrameNo>0`）⇒ 不读像素：读就会抢在渲染器前面建上下文（同一 canvas 只有第一次 getContext 生效）' }
      const gl = cv.getContext('webgl2')
      if (!gl) return { w, h, why: '拿不到 webgl2 上下文（首帧信号有了却读不到上下文：可能已被别的东西先占了）' }
      const px = new Uint8Array(w * h * 4)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
      return Object.assign({ mode: 'webgl2' }, pct(tally(px, 4), w * h))
    }, { elysia: MODE === 'elysia', frameSeen })
    await browser.close()
    // 输出协议（父进程解析）：行前缀 RESULT/LOGS/STATS
    console.log('RESULT ' + JSON.stringify({ ok: true, mode: 'headless-' + name, ms: Date.now() - t0 }))
    console.log('STATS ' + JSON.stringify(stats))
    console.log('LOGS ' + JSON.stringify(logs.filter((l) => /\[we-scene\]|⚠|js-error|\[pageerror\]|error/i.test(l)).slice(0, 40)))
    console.log('PAGELOG ' + JSON.stringify(pageLog.split('\n').slice(-25).join('\n')))
    fs.writeFileSync(path.join(os.tmpdir(), 'headless.log'), logs.join('\n') + '\n\n=== 页面 #log ===\n' + pageLog)
  } catch (e) {
    try { await browser?.close() } catch {}
    console.log('RESULT ' + JSON.stringify({ ok: false, mode: 'headless-' + name, ms: Date.now() - t0, err: String(e.message).slice(0, 300) }))
    process.exit(1)
  }
}

// 父进程：带硬超时跑一档（挂起可杀）
function tryAttempt(i) {
  const [name, args] = ARGSETS[i]
  return new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [import.meta.filename, '--one', String(i)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SHOT_URL: url, SHOT_OUT: out, SHOT_WAIT: String(waitMs), SHOT_W: String(W), SHOT_H: String(H) },
    })
    let buf = ''
    let done = false
    const timer = setTimeout(() => { if (!done) { child.kill('SIGKILL'); done = true; resolve({ name, ok: false, ms: Date.now() - t0, err: '硬超时 ' + ONE_CHILD_MS / 1000 + 's（挂起，SIGKILL）' }) } }, ONE_CHILD_MS)
    child.stdout.on('data', (c) => { buf += c })
    child.stderr.on('data', (c) => { buf += c })
    child.on('exit', () => {
      if (done) return
      done = true; clearTimeout(timer)
      const resultLine = buf.split('\n').find((l) => l.startsWith('RESULT '))
      if (resultLine) {
        const r = JSON.parse(resultLine.slice(7))
        r.stdout = buf
        resolve({ name, ...r })
      } else {
        resolve({ name, ok: false, ms: Date.now() - t0, err: ('exit=' + child.exitCode + ' ' + buf).slice(-300) })
      }
    })
  })
}

// ── 主流程 ──
const evidence = { url, out, attempts: [], at: new Date().toISOString() }
let success = null
if (process.env.SHOT_MODE === 'cpu') {
  // 直通 CPU 预览（本机 headless 已判定不可用时的省时开关；完整链照常可用 SHOT_MODE=chain）
  console.error('[headless-shot] SHOT_MODE=cpu：跳过 headless 降级链，直接 CPU 预览兜底（局限：无蒙皮网格/效果链/粒子）')
} else {
  for (let i = 0; i < ARGSETS.length; i++) {
    const r = await tryAttempt(i)
    evidence.attempts.push({ set: r.name, ok: !!r.ok, ms: r.ms, err: r.err || null })
    console.error(`[headless-shot] 档位 ${r.name}: ${r.ok ? '成功' : '失败'} (${r.ms}ms)${r.err ? ' · ' + String(r.err).slice(0, 120) : ''}`)
    if (r.ok) { success = r; break }
  }
  fs.writeFileSync(path.join(os.tmpdir(), 'headless-evidence.json'), JSON.stringify(evidence, null, 1))
}

if (success) {
  const statsLine = (success.stdout.split('\n').find((l) => l.startsWith('STATS ')) || '').slice(6)
  const logsLine = (success.stdout.split('\n').find((l) => l.startsWith('LOGS ')) || '').slice(5)
  const pageLogLine = (success.stdout.split('\n').find((l) => l.startsWith('PAGELOG ')) || '').slice(8)
  console.log('截图:', out, '· mode=' + success.name)
  console.log('画布统计:', statsLine || 'null')
  const logs = logsLine ? JSON.parse(logsLine) : []
  const errs = logs.filter((l) => /js-error|\[pageerror\]|\[we-scene\].*(失败|错误|异常)|console.*error/i.test(l))
  console.log('--- error 级日志 ' + errs.length + ' 条 ---')
  if (errs.length) console.log(errs.slice(0, 15).join('\n'))
  console.log('--- 页面日志尾部 ---')
  console.log(pageLogLine ? JSON.parse(pageLogLine) : '(无)')
  process.exit(errs.length ? 1 : 0)
}

// ── ② headless 不可用 → CPU 预览兜底 ──
console.error('\n[headless-shot] ⚠ headless Chromium 在本环境**不可用**（全部 ' + ARGSETS.length + ' 档失败，证据见 /tmp/headless-evidence.json）。' +
  '\n  实测失败模式：① 多进程档 launch/newPage 可过但任何导航挂起（连 about:blank/data: 都超时——PRoot 下渲染进程 Mojo IPC 不可用）；' +
  '② single-process 档 launch 即崩（Target/browser closed）；③ NetworkServiceInProcess / old-headless / swiftshader-GL 变体均无效。' +
  '\n  改用 CPU 预览兜底（preview.mjs）。' +
  '\n⚠ CPU 预览局限：不画 puppet 蒙皮网格（网格层是简化路径）、无效果链/粒子——只验证层几何/纹理绑定/可见性。')
const idMatch = /[?&]id=(\d+)/.exec(url)
if (!idMatch) {
  console.error('[headless-shot] URL 无 ?id=<数字>，CPU 预览无法兜底（?pkgpath/?pkgurl 场景请用 render-audit）')
  process.exit(2)
}
const pw = Math.min(1280, W), ph = Math.min(720, H)
try {
  execFileSync('node', ['tests/preview.mjs', idMatch[1], out, String(pw), String(ph)], { cwd: ROOT, timeout: 300_000, stdio: 'inherit', env: { ...process.env, REFR: process.env.REFR || '0' } })
  console.log('\n截图:', out, '· mode=cpu-preview（局限见上，非 GPU 语义）')
  process.exit(0)
} catch (e) {
  console.error('[headless-shot] CPU 预览兜底也失败:', String(e.message).slice(0, 300))
  process.exit(2)
}

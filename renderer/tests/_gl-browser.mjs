// _gl-browser.mjs —— 「有头优先 + 能力前置探针 + 无 GL 打 SKIP」这套口径的**唯一实现**（tests/ 共用）
//
// ⚠ 实现**照抄** `tests/bench-renderer-source-test.mjs` 的 D 段（2026-09-22 归因那一版），不另造口径：
//   · 本机（Android/PRoot，**无 `/dev/dri`**）**无头 Firefox 连 WebGL1 都建不了**
//     （控制台 `FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`）⇒ 凡是"在 headless Firefox 里断言 WebGL2 /
//     读画布像素"的门禁，在本机**必然假红**（读数会长成"300×150 空画布 / meanL=0 / mae=0"）。
//   · 本仓库唯一能出 WebGL2 的组合 = **有头 Firefox + X 显示 `:0` + 软件 llvmpipe**
//     （`docs/REAL-MACHINE-AUTOMATION.md` §1、`tests/x11-e2e/README.md` §1）。
//
// 三件事，缺一不可：
//   ① **有头优先**：默认起有头（`DISPLAY` = `MPW_X11_DISPLAY` || `:0`），起不来/没显示才回落无头；
//      `MPW_BENCH_HEADLESS=1` 强制无头（给真有 GL 的机器用）；`MPW_GL_FORCE_OFF=1` 强制关 WebGL
//      （等价开关，给有 GL 的机器自证"无 GL ⇒ SKIP + 读数"这条路）。
//   ② **能力前置探针**：真去问一次浏览器（`canvas.getContext('webgl2')` / `('webgl')`）能不能建，**不猜**。
//   ③ 拿不到 GL ⇒ 调用方 **SKIP 并打印原样读数** —— 既不谎报成红（把环境缺能力说成产品坏），
//      也不静默通过（"没测到"必须看得见）。
//
// 用法（探针里就三行）：
//   const { browser, launchNote } = await launchGLBrowser(firefox)
//   const gl = await glCapability(browser)                        // { webgl2, webgl1, ver2, ver1, renderer, err }
//   if (!gl.webgl2) { await closeQuiet(browser); skipGL('本档名', launchNote, gl) }   // 整档 GL 前置
// 多判据组（有非 GL 判据照跑的那种）不要 exit，改用 `logGLSkip(label, launchNote, gl)` 打一条 SKIP 继续跑。
import { AUDIO_MUTE_PREFS } from './_audio-mute.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'

/** 有头模式用的 X 显示号（`MPW_X11_DISPLAY` 可换；本机既有做法就是 `:0`）。 */
export const XDISPLAY = process.env.MPW_X11_DISPLAY || ':0'
/** 显式强制无头（只有真有 GL 的机器才需要它；本机强制无头 ⇒ 探针会拿不到 GL ⇒ SKIP）。 */
export const FORCE_HEADLESS = process.env.MPW_BENCH_HEADLESS === '1'
/** **等价开关**：强制"这台浏览器拿不到 GL"（`webgl.disabled`）—— 给**本来就有 GL 的机器**（含 x11-e2e 这种
    只能有头跑的档）自证"无 GL ⇒ SKIP + 原样读数"这条路真的会走，而不是只在没 GL 的机器上才第一次被执行。
    与 `MPW_BENCH_HEADLESS=1`（强制无头 ⇒ 本机因此拿不到 GL）同族，只在取证/自证时用。 */
export const FORCE_NO_GL = process.env.MPW_GL_FORCE_OFF === '1'
/** WebGL 预置项：默认显式开（有头软件 llvmpipe 才建得起来）；`MPW_GL_FORCE_OFF=1` 时反过来关掉。
    只能有头跑的档（`tests/x11-e2e/**`：必须有真窗口）不走 `launchGLBrowser` 的"回落无头"，
    但可以 `...glPrefs()` 把同一份预置项接过去 ⇒ `MPW_GL_FORCE_OFF=1` 在那边同样生效。 */
export const glPrefs = () => (FORCE_NO_GL
  ? { 'webgl.disabled': true, 'webgl.force-enabled': false }
  : { 'webgl.force-enabled': true })

/** 启动参数（与 `bench-renderer-source-test.mjs` 的 `launchOpts` 逐字同款）：
    软件光栅 + 显式开 WebGL 预置项；有头才带 `DISPLAY`。 */
export const launchOpts = (headless, extra = {}) => ({
  headless,
  env: {
    ...process.env, MOZ_WEBGL_FORCE_SOFTWARE: '1', LIBGL_ALWAYS_SOFTWARE: '1',
    ...(headless ? {} : { DISPLAY: XDISPLAY }),
    ...(extra.env || {}),
  },
  firefoxUserPrefs: { ...AUDIO_MUTE_PREFS,
    ...glPrefs(), 'gfx.webrender.software': true, 'webgl.out-of-process': false,
    ...(extra.firefoxUserPrefs || {}),
  },
  ...(extra.top || {}),
})

/**
 * 起浏览器：**有头优先**（本机唯一能出 WebGL2 的组合），有头起不来/没显示才回落无头。
 * @returns {Promise<{browser:any, launchNote:string, headless:boolean}>}
 */
export async function launchGLBrowser(firefox, extra = {}) {
  let note = ''
  let b = null
  let headless = false
  if (!FORCE_HEADLESS) {
    try { b = await firefox.launch(launchOpts(false, extra)); note = '有头 DISPLAY=' + XDISPLAY }
    catch (e) { note = '有头起不来（' + String((e && e.message) || e).slice(0, 90) + '）⇒ 回落无头' }
  }
  if (!b) {
    b = await firefox.launch(launchOpts(true, extra))
    headless = true
    note = FORCE_HEADLESS ? '无头（MPW_BENCH_HEADLESS=1）' : note + ' · 无头'
  }
  return { browser: b, launchNote: note + (FORCE_NO_GL ? ' · MPW_GL_FORCE_OFF=1（强制关 WebGL）' : ''), headless }
}

/**
 * 能力前置探针：真去问一次浏览器 `webgl2` / `webgl1` 能不能建（**不猜**，读一次原始读数）。
 * 与 `bench-renderer-source-test.mjs` 的 D 段探针同口径，另加 `webgl1` 读数（诊断"连 1 都建不了"）。
 * @returns {Promise<{webgl2:boolean, webgl1:boolean, ver2:string|null, ver1:string|null, renderer:string|null, err?:string}>}
 */
export async function glCapability(browser) {
  try {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 300 } })
    const page = await ctx.newPage()
    await page.goto('about:blank')
    const g = await page.evaluate(() => {
      const out = { webgl2: false, webgl1: false, ver2: null, ver1: null, renderer: null }
      try {
        const c = document.createElement('canvas')
        const gl = c.getContext('webgl2')
        out.webgl2 = !!gl
        out.ver2 = gl ? String(gl.getParameter(gl.VERSION)) : null
        const d = gl && gl.getExtension('WEBGL_debug_renderer_info')
        out.renderer = d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : null
        if (!gl) {                                   // 连 2 都没有时，再问一次 1（诊断用：本机两个都是 null）
          const c1 = document.createElement('canvas')
          const gl1 = c1.getContext('webgl') || c1.getContext('experimental-webgl')
          out.webgl1 = !!gl1
          out.ver1 = gl1 ? String(gl1.getParameter(gl1.VERSION)) : null
        }
      } catch (e) { out.err = String((e && e.message) || e).slice(0, 100) }
      return out
    })
    await ctx.close()
    return g
  } catch (e) {
    return { webgl2: false, webgl1: false, ver2: null, ver1: null, renderer: null, err: 'GL 探针失败: ' + String((e && e.message) || e).slice(0, 140) }
  }
}

/** 只能有头跑的档（`tests/x11-e2e/**`：必须有真窗口）用的 launchNote：显示号 + 强制关 GL 的自证标记。 */
export const headedNote = (display) => '有头 DISPLAY=' + display + (FORCE_NO_GL ? ' · MPW_GL_FORCE_OFF=1（强制关 WebGL）' : '')

/** 读数 → 一行 JSON（SKIP 行与日志都用它，保证"原样读数"里含启动模式与两个能力位）。 */export const glReading = (launchNote, gl) => JSON.stringify({
  launch: launchNote, webgl2: !!gl.webgl2, webgl1: !!gl.webgl1,
  ver2: gl.ver2 || null, ver1: gl.ver1 || null, renderer: gl.renderer || null,
  ...(gl.err ? { err: gl.err } : {}),
})

/** 「为什么是 SKIP 而不是红」的三行解释（与 `bench-renderer-source-test.mjs` 打印的出路一致）。 */
export function glSkipWhy() {
  console.log('  ⚠ 环境缺能力，**不是产品坏**：无头 Firefox（本机无 `/dev/dri`）连 WebGL1 都建不了')
  console.log('    （`FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`）⇒ 画布停在 300×150 空画布、场景停在')
  console.log('    「❌ 启动失败: 当前浏览器不支持 WebGL2」。要跑满：起 X 显示（本仓库既有做法')
  console.log('    `DISPLAY=:0`，见 tests/x11-e2e/README.md §1）后重跑；只有显式 `MPW_BENCH_HEADLESS=1` 才强制无头。')
}

/** 打印一条 SKIP（**带原样读数**，不静默、不谎报成红）；调用方自己决定后续流程。 */
export function logGLSkip(label, launchNote, gl, extra = '') {
  console.log('SKIP ' + label + ' —— 本机浏览器拿不到 WebGL2（画布/GL 级读数不可信）；读数 '
    + glReading(launchNote, gl) + (extra ? ' · ' + extra : ''))
  return glReading(launchNote, gl)
}

/** 整档 GL 前置：关掉浏览器 → 打 SKIP + 读数 + 出路 → 退出码 0（"没测到"绝不等于"通过"）。 */
export async function skipGL(browser, label, launchNote, gl) {
  await closeQuiet(browser)
  logGLSkip(label, launchNote, gl)
  glSkipWhy()
  process.exit(0)
}

/** 关浏览器（不抛；退出路径上调用）。 */
export async function closeQuiet(browser) {
  try { await browser.close() } catch { /* 已关/被环境带走 */ }
}

/** 找 playwright（tests/ 既有候选顺序：环境变量 → 本仓 → 插件仓 → 全局）。 */
export function findPlaywright() {
  const WS_ROOT = path.resolve(ROOT, '..')
  const cands = [process.env.MPW_PLAYWRIGHT, path.join(ROOT, 'node_modules/playwright/index.js'),
    path.join(WS_ROOT, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js'),
    '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c } catch { /* next */ } }
  return null
}

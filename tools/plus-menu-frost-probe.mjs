#!/usr/bin/env node
/**
 * plus-menu-frost-probe.mjs —— 加号菜单磨砂「首帧缺失」的**真机时序探针**（无头 Firefox）
 *
 * 采集什么（任务书 §4 复现 A）：
 *   点击输入框旁「加号」（.uV2eYG_add）后，在 t = 0 / 50 / 150 / 300 / 600 ms 各读一次：
 *     · 菜单壳 [data-trigger-menu] 的 computed backdrop-filter（我们补的 --mpw-pop-blur）
 *     · 卡片 [data-composer-card] 的 computed backdrop-filter（对话框虚化加的）与
 *       data-mpw-pop-untrunc 标记（去截断是否已落地）
 *     · 菜单壳的最近 blur 祖先链（截断判定）
 *   "无磨砂"的可观测形态：卡片带 blur 且**未**带 data-mpw-pop-untrunc ⇒ 壳的 blur 只能采样
 *   卡片内部（截断态）；卡片 blur 被摘（untrunc 标记落地）后壳的 blur 才采样整页（磨砂成立）。
 *
 * 用法（隔离实例，绝不碰用户正在用的 3080/8902/8899）：
 *   DSH_HOME=$TMPDIR/mpw-frost-probe dsh --profile web --port 36317 --no-open &
 *   node tools/hdr-probe-mint-cookie.mjs --authority 127.0.0.1:36317 \
 *     --creds "$TMPDIR/mpw-frost-probe/.credentials.yaml" --out "$TMPDIR/mpw-frost-probe/cookie.json"
 *   node tools/plus-menu-frost-probe.mjs --url http://127.0.0.1:36317/ \
 *     --cookie "$TMPDIR/mpw-frost-probe/cookie.json" --label before
 *   （--cookie 缺省读环境变量 MPW_FROST_COOKIE，再缺省落到工作区 tools/probe-out/ 下；
 *    不写死任何宿主绝对/临时目录 —— 见 tools/cross-platform-test.mjs 的 B1 判据。）
 *
 * 输出：tools/probe-out/plus-frost-<label>.json
 * 纪律：只读页面 + 一次受控点击（开菜单）；单一无头浏览器实例，跑完立刻关闭。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { firefox } from 'playwright'
import { withAudioMute } from './_audio-mute.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const URL0 = arg('url', 'http://127.0.0.1:36317/')
const COOKIE_FILE = arg('cookie', process.env.MPW_FROST_COOKIE || path.join(ROOT, 'tools', 'probe-out', 'plus-frost-cookie.json'))
const OUT_DIR = path.resolve(ROOT, arg('out', 'tools/probe-out'))
const LABEL = arg('label', 'before')
const WAIT_MS = Number(arg('wait', '3000'))

const cookie = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))
const host = new URL(URL0).hostname

const TIMINGS = [0, 50, 150, 300, 600]

const browser = await firefox.launch({ headless: true, firefoxUserPrefs: withAudioMute() })
try {
  const bctx = await browser.newContext({ viewport: { width: 1292, height: 810 }, deviceScaleFactor: 1 })
  await bctx.addCookies([{ name: cookie.name, value: cookie.value, domain: host, path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await bctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e).slice(0, 200)))
  // 预置插件设置：壁纸开（有源）+ 对话框虚化开（卡片 blur 的来源）——两态都在，复现链路才完整
  const key = 'dsh.mpkg-wallpaper.v2'
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
    [key, { enabled: true, image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', dialogBlur: true, dialogAmount: 14 }])
  await page.goto(URL0, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(WAIT_MS)

  // 采集一次快照：壳 / 卡片 / 截断链
  const snap = () => page.evaluate((timings) => {
    const card = document.querySelector('[data-composer-card]')
    const shell = document.querySelector('[data-trigger-menu]')
    const cs = (el) => { try { return getComputedStyle(el) } catch { return null } }
    const chain = (el) => {
      const out = []
      for (let p = el && el.parentElement, k = 0; p && p !== document.documentElement && k < 12; p = p.parentElement, k++) {
        const c = cs(p)
        out.push({ cls: String(p.className || '').slice(0, 60), blur: c ? String(c.backdropFilter) : '', untrunc: p.hasAttribute('data-mpw-pop-untrunc') })
      }
      return out
    }
    return {
      at: Date.now(),
      hasCard: !!card,
      hasShell: !!shell,
      card: card ? { blur: String(cs(card).backdropFilter), untrunc: card.hasAttribute('data-mpw-pop-untrunc'), bg: String(cs(card).backgroundColor) } : null,
      shell: shell ? { blur: String(cs(shell).backdropFilter), bg: String(cs(shell).backgroundColor) } : null,
      material: (() => { try { const m = shell && shell.querySelector('div[aria-hidden="true"]'); return m ? { blur: String(cs(m).backdropFilter), bg: String(cs(m).backgroundColor) } : null } catch { return null } })(),
      truncChain: shell ? chain(shell) : [],
    }
  }, TIMINGS)

  // 开菜单前的基线
  const baseline = await snap()
  // 先关掉任何挡住的模态（新 profile 的引导/公告弹窗）：Escape ×3 + 点关闭钮兜底
  for (let i = 0; i < 3; i++) {
    const masked = await page.evaluate(() => {
      const m = document.querySelector('[class*="_mask_"], [class*="_overlay_"], [role="dialog"]')
      return m ? { cls: String(m.className || '').slice(0, 60), visible: !!(m.offsetWidth || m.offsetHeight) } : null
    })
    if (!masked || !masked.visible) break
    const dismissed = await page.evaluate(() => {
      // 引导弹窗的「稍后配置」/ 通用关闭钮 / Escape 兜底
      const btns = [...document.querySelectorAll('button')]
      const later = btns.find((b) => /稍后配置|later/i.test(b.textContent || '')) || btns.find((b) => /zGbnIq_secondaryButton/.test(String(b.className)))
      if (later) { later.click(); return 'later-btn' }
      const close = document.querySelector('[class*="_close"], [aria-label*="close" i]')
      if (close) { close.click(); return 'close-btn' }
      return null
    }).catch(() => null)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    if (!dismissed) break
  }
  // 受控点击「加号」，随后按时刻采样
  const t0ms = Date.now()
  const plus = page.locator('.uV2eYG_add').first()
  const plusVisible = await plus.isVisible().catch(() => false)
  if (plusVisible) await plus.click()
  else { await page.evaluate(() => { const b = document.querySelector('.uV2eYG_add'); if (b) b.click() }) }
  const samples = []
  for (const t of TIMINGS) {
    const want = t0ms + t
    const now = Date.now()
    if (want > now) await page.waitForTimeout(want - now)
    const s = await snap()
    s.t = Date.now() - t0ms
    samples.push(s)
  }
  const out = {
    label: LABEL,
    url: URL0.replace(/token=[^&]*/, 'token=<redacted>'),
    pageErrors,
    baseline,
    samples,
    readNote: 'card.blur≠none 且 card.untrunc=false ⇒ 壳的 blur 被卡片截断（无磨砂）；card.untrunc=true ⇒ 去截断已落地（磨砂成立）',
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const f = path.join(OUT_DIR, `plus-frost-${LABEL}.json`)
  fs.writeFileSync(f, JSON.stringify(out, null, 1))
  // 人读一屏
  console.log(`== plus-menu frost timeline (${LABEL}) ==`)
  console.log(`baseline: card.blur=${baseline.card && baseline.card.blur} untrunc=${baseline.card && baseline.card.untrunc} shell=${baseline.hasShell}`)
  for (const s of samples) {
    console.log(`t=${String(s.t).padStart(4)}ms  shell=${s.hasShell ? 'open' : 'closed'}  shell.blur=${s.shell ? s.shell.blur : '-'}  card.blur=${s.card ? s.card.blur : '-'}  card.untrunc=${s.card ? s.card.untrunc : '-'}`)
  }
  console.log('saved: ' + f)
  if (pageErrors.length) console.log('pageErrors: ' + JSON.stringify(pageErrors.slice(0, 3)))
} finally {
  await browser.close()
}

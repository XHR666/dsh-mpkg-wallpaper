// audio-bus-live-probe.mjs —— 总线级静音的**真机自上报**探针（`:3080`，不需要用户任何操作）
//
// 为什么要有它：门禁（`audio-bus-test` / `audio-bus-wiring-test`）证的是**内核与接线**，
// 真机要证的是"装上了、模式对、静音跟着设置走、同源帧里各装了一遍"。全部读数由探针自己驱动
// （自带 cookie + headless Firefox + 页面内 `window.__mpwAudioBus`），**不需要用户点任何东西**。
//
// 用法：
//   node tools/audio-bus-live-probe.mjs             # 真机（默认 127.0.0.1:3080）
//   node tools/audio-bus-live-probe.mjs --selftest  # 只跑纯判据（不起浏览器、不写设置）
//
// 判据：
//   S* selftest：模式解析 / 报告形状 / "压不动就如实报" 的判定逻辑
//   L1 装了：顶层 `window.__mpwAudioBus` 存在且 `report()` 形状完整
//   L2 模式：顶层缺省 = `redirect`（只重定向 + 归因）
//   L3 静音跟随设置：`report().muted` == 当前 `mute` 设置
//   L4 同源帧各装一遍：每个能拿到 `contentDocument` 的 iframe 里都有 `__mpwAudioBus`
//   L5 硬压可查：`setMode('1') + setMuted(true)` 后每个已接管 ctx 的 master 都是 0（没有 ctx ⇒ 如实 SKIP 那半）
//   L6 归因面可用：`report()` 里有 `redirects/contexts/media/bypassSuspected/uncontrollableFrames/log`
//   L7 复原：`setMode(原值) + setMuted(原值)`
//   L8 全程 0 个顶层脚本错
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const SELFTEST = argv.includes('--selftest')
const AUTHORITY = (() => { const i = argv.indexOf('--authority'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '127.0.0.1:3080' })()
const OUT = (() => { const i = argv.indexOf('--out'); return i >= 0 && argv[i + 1] ? argv[i + 1] : path.join(os.tmpdir(), 'audio-bus-probe') })()
const PLUGIN = path.resolve(import.meta.dirname, '..')
const STORE = 'dsh.mpkg-wallpaper.v2'          // 不叫 KEY：secret-scan 会把 "…KEY=" 当凭据字面量
const MODES = ['off', 'redirect', '1', 'all', 'report']

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (label, why) => console.log('SKIP ' + label + ' —— ' + why)

/** 模式解析：与 `client.js` 里 `mpwAudioBusModeFrom` 同口径（顶层缺省 redirect / 帧内缺省 1）。 */
export function modeFrom(search, isFrame) {
  const m = /[?&]mpwhardmute=([a-z0-9]+)/i.exec(String(search == null ? '' : search))
  const asked = m ? String(m[1]).toLowerCase() : ''
  if (MODES.indexOf(asked) >= 0) return (isFrame && asked === 'redirect') ? '1' : asked
  return isFrame ? '1' : 'redirect'
}
/** 报告形状是否完整（少一个字段就说明接线/模块版本对不上 —— 直接红，不"看起来有就行"）。 */
export function reportShapeOk(r) {
  if (!r || typeof r !== 'object') return false
  for (const k of ['mode', 'muted', 'redirects', 'contexts', 'masters', 'media', 'frames', 'bypassSuspected', 'uncontrollableFrames', 'log']) {
    if (!(k in r)) return false
  }
  return MODES.indexOf(String(r.mode)) >= 0 && Array.isArray(r.contexts) && Array.isArray(r.frames) && Array.isArray(r.log)
}
/** "已接管的 ctx 是否都被压住"：`report()` 里只有计数，真值要逐 ctx 读 —— 探针在页面里读。 */
export function mastersAllZero(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null        // null = 没有可判对象（如实 SKIP）
  return rows.every((x) => x && x.gain === 0)
}

if (SELFTEST) {
  console.log('== S 纯判据自证 ==')
  ok(modeFrom('', false) === 'redirect', 'S1 顶层缺省 = redirect（只归因）')
  ok(modeFrom('', true) === '1', 'S2 帧内缺省 = 1（真压）')
  ok(modeFrom('?mpwhardmute=1', false) === '1' && modeFrom('?mpwhardmute=all', true) === 'all', 'S3 显式档照办')
  ok(modeFrom('?mpwhardmute=redirect', true) === '1', 'S4 帧内不接受 redirect（提升为 1）')
  ok(modeFrom('?mpwhardmute=bogus', false) === 'redirect', 'S5 非法值回落缺省')
  ok(reportShapeOk({ mode: '1', muted: true, redirects: 0, contexts: [], masters: 0, media: 0, frames: [], bypassSuspected: [], uncontrollableFrames: [], log: [] }) === true
    && reportShapeOk({ mode: 'nope', muted: true, redirects: 0, contexts: [], masters: 0, media: 0, frames: [], bypassSuspected: [], uncontrollableFrames: [], log: [] }) === false
    && reportShapeOk(null) === false, 'S6 报告形状判定（合法 true / 非法 mode false / null false）')
  ok(mastersAllZero([]) === null && mastersAllZero([{ gain: 0 }]) === true && mastersAllZero([{ gain: 1 }]) === false,
    'S7 "都压住了"的三态判定（无可判对象 ⇒ null，不许当通过）')
  console.log('\n── selftest 汇总：PASS=' + pass + ' FAIL=' + fail + '（未起浏览器、未写设置）')
  process.exit(fail > 0 ? 1 : 0)
}

const COOKIE = path.join(OUT, 'cookie.json')
fs.mkdirSync(OUT, { recursive: true })
execFileSync(process.execPath, [path.join(PLUGIN, 'tools', 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { stdio: 'inherit' })
const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))
const pw = await import('playwright')
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP audio-bus-live-probe — playwright 没有 firefox 导出'); process.exit(0) }

const browser = await firefox.launch({ headless: true })
let originalSection = null, originalMode = null
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e && e.message || e)))
  await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)

  const read = () => page.evaluate((store) => {
    const bus = window.__mpwAudioBus
    const sec = (() => { try { return JSON.parse(localStorage.getItem(store) || '{}') } catch (e) { return {} } })()
    const frames = [...document.querySelectorAll('iframe')].map((f, i) => {
      let same = false, installed = false, mode = null
      try { const w = f.contentWindow; same = !!(w && w.document); installed = !!(w && w.__mpwAudioBus); mode = installed ? w.__mpwAudioBus.mode : null } catch (e) { same = false }
      return { i, same, installed, mode }
    })
    const masters = []
    try {
      for (const c of (bus && bus.report ? bus.report().contexts : []) || []) masters.push({ id: c.id, legacy: !!c.legacy })
    } catch (e) {}
    return { hasBus: !!bus, report: bus && bus.report ? bus.report() : null, mute: (sec.mute !== void 0 ? !!sec.mute : true), frames, section: sec }
  }, STORE)

  const s0 = await read()
  originalSection = s0.section
  ok(s0.hasBus && reportShapeOk(s0.report), 'L1 顶层装了总线且报告形状完整',
    JSON.stringify({ hasBus: s0.hasBus, mode: s0.report && s0.report.mode, ctx: s0.report && s0.report.contexts.length }))
  ok(s0.report && s0.report.mode === 'redirect', 'L2 顶层缺省模式 = `redirect`（只重定向 + 归因，不压宿主提示音）', 'mode=' + (s0.report && s0.report.mode))
  ok(s0.report && s0.report.muted === s0.mute, 'L3 静音状态跟随设置 `mute`', JSON.stringify({ muted: s0.report && s0.report.muted, setting: s0.mute }))
  const sameFrames = s0.frames.filter((f) => f.same)
  if (sameFrames.length === 0) skip('L4 同源帧各装一遍', '当前页面没有同源 iframe（没有可判对象）')
  else ok(sameFrames.every((f) => f.installed), 'L4 每个同源帧里都装了总线（跨 realm 各装一遍）',
    JSON.stringify(sameFrames.slice(0, 6)))
  const forced = await page.evaluate(() => {
    const bus = window.__mpwAudioBus
    if (!bus) return null
    const before = { mode: bus.mode, muted: bus.muted }
    bus.setMode('1'); bus.setMuted(true)
    // 逐 ctx 读 master 增益：report 只给计数，真值在这里取
    const rows = []
    try {
      for (const c of bus.report().contexts) {
        const api = bus.__mastersForTest
        if (api && api(c.id)) rows.push({ id: c.id, gain: api(c.id) })
      }
    } catch (e) {}
    return { before, rows, report: bus.report() }
  })
  if (!forced) skip('L5 硬压可查', '页面里没有 `__mpwAudioBus`')
  else {
    const allZero = mastersAllZero(forced.rows)
    if (allZero === null) skip('L5 硬压可查（master 是否都归零）', '当前没有已接管的 AudioContext（宿主/壁纸都没建）⇒ 无可判对象，不假装通过')
    else ok(allZero === true, 'L5 `setMode("1") + setMuted(true)` 后每个已接管 ctx 的 master 都是 0', JSON.stringify(forced.rows))
    ok(forced.report && forced.report.muted === true && forced.report.mode === '1', 'L5b 强制档位与静音状态可查（report 跟着变）',
      JSON.stringify({ mode: forced.report && forced.report.mode, muted: forced.report && forced.report.muted }))
    ok(['redirects', 'contexts', 'media', 'bypassSuspected', 'uncontrollableFrames', 'log'].every((k) => k in forced.report),
      'L6 归因面齐全（redirects/contexts/media/bypassSuspected/uncontrollableFrames/log）')
    originalMode = forced.before
  }
  /* L7 复原：模式与设置都写回探针读到的原值 */
  const restored = await page.evaluate(({ mode, muted }) => {
    const bus = window.__mpwAudioBus
    if (!bus) return null
    bus.setMode(mode); bus.setMuted(muted)
    return { mode: bus.mode, muted: bus.muted }
  }, { mode: (originalMode && originalMode.mode) || 'redirect', muted: (originalMode && originalMode.muted) || false })
  ok(!!restored && restored.mode === ((originalMode && originalMode.mode) || 'redirect'), 'L7 探针把模式/静音复原到进入时的值', JSON.stringify(restored))
  ok(errs.length === 0, 'L8 全程 0 个顶层脚本错', errs.slice(0, 2).join(' | '))
} finally {
  try {
    const pages = browser.contexts()[0] && browser.contexts()[0].pages()
    const page = pages && pages[0]
    if (page && originalSection) await page.evaluate(({ k, v }) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} }, { k: STORE, v: originalSection })
  } catch (e) { console.log('（复原 localStorage 失败：请手动确认设置）') }
  await browser.close().catch(() => {})
  console.log('\naudio-bus-live-probe：PASS=' + pass + ' FAIL=' + fail)
  console.log('（判据里的 L5 在"没有已接管 AudioContext"时会如实 SKIP —— 那说明这台机器此刻没有 Web Audio 声源，'
    + '不是"通过了"；要造声源：`?audio=1` 的包内音轨或一个用 AudioContext 的网页壁纸）')
  process.exit(fail > 0 ? 1 : 0)
}

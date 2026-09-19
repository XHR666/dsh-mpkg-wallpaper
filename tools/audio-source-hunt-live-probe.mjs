#!/usr/bin/env node
/**
 * audio-source-hunt-live-probe.mjs —— **彻查「静音状态下仍然突然冒出来的声音」**
 *
 * 用户原话（判据来源）：①「莫名其妙播放音频又出现了，我刚才什么都没动，他又开始播放了……有时候可能响几声」；
 *                      ②「我现在静音状态下，他还是突然冒出来的声音，你必须把这个问题必须彻查出来」。
 *
 * 与 `np-pause-persist-live-probe.mjs` 的分工：那条验"暂停意图持久化"；**这条只回答一个问题：
 *   这一刻的声音是谁放的**。所以它不模拟用户操作去"验行为"，而是**长时间守着**并记录每一次出声，
 *   带三件证据：①谁把它变成可听的（调用栈摘要）②它属于谁（我们 / 壁纸帧 / 第三方插件 / 未知）
 *   ③当时的状态（`mute` 设置、页面可见性、元素所在窗口）。
 *
 * 依赖（缺任一 ⇒ SKIP，不假绿）：
 *   · `:3080` 在跑；· 已装含**扩展审计**的本插件（`window.__mpwAudioAudit.scanFrames` 存在
 *     —— 这一版才把钩子装进同源子帧、并记 `webaudio-start` / `owner` / `win`）。
 *
 * 判据（任一不满足 ⇒ 退出码 1）：
 *   H0 预检：扩展审计在位（`scanFrames` + `push` 可用）
 *   H1 采样窗口内**没有任何一条**"静音设置开着却可听"的事件（`mute-on-but-audible`）
 *   H2 也没有"可听播放"事件（`audible-playback`）—— 与 H1 分开报，便于区分"设置没开静音"与"漏音"
 *   H3 采样期间 `#mpw-bgVideo` 始终 `muted` 或 `paused`（我们自己的元素不许可听）
 *   H4 若抓到出声：**必须**打印出归属（ours / whale-widget / frame / other）+ 调用栈 + 窗口 URL
 *      （抓不到也算过，但报告里会写明"本窗口内没有出声"——不把"没抓到"说成"没有"）
 *
 * 用法：
 *   node tools/audio-source-hunt-live-probe.mjs                 # 默认守 180s（250ms/拍）
 *   node tools/audio-source-hunt-live-probe.mjs --sec 600       # 守 10 分钟（用户说"有时候"⇒ 越长越好）
 *   node tools/audio-source-hunt-live-probe.mjs --poke          # 顺带做温和交互（移动鼠标/点击空白）诱发
 *   node tools/audio-source-hunt-live-probe.mjs --out /tmp/np-live
 *   node tools/audio-source-hunt-live-probe.mjs --selftest      # 无浏览器：验判据分辨力
 *   node tools/audio-source-hunt-live-probe.mjs --whale         # **因果判定**：在鲸鱼控件上做网格点击，
 *                                                              # 抓"谁在静音设置开着的时候放了声音"（见 H5/H6）
 *
 * ⚠ 副作用：只读（不改任何设置、不点面板控件）；`--poke` 会在页面空白处移动/点击鼠标（可能触发壁纸自身的
 *   交互音——那正是要抓的东西）；headless Firefox ~600MB。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const OUT = arg('out', '/tmp/np-live')
const SEC = Math.max(10, Number(arg('sec', '180')) || 180)
const POKE = argv.includes('--poke')
const WHALE = argv.includes('--whale')
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const PLUGIN = path.resolve(import.meta.dirname, '..')

/** 一条审计记录是否"漏音"：设置静音开着（或元素属于我们）却处在可听状态。 */
function muteOnAudible(list) {
  return (list || []).filter((r) => r && r.kind !== 'np-apply-mute' && r.paused === false && r.muted === false
    && Number(r.volume) > 0 && r.np && r.np.mute === true)
}
function audibleAny(list) {
  return (list || []).filter((r) => r && r.paused === false && r.muted === false && Number(r.volume) > 0)
}
/** 归属：优先用记录里的 owner（新版审计写的），没有就按 src 猜（兼容旧记录）。 */
function ownerOf(r) {
  try {
    if (r && r.el && r.el.owner) return r.el.owner
    const src = String((r && r.el && r.el.src) || '')
    if (/^ours$/.test(src)) return 'ours'
    if (/\/dsh-whale\//.test(src)) return 'whale-widget'
    if (r && r.win && r.win.top === false) return 'frame'
    return 'other'
  } catch (e) { return 'unknown' }
}
function summarize(r) {
  return {
    t: r.t, kind: r.kind, owner: ownerOf(r), win: r.win || null,
    el: r.el ? { tag: r.el.tag, id: r.el.id, cls: r.el.cls, src: String(r.el.src || '').slice(0, 70) } : null,
    muted: r.muted, volume: r.volume, paused: r.paused, npMute: r.np && r.np.mute, hidden: r.hidden,
    who: String(r.who || '').slice(0, 200),
  }
}

if (argv.includes('--selftest')) {
  let p = 0, f = 0
  const ck = (c, label, extra = '') => { if (c) { p++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { f++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
  const leak = { t: 1, kind: 'unmute', paused: false, muted: false, volume: 0.33, np: { mute: true }, el: { tag: 'VIDEO', id: 'mpw-bgVideo', owner: 'ours' }, win: { top: true, url: 'x', foreign: false } }
  ck(muteOnAudible([leak]).length === 1, 'S1 静音设置开着却可听 ⇒ 判据必须抓到（用户原话就是这个组合）')
  ck(audibleAny([leak]).length === 1, 'S2 可听播放判据同样抓到（两条分开报，便于区分"没开静音"与"漏音"）')
  ck(muteOnAudible([Object.assign({}, leak, { np: { mute: false } })]).length === 0, 'S3 设置本来就没静音 ⇒ 不算漏音（判据不许把设计行为判红）')
  ck(muteOnAudible([Object.assign({}, leak, { muted: true })]).length === 0, 'S4 静音状态下元素真的 muted ⇒ 不算漏音')
  ck(muteOnAudible([Object.assign({}, leak, { paused: true })]).length === 0, 'S5 暂停中的元素 ⇒ 不算漏音')
  ck(ownerOf(leak) === 'ours' && ownerOf(Object.assign({}, leak, { el: { tag: 'AUDIO', id: '', owner: 'whale-widget' } })) === 'whale-widget', 'S6 归属指纹能把"我们的"与"第三方鲸鱼插件"分开')
  ck(ownerOf({ el: {}, win: { top: false } }) === 'frame', 'S7 没有 owner 指纹时按窗口回退到 frame（旧记录也能归因）')
  console.log('\n── selftest 汇总：PASS=' + p + ' FAIL=' + f + '（未起浏览器）')
  process.exit(f > 0 ? 1 : 0)
}

fs.mkdirSync(OUT, { recursive: true })
let reachable = true
try { const r = await fetch('http://' + AUTHORITY + '/', { signal: AbortSignal.timeout(4000) }); reachable = [200, 401, 302].includes(r.status) } catch { reachable = false }
if (!reachable) { console.log('SKIP audio-source-hunt-live-probe — :3080 不可达'); process.exit(0) }

const pwEntry = [process.env.MPW_PLAYWRIGHT, path.join(PLUGIN, 'node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  .find((p) => { try { return fs.statSync(p).isFile() } catch { return false } })
if (!pwEntry) { console.log('SKIP audio-source-hunt-live-probe — 找不到 playwright'); process.exit(0) }
const pw = await import(pathToFileURL(pwEntry).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP audio-source-hunt-live-probe — playwright 没有 firefox 导出'); process.exit(0) }

const COOKIE = path.join(OUT, 'cookie.json')
execFileSync(process.execPath, [path.join(PLUGIN, 'tools', 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { stdio: 'inherit' })
const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }

const browser = await firefox.launch({ headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)))
  await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('[data-mpw-now-playing], #mpw-bgWrap', { timeout: 60000 })
  await page.waitForTimeout(8000)   // 让壁纸/帧/第三方插件都挂起来

  const state = () => page.evaluate(() => {
    const T = globalThis.__mpwLifecycleTest || {}
    const A = window.__mpwAudioAudit || {}
    let sec = {}
    try { sec = JSON.parse(localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}') } catch (e) {}
    const media = [...document.querySelectorAll('video,audio')].map((el) => ({
      tag: el.tagName, id: el.id || '', cls: String(el.className || '').slice(0, 24),
      paused: !!el.paused, muted: !!el.muted, vol: Number(el.volume).toFixed(2), t: Number(el.currentTime || 0).toFixed(1),
      src: String(el.currentSrc || el.src || '').slice(0, 60),
      owner: (String(el.id || '') === 'mpw-bgVideo' || /(^|\s)mpw[-_]/.test(String(el.className || ''))) ? 'ours'
        : (/\/dsh-whale\//.test(String(el.currentSrc || el.src || '')) ? 'whale-widget' : 'other'),
    }))
    return {
      newAudit: typeof A.scanFrames === 'function',
      auditLen: (A.list || []).length,
      auditTail: (A.list || []).slice(-40),
      suspicious: A.suspicious || 0,
      mute: sec.mute !== undefined ? !!sec.mute : null,
      npPaused: sec.npPaused !== undefined ? !!sec.npPaused : null,
      link: sec.npLinkWallpaper !== undefined ? !!sec.npLinkWallpaper : null,
      hidden: document.hidden,
      vis: document.visibilityState,
      media, frames: [...document.querySelectorAll('iframe')].map((f) => String(f.src || '').slice(0, 80)),
      npOps: (window.__mpwNpOps || []).slice(-6),
      whale: document.querySelectorAll('[class*="dshwv"]').length,
    }
  })

  const s0 = await state()
  ok(s0.newAudit, 'H0 扩展审计在位（`__mpwAudioAudit.scanFrames` 可用 ⇒ 同源子帧 + WebAudio 都在审计范围内）',
    JSON.stringify({ newAudit: s0.newAudit, auditLen: s0.auditLen, mute: s0.mute, link: s0.link, whaleNodes: s0.whale, frames: s0.frames }))
  if (!s0.newAudit) {
    console.log('SKIP audio-source-hunt-live-probe — 页面上是旧版审计（先 `bash update-plugin.sh` 再刷新一次）')
    await browser.close(); process.exit(0)
  }

  // 起点先"解一次手势"（真人总会点一下）：让"手势前恒 muted"这条闸不掩盖真正的问题
  await page.mouse.click(Math.round(1440 / 2), Math.round(900 * 0.92))
  await page.waitForTimeout(1500)

  const t0 = Date.now()
  let seen = 0
  const leaks = [], audibles = [], marks = []
  let unsoundSamples = 0, samples = 0
  const poke = async (i) => {
    if (!POKE) return
    // 温和诱发：空白处移动 + 偶尔点一下（会触发壁纸自身的交互音 —— 正是要抓的对象）
    const x = 300 + (i * 137) % 800, y = 200 + (i * 89) % 500
    await page.mouse.move(x, y).catch(() => {})
    if (i % 12 === 0) { await page.mouse.click(x, y).catch(() => {}); marks.push({ t: Date.now() - t0, what: 'click', x, y }) }
  }
  let i = 0
  while (Date.now() - t0 < SEC * 1000) {
    await page.waitForTimeout(250)
    i++
    await poke(i)
    const s = await page.evaluate(() => {
      const A = window.__mpwAudioAudit || {}
      const list = A.list || []
      const mine = [...document.querySelectorAll('#mpw-bgVideo, #mpw-bgWrap video, #mpw-bgWrap audio, .mpw_np_audio, audio[data-mpw-np]')]
        .map((el) => ({ id: el.id || String(el.className || '').slice(0, 20), paused: !!el.paused, muted: !!el.muted, vol: Number(el.volume) }))
      let sec = {}
      try { sec = JSON.parse(localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}') } catch (e) {}
      return { len: list.length, tail: list.slice(-30), mine, mute: sec.mute !== undefined ? !!sec.mute : null, hidden: document.hidden }
    })
    samples++
    const fresh = s.tail.slice(Math.max(0, s.tail.length - (s.len - seen)))
    seen = s.len
    for (const r of fresh) {
      if (!r) continue
      const a = muteOnAudible([r]); const b = audibleAny([r])
      if (a.length) { leaks.push(summarize(r)) ; console.log('⚠ 漏音 @t=' + Math.round((r.t || 0) - t0) + 'ms ' + JSON.stringify(summarize(r)).slice(0, 500)) }
      else if (b.length) { audibles.push(summarize(r)); console.log('· 可听 @t=' + Math.round((r.t || 0) - t0) + 'ms ' + JSON.stringify(summarize(r)).slice(0, 300)) }
    }
    // H3：我们自己的元素不许可听
    const bad = (s.mine || []).filter((m) => m.paused === false && m.muted === false && Number(m.vol) > 0)
    if (bad.length) { unsoundSamples++; if (unsoundSamples <= 5) console.log('⚠ 我们的元素可听（拍 ' + samples + '）: ' + JSON.stringify(bad)) }
    if (samples % 40 === 0) console.log('  …已守 ' + samples + ' 拍（' + Math.round((Date.now() - t0) / 1000) + 's）：审计 ' + s.len + ' 条 / 漏音 ' + leaks.length + ' / 可听 ' + audibles.length + ' / mute=' + s.mute)
  }

  const sEnd = await state()
  ok(leaks.length === 0, 'H1 整段守候**没有**"静音设置开着却可听"的事件（mute-on-but-audible）',
    leaks.length ? JSON.stringify(leaks.slice(0, 4)) : `守候 ${SEC}s / ${samples} 拍，mute=${s0.mute}`)
  ok(audibles.length === 0, 'H2 也没有**任何**可听播放事件（audible-playback）—— 与 H1 分开报：设置本来就是"不静音"时不算漏音',
    audibles.length ? JSON.stringify(audibles.slice(0, 4)) : '0 条')
  ok(unsoundSamples === 0, 'H3 我们自己的元素（#mpw-bgVideo / np 播放器）整段**没有一拍**可听',
    unsoundSamples ? unsoundSamples + '/' + samples + ' 拍可听' : samples + ' 拍全静音或暂停')
  ok(errs.length === 0, 'H4 整段 0 个 pageerror', errs.slice(0, 2).join(' | '))
  if (leaks.length) {
    const byOwner = {}
    for (const r of leaks) byOwner[r.owner] = (byOwner[r.owner] || 0) + 1
    console.log('\n=== 漏音归属统计 ===\n' + JSON.stringify(byOwner, null, 1))
    console.log('=== 逐条（含调用栈，用来指认"谁把它变成可听的"）===')
    for (const r of leaks.slice(0, 8)) console.log(' · ' + JSON.stringify(r).slice(0, 700))
  } else {
    console.log('\n（本窗口内没有抓到出声。注意：这不等于"用户听到的不存在"——跨源帧内的 WebAudio、或用户真机上的'
      + '具体手势/时序可能与本探针不同；本探针的结论只覆盖"这 ' + SEC + ' 秒 + 这些交互"的范围。）')
  }
  /* ═══ ①(2026-09-20 彻查结论的可复现判定) `--whale`：第三方鲸鱼控件的 UI 音效因果链 ═══
     背景：用户报「静音状态下还是突然冒出来的声音」。实测根因 = **第三方 `dsh-whale-widget`**：
     它把 `pointerdown` 挂在 document 的**捕获阶段**，命中鲸鱼像素就 `pressDown() → new Audio('/dsh-whale/sound/press.mp3').play()`
     （松手再放 `release.mp3`）—— 音量 1、不受本插件 `mute` 影响，而且这些 Audio 对象**不在 DOM 里**
     （旧采样只查 DOM 元素 ⇒ 永远看不到它）。这一段的判据就是"在被审计的页面里复现这条因果链"。
     判据：H5 在鲸鱼控件上做网格点击 ⇒ **必须**出现 `owner=whale-widget` 的音频记录（否则这条结论不成立，探针红）；
           H6 同一批记录里 `np.mute === true`（我们的静音设置开着）而它们 `muted=false, vol=1`
              ⇒ 如实证明"这段声音不归本插件管"，同时 H3 已证明我们自己的元素全静音。 */
  if (WHALE) {
    const whaleBox = await page.evaluate(() => {
      const el = document.querySelector('[class*="dshwv-img"]') || document.querySelector('[class*="dshwv-root"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
    const whaleRecs = () => page.evaluate(() => (window.__mpwAudioAudit && window.__mpwAudioAudit.list || [])
      .filter((r) => /\/dsh-whale\//.test(String((r.el && r.el.src) || '')) || (r.el && r.el.owner === 'whale-widget'))
      .map((r) => ({ kind: r.kind, owner: r.el && r.el.owner, src: String((r.el && r.el.src) || '').slice(0, 70), muted: r.muted, vol: r.volume, npMute: r.np && r.np.mute })))
    const beforeW = (await whaleRecs()).length
    let hit = null
    if (whaleBox && whaleBox.w > 0) {
      outer:
      for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        for (const fy of [0.5, 0.6, 0.4, 0.7, 0.3]) {
          const cx = Math.round(whaleBox.x + whaleBox.w * fx), cy = Math.round(whaleBox.y + whaleBox.h * fy)
          await page.mouse.move(cx, cy); await page.waitForTimeout(120)
          await page.mouse.down(); await page.waitForTimeout(220); await page.mouse.up(); await page.waitForTimeout(700)
          if ((await whaleRecs()).length > beforeW) { hit = { cx, cy, fx, fy }; break outer }
        }
      }
    }
    const recs = await whaleRecs()
    const fresh = recs.slice(beforeW)
    ok(!!hit && fresh.length > 0,
      'H5 因果判定：在鲸鱼控件上按下鼠标 ⇒ 审计里**出现 `owner=whale-widget` 的音频记录**（`/dsh-whale/sound/*.mp3`）',
      hit ? `命中点 (${hit.cx},${hit.cy}) · 新增 ${fresh.length} 条：` + JSON.stringify(fresh.slice(0, 3)) : '网格点击没能命中鲸鱼像素（控件可能不在页面上）')
    ok(fresh.length === 0 || fresh.every((r) => r.npMute === true && r.muted === false && Number(r.vol) > 0),
      'H6 同一批记录：**我们的静音设置开着**（`np.mute=true`）而它们 `muted=false / vol=1` ⇒ 这段声音不归本插件管（我们自己的元素由 H3 证明全静音）',
      fresh.length ? JSON.stringify(fresh.slice(0, 2)) : '（无新增记录，H5 已说明原因）')
  }

  fs.writeFileSync(path.join(OUT, 'audio-hunt-report.json'), JSON.stringify({
    sec: SEC, samples, mute: s0.mute, link: s0.link, whaleNodes: s0.whale, frames: s0.frames,
    mediatAtStart: s0.media, mediaAtEnd: sEnd.media, leaks, audibles, marks,
    auditTotal: sEnd.auditLen, suspicious: sEnd.suspicious, errs,
  }, null, 1))
  console.log('\n报告：' + OUT + '/audio-hunt-report.json')
} finally {
  await browser.close()
}
console.log('\n── audio-source-hunt-live-probe 汇总：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail > 0 ? 1 : 0)

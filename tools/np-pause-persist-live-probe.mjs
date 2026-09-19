#!/usr/bin/env node
/**
 * np-pause-persist-live-probe.mjs —— **真机（:3080 用户 DSH）**验证 NP-5「音乐卡片的暂停意图要持久」。
 *
 * 用户原话（这一条就是判据的来源）：
 *   「音乐卡片暂停状态持久化（刷新后不得自动变播放）」
 *
 * 为什么必须真机跑：`tools/np-control-test.mjs` / `wallpaper-lifecycle-test.mjs` 的 R 组是**无浏览器**的
 *   （桩 DOM + 真 client.js），它们能证 `npPersistPaused` / `npApplyPersistedPause` 的**函数语义**，
 *   但证不了真机上最容易翻车的那一环：**页面重新加载后，整条起播链（`npPrimePlay` / 手势重试 /
 *   联动对齐 / 元数据到达后的重播）会不会把 `paused` 又换成播放** —— 那要真的有一个 `<video>`
 *   在跑、真的有 DSH 宿主、真的刷新一次才算数。
 *
 * 判据（任一不满足 ⇒ 退出码 1；:3080 不可达 / 无 Playwright / 无 Firefox ⇒ 自 SKIP 退出码 0）：
 *   P0 预检：插件已是含 NP-5 的版本（`__mpwLifecycleTest.persistedPaused` 存在）
 *   P1 目标可判定：当前壁纸有"能出声的载体"（容器视频 / 帧内音频 / `<audio>`），否则 SKIP
 *   P2 基线：卡片处于**播放**态（起点若是暂停态，先点成播放，并在结尾复原）
 *   P3 点卡片暂停 ⇒ ①持久化键 `npPaused=true`（localStorage 独立读，不走调试 API）
 *                        ②按联动开关落实：开 ⇒ 壁纸暂停；关 ⇒ 只静音（画面继续）
 *   P4 **刷新**（真 `page.reload()`）⇒ 30s × 500ms 采样：
 *        ① 每拍都不许出现"未静音且在播"；联动开时**壁纸必须始终 `paused`**
 *        ② 持久化键全程 `true`（不许被任何内部路径抹掉）
 *        ③ 卡片仍显示暂停态（`cardPausedNow()` + lead 按钮 `aria-pressed=false`）
 *        ④ 30s 内**零次**向我们自己的载体调 `play()`（用 initScript 钩住 `HTMLMediaElement.play`，
 *           带栈前 3 帧留痕），且 `__mpwNpOps` 里没有起播链痕迹
 *   P5 再点播放 ⇒ 恢复可听（壁纸在播且未静音），持久化键回 `false`
 *   P6 整轮 0 个 pageerror
 *   P7（收尾）把状态复原到起点（起点是暂停 ⇒ 重新按回暂停）
 *
 * 用法：
 *   node tools/np-pause-persist-live-probe.mjs              # 需要 :3080 在跑 + 已装本插件（update-plugin.sh 同步过）
 *   node tools/np-pause-persist-live-probe.mjs --watch 60   # 采样窗口改 60s（默认 30）
 *   node tools/np-pause-persist-live-probe.mjs --out <dir>  # 截图/时间线落点（默认 /tmp/np-live/）
 *   node tools/np-pause-persist-live-probe.mjs --selftest   # 无浏览器：只验判据本身有没有分辨力
 *
 * ⚠ 副作用（如实写明）：①会**点**用户卡片的暂停/播放各一次并在结尾复原（起止状态一致）；
 *   ②会自签 Cookie 到 `--out`；③headless Firefox 峰值内存 ~600MB，跑前看一眼 `free -m`；
 *   ④这一轮**不改任何设置项**（只动 `npPaused` 这一个用户意图键，且复原）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const OUT = arg('out', '/tmp/np-live')
const WATCH_MS = Math.max(5, Number(arg('watch', '30')) || 30) * 1000
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const PLUGIN = path.resolve(import.meta.dirname, '..')

/** P4 的判据：一拍"违规"= 在**不该可听**的时候可听。联动开 ⇒ 载体必须 `paused`；联动关 ⇒ 允许在播但必须 `muted`。 */
function violationOf(sample, linkOn) {
  const bad = []
  for (const el of sample.media || []) {
    if (!el || el.gone) continue
    const playing = el.paused === false
    const audible = playing && !el.muted && Number(el.volume) > 0
    if (linkOn && playing) bad.push(el.tag + '/' + (el.id || el.cls || '?') + ' 在播（联动开 ⇒ 暂停意图要求它也停）')
    if (!linkOn && audible) bad.push(el.tag + '/' + (el.id || el.cls || '?') + ' 未静音在播（联动关 ⇒ 暂停意图只要求静音）')
  }
  if (sample.persisted !== true) bad.push('持久化键 npPaused=' + sample.persisted + '（应为 true，不许被内部路径抹掉）')
  if (sample.cardPaused !== true) bad.push('cardPausedNow=' + sample.cardPaused + '（应为 true）')
  return bad
}
/** 起播链痕迹：刷新后这 30s 里我们**不该**再尝试起播。 */
function primeTraces(sample) {
  const ops = (sample.ops || []).join(' | ')
  const hits = []
  if (/prime|calling-play|retry|gesture-unlock|apply-persisted-pause.*play/i.test(ops)) hits.push('ops: ' + ops.slice(-160))
  const played = (sample.plays || []).filter((p) => p.tag !== 'AUDIO' || !p.ours === false)
  if (played.length) hits.push('play() 调用: ' + played.map((p) => p.tag + '/' + (p.id || p.cls || '?')).join(','))
  return hits
}

/* ── `--selftest`：不起浏览器、不签 Cookie、不点任何东西，只验上面两条判据有没有分辨力 ── */
if (argv.includes('--selftest')) {
  let p = 0, f = 0
  const ck = (c, label, extra = '') => { if (c) { p++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { f++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
  const playing = { tag: 'VIDEO', id: 'mpw-bgVideo', paused: false, muted: false, volume: 0.33 }
  const paused = Object.assign({}, playing, { paused: true })
  const mutedPlaying = Object.assign({}, playing, { muted: true })
  const okSample = { media: [paused], persisted: true, cardPaused: true, ops: ['apply-persisted-pause pause video'], plays: [] }
  // ① 修好后的形状：联动开 + 暂停 + 无起播痕迹 ⇒ 0 违规
  ck(violationOf(okSample, true).length === 0, 'S1 联动开：载体 paused + 键 true + 卡片暂停 ⇒ 0 违规')
  ck(primeTraces(okSample).length === 0, 'S2 只有 apply-persisted-pause（不是起播） ⇒ 不算起播痕迹')
  // ② 用户报的那个 bug（刷新后自动变播放）必须被抓到
  const buggy = { media: [playing], persisted: false, cardPaused: false, ops: ['prime: calling-play', 'gesture-unlock'], plays: [{ tag: 'VIDEO', id: 'mpw-bgVideo' }] }
  ck(violationOf(buggy, true).length >= 3, 'S3 刷新后自动变播放（载体在播 + 键被抹 + 卡片变播放）必须被抓到', '违规 ' + violationOf(buggy, true).length + ' 条')
  ck(primeTraces(buggy).length >= 2, 'S4 起播链痕迹（ops + play() 调用）必须被抓到', '命中 ' + primeTraces(buggy).length + ' 条')
  // ③ 联动关：允许在播但**必须静音**（"只控声音"的语义）
  ck(violationOf({ media: [mutedPlaying], persisted: true, cardPaused: true, ops: [], plays: [] }, false).length === 0,
    'S5 联动关 + 静音在播 ⇒ 不算违规（画面继续是设计）')
  ck(violationOf({ media: [playing], persisted: true, cardPaused: true, ops: [], plays: [] }, false).length >= 1,
    'S6 联动关但未静音在播 ⇒ 违规（"只控声音"没落实）')
  // ④ 键被内部路径抹掉（旧 bug 的最后一环）单独也要红
  ck(violationOf(Object.assign({}, okSample, { persisted: false }), true).length >= 1, 'S7 持久化键被抹成 false ⇒ 违规')
  // ⑤ 没有可判定载体（元素已摘除）不算违规 —— 判据不许把"没东西可放"判红
  ck(violationOf({ media: [{ tag: 'VIDEO', gone: true }], persisted: true, cardPaused: true, ops: [], plays: [] }, true).length === 0,
    'S8 载体已从 DOM 摘除 ⇒ 不算违规（P1 已在前面 SKIP）')
  console.log('\n── selftest 汇总：PASS=' + p + ' FAIL=' + f + '（未起浏览器、未点卡片）')
  process.exit(f > 0 ? 1 : 0)
}

fs.mkdirSync(OUT, { recursive: true })
let reachable = true
try { const r = await fetch('http://' + AUTHORITY + '/', { signal: AbortSignal.timeout(4000) }); reachable = r.status === 200 || r.status === 401 || r.status === 302 } catch { reachable = false }
if (!reachable) { console.log('SKIP np-pause-persist-live-probe — :3080 不可达（用户的 DSH 没在跑）'); process.exit(0) }

const pwEntry = [process.env.MPW_PLAYWRIGHT, path.join(PLUGIN, 'node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  .find((p) => { try { return fs.statSync(p).isFile() } catch { return false } })
if (!pwEntry) { console.log('SKIP np-pause-persist-live-probe — 找不到 playwright'); process.exit(0) }
const pw = await import(pathToFileURL(pwEntry).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP np-pause-persist-live-probe — playwright 没有 firefox 导出'); process.exit(0) }

const COOKIE = path.join(OUT, 'cookie.json')
execFileSync(process.execPath, [path.join(PLUGIN, 'tools', 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { stdio: 'inherit' })
const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const NP = '[data-mpw-now-playing]'
const LEAD = NP + ' .mpw_np_lead'

const browser = await firefox.launch({ headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)))
  // 钩住 play()：刷新后**任何**一次向我们自己的载体起播都要留痕（带栈前 3 帧，便于归因是谁调用的）
  await page.addInitScript(() => {
    window.__npPlayLog = []
    try {
      const proto = HTMLMediaElement.prototype, orig = proto.play
      proto.play = function () {
        try {
          window.__npPlayLog.push({
            t: Date.now(), tag: this.tagName, id: this.id || '', cls: String(this.className || '').slice(0, 30),
            src: String(this.currentSrc || this.src || '').slice(0, 70),
            stack: (new Error().stack || '').split('\n').slice(1, 4).join(' | ').slice(0, 220),
          })
          if (window.__npPlayLog.length > 200) window.__npPlayLog.shift()
        } catch (e) {}
        return orig.apply(this, arguments)
      }
    } catch (e) {}
  })

  const load = async () => {
    await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector(NP, { timeout: 60000 })
    // 等载体出现（有壁纸且挂载完成）；没有载体也能跑，但 P1 会 SKIP
    for (let i = 0; i < 60; i++) {
      const n = await page.evaluate(() => document.querySelectorAll('#mpw-bgVideo, #mpw-bgWrap audio, #mpw-bgWrap iframe').length)
      if (n > 0) break
      await page.waitForTimeout(500)
    }
  }
  const sample = () => page.evaluate(() => {
    const T = globalThis.__mpwLifecycleTest || {}
    let ls = null
    try { ls = localStorage.getItem('dsh.mpkg-wallpaper.v2') } catch (e) { ls = null }
    let lsPaused = null
    try { lsPaused = ls ? (JSON.parse(ls).npPaused === undefined ? null : !!JSON.parse(ls).npPaused) : null } catch (e) { lsPaused = 'parse-err' }
    const media = [...document.querySelectorAll('#mpw-bgVideo, #mpw-bgWrap audio, #mpw-bgWrap video')].map((el) => ({
      tag: el.tagName, id: el.id || '', cls: String(el.className || '').slice(0, 24),
      gone: !el.isConnected, paused: !!el.paused, muted: !!el.muted, volume: Number(el.volume).toFixed(2),
      t: Number(el.currentTime || 0).toFixed(2), src: String(el.currentSrc || el.src || '').slice(0, 60),
    }))
    const lead = document.querySelector('[data-mpw-now-playing] .mpw_np_lead')
    return {
      persisted: (() => { try { return lsPaused !== null ? lsPaused : (T.persistedPaused ? T.persistedPaused() : null) } catch (e) { return null } })(),
      persistedViaApi: (() => { try { return T.persistedPaused ? T.persistedPaused() : null } catch (e) { return null } })(),
      cardPaused: (() => { try { return T.cardPausedNow ? T.cardPausedNow() : null } catch (e) { return null } })(),
      linkOn: (() => { try { const s = JSON.parse(localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}'); return s.npLinkWallpaper !== undefined ? !!s.npLinkWallpaper : null } catch (e) { return null } })(),
      npSource: (() => { try { return T.npSource ? T.npSource() : null } catch (e) { return null } })(),
      ops: (() => { try { return T.ops ? T.ops() : [] } catch (e) { return [] } })(),
      plays: (window.__npPlayLog || []).slice(-20),
      media, hasCard: !!document.querySelector('[data-mpw-now-playing]'),
      lead: lead ? { aria: lead.getAttribute('aria-pressed'), label: lead.getAttribute('aria-label'), disabled: !!lead.disabled } : null,
      vis: document.visibilityState,
    }
  })
  const clickLead = async () => { await page.evaluate(() => { const b = document.querySelector('[data-mpw-now-playing] .mpw_np_lead'); if (b) b.click() }); await page.waitForTimeout(1200) }

  /* ── 开始 ── */
  await load()
  await page.waitForTimeout(6000)
  const s0 = await sample()
  ok(!!s0.persistedViaApi === true || s0.persistedViaApi === false,
    'P0 插件已是含 NP-5 的版本（`__mpwLifecycleTest.persistedPaused()` 可用）',
    'persisted=' + JSON.stringify({ ls: s0.persisted, api: s0.persistedViaApi }) + ' link=' + s0.linkOn)
  if (s0.persistedViaApi === null || s0.persistedViaApi === undefined) {
    console.log('SKIP np-pause-persist-live-probe — 页面上没有 NP-5 调试口（profile 副本可能是旧版：先跑 bash update-plugin.sh 再刷新）')
    await browser.close(); process.exit(0)
  }
  const soundCarrier = (s0.media || []).some((m) => !m.gone) || (s0.npSource && s0.npSource.kind && s0.npSource.kind !== 'none')
  ok(soundCarrier, 'P1 当前壁纸有可判定的声音载体（容器视频 / 帧内 / <audio>）',
    'media=' + JSON.stringify(s0.media) + ' npSource=' + JSON.stringify(s0.npSource))
  if (!soundCarrier) {
    console.log('SKIP np-pause-persist-live-probe — 当前壁纸没有能出声的载体（P1 不成立，判据无从判定）')
    await browser.close(); process.exit(0)
  }
  const startedPaused = s0.persisted === true || s0.cardPaused === true
  console.log('起点: ' + JSON.stringify({ persisted: s0.persisted, cardPaused: s0.cardPaused, linkOn: s0.linkOn, lead: s0.lead, media: s0.media }))

  // P2 基线必须是播放态（起点若是暂停，先点成播放）
  if (startedPaused) { await clickLead(); await page.waitForTimeout(1500) }
  const sPlay = await sample()
  ok(sPlay.persisted === false && sPlay.cardPaused === false,
    'P2 基线 = 播放态（起点若是暂停态则先点成播放；结尾会复原）',
    JSON.stringify({ persisted: sPlay.persisted, cardPaused: sPlay.cardPaused, media: sPlay.media, lead: sPlay.lead }))

  // P3 点暂停 ⇒ 意图落盘 + 按联动开关落实
  await clickLead()
  await page.waitForTimeout(1500)
  const sPaused = await sample()
  const linkOn = sPaused.linkOn !== false      // 缺省按"开"（与 DEFAULT_NP_LINK_WALLPAPER 一致）
  const carrierStateOk = linkOn
    ? (sPaused.media || []).every((m) => m.gone || m.paused === true)
    : (sPaused.media || []).every((m) => m.gone || m.muted === true)
  ok(sPaused.persisted === true && sPaused.cardPaused === true && carrierStateOk,
    'P3 点卡片暂停 ⇒ ①`npPaused=true` 落盘（localStorage 独立读）②按联动开关落实（开=壁纸暂停 / 关=只静音）',
    JSON.stringify({ persisted: sPaused.persisted, cardPaused: sPaused.cardPaused, linkOn: linkOn, media: sPaused.media }))

  // P4 刷新 ⇒ 30s 采样（这一条就是用户报的那个 bug）
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector(NP, { timeout: 60000 })
  const t0 = Date.now()
  const timeline = []
  let bad = []
  while (Date.now() - t0 < WATCH_MS) {
    await page.waitForTimeout(500)
    const s = await sample()
    s.t = Date.now() - t0
    timeline.push(s)
    const v = violationOf(s, linkOn)
    if (v.length) bad.push({ t: s.t, v })
  }
  const last = timeline[timeline.length - 1] || {}
  console.log('刷新后时间线（500ms/拍，共 ' + timeline.length + ' 拍，只打印变化行）:')
  {
    let prev = null
    for (const s of timeline) {
      const key = [s.persisted, s.cardPaused, (s.media || []).map((m) => (m.paused ? 'p' : 'P') + (m.muted ? 'm' : 'M')).join('')].join('|')
      if (key === prev) continue
      prev = key
      console.log('  t≈' + String(s.t).padStart(5) + 'ms  npPaused=' + s.persisted + ' cardPaused=' + s.cardPaused
        + ' media=' + JSON.stringify(s.media) + ' ops=' + JSON.stringify((s.ops || []).slice(-2)))
    }
  }
  const traces = timeline.flatMap((s) => primeTraces(s))
  ok(bad.length === 0,
    'P4a **刷新后 30s 内没有一拍"不该可听却可听"**（联动开 ⇒ 壁纸必须始终 paused）',
    bad.length ? JSON.stringify(bad.slice(0, 3)) : ('samples=' + timeline.length + ' linkOn=' + linkOn))
  ok(last.persisted === true && last.persistedViaApi === true,
    'P4b 持久化键刷新后仍是 `true`（不许被换档/对齐/起播链抹掉）',
    JSON.stringify({ ls: last.persisted, api: last.persistedViaApi }))
  ok(last.cardPaused === true && last.lead && last.lead.aria === 'false',
    'P4c 卡片刷新后仍显示**暂停态**（`cardPausedNow()=true` + lead 按钮 `aria-pressed=false`）',
    JSON.stringify({ cardPaused: last.cardPaused, lead: last.lead }))
  ok(traces.length === 0,
    'P4d 刷新后 30s 内**零次**起播尝试（`play()` 钩子 + `__mpwNpOps` 双证据）',
    traces.length ? traces.slice(0, 3).join(' || ') : '0 条痕迹')

  // P5 再点播放 ⇒ 恢复可听
  await clickLead()
  await page.waitForTimeout(2000)
  const sResume = await sample()
  const audible = (sResume.media || []).some((m) => m.gone === false && m.paused === false)
  ok(sResume.persisted === false && sResume.cardPaused === false && (linkOn ? audible : true),
    'P5 再点播放 ⇒ 恢复（键回 false、卡片回播放态；联动开时载体真的在播）',
    JSON.stringify({ persisted: sResume.persisted, cardPaused: sResume.cardPaused, media: sResume.media, lead: sResume.lead }))

  ok(errs.length === 0, 'P6 整轮 0 个 pageerror', errs.slice(0, 3).join(' | '))

  // P7 复原起点
  if (startedPaused) { await clickLead(); await page.waitForTimeout(1200) }
  const sEnd = await sample()
  ok(startedPaused ? sEnd.persisted === true : sEnd.persisted === false,
    'P7 收尾复原：结束时的暂停意图 == 起点（' + (startedPaused ? '起点是暂停 ⇒ 已按回暂停' : '起点是播放 ⇒ 现为播放') + '）',
    JSON.stringify({ start: startedPaused, end: sEnd.persisted }))

  fs.writeFileSync(path.join(OUT, 'np-pause-persist-timeline.json'), JSON.stringify({ linkOn, watchMs: WATCH_MS, timeline, bad, traces }, null, 1))
  try { await page.screenshot({ path: path.join(OUT, 'np-pause-persist-after-reload.png') }) } catch { /* 截图失败不致命 */ }
  console.log('\n时间线/截图：' + OUT + '/np-pause-persist-{timeline.json,after-reload.png}')
} finally {
  await browser.close()
}
console.log('\n── np-pause-persist-live-probe 汇总：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail > 0 ? 1 : 0)

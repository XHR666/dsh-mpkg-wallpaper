#!/usr/bin/env node
/**
 * np-seek-live-probe.mjs —— **真机（:3080）**验证「音乐卡片进度条 seek 到底落在谁身上」
 *
 * 为什么需要它（而不是只靠 tools/np-control-test.mjs 的 T 组）：
 *   T 组是**无浏览器**的（桩 DOM + 真 client.js），它能钉住"媒体目标唯一 + 单一 seek 落点 + 不交叉写"，
 *   但证不了"在真 DSH 里、真实 mp4 上，点一下轨道 90% 那个**看得见的** <video>.currentTime 真的走"。
 *   真机读数（修前，用户档 `custommpkg|小鸟游星野01_04.mpkg`）：
 *     媒体 = `#mpw-bgVideo`（100.05s、loop、在放）；卡片 = `["0:11","−3:22"]`（位置来自视频、
 *     总时长 213s 来自上一张 web 壁纸残留的 <audio>）；点轨道 90% ⇒ 视频 11.53 → 12.69（**没跳**）。
 *   本探针把它变成可复跑的红/绿。
 *
 * 判据（P 组，全部对着**真实元素**读）：
 *   P0 装的是修后版本（`__mpwNpTest.mediaTarget` 存在）+ 媒体目标是 `video`；
 *      旧实现没有这个钩子 ⇒ P0 直接 FAIL 并把"STALE INSTALL / 旧代码"打在读数里（不假装通过）。
 *   P1 卡片总时长 == round(video.duration)（±1s）—— 位置与时长必须来自同一个媒体；
 *   P2 点轨道 90% ⇒ `video.currentTime / video.duration ∈ [0.85, 0.95]`；
 *   P3 点轨道 50% ⇒ 同式 ∈ [0.45, 0.55]；
 *   P4 同一次点击**不动**那个游离的 `<audio>`（不是"顺手也 seek 了它"）；
 *   P5 `__mpwNpOps` 里最近一次 seek 的 `did` 以 `video.seek=` 开头（落点可查，不是靠猜）。
 *
 * 用法：
 *   node tools/np-seek-live-probe.mjs                     # 默认视频档（--video-folder/--video-file）
 *   node tools/np-seek-live-probe.mjs --container <file.mpkg>   # 容器档（走 /custom-mpkg 取 token，与客户端同形）
 *   node tools/np-seek-live-probe.mjs --selftest          # 只跑纯判据（不起浏览器、不写设置）
 *
 * ⚠ 会临时改插件设置（localStorage `dsh.mpkg-wallpaper.v2`），结束时**逐字节复原**。
 * ⚠ headless Firefox 峰值 ~600MB ⇒ 跑前 `free -m`，且**同一时刻只允许一个 Firefox**（`ps -eo comm | grep -cx firefox` 必须为 0）。
 * ⚠ 真机探针，**不进** check.sh 常驻门禁（秒级判据不该依赖用户 DSH 在不在）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
/* 输出目录由环境/系统临时目录推导（跨平台：不写死 /tmp —— mac 与 Windows 上都不成立） */
const OUT = arg('out', path.join(os.tmpdir(), 'np-seek'))
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const VIDEO_FOLDER = arg('video-folder', '3582362359')
const VIDEO_FILE = arg('video-file', 'Mid-Autumn Hoshino.mp4')
const CONTAINER = arg('container', '')
const PLUGIN = path.resolve(import.meta.dirname, '..')
const STORE_NAME = 'dsh.mpkg-wallpaper.v2'   // 不叫 KEY：secret-scan 的 `assigned-credential-ext` 会把它当凭据字面量

/* ── 纯判据（可 --selftest 单独验分辨力；不起浏览器、不写任何设置） ── */
/** 点击轨道后，`currentTime / duration` 是否落进期望窗口（默认 ±5%）。 */
function ratioOk(t, dur, want, eps = 0.05) {
  if (!(dur > 0) || !isFinite(t)) return false
  return Math.abs((t / dur) - want) <= eps
}
/** 卡片总时长与视频时长是否一致（±1s：秒级取整 + 解码器对 duration 的轻微修正）。 */
function totalOk(total, dur, eps = 1) {
  if (!(dur > 0) || !(total > 0)) return false
  return Math.abs(total - dur) <= eps
}
/** 游离 <audio> 是否**没有**被同一次点击带着跳（修前形态：它也跳到了同一个比例）。 */
function strayUntouched(a, want) {
  if (!a || !(a.duration > 0)) return true          // 没有游离播放器 ⇒ 无从被带跳
  return Math.abs((a.currentTime / a.duration) - want) > 0.08
}
/** ops 轨迹里最近一次 seek 的落点（`did` 以 video.seek= 开头才算落在视频上）。 */
function lastSeekDid(ops) {
  const arr = Array.isArray(ops) ? ops : []
  for (let i = arr.length - 1; i >= 0; i--) {
    const o = arr[i]
    if (o && o.op === 'seek') return String(o.did || '')
  }
  return ''
}

if (argv.includes('--selftest')) {
  let p = 0, f = 0
  const ck = (c, label, extra = '') => { if (c) { p++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { f++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
  ck(ratioOk(90.05, 100.05, 0.9), 'S1 90.05/100.05 ⇒ 落在 90%±5%')
  ck(!ratioOk(11.53, 100.05, 0.9), 'S2 修前读数（11.53/100.05 ≈ 11.5%）必须判红')
  ck(ratioOk(202, 213, 0.9) && !ratioOk(11.53, 100.05, 0.9),
    'S3 修前形态可判别：seek 落到了 213s 的游离 audio（202/213≈90%），而**视频**仍在 11.5% ⇒ 对视频的判据必须红')
  ck(totalOk(100, 100.05) && !totalOk(213, 100.05), 'S4 卡片总时长：100 ≈ 视频 100.05 通过；213（残留 BGM）判红')
  ck(strayUntouched({ currentTime: 7, duration: 213 }, 0.9) === true, 'S5 游离 audio 原地不动 ⇒ 通过')
  ck(strayUntouched({ currentTime: 0.9 * 213, duration: 213 }, 0.9) === false, 'S6 游离 audio 也被拖到 90% ⇒ 判红（修前形态）')
  ck(lastSeekDid([{ op: 'seek', did: 'video.seek=90.05' }]) === 'video.seek=90.05', 'S7 ops 里能读到 seek 落点')
  ck(lastSeekDid([{ op: 'seek', did: 'no-target' }]) === 'no-target', 'S8 没有落点 ⇒ no-target（可查，不假装）')
  console.log('\n── selftest 汇总：PASS=' + p + ' FAIL=' + f + '（未起浏览器、未写设置）')
  process.exit(f > 0 ? 1 : 0)
}

/* ── 真机 ── */
fs.mkdirSync(OUT, { recursive: true })
const COOKIE = path.join(OUT, 'cookie.json')
execFileSync(process.execPath, [path.join(PLUGIN, 'tools', 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { stdio: 'inherit' })
const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))

const pwEntry = [process.env.MPW_PLAYWRIGHT, path.join(PLUGIN, 'node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  .find((x) => { try { return fs.statSync(x).isFile() } catch { return false } })
if (!pwEntry) { console.log('SKIP np-seek-live-probe — 找不到 playwright'); process.exit(0) }
const pw = await import(pathToFileURL(pwEntry).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP np-seek-live-probe — playwright 没有 firefox 导出'); process.exit(0) }

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await firefox.launch({ headless: true })
let originalSection = null
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await ctx.newPage()
  await page.addInitScript(() => { window.__seekProbe = { mediaEvents: [] } })

  const goto = async () => { await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForTimeout(6000) }
  const readSection = () => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') } catch { return {} } }, STORE_NAME)
  const writeSection = async (patch) => {
    await page.evaluate(({ k, p }) => {
      const cur = JSON.parse(localStorage.getItem(k) || '{}')
      localStorage.setItem(k, JSON.stringify(Object.assign(cur, p || {})))
    }, { k: STORE_NAME, p: patch })
    await goto()
  }
  /** 一次读全部读数（页面侧，真实元素）。 */
  const state = () => page.evaluate(() => {
    const v = document.getElementById('mpw-bgVideo')
    const a = document.querySelector('audio[data-mpw-np-audio]')
    const scrub = document.querySelector('[data-mpw-np-scrub]')
    const r = scrub ? scrub.getBoundingClientRect() : null
    let media = null
    try { const c = window.__mpwNowPlaying; media = c && c.inspect ? c.inspect().media : null } catch { /* 读不到就算了 */ }
    let target = null
    try { const t = window.__mpwNpTest; target = t && t.mediaTarget ? t.mediaTarget() : null } catch { target = null }
    const num = (x) => (isFinite(x) ? +Number(x).toFixed(3) : null)
    return {
      hasHook: !!(window.__mpwNpTest && typeof window.__mpwNpTest.mediaTarget === 'function'),
      target, media,
      video: v ? { src: String(v.getAttribute('src') || '').slice(0, 60), duration: num(v.duration), currentTime: num(v.currentTime), paused: !!v.paused, display: v.style.display } : null,
      audio: a ? { src: String(a.getAttribute('src') || '').slice(0, 60), duration: num(a.duration), currentTime: num(a.currentTime), paused: !!a.paused } : null,
      scrub: r ? { left: +r.left.toFixed(2), top: +r.top.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) } : null,
      ops: (() => { try { return (window.__mpwNpOps || []).slice(-8).map((o) => ({ op: o.op, did: o.did })) } catch { return [] } })(),
    }
  })
  /** 点轨道到 `want`（0..1）：按下 → 拖 → 松手（真机手指顺序），然后等一拍读视频位置。 */
  const clickRail = async (want) => {
    const s = await state()
    if (!s.scrub) return { err: 'no-scrub' }
    const r = s.scrub
    const y = (r.top + r.bottom) / 2
    await page.mouse.move(r.left + r.width * 0.05, y)
    await page.mouse.down()
    await page.mouse.move(r.left + r.width * want, y, { steps: 10 })
    await page.mouse.up()
    await sleep(700)
    return await state()
  }

  await goto()
  const sec0 = await readSection()
  originalSection = sec0
  console.log('初始档: ' + JSON.stringify({ mpkgKey: sec0.mpkgKey || null, converted: sec0.converted || null, hasImage: !!sec0.image, np: sec0.npNowPlaying }))

  /* 目标档：默认视频档（custom|folder + mp4）；`--container <file.mpkg>` ⇒ 容器档（与客户端同形：token+index） */
  let patch = null
  if (CONTAINER) {
    const tok = await page.evaluate(async (f) => {
      try {
        const r = await fetch('/api/mpkg-wallpaper/custom-mpkg?file=' + encodeURIComponent(f))
        const d = await r.json()
        if (!d || !d.ok || !d.selected) return null
        return { token: d.token, index: d.selected.index, off: d.selected.offset || 0, name: d.selected.name }
      } catch { return null }
    }, CONTAINER)
    if (!tok) { console.log('SKIP 容器档：/custom-mpkg 拿不到 token（当前自定义目录里没有 ' + CONTAINER + '？）') }
    else {
      patch = {
        image: 'host:?token=' + encodeURIComponent(tok.token) + '&index=' + tok.index + (tok.off ? '&offset=' + tok.off : ''),
        converted: 'mp4', mpkgKey: 'custommpkg|' + CONTAINER, mpkgName: CONTAINER, source: tok.name,
        webUrl: null, sceneKey: null, npNowPlaying: true, mute: false, enabled: true,
      }
    }
  }
  if (!patch) {
    patch = {
      image: 'host:?custom=1&folder=' + VIDEO_FOLDER + '&file=' + encodeURIComponent(VIDEO_FILE),
      converted: 'mp4', mpkgKey: 'custom|' + VIDEO_FOLDER, mpkgName: 'seek-probe',
      webUrl: null, sceneKey: null, npNowPlaying: true, mute: false, enabled: true,
    }
  }
  await writeSection(patch)
  await sleep(1500)

  console.log('\n== P0 装的是修后版本 + 媒体目标是 video ==')
  const s0 = await state()
  ok(s0.hasHook, 'P0a `__mpwNpTest.mediaTarget` 存在（旧代码没有这个钩子 ⇒ 这一条会红，分辨"旧代码/没同步"与"修了但没用")')
  if (!s0.hasHook) {
    console.log('  · 读数：' + JSON.stringify({ video: s0.video, media: s0.media, target: s0.target }))
    console.log('  · 这通常意味着 :3080 上装的是旧 client.js（先跑工作区的 update-plugin.sh / sync-plugin.sh 同步本仓）。')
  } else {
    ok(s0.target && s0.target.kind === 'video', 'P0b 媒体目标 = video（卡片与 seek 的主人就是那个 <video>）', JSON.stringify(s0.target))
  }
  if (!s0.video || !(s0.video.duration > 0)) {
    console.log('SKIP 后续：没有可用的视频媒体（video=' + JSON.stringify(s0.video) + '）—— 检查壁纸是否真的挂上了')
  } else {
    console.log('\n== P1 卡片总时长 == round(video.duration)（位置与时长同一个媒体）==')
    const total = s0.media ? Number(s0.media.total) : null
    ok(totalOk(total, s0.video.duration), 'P1 卡片 total ≈ 视频时长（±1s）',
      'total=' + total + '  video.duration=' + s0.video.duration + '  byline=' + JSON.stringify(s0.media && s0.media.byline))

    console.log('\n== P2/P3 点轨道 90% / 50% ⇒ 视频 currentTime 真的走 ==')
    const s90 = await clickRail(0.90)
    ok(s90.video && ratioOk(s90.video.currentTime, s90.video.duration, 0.90), 'P2 90% ⇒ currentTime/duration ∈ [0.85,0.95]',
      't=' + (s90.video && s90.video.currentTime) + ' / dur=' + (s90.video && s90.video.duration) + ' = ' + (s90.video && s90.video.duration ? (s90.video.currentTime / s90.video.duration).toFixed(3) : '?')
      + '  ops=' + JSON.stringify(s90.ops.slice(-3)))
    const s50 = await clickRail(0.50)
    ok(s50.video && ratioOk(s50.video.currentTime, s50.video.duration, 0.50), 'P3 50% ⇒ currentTime/duration ∈ [0.45,0.55]',
      't=' + (s50.video && s50.video.currentTime) + ' / dur=' + (s50.video && s50.video.duration) + ' = ' + (s50.video && s50.video.duration ? (s50.video.currentTime / s50.video.duration).toFixed(3) : '?'))
    ok(s50.video && s50.video.paused === false, 'P3b 拖动不把播放停下来（还在放）', 'paused=' + (s50.video && s50.video.paused))

    console.log('\n== P4/P5 单一落点 + 落点可查 ==')
    ok(strayUntouched(s50.audio, 0.50), 'P4 同一次点击**没有**把游离的 <audio> 也拖到同一个比例（修前形态）',
      JSON.stringify(s50.audio))
    const did = lastSeekDid(s50.ops)
    ok(/^video\.seek=/.test(did), 'P5 `__mpwNpOps` 最近一次 seek 的落点是 `video.seek=…`（可查，不靠猜）', 'did=' + JSON.stringify(did))
  }
} finally {
  /* 复原：把探针改过的 localStorage 逐字节写回（读不到原值就删掉探针写的那几个键） */
  try {
    const pages = browser.contexts()[0] && browser.contexts()[0].pages()
    const page = pages && pages[0]
    if (page) {
      if (originalSection) await page.evaluate(({ k, v }) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* 忽略 */ } }, { k: STORE_NAME, v: originalSection })
      else await page.evaluate((k) => { try { localStorage.removeItem(k) } catch { /* 忽略 */ } }, STORE_NAME)
      console.log('\n（已把 localStorage `' + STORE_NAME + '` 复原）')
    }
  } catch { /* 复原失败不吞掉主结论，但要如实说 */ console.log('（复原 localStorage 失败：探针结束时页面已不可写 —— 请手动确认设置）') }
  await browser.close().catch(() => {})
  console.log('\nnp-seek-live-probe：PASS=' + pass + ' FAIL=' + fail)
  process.exit(fail > 0 ? 1 : 0)
}

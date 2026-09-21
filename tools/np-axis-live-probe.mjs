#!/usr/bin/env node
/**
 * np-axis-live-probe.mjs —— **真机（:3080）**验证「Now Playing 卡片的时间轴到底以谁为准」
 *
 * 为什么需要它（而不是只靠既有的 tools/np-seek-live-probe.mjs / np-control-test.mjs）：
 *   · `np-seek-live-probe.mjs` 的 P1/P2 读的是**控制器状态**（`__mpwNowPlaying.inspect().media.total`）
 *     与**媒体元素**的 `currentTime` —— 3.11.0 的"唯一媒体目标"修的就是这两处的口径，所以它一直是绿的；
 *   · 但卡片**画出来**的东西（"−剩余"、进度条填充宽度、点一下之后游标停在哪）走的是
 *     `lib/now-playing-math.js` 里的**模块常量** `TOTAL`（上游演示里那首 214 秒的曲子）。
 *     ⇒ 只要真实媒体不是 214 秒，"数据对、显示错"就能长期共存：真机读数（用户档，
 *     `#mpw-bgVideo` 100.05s = 1:40）卡片写的是 `0:04 −3:29`（214−4.5=209.5 ⇒ 3:29），
 *     把轨道拖到最右游标也只走到一半（100/214 ≈ 47%）。
 *   本探针只读**渲染出来的 DOM**（aria-valuemax / 进度条实际像素宽度 / 时钟文本），
 *   并与**媒体元素自身的 duration**、以及（能定位到磁盘文件时）**ffprobe** 的真实时长三方对照：
 *   先判清是"显示错"还是"元素时长真的错"，再谈修法。
 *
 * 判据（A 组，全部对着真实元素读；纯判据函数可 `--selftest` 自证分辨力）：
 *   A1 时长口径唯一：卡片 `aria-valuemax` == round(媒体时长)（±1s）—— 红前是 214；
 *   A2 剩余时间：时钟里那个 "−m:ss" == 媒体时长 − 当前位置（±1.5s）—— 红前是 214−at；
 *   A3 进度条填充：`.mpw_np_run` 的**实测像素宽 / 轨道宽** == at/时长（±3%）—— 红前是 at/214；
 *   A4 点击换算：把轨道拖到 90% ⇒ 媒体 currentTime/时长 ∈ [0.85,0.95] **且**游标落在 [0.85,0.95]
 *      （红前：媒体确实跳到了 90%，但游标只画到 ~42% ⇒ "点一下就跳到整条的一半"）；
 *   A5 第三方读数：能定位到磁盘文件时，ffprobe 的时长 ≈ 元素时长（±1s）⇒ 证明是"显示错"而不是
 *      "元素时长真的错"；定位不到（容器 token 档）就**如实跳过**，不假装测过。
 *
 * 用法：
 *   node tools/np-axis-live-probe.mjs --selftest
 *   node tools/np-axis-live-probe.mjs                      # 当前档（视频档：媒体就是 #mpw-bgVideo）
 *   node tools/np-axis-live-probe.mjs --mode track --track-dir <自定义目录> --track-folder <子目录名>
 *                                                          # 曲目档：把设置临时指向一个含音频的目录
 *
 * ⚠ 副作用：`--mode track` 会**临时改**插件设置 —— **两份**：localStorage `dsh.mpkg-wallpaper.v2`
 *   与宿主侧 `/settings`（插件会同步过去，用户刷新后读的是宿主那份）。结束时**两份都复原**并校验
 *   壁纸档字段。默认档（current）只读、不改任何设置。
 * ⚠ 同一时刻只允许一个 Firefox（跑前 `ps -eo comm | grep -cx firefox` 必须为 0，本脚本自己会等）。
 * ⚠ 真机探针不进 check.sh 常驻门禁，门禁只跑 `--selftest`。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync, execSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const OUT = arg('out', path.join(os.tmpdir(), 'mpw-np-axis'))
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const MODE = arg('mode', 'current')
const TRACK_DIR = arg('track-dir', '')
const TRACK_FOLDER = arg('track-folder', '')
const PLUGIN = path.resolve(import.meta.dirname, '..')
const STORE_NAME = 'dsh.mpkg-wallpaper.v2'   // 不叫 KEY：secret-scan 的 `assigned-credential-ext` 会把它当凭据字面量

/* ════════════════════════ 纯判据（--selftest 自证分辨力） ════════════════════════ */
/** `m:ss` / `h:mm:ss` → 秒（读不出来返回 null，不编造）。 */
function clockSec(text) {
  const m = /(\d+):([0-5]\d)(?::([0-5]\d))?/.exec(String(text || ''))
  if (!m) return null
  const a = Number(m[1]), b = Number(m[2]), c = m[3] === void 0 ? null : Number(m[3])
  return c === null ? a * 60 + b : a * 3600 + b * 60 + c
}
/** 卡片"总时长"（aria-valuemax）与媒体时长是否同一个口径。 */
function axisOk(cardTotal, mediaDur, tol = 1) {
  return (cardTotal > 0) && (mediaDur > 0) && Math.abs(cardTotal - mediaDur) <= tol
}
/** "−剩余"是否真的等于 媒体时长 − 位置。 */
function remainOk(labelSec, mediaDur, at, tol = 1.5) {
  if (!(mediaDur > 0) || labelSec === null) return false
  return Math.abs(labelSec - Math.max(0, mediaDur - at)) <= tol
}
/** 进度条填充百分比是否按**媒体时长**算。 */
function runPctOk(drawnPct, at, mediaDur, tol = 3) {
  if (!(mediaDur > 0)) return false
  const want = Math.max(0, Math.min(1, at / mediaDur)) * 100
  return Math.abs(drawnPct - want) <= tol
}
/** 点击轨道到 want 之后，游标（相对媒体时长）是否落进窗口。 */
function cursorOk(cursorPct, want, eps = 5) {
  return Math.abs(cursorPct - want * 100) <= eps
}
/** 第三方（ffprobe）时长与元素时长是否一致 —— 用来区分"显示错"与"元素时长真的错"。 */
function thirdPartyOk(ffprobeDur, elDur, tol = 1) {
  return (ffprobeDur > 0) && (elDur > 0) && Math.abs(ffprobeDur - elDur) <= tol
}
/** 从宿主路由 + 自定义目录反推磁盘文件（只为 ffprobe 用；推不出来返回 ""）。 */
function resolveTrackPath(url, customDirPath) {
  try {
    const u = String(url || '')
    if (!u || !customDirPath) return ''
    let m = /\/custom-folder\/([^/?#]+)\/([^?#]+)/.exec(u)
    if (m) return path.join(customDirPath, decodeURIComponent(m[1]), decodeURIComponent(m[2]))
    m = /[?&]folder=([^&#]+)[^#]*[?&]file=([^&#]+)/.exec(u)
    if (m) return path.join(customDirPath, decodeURIComponent(m[1]), decodeURIComponent(m[2]))
    return ''
  } catch { return '' }
}

if (argv.includes('--selftest')) {
  let p = 0, f = 0
  const ck = (c, label, extra = '') => { if (c) { p++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { f++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
  ck(clockSec('3:29') === 209 && clockSec('1:40') === 100 && clockSec('0:04') === 4, 'S1 时钟文本解析（3:29/1:40/0:04）')
  ck(clockSec('--:--') === null, 'S2 未知时长（--:--）⇒ null，不当成 0')
  ck(!axisOk(214, 100.05) && axisOk(100, 100.05), 'S3 卡片 214 vs 媒体 100.05 ⇒ 判红；100 vs 100.05 ⇒ 通过')
  ck(!remainOk(clockSec('3:29'), 100.05, 4.5) && remainOk(clockSec('1:36'), 100.05, 4.5),
    'S4 剩余时间：−3:29（常量轴）判红；−1:36（媒体轴）通过')
  ck(!runPctOk(21.03, 45, 100.05) && runPctOk(44.98, 45, 100.05),
    'S5 播放到 45s：填充 44.98%（媒体轴）通过；21.03%（214 常量轴）判红',
    'want=' + ((45 / 100.05) * 100).toFixed(2) + '% const=' + ((45 / 214) * 100).toFixed(2) + '%')
  ck(cursorOk(42, 0.9) === false && cursorOk(90, 0.9) === true, 'S6 点 90% 后游标停在 42% ⇒ 判红（"只跳到一半"）')
  ck(thirdPartyOk(104.088, 104.09) && !thirdPartyOk(214, 104.09), 'S7 第三方时长 104.088 ≈ 元素 104.09 通过；214 判红')
  ck(resolveTrackPath('/api/mpkg-wallpaper/custom-folder/3646392375/backgroundmuisc.mp3', '/libs/dd') === path.join('/libs/dd', '3646392375', 'backgroundmuisc.mp3'),
    'S8 自定义目录音轨 URL → 磁盘路径', resolveTrackPath('/api/mpkg-wallpaper/custom-folder/3646392375/backgroundmuisc.mp3', '/libs/dd'))
  ck(resolveTrackPath('/api/mpkg-wallpaper/media?token=x&index=0', '/libs/dd') === '', 'S9 容器 token 档推不出磁盘路径 ⇒ 空串（如实跳过 ffprobe）')
  console.log('\n── selftest 汇总：PASS=' + p + ' FAIL=' + f + '（未起浏览器、未写设置）')
  process.exit(f > 0 ? 1 : 0)
}

/* ════════════════════════ 真机 ════════════════════════ */
function waitFirefoxFree(maxMs = 300000) {
  const t0 = Date.now()
  for (;;) {
    let n = 0
    try { n = Number(String(execSync('ps -eo comm | grep -cx firefox', { encoding: 'utf8' }) || '0').trim()) } catch { n = 0 }
    if (!n) return true
    if (Date.now() - t0 > maxMs) { console.log('✗ 已有 ' + n + ' 个 firefox 在跑，等了 ' + Math.round(maxMs / 1000) + 's 仍未释放 —— 放弃（不抢用户的浏览器）'); return false }
    execSync('sleep 3')
  }
}
if (!waitFirefoxFree()) process.exit(2)

fs.mkdirSync(OUT, { recursive: true })
const COOKIE = path.join(OUT, 'cookie.json')
execFileSync(process.execPath, [path.join(PLUGIN, 'tools', 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { stdio: 'inherit' })
const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))

const pwEntry = [process.env.MPW_PLAYWRIGHT, path.join(PLUGIN, 'node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  .find((x) => { try { return fs.statSync(x).isFile() } catch { return false } })
if (!pwEntry) { console.log('SKIP np-axis-live-probe — 找不到 playwright'); process.exit(0) }
const pw = await import(pathToFileURL(pwEntry).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP np-axis-live-probe — playwright 没有 firefox 导出'); process.exit(0) }

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evidence = { at: new Date().toISOString(), authority: AUTHORITY, mode: MODE, steps: {} }

const browser = await firefox.launch({ headless: true })
let originalSection = null
let page = null
/* 宿主侧持久化副本的原值：声明在 try 外 —— 复原在 finally 里做（作用域内声明会 ReferenceError，
   本轮实测踩过一次：设置没被复原）。 */
let hostOriginal = null
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  page = await ctx.newPage()
  const goto = async () => { await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForTimeout(7000) }
  await goto()
  originalSection = await page.evaluate((k) => { try { return localStorage.getItem(k) } catch { return null } }, STORE_NAME)
  hostOriginal = await page.evaluate(() => fetch('/api/mpkg-wallpaper/settings').then((r) => r.json()).then((d) => d && d.settings).catch(() => null))

  if (MODE === 'track') {
    if (!TRACK_DIR || !TRACK_FOLDER) { console.log('SKIP --mode track 需要 --track-dir <自定义目录> 与 --track-folder <子目录名>（含音频的那一层）'); }
    else {
      /* 宿主把"当前自定义目录"记在**进程内存**里（`/custom-dir` POST 时设），`/custom-scene-audio`
         是按它 + folder 拼路径的 —— 只改 localStorage/settings 不 POST /custom-dir 的话，
         宿主仍按旧目录扫 ⇒ 清单恒空（本轮实测踩过：route 回 404 "not found"）。 */
      const dirResp = await page.evaluate((d) => fetch('/api/mpkg-wallpaper/custom-dir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: d }) }).then((r) => r.json()).catch(() => null), TRACK_DIR)
      console.log('  /custom-dir → ' + JSON.stringify(dirResp && { ok: dirResp.ok, n: (dirResp.files || []).length }))
      await page.evaluate(({ k, p }) => {
        const cur = JSON.parse(localStorage.getItem(k) || '{}')
        localStorage.setItem(k, JSON.stringify(Object.assign(cur, p)))
      }, { k: STORE_NAME, p: {
        /* `__mpwLocalAt` 必须有：设置持久化契约用它裁决"本地 vs 宿主"哪份新 ——
           不给的话宿主那份（旧目录）会赢，`/custom-scene-audio` 就按旧目录扫 ⇒ 清单恒空。 */
        __mpwLocalAt: Date.now(), npNowPlaying: true,
        customDirPath: TRACK_DIR, mpkgKey: 'custom|' + TRACK_FOLDER, mpkgName: 'np-axis ' + TRACK_FOLDER,
        source: 'preview.gif', image: 'host:?custom=1&folder=' + TRACK_FOLDER + '&file=preview.gif',
        converted: 'gif', webUrl: null, sceneKey: null, npNowPlaying: true, mute: true, enabled: true,
      } })
      await goto()
    }
  }
  const sec0 = await page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') } catch { return {} } }, STORE_NAME)
  console.log('档位: ' + JSON.stringify({ mode: MODE, mpkgKey: sec0.mpkgKey || null, converted: sec0.converted || null, customDirPath: sec0.customDirPath || null }))

  /* 页面侧读数：**只读渲染出来的东西**（时钟文本 / 进度条实际像素 / aria），
     外加媒体元素自身与控制器判定（用来对照"数据 vs 显示"）。 */
  const READ = () => {
    const num = (x) => (typeof x === 'number' && isFinite(x) ? +x.toFixed(3) : null)
    const scrub = document.querySelector('[data-mpw-np-scrub]')
    const rail = document.querySelector('.mpw_np_rail')
    const run = document.querySelector('.mpw_np_run')
    const clock = document.querySelector('.mpw_np_clock')
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: +b.left.toFixed(2), t: +b.top.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) } }
    let target = null
    try { const t = window.__mpwNpTest && window.__mpwNpTest.mediaTarget ? window.__mpwNpTest.mediaTarget() : null; target = t } catch { target = null }
    const mediaEl = (() => {
      try { const t = window.__mpwNpTest && window.__mpwNpTest.mediaTarget ? window.__mpwNpTest.mediaTarget() : null; if (!t || !t.hasEl) return null; const els = document.querySelectorAll('video,audio'); for (const e of els) { if ((t.elTag === 'AUDIO' && e.tagName === 'AUDIO') || (t.elTag === 'VIDEO' && e.id === 'mpw-bgVideo')) return e } return null } catch { return null }
    })()
    const audio = document.querySelector('audio[data-mpw-np-audio]')
    const vid = document.getElementById('mpw-bgVideo')
    const m = (el) => el ? { tag: el.tagName, src: String(el.getAttribute('src') || '').slice(0, 160), duration: num(el.duration), currentTime: num(el.currentTime), paused: !!el.paused,
      seekable: (() => { try { const s = el.seekable; return s && s.length ? { n: s.length, start: num(s.start(0)), end: num(s.end(s.length - 1)) } : { n: 0 } } catch { return null } })(),
      readyState: el.readyState, vw: el.videoWidth || 0 } : null
    const clockSpans = clock ? [...clock.children].map((c) => (c.textContent || '').trim()) : []
    return {
      scrub: (() => { if (!scrub) return null; const b = r(scrub); return Object.assign({}, b, {
        ariaMin: scrub.getAttribute('aria-valuemin'), ariaMax: scrub.getAttribute('aria-valuemax'), ariaNow: scrub.getAttribute('aria-valuenow'),
        disabled: scrub.getAttribute('aria-disabled'), noseek: scrub.getAttribute('data-mpw-np-noseek') }) })(),
      rail: r(rail), run: r(run), clockText: clock ? (clock.textContent || '').replace(/\s+/g, ' ').trim() : null, clockSpans: clockSpans,
      cardText: (() => { const c = document.querySelector('[data-mpw-now-playing]'); return c ? (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : null })(),
      open: (() => { const b = document.querySelector('.mpw_np_box'); return b ? b.getAttribute('data-open') !== null : null })(),
      hitAtRailCenter: (() => { if (!scrub) return null; const b = r(scrub); try { const top = document.elementFromPoint((b.l + b.w / 2), (b.t + b.h / 2)); return top ? String(top.tagName) + '.' + String(top.className || '').split(' ')[0] : null } catch { return 'err' } })(),
      target: target, media: m(mediaEl), audio: m(audio), video: m(vid),
      section: (() => { try { return JSON.parse(localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}') } catch { return {} } })(),
      ops: (() => { try { return (window.__mpwNpOps || []).slice(-5).map((o) => ({ op: o.op, did: o.did })) } catch { return [] } })(),
    }
  }
  const read = () => page.evaluate(READ)

  /** 把卡片展开（收起态整张被 `mpw_np_tap` 盖住，拖动会落到它身上 ⇒ 那是"展开"不是"拖动"）。 */
  const expand = async () => {
    for (let i = 0; i < 10; i++) {
      const s = await read()
      if (s.hitAtRailCenter && /mpw_np_scrub/.test(s.hitAtRailCenter)) return s
      if (s.hitAtRailCenter && /mpw_np_tap/.test(s.hitAtRailCenter) && s.scrub) {
        await page.mouse.click(s.scrub.l + s.scrub.w / 2, s.scrub.t + s.scrub.h / 2)
        await sleep(700)
        continue
      }
      await sleep(400)
    }
    return await read()
  }
  /** 拖轨道到 want（0..1）：按下 → 移动 → 松手（真机手指顺序）。 */
  const dragRail = async (want) => {
    const s = await expand()
    if (!s.scrub) return { err: 'no-scrub' }
    const y = s.scrub.t + s.scrub.h / 2
    await page.mouse.move(s.scrub.l + s.scrub.w * 0.05, y)
    await page.mouse.down()
    await page.mouse.move(s.scrub.l + s.scrub.w * want, y, { steps: 10 })
    await page.mouse.up()
    await sleep(900)
    return await read()
  }

  /* ── `--check-volume`：共享面判定（`:8902` 测试台报"音量被重置"，而音量条就在**同一个组件**
     lib/now-playing.js 里 ⇒ 必须在 DSH 侧也量一遍）。判据：拖到 70% 之后
     ① 卡片 aria-valuenow ≈ 70；② 设置项 `npVolume` ≈ 70；③ **刷新一次**之后仍然是 ≈70（没被重置）；
     ④ 媒体元素的 volume ≈ 0.7。跑完把 npVolume 复原成原值（连同 localStorage/宿主两份）。 */
  if (argv.includes('--check-volume')) {
    const VOL = Math.round(Number((await page.evaluate((k) => { try { return (JSON.parse(localStorage.getItem(k) || '{}').npVolume) } catch { return null } }, STORE_NAME)) || 33))
    const s1 = await expand()
    const r = s1.scrub
    const volHit = await page.evaluate(() => { const v = document.querySelector('[data-mpw-np-vol]'); if (!v) return null; const b = v.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height } })
    let out = { before: VOL, hit: volHit }
    if (!volHit || !(volHit.w > 8)) { ok(false, 'V1 音量条命中区可量（找不到 [data-mpw-np-vol] 的几何）', JSON.stringify({ volHit: volHit, r: r && { l: r.l, w: r.w } })) }
    else {
      const y = volHit.t + volHit.h / 2
      await page.mouse.move(volHit.l + volHit.w * 0.05, y)
      await page.mouse.down()
      await page.mouse.move(volHit.l + volHit.w * 0.7, y, { steps: 8 })
      await page.mouse.up()
      await sleep(900)
      const after = await read()
      const set1 = await page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || '{}').npVolume } catch { return null } }, STORE_NAME)
      const aria1 = after.scrub && after.scrub.ariaMax !== null ? await page.evaluate(() => { const v = document.querySelector('[data-mpw-np-vol]'); return v ? v.getAttribute('aria-valuenow') : null }) : null
      const elVol = await page.evaluate(() => { const a = document.querySelector('audio[data-mpw-np-audio]'); const v = document.getElementById('mpw-bgVideo'); const m = (a && a.volume) || (v && v.volume); return typeof m === 'number' ? +m.toFixed(3) : null })
      await goto()   // 刷新：判"有没有被重置"
      const s2 = await expand()
      const set2 = await page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || '{}').npVolume } catch { return null } }, STORE_NAME)
      const aria2 = await page.evaluate(() => { const v = document.querySelector('[data-mpw-np-vol]'); return v ? v.getAttribute('aria-valuenow') : null })
      const elVol2 = await page.evaluate(() => { const a = document.querySelector('audio[data-mpw-np-audio]'); const v = document.getElementById('mpw-bgVideo'); const m = (a && a.volume) || (v && v.volume); return typeof m === 'number' ? +m.toFixed(3) : null })
      out = Object.assign(out, { setAfterDrag: set1, ariaAfterDrag: aria1, elVolumeAfterDrag: elVol, setAfterReload: set2, ariaAfterReload: aria2, elVolumeAfterReload: elVol2 })
      evidence.steps.volume = out
      console.log('  音量读数: ' + JSON.stringify(out))
      const near = (a2, b2, tol) => a2 !== null && a2 !== void 0 && Math.abs(Number(a2) - b2) <= tol
      ok(near(set1, 70, 12), 'V1 拖到 70% ⇒ 设置项 npVolume 跟着走（±12）', 'npVolume=' + set1)
      ok(near(aria1, 70, 12), 'V2 卡片 aria-valuenow ≈ 70（组件显示与设置同源）', 'aria=' + aria1)
      ok(near(set2, Number(set1), 6) && near(aria2, Number(aria1), 6), 'V3 **刷新之后**音量仍在（没有被重置）', JSON.stringify({ set: [set1, set2], aria: [aria1, aria2] }))
      ok(elVol2 === null || near(elVol2 * 100, Number(set2), 10), 'V4 刷新之后电平真的落到媒体元素（volume ≈ npVolume/100）', 'elVolume=' + elVol2 + ' npVolume=' + set2)
    }
  }

  const s0 = await expand()
  evidence.steps.initial = s0
  console.log('初始读数: ' + JSON.stringify({ target: s0.target, scrub: s0.scrub && { max: s0.scrub.ariaMax, now: s0.scrub.ariaNow, noseek: s0.scrub.noseek }, run: s0.run, rail: s0.rail, clock: s0.clockSpans, media: s0.media || s0.audio || s0.video }))

  const mediaM = s0.media || s0.audio || s0.video
  if (!s0.scrub || !mediaM || !(mediaM.duration > 0)) {
    console.log('SKIP 后续：没有可用的媒体或轨道（scrub=' + !!s0.scrub + ' media=' + JSON.stringify(mediaM) + '）')
    if (s0.scrub) ok(false, 'A0 卡片有可拖的轨道且媒体有时长', JSON.stringify({ scrub: s0.scrub, media: mediaM }))
  } else {
    const dur = mediaM.duration
    const at = mediaM.currentTime
    const cardMax = Number(s0.scrub.ariaMax)
    console.log('\n== A1/A2/A3 时长轴：卡片显示 vs 媒体元素 ==')
    ok(axisOk(cardMax, dur), 'A1 卡片 aria-valuemax == 媒体时长（±1s）', 'card=' + cardMax + ' media=' + dur + '（差 ' + (cardMax - dur).toFixed(2) + 's）')
    const remainLabel = s0.clockSpans.length > 1 ? s0.clockSpans[s0.clockSpans.length - 1] : ''
    const remainSec = clockSec(remainLabel)
    ok(remainOk(remainSec, dur, at), 'A2 "−剩余" == 媒体时长 − 位置（±1.5s）', 'label=' + JSON.stringify(remainLabel) + ' ⇒ ' + remainSec + 's；期望 ' + (dur - at).toFixed(1) + 's')
    const drawnPct = (s0.run && s0.rail && s0.rail.w > 0) ? (s0.run.w / s0.rail.w) * 100 : null
    ok(drawnPct !== null && runPctOk(drawnPct, at, dur), 'A3 进度条填充 = 位置/媒体时长（±3%）', 'drawn=' + (drawnPct === null ? 'null' : drawnPct.toFixed(2) + '%') + '；期望 ' + ((at / dur) * 100).toFixed(2) + '%')

    console.log('\n== A4 点轨道 90%：媒体落点 + 游标落点 ==')
    const s90 = await dragRail(0.90)
    const m90 = s90.media || s90.audio || s90.video
    const posRatio = (m90 && m90.duration > 0) ? (m90.currentTime / m90.duration) * 100 : null
    ok(posRatio !== null && cursorOk(posRatio, 0.90, 8), 'A4a 媒体 currentTime/时长 ∈ 90%±8%（3.11.0 的"唯一媒体目标"口径）', 't=' + (m90 && m90.currentTime) + ' / ' + (m90 && m90.duration) + ' = ' + (posRatio === null ? 'null' : posRatio.toFixed(1) + '%'))
    const drawn90 = (s90.run && s90.rail && s90.rail.w > 0) ? (s90.run.w / s90.rail.w) * 100 : null
    ok(drawn90 !== null && cursorOk(drawn90, 0.90, 8), 'A4b 游标（进度条填充）也落在 90%±8%（"点一下就跳到一半"的判据）', 'drawn=' + (drawn90 === null ? 'null' : drawn90.toFixed(1) + '%') + ' aria=' + JSON.stringify({ now: s90.scrub && s90.scrub.ariaNow, max: s90.scrub && s90.scrub.ariaMax }))

    console.log('\n== A5 第三方读数：ffprobe（能定位到磁盘文件时）==')
    const srcUrl = String((s90.audio && s90.audio.src) || (s90.video && s90.video.src) || '')
    const filePath = resolveTrackPath(srcUrl, String(s90.section.customDirPath || ''))
    let ffDur = null
    if (!filePath) console.log('  · 跳过：媒体源是容器 token / 直链，推不出磁盘文件（如实跳过，不假装测过）: ' + srcUrl.slice(0, 90))
    else if (!fs.existsSync(filePath)) console.log('  · 跳过：推出的路径不存在: ' + filePath)
    else {
      try { ffDur = Number(String(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', filePath], { encoding: 'utf8' })).trim()) }
      catch (e) { ffDur = null; console.log('  · ffprobe 失败: ' + String((e && e.message) || e).slice(0, 120)) }
    }
    if (ffDur !== null && isFinite(ffDur)) {
      evidence.steps.ffprobe = { file: filePath, duration: ffDur }
      ok(thirdPartyOk(ffDur, dur), 'A5 ffprobe 真实时长 ≈ 元素时长（±1s）⇒ 是"显示错"不是"元素时长错"', 'file=' + path.basename(filePath) + ' ffprobe=' + ffDur.toFixed(3) + ' el=' + dur + ' 差=' + (dur - ffDur).toFixed(3) + 's')
    } else {
      console.log('  · A5 无第三方读数（跳过）—— 元素自身 duration=' + dur + 's 仍与卡片口径对照（A1/A2/A3）')
    }
    evidence.steps.after90 = s90
  }
} catch (e) {
  console.log('✗ 真机流程异常: ' + String((e && e.stack) || e).slice(0, 700))
  evidence.error = String((e && e.message) || e)
  fail++
} finally {
  try {
    if (page && originalSection !== null) {
      let back = null
      for (let round = 0; round < 3; round++) {
        /* 宿主进程内存里的"当前自定义目录"也必须还原：`--mode track` 会 POST /custom-dir 换目录，
           不还原的话用户下一次扫描/自定义目录壁纸的路由都会按探针那个目录解析。 */
        if (MODE === 'track' && hostOriginal && hostOriginal.customDirPath) {
          await page.evaluate((d) => fetch('/api/mpkg-wallpaper/custom-dir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: d }) }).then((r) => r.json()).catch(() => null), hostOriginal.customDirPath).catch(() => null)
        }
        if (MODE === 'track' && hostOriginal) {
          await page.evaluate((o) => fetch('/api/mpkg-wallpaper/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }).then((x) => x.json()).catch(() => null), hostOriginal).catch(() => null)
        }
        await page.evaluate(({ k, v }) => { try { localStorage.setItem(k, v) } catch {} }, { k: STORE_NAME, v: originalSection }).catch(() => {})
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
        await sleep(3000)
        back = await page.evaluate((k) => { try { return localStorage.getItem(k) } catch { return null } }, STORE_NAME).catch(() => null)
        const same = (() => { try { const a = JSON.parse(originalSection), b = JSON.parse(back || '{}'); return ['mpkgKey', 'source', 'image', 'converted', 'webUrl', 'sceneKey', 'customDirPath', 'enabled', 'npVolume', 'npPaused'].every((x) => JSON.stringify(a[x]) === JSON.stringify(b[x])) } catch { return false } })()
        if (same || MODE !== 'track') { if (same) console.log('✓ 插件设置已复原（壁纸档字段逐项一致，含 npVolume/npPaused）'); break }
      }
      if (back !== originalSection && MODE === 'track') console.log('⚠ 复原后与原文不同，请人工确认 ' + STORE_NAME)
    }
  } catch (e) { console.log('⚠ 复原设置失败: ' + String((e && e.message) || e)) }
  try { await browser.close() } catch {}
}
fs.writeFileSync(path.join(OUT, 'np-axis-evidence.json'), JSON.stringify({ pass, fail, evidence }, null, 1))
console.log('\n── 真机汇总：PASS=' + pass + ' FAIL=' + fail + '  证据: ' + path.join(OUT, 'np-axis-evidence.json'))
process.exit(fail > 0 ? 1 : 0)

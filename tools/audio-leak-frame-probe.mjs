// audio-leak-frame-probe.mjs —— 插件侧真机探针：**壁纸 iframe 里的声音有没有被"静音"压住**
//
// 为什么要有它：`tools/audio-bus-live-probe.mjs` 只问"总线装上了吗"（宿主自己那一侧）；
//   用户报的是"静音开着仍有声音"，那问的是**帧内**：谁在出声、静音信号到没到帧里、到了之后出不出声。
//   本探针把这三件事分开量：
//     A 通道：宿主 → 帧 的静音信号**走哪条路**（iframe.muted expando / contentDocument 逐元素 /
//       shim policy postMessage / 新增的 `mpw-audio-policy` postMessage）——逐条实测可达性；
//     B 帧内：`AudioContext` 计数与状态、接进 destination 那条边的电平（rms）、媒体元素 paused/muted/currentTime；
//     C 宿主自证：我们自己的 NP 播放器（`npAudio`/`#mpw-bgWrap` 里的 audio）在不在放。
//
// 用法：
//   node tools/audio-leak-frame-probe.mjs                     # 只读：打开 :3080，量当前设置下的现状
//   node tools/audio-leak-frame-probe.mjs --configure         # 写设置（mute=1 + 渲染器调试参数 audio=1）后量，结束**复原**
//   node tools/audio-leak-frame-probe.mjs --configure --refresh  # 再刷新一次，量"刷新后有没有重新下发"
//   node tools/audio-leak-frame-probe.mjs --mount-scene --refresh # 挂**场景渲染器档**（写档案后刷新），量帧内的图级输出
//   node tools/audio-leak-frame-probe.mjs --json              # 只打印机器可读 JSON
//
// 诚实边界：本机是桌面 Firefox（llvmpipe），用户的现场是 Android WebView/Adreno；
//   `--permissive`（默认开）用 `media.autoplay.*` 预置项模拟"WebView 允许自动播放"——
//   桌面缺省策略下不点一下根本不出声，量不到"漏音"这件事本身。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const has = (n) => argv.includes('--' + n)
const argOf = (n, d) => { const i = argv.indexOf('--' + n); if (i >= 0 && argv[i + 1]) return argv[i + 1]; const eq = argv.find((a) => a.startsWith('--' + n + '=')); return eq ? eq.slice(n.length + 1) : d }
const AUTHORITY = argOf('authority', '127.0.0.1:3080')
const OUT = argOf('out', path.join(os.tmpdir(), 'mpw-audio-frame-probe'))
const CONFIGURE = has('configure')
const REFRESH = has('refresh')
const MOUNT_SCENE = has('mount-scene')
const JSON_ONLY = has('json')
const PERMISSIVE = !has('no-permissive')
const STORE = 'dsh.mpkg-wallpaper.v2'
const PLUGIN = path.resolve(import.meta.dirname, '..')

let pass = 0, fail = 0
const say = (...a) => { if (!JSON_ONLY) console.log(...a) }
const ok = (c, label, extra = '') => { if (c) pass++; else fail++; say((c ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : '')) }

/* 帧内探针（在**每个** realm 的页面脚本之前装好；跨源帧同样装得上 —— 这一点本身就是要量的事实之一）。
   与渲染器仓 `tests/audio-leak-graph-probe.mjs` 的 INIT 同一手法：把"接 destination 的那条边"抽出来，
   用探针 AnalyserNode 量**真的会到扬声器的那份信号**。 */
const INIT = () => {
  const P = { taps: [], err: null, events: [], gesture: 0 }
  window.__mpwFrameAudioProbe = P
  try {
    const proto = window.AudioNode && window.AudioNode.prototype
    const origConnect = proto && proto.connect
    const isOffline = (ctx) => { try { const O = window.OfflineAudioContext || window.webkitOfflineAudioContext; return !!(O && ctx instanceof O) } catch (e) { return false } }
    P.tapFor = (ctx) => {
      let t = P.taps.find((x) => x.ctx === ctx)
      if (t) return t
      const an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0
      t = { ctx, an, connects: 0 }; P.taps.push(t)
      origConnect.call(an, ctx.destination)
      return t
    }
    proto.connect = function (dest) {
      const rest = Array.prototype.slice.call(arguments, 1)
      try {
        const ctx = this && this.context
        if (ctx && dest && dest === ctx.destination && !isOffline(ctx)) { const t = P.tapFor(ctx); t.connects++; return origConnect.call(this, t.an, ...rest) }
      } catch (e) { P.err = String((e && e.message) || e) }
      return origConnect.call(this, dest, ...rest)
    }
    window.addEventListener('pointerdown', () => { P.gesture++ }, true)
    /* 宿主静音信号的**到达台账**：帧内收到过哪些形状的静音/音量消息（跨源唯一可达的通道）。 */
    P.msgs = []
    window.addEventListener('message', (ev) => {
      try {
        const d = ev && ev.data
        if (d && typeof d === 'object' && typeof d.type === 'string' && /mpw|audio|mute/i.test(d.type)) P.msgs.push({ at: Date.now(), type: d.type, muted: d.muted, volume: d.volume, fromParent: (() => { try { return ev.source === window.parent } catch (e) { return null } })() })
      } catch (e) {}
    }, true)
  } catch (e) { P.err = String((e && e.message) || e) }
}

const FRAME_READ = () => {
  const P = window.__mpwFrameAudioProbe || { taps: [], msgs: [], events: [], gesture: 0 }
  const rmsOf = (an) => { try { const b = new Uint8Array(an.fftSize); an.getByteTimeDomainData(b); let s = 0; for (let i = 0; i < b.length; i++) { const d = (b[i] - 128) / 128; s += d * d } return Math.sqrt(s / b.length) } catch (e) { return null } }
  const els = []
  try { const l = document.querySelectorAll('audio,video'); for (let i = 0; i < l.length; i++) { const el = l[i]; els.push({ tag: el.tagName, paused: !!el.paused, muted: !!el.muted, volume: Number(el.volume), t: Number(el.currentTime || 0), readyState: el.readyState, hasSrcNode: !!el.__mpwMediaSource, inTree: !!(el.parentNode || el.isConnected) }) } } catch (e) {}
  return {
    href: (() => { try { return String(location.href).replace(/st=[^&]*/, 'st=…').slice(0, 200) } catch (e) { return '?' } })(),
    embedded: (() => { try { return window.self !== window.top } catch (e) { return 'cross' } })(),
    frameElementReadable: (() => { try { return window.frameElement ? { ok: true, muted: window.frameElement.muted } : { ok: true, muted: null } } catch (e) { return { ok: false, err: String(e && e.name || e) } } })(),
    ctxs: P.taps.map((t) => ({ state: String(t.ctx.state), currentTime: Number(t.ctx.currentTime || 0), sampleRate: Number(t.ctx.sampleRate || 0) })),
    rms: P.taps.map((t) => rmsOf(t.an)),
    els,
    msgs: P.msgs || [],
    gesture: P.gesture,
    ledger: (() => { try { return JSON.parse(JSON.stringify(window.__mpwAudioLedger || null)) } catch (e) { return null } })(),
    policy: (() => { try { return JSON.parse(JSON.stringify(window.__mpwAudioPolicy || null)) } catch (e) { return null } })(),
    graph: (() => { try { return (typeof window.__mpwAudioGraph === 'function') ? window.__mpwAudioGraph() : null } catch (e) { return null } })(),
    bus: (() => { try { return window.__mpwAudioBus ? { mode: window.__mpwAudioBus.mode, muted: window.__mpwAudioBus.muted, redirects: (window.__mpwAudioBus.report() || {}).redirects } : null } catch (e) { return null } })(),
    /* 用户激活 + 逐元素 play() 的真实裁决：把"浏览器策略挡住"与"产品自己不放"分开。
       桌面缺激活 ⇒ 读数是"元素在放、但一个字节都没出去"，真机 WebView（免手势）没有这道闸。 */
    act: (() => { try { return navigator.userActivation ? { hasBeenActive: !!navigator.userActivation.hasBeenActive, isActive: !!navigator.userActivation.isActive } : null } catch (e) { return null } })(),
    probeErr: P.err,
  }
}

const TOP_READ = (store) => {
  const sec = (() => { try { return JSON.parse(localStorage.getItem(store) || '{}') } catch (e) { return {} } })()
  const wrap = document.getElementById('mpw-bgWrap')
  const kids = wrap ? [...wrap.children].map((c) => ({ tag: c.tagName, cls: String(c.className || ''), display: (c.style && c.style.display) || '', src: c.getAttribute && c.getAttribute('src') ? String(c.getAttribute('src')).replace(/st=[^&]*/, 'st=…').slice(0, 220) : null })) : []
  const frames = [...document.querySelectorAll('iframe')].map((f, i) => {
    let same = false, hasBus = false, busMuted = null
    try { const w = f.contentWindow; same = !!(w && w.document); hasBus = !!(w && w.__mpwAudioBus); busMuted = hasBus ? !!w.__mpwAudioBus.muted : null } catch (e) { same = false }
    const src = String(f.getAttribute('src') || '')
    return { i, same, hasBus, busMuted, shim: /[?&]mpwshim=1(?:&|$)/.test(src), mutedExpando: !!f.muted, src: src.replace(/st=[^&]*/, 'st=…').slice(0, 240) }
  })
  const frameKey = [...document.querySelectorAll('iframe.mpw-webFrame')].map((f) => { try { return f.__mpwShimPolicy ? { win: !!f.__mpwShimPolicy.win, muted: f.__mpwShimPolicy.muted } : null } catch (e) { return null } })
  /* 宿主页自己的媒体元素（**视频壁纸**与**我们自己的 NP 播放器**都在这里）：
     这两条是"谁在出声"的另一半 —— 帧内没声音 ≠ 没声音。 */
  const media = [...document.querySelectorAll('audio,video')].map((el) => ({
    np: el.hasAttribute('data-mpw-np-audio'), id: el.id || '', cls: String(el.className || ''),
    paused: !!el.paused, muted: !!el.muted, volume: Number(el.volume), t: Number(el.currentTime || 0),
    readyState: el.readyState, display: (el.style && el.style.display) || '',
    hasAudioTrack: (el.mozHasAudio !== undefined ? !!el.mozHasAudio : null), loop: !!el.loop,
    src: String(el.currentSrc || el.getAttribute('src') || '').replace(/token=[^&]*/, 'token=…').slice(-70),
  }))
  const npt = (() => { try { const t = window.__mpwNpTest; return t ? { wantMuted: t.wantMuted(), cardPaused: t.cardPausedNow(), source: t.npSource(), ops: t.ops(), hiddenAudioBlock: t.hiddenAudioBlock && t.hiddenAudioBlock() } : null } catch (e) { return null } })()
  return {
    section: sec,
    wrapAttrs: wrap ? { 'data-mpw-np-sound': wrap.getAttribute('data-mpw-np-sound'), 'data-mpw-np-sound-reason': wrap.getAttribute('data-mpw-np-sound-reason'), 'data-mpw-webframe-mode': wrap.getAttribute('data-mpw-webframe-mode'), 'data-mpw-webframe-src': String(wrap.getAttribute('data-mpw-webframe-src') || '').slice(0, 200) } : null,
    kids, frames, shimPolicy: frameKey, media, npt,
    npFrameSound: (() => { try { return JSON.parse(JSON.stringify(window.__mpwNpFrameSound || null)) } catch (e) { return null } })(),
    npOps: (() => { try { return JSON.parse(JSON.stringify(window.__mpwNpOps || null)) } catch (e) { return null } })(),
    busReport: (() => { try { const b = window.__mpwAudioBus; if (!b) return null; const r = b.report(); return { mode: r.mode, muted: r.muted, contexts: r.contexts.length, masters: r.masters, media: r.media, redirects: r.redirects, uncontrollable: (r.uncontrollableFrames || []).length, frames: (r.frames || []).length } } catch (e) { return null } })(),
    busFrames: (() => { try { const b = window.__mpwAudioBus; if (!b || !b.report) return null; const rows = []; for (const c of b.report().contexts || []) rows.push({ id: c.id, legacy: !!c.legacy, frames: c.frames }); return rows } catch (e) { return null } })(),
  }
}

const cookiePath = path.join(OUT, 'cookie.json')
fs.mkdirSync(OUT, { recursive: true })
execFileSync(process.execPath, [path.join(PLUGIN, 'tools', 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', cookiePath], { stdio: JSON_ONLY ? 'ignore' : 'inherit' })
const cookie = JSON.parse(fs.readFileSync(cookiePath, 'utf8'))
const pw = await import('playwright')
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { say('SKIP audio-leak-frame-probe —— playwright 没有 firefox 导出'); process.exit(2) }

const prefs = Object.assign(
  { 'webgl.force-enabled': true, 'gfx.webrender.software': true, 'webgl.out-of-process': false },
  PERMISSIVE ? { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 2, 'media.autoplay.block-webaudio': false, 'media.autoplay.allow-muted': true } : {},
)
const browser = await firefox.launch({
  headless: false,
  env: Object.assign({}, process.env, { DISPLAY: process.env.MPW_X11_DISPLAY || ':0', MOZ_WEBGL_FORCE_SOFTWARE: '1', LIBGL_ALWAYS_SOFTWARE: '1' }),
  firefoxUserPrefs: prefs,
})
const out = { authority: AUTHORITY, permissive: PERMISSIVE, configure: CONFIGURE, refresh: REFRESH, steps: [] }
let originalSection = null, originalHost = null, page = null
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String((e && e.message) || e).slice(0, 160)))
  await page.addInitScript(INIT)

  const measure = async (label) => {
    await page.waitForTimeout(1500)
    const top = await page.evaluate(TOP_READ, STORE)
    const frameList = page.frames().filter((f) => f !== page.mainFrame())
    const frameReads = []
    for (const fr of frameList) {
      let r = null
      try { r = await fr.evaluate(FRAME_READ) } catch (e) { r = { err: String((e && e.message) || e).slice(0, 120) } }
      frameReads.push(r)
    }
    /* 峰值保持：单窗 RMS 会被音轨静音段/兜底 `load()` 的瞬间读成 0 ⇒ 6 次采样取最大，
       否则"静音生效"可能是假绿（真因是那一刻本来就没信号）。 */
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(220)
      for (let k = 0; k < frameList.length; k++) {
        if (!frameReads[k] || frameReads[k].err) continue
        try {
          const rr = await frameList[k].evaluate(FRAME_READ)
          const peak = Math.max(0, ...(rr.rms || []).filter((x) => typeof x === 'number'))
          frameReads[k].rmsPeak = Math.max(frameReads[k].rmsPeak || 0, peak)
        } catch (e) { /* 帧正在导航：跳过这一拍 */ }
      }
    }
    const row = { label, top, frames: frameReads }
    out.steps.push(row)
    say('\n── ' + label)
    say('   设置: mute=' + JSON.stringify(top.section.mute) + ' npNowPlaying=' + JSON.stringify(top.section.npNowPlaying)
      + ' sceneDebugParams=' + JSON.stringify(top.section.sceneDebugParams || null) + ' sceneRendererUrl=' + JSON.stringify(top.section.sceneRendererUrl || null))
    say('   壁纸层: ' + JSON.stringify(top.kids))
    say('   宿主媒体元素: ' + JSON.stringify(top.media))
    say('   NP 自证: ' + JSON.stringify(top.npt))
    say('   宿主帧: ' + JSON.stringify(top.frames))
    say('   npFrameSound: ' + JSON.stringify(top.npFrameSound) + ' busReport=' + JSON.stringify(top.busReport))
    for (const r of frameReads) {
      if (!r || r.err) { say('   帧读数失败: ' + JSON.stringify(r)); continue }
      say('   帧 ' + r.href)
      say('     embedded=' + r.embedded + ' frameElement=' + JSON.stringify(r.frameElementReadable) + ' act=' + JSON.stringify(r.act))
      say('     ctxs=' + JSON.stringify(r.ctxs) + ' rms=' + JSON.stringify(r.rms) + ' 峰值=' + JSON.stringify(r.rmsPeak) + ' gesture=' + r.gesture)
      say('     els=' + JSON.stringify(r.els))
      say('     policy=' + JSON.stringify(r.policy) + ' graph=' + JSON.stringify(r.graph) + ' bus=' + JSON.stringify(r.bus))
      say('     msgs=' + JSON.stringify(r.msgs.slice(-6)) + ' ledger=' + JSON.stringify(r.ledger))
    }
    return row
  }

  await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)
  const R0 = await measure('S0 现状（不写任何设置）')
  originalSection = R0.top.section
  /* ①(2026-09-24 事故修复) 用户设置**有两处**存储：localStorage + 宿主端 `settings.json`
     （`lib/client.js` 的 mpwPersistSection："去重后写 host"）。旧写法只存 localStorage 那一份
     ⇒ 探针写完 localStorage 后插件把它 PUT 到宿主端，宿主那份的 `__mpwHostAt` 更新
     ⇒ 下次加载按"谁新用谁"裁决时**宿主（探针档）赢**、用户的壁纸被探针场景顶掉
     （真发现场：DSH 背景变成"探针场景（凯尔希 4 音轨）"，`webUrl` 里带 `&audio=1`）。
     所以宿主那一份也必须照原样存档，并在结束时**写回 + 复核**（见 finally）。 */
  try {
    originalHost = await page.evaluate(async () => {
      const r = await fetch('/api/mpkg-wallpaper/settings')
      const d = await r.json()
      return (d && d.ok && d.settings && typeof d.settings === 'object') ? d.settings : null
    })
    try { fs.writeFileSync(path.join(os.tmpdir(), 'mpw-frame-probe-host-before.json'), JSON.stringify({ at: Date.now(), settings: originalHost }, null, 1)) } catch (e) {}
    say('（宿主档已存档：' + path.join(os.tmpdir(), 'mpw-frame-probe-host-before.json') + '，键数=' + (originalHost ? Object.keys(originalHost).length : 0) + '）')
  } catch (e) { say('宿主档存档失败（结束时跳过宿主那半）：' + String((e && e.message) || e)) }

  if (CONFIGURE) {
    /* 用户序列：设置里"静音"打开 + 渲染器调试参数带 audio=1（渲染器的场景音轨只在 `?audio=1` 时接图）。
       写完 **重新加载** = 用户说的"刷新"。 */
    const DBG = argOf('debug', 'audio=1')
    await page.evaluate(({ k, dbg }) => {
      const s = JSON.parse(localStorage.getItem(k) || '{}')
      s.mute = true
      s.sceneDebugParams = dbg
      localStorage.setItem(k, JSON.stringify(s))
      return { mute: s.mute, sceneDebugParams: s.sceneDebugParams, webUrl: s.webUrl || null, sceneKey: s.sceneKey || null, source: s.source || null }
    }, { k: STORE, dbg: DBG })
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(9000)
    const R1 = await measure('S1 静音=开 + audio=1（**刷新之后**，不点任何东西）')
    out.scenario = { rmsAfterMute: R1.frames.map((f) => f && f.rms), audibles: R1.frames.filter((f) => f && f.rms && f.rms.some((v) => v > 1e-4)).length }
    if (REFRESH) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(9000)
      const R2 = await measure('S2 再刷新一次（同一设置；看"刷新后有没有重新下发"）')
      out.scenario.rmsAfterSecondRefresh = R2.frames.map((f) => f && f.rms)
    }
  }

  if (MOUNT_SCENE) {
    /* 把"场景渲染器档"写进档案（与用户的 `applySceneViaRenderer` 写的是**同一批字段**），
       然后**刷新** —— 这样量到的是插件自己的挂载路径（同一个 iframe/沙箱/applyWebMute），
       不是我们另搭的舞台。包源用渲染器自己的 `/pkgpath`（本机语料），避免动用户的库目录设置。 */
    /* 语料包路径**从脚本位置推导**（工作区根 = 插件仓的上一级）：lib/** 与 tools/** 不许出现本机绝对路径
       （integrity ⑩ / secret-scan B / cross-platform B1 三条独立判据都会判红）。 */
    const WS_ROOT = path.resolve(PLUGIN, '..')
    const pkg = argOf('scene-pkg', process.env.MPW_SCENE_PKG || path.join(WS_ROOT, 'allwallpaper', 'dd', '3719111841', 'scene.pkg'))
    const withAudio = argOf('scene-audio', '1') !== '0'
    const rendererBase = argOf('scene-base', 'http://127.0.0.1:8902/webloader/')
    const pkgUrl = rendererBase.replace(/\/?$/, '/') + '?pkgurl=' + encodeURIComponent('http://127.0.0.1:8902/pkgpath?p=' + pkg)
      + '&embed=1' + (withAudio ? '&audio=1' : '')
    const patch = {
      mute: true, converted: 'scene', image: '', source: pkg.split('/').pop(), mpkgKey: '', mpkgName: '探针场景（凯尔希 4 音轨）',
      sceneKey: 'scene|probe|' + pkg, webUrl: pkgUrl, activeSlot: null, propEdits: undefined,
    }
    await page.evaluate(({ k, p }) => { const s = JSON.parse(localStorage.getItem(k) || '{}'); Object.assign(s, p); localStorage.setItem(k, JSON.stringify(s)); return s.mute }, { k: STORE, p: patch })
    if (!JSON_ONLY) console.log('\n（已写入场景档：' + pkgUrl + '）')
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(15000)
    const RS = await measure('S3 场景渲染器档 + 静音=开（刷新之后）')
    out.scene = { pkg: pkg, url: pkgUrl, reads: RS.frames, top: { frames: RS.top.frames, npFrameSound: RS.top.npFrameSound, media: RS.top.media } }
    if (has('policy-push')) {
      /* 把**修复后插件会发的那条消息**从宿主页推下去（`sendRendererAudioPolicy` 的载荷逐字同形）：
         为什么探针自己推：DSH 在插件加载时就把客户端 bundle 缓存在内存里（实测 `rev=2cb504b3262b`
         ≠ 本地内容哈希 `40950d9ad5c3`）⇒ 本次改动要下一次插件重载/宿主重启才会进浏览器。
         这一推量的是**渲染器那一半**（图级收口），插件那一半由 tools/np-media-test.mjs 的 D5–D9 判据钉住。 */
      const push = async (muted, tag) => {
        const r = await page.evaluate(({ muted }) => {
          const f = document.querySelector('iframe.mpw-webFrame')
          if (!f || !f.contentWindow || typeof f.contentWindow.postMessage !== 'function') return 'no-frame'
          f.contentWindow.postMessage({ type: 'mpw-audio-policy', muted: muted, volume: 1 }, '*')
          return 'sent'
        }, { muted })
        say('   宿主下发 {type:mpw-audio-policy, muted:' + muted + '} → ' + r + '（' + tag + '）')
        await page.waitForTimeout(2000)
      }
      await push(true, '暂停/静音档')
      const RP = await measure('S7 宿主下发 muted:true 之后（图级静音）')
      out.scene.readsAfterMute = RP.frames.map((f) => f && { rms: f.rms, policy: f.policy, graph: f.graph, msgs: (f.msgs || []).length, els: (f.els || []).map((e) => ({ muted: e.muted, paused: e.paused })) })
      await push(false, '放行档')
      const RU = await measure('S8 宿主下发 muted:false 之后（放行：证明 S7 的 0 不是"本来就没在放"）')
      out.scene.readsAfterUnmute = RU.frames.map((f) => f && { rms: f.rms, policy: f.policy, graph: f.graph })
      await push(true, '再静音（幂等/可重复）')
      const RM = await measure('S9 再下发 muted:true（幂等：次数/节点不增长）')
      out.scene.readsAfterMute2 = RM.frames.map((f) => f && { rms: f.rms, policy: f.policy, graph: f.graph, msgs: (f.msgs || []).length })
    }
    if (has('fallback')) {
      /* ★ 用户最新现场（原话）："又开始播放音频了，这个音频并不是我当前壁纸的音频（没动音频、也没刷新）"。
         机制：场景看门狗兜底把渲染器 iframe **藏起来但保留**（`.mpw-bgWrap.mpw-scene-fallback iframe.mpw-webFrame
         { display:none !important }`，client.js:14595），而隐藏的 iframe 里音频照样在放。
         本步复刻"隐藏"（stale 的在线插件里就是加这一个类），量隐藏前后帧内输出。 */
      await page.evaluate(() => { const f = document.querySelector('iframe.mpw-webFrame'); if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'mpw-audio-policy', muted: false, volume: 1, park: false }, '*') })
      await page.waitForTimeout(2500)
      const RV = await measure('S10 场景帧可见 + 宿主放行（对照：这一页本来在放）')
      out.fallback = { visible: { rms: RV.frames.map((f) => f && f.rmsPeak), graph: RV.frames.map((f) => f && f.graph) } }

      const hide = async (on) => await page.evaluate(({ on }) => {
        const w = document.getElementById('mpw-bgWrap')
        if (!w) return null
        if (on) w.classList.add('mpw-scene-fallback'); else w.classList.remove('mpw-scene-fallback')
        const f = document.querySelector('iframe.mpw-webFrame')
        return { cls: w.className, display: f ? (getComputedStyle(f).display) : null }
      }, { on })

      const h1 = await hide(true)
      say('   （复刻插件兜底隐藏：' + JSON.stringify(h1) + '）')
      await page.waitForTimeout(3000)
      const RH = await measure('S11 ★ 被藏起来之后（看门狗兜底：静态帧 + iframe display:none）')
      out.fallback.hidden = { hide: h1, rms: RH.frames.map((f) => f && f.rmsPeak), policy: RH.frames.map((f) => f && f.policy), graph: RH.frames.map((f) => f && f.graph), els: RH.frames.map((f) => f && (f.els || []).map((e) => ({ paused: e.paused, muted: e.muted }))) }
      /* ⚠ 读数口径（本轮实测踩到）：**ctx 被 suspend 之后，destination 抽头的 getByteTimeDomainData 会
         停留在最后一帧缓冲**（不是"还在出声"）⇒ 判"有没有声"要以 `graph.parked/ctx==='suspended'/
         masterGain===0/元素 paused` 为准；抽头只在"图在跑"时才是权威读数。 */
      const audibleOf = (row) => {
        const fr = (row && row.frames && row.frames[0]) || {}
        const g = fr.graph || {}
        if (g.parked === true || g.ctx === 'suspended' || g.masterGain === 0) return false
        return (fr.rmsPeak || 0) > 1e-4
      }
      out.fallback.hidden.audible = audibleOf(RH)
      say('   ↳ 判决：隐藏后 峰值=' + JSON.stringify(out.fallback.hidden.rms) + ' 图={parked:' + JSON.stringify((RH.frames[0] || {}).graph && RH.frames[0].graph.parked) + ', parkReason:' + JSON.stringify((RH.frames[0] || {}).graph && RH.frames[0].graph.parkReason) + ', ctx:' + JSON.stringify((RH.frames[0] || {}).graph && RH.frames[0].graph.ctx) + ', masterGain:' + JSON.stringify((RH.frames[0] || {}).graph && RH.frames[0].graph.masterGain) + '} ⇒ ' + (out.fallback.hidden.audible ? '**仍在出声（漏音）**' : '已停源（元素 paused + ctx suspended；抽头的非零值是 suspend 前的残留缓冲）'))

      /* 改前等价：把**新增的两道防线**在页面里拆掉（渲染器侧的自证可见性 IO），且宿主本来就不发 park
         （在线插件是加载期缓存的旧 bundle）⇒ 再隐藏一次，应当能量到"隐藏的帧照样在放"。 */
      await hide(false)
      await page.evaluate(() => { const f = document.querySelector('iframe.mpw-webFrame'); if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'mpw-audio-policy', muted: false, volume: 1, park: false }, '*') })
      await page.waitForTimeout(1200)
      const ioOff = []
      for (const fr of page.frames()) {
        if (fr === page.mainFrame()) continue
        try { ioOff.push(await fr.evaluate(() => { try { const g = window.__mpwAudioGateRef; if (g && g.rafTimer) { clearInterval(g.rafTimer); g.rafTimer = 0; return 'raf-timer-off' } return 'no-raf-timer' } catch (e) { return String(e && e.message || e) } })) } catch (e) { ioOff.push('err') }
      }
      say('   （改前等价：拆掉渲染器侧的 rAF 停摆探测 = ' + JSON.stringify(ioOff) + '）')
      const h2 = await hide(true)
      await page.waitForTimeout(3000)
      const RB = await measure('S12 ☆ 改前等价（无 IO 自证 + 宿主无 park 通道）⇒ 隐藏的帧')
      out.fallback.beforeEquivalent = { hide: h2, io: ioOff, rms: RB.frames.map((f) => f && f.rmsPeak), graph: RB.frames.map((f) => f && f.graph) }
      say('   ↳ 判决：改前等价下 峰值=' + JSON.stringify(out.fallback.beforeEquivalent.rms) + ' 图=' + JSON.stringify((RB.frames[0] || {}).graph && { parked: RB.frames[0].graph.parked, ctx: RB.frames[0].graph.ctx, masterGain: RB.frames[0].graph.masterGain }) + ' ⇒ ' + ((out.fallback.beforeEquivalent.rms || []).some((v) => (v || 0) > 1e-4) ? '**隐藏的帧照样在放（= 用户听到的那段声音）**' : '没量到（桌面缺用户激活时元素可能没起播，见 els/act）'))
      await hide(false)
    }
    if (has('frame-play')) {
      /* 帧内 `play()` 的真实裁决：桌面缺用户激活时这里会给出 NotAllowedError（= 策略挡住的证据，
         **不是**"我们静音成功了"）；真机 WebView 免手势 ⇒ 这行会 'ok'，声音就出去了。 */
      const res = []
      for (const fr of page.frames()) {
        if (fr === page.mainFrame()) continue
        try {
          res.push(await fr.evaluate(async () => {
            const out = []
            for (const el of document.querySelectorAll('audio,video')) { try { await el.play(); out.push('ok') } catch (e) { out.push(String((e && e.name) || e)) } }
            return out
          }))
        } catch (e) { res.push('ERR ' + String((e && e.message) || e).slice(0, 80)) }
      }
      say('   帧内 play() 裁决: ' + JSON.stringify(res))
      out.framePlay = res
      await page.waitForTimeout(2500)
      const RS5 = await measure('S5 帧内 play() 之后（同一静音设置）')
      out.scene.rmsAfterFramePlay = RS5.frames.map((f) => f && f.rms)
    }
    if (has('click-top')) {
      await page.mouse.click(700, 500)
      await page.waitForTimeout(2500)
      const RS6 = await measure('S6 顶层点一下之后（用户手势）')
      out.scene.rmsAfterClick = RS6.frames.map((f) => f && f.rms)
    }
    if (REFRESH) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(15000)
      const RS2 = await measure('S4 再刷新一次（同一场景档；看刷新后通道是否重新下发）')
      out.scene.reads2 = RS2.frames
    }
  }
  out.errs = errs
  const aud = out.steps[out.steps.length - 1].frames.filter((f) => f && ((f.rmsPeak || 0) > 1e-4 || (f.rms || []).some((v) => v > 1e-4)))
  ok(true, '探针跑完（读数见上）', '有声音的帧数=' + aud.length)
} catch (e) {
  say('探针异常: ' + String((e && e.message) || e)); fail++
} finally {
  /* **复原用户设置**（两处都写 + 复核）：本探针只在 --configure/--mount-scene 时写，写前各存了一份原值。
     ①(2026-09-24) 旧写法只复原 localStorage ⇒ 见上面 originalHost 的说明：宿主那份会赢裁决。
     复原顺序：先 localStorage、再宿主（宿主要带**新的** `__mpwHostAt`，否则它比探针那份旧、裁决仍判探针赢）；
     探针**新增**的键要显式 PUT `null`（宿主端是"合并不替换"，不传 null 删不掉）。
     最后 GET 回来**逐键比对**：不一致就判红并打印差异（绝不把"没复原干净"说成"已复原"）。 */
  try {
    if ((CONFIGURE || MOUNT_SCENE) && page && originalSection) {
      await page.evaluate(({ k, v }) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} }, { k: STORE, v: originalSection })
      if (originalHost) {
        const res = await page.evaluate(async (orig) => {
          const B = '/api/mpkg-wallpaper'
          const cur = ((await (await fetch(B + '/settings')).json()).settings) || {}
          const patch = {}
          for (const k of Object.keys(orig)) patch[k] = orig[k]
          for (const k of Object.keys(cur)) if (!(k in orig)) patch[k] = null   // 探针新增的键 ⇒ 显式删
          patch.__mpwHostAt = Date.now()
          const r = await fetch(B + '/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
          const now = ((await (await fetch(B + '/settings')).json()).settings) || {}
          const diff = []
          for (const k of new Set([...Object.keys(orig), ...Object.keys(now)])) {
            if (k === '__mpwHostAt') continue
            if (JSON.stringify(orig[k]) !== JSON.stringify(now[k])) diff.push(k + ': ' + JSON.stringify(orig[k]) + ' → ' + JSON.stringify(now[k]))
          }
          return { put: r.ok, diff: diff.slice(0, 8), diffN: diff.length, keys: Object.keys(now).length }
        }, originalHost)
        ok(!!res.put && res.diffN === 0, '宿主档复原并复核（逐键一致）', 'HTTP=' + (res.put ? 'ok' : '失败') + ' 差异=' + res.diffN + (res.diff ? ' ' + JSON.stringify(res.diff) : '') + ' 键数=' + res.keys)
      } else {
        say('（宿主档存档缺失 ⇒ 未写回；请人工确认 设置→壁纸）')
      }
      say('（已复原探针进入时的设置：localStorage + 宿主）')
    }
  } catch (e) { fail++; say('FAIL 复原设置失败（请手动确认 设置→壁纸 的壁纸/静音/调试参数）：' + String((e && e.message) || e)) }
  await browser.close().catch(() => {})
}
if (JSON_ONLY) console.log(JSON.stringify(out, null, 1))
say('\naudio-leak-frame-probe：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)

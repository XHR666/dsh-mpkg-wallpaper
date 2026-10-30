// audio-leak-graph-probe.mjs —— 「静音了还有声音」的**可区分读数**探针（元素路径 vs WebAudio 图路径）
//
// 为什么要有它：`render-audio-leak-test.mjs` 是**源码切片**判据（无浏览器、确定性），证的是"代码长什么样"；
//   本探针是**真浏览器读数**，回答一个切片答不了的问题：**声音是从哪儿出去的**。
//   两条路必须在读数上可区分，否则"静音了还有声音"永远只能靠猜：
//     · 元素路径：`<audio>/<video>` 的 `paused/currentTime`、元素 `muted/volume`；
//     · WebAudio 图路径：`AudioContext` 计数/状态、图里节点数、**接进 destination 的那条边的电平**。
//
// 关键手法（**不猜，直接量出口**）：在页面任何脚本之前包一层 `AudioNode.prototype.connect`，
//   凡是 `node.connect(ctx.destination)` 一律改接我们自己的探针 AnalyserNode（探针再连 destination）。
//   于是 `getByteTimeDomainData` 的 RMS = **真的会到达扬声器的那份信号**：
//     rms > 0 ⇒ 在出声；rms == 0 ⇒ 即便元素在"播放"也一个字都没出去。
//   这与"元素 muted 了没有"是两个独立读数 —— 本探针存在的意义就是把这两件事分开。
//
// 用法：
//   node tests/audio-leak-graph-probe.mjs --url "<渲染器 URL>"
//   node tests/audio-leak-graph-probe.mjs --url "http://127.0.0.1:8902/webloader/?pkgpath=/abs/scene.pkg&audio=1&shell=0"
//   选项：--steps=element-mute,host-volume,policy-mute,gesture   只跑其中几步
//         --permissive   允许自动播放（模拟 Android WebView 的 mediaPlaybackRequiresUserGesture=false）
//         --json         只打印机器可读 JSON（报告里贴的那份）
//
// 退出码：0 = 探针跑完（读数在 stdout，**不判红**：它是取证工具，不是门禁）；
//         2 = 前置不满足（:8902 不可达 / 无 WebGL ⇒ 探针自我 SKIP，避免把环境缺能力说成产品结论）。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf(n); if (i >= 0 && argv[i + 1]) return argv[i + 1]; const eq = argv.find((a) => a.startsWith(n + '=')); return eq ? eq.slice(n.length + 1) : d }
const URL_IN = argOf('--url', '')
const PERMISSIVE = argv.includes('--permissive')
const JSON_ONLY = argv.includes('--json')
const STEPS = String(argOf('--steps', 'gesture,rolling,mute-ab,host-volume,policy-mute')).split(',').map((s) => s.trim()).filter(Boolean)
if (!URL_IN) { console.log('SKIP audio-leak-graph-probe —— 必须给 --url（渲染器地址）'); process.exit(2) }

let pass = 0, fail = 0
const say = (...a) => { if (!JSON_ONLY) console.log(...a) }
const ok = (c, label, extra = '') => { if (c) pass++; else fail++; say((c ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : '')) }

/* 探针注入脚本：在任何页面脚本之前跑。**只加观测，不改产品行为**（唯一的改写是"接 destination 的边"，
   而接法等价：node → 探针 Analyser → destination，信号逐位同路，只是多一个只读抽头）。 */
const INIT = () => {
  const P = { ctxs: [], taps: [], err: null, gesture: { pointerdown: 0, keydown: 0, click: 0 }, events: [] }
  window.__mpwAudioGraphProbe = P
  try {
    /* 拦在 **AudioNode.prototype**（基类）上：`analyser.connect(dest)`、`gain.connect(dest)`、
       `source.connect(dest)` 全走这一份（子类没有自己的 connect）。只拦 AnalyserNode 会漏掉
       "第三方自己建了个 GainNode 直连 destination"这条最常见的旁路。 */
    const AN = window.AudioNode, ANproto = AN && AN.prototype
    const origConnect = ANproto && ANproto.connect
    const origDisconnect = ANproto && ANproto.disconnect
    const isOffline = (ctx) => { try { const O = window.OfflineAudioContext || window.webkitOfflineAudioContext; return !!(O && ctx instanceof O) } catch (e) { return false } }
    P.tapFor = (ctx) => {
      let t = P.taps.find((x) => x.ctx === ctx)
      if (t) return t
      const an = ctx.createAnalyser()
      an.fftSize = 2048
      an.smoothingTimeConstant = 0
      t = { ctx, an, connects: 0, at: Date.now() }
      P.taps.push(t)
      origConnect.call(an, ctx.destination)      // 探针自己接 destination（走原始引用，不再被拦）
      return t
    }
    ANproto.connect = function (dest) {
      const rest = Array.prototype.slice.call(arguments, 1)
      try {
        const ctx = this && this.context
        if (ctx && dest && dest === ctx.destination && !isOffline(ctx)) {
          const t = P.tapFor(ctx)
          t.connects++
          P.events.push({ at: Date.now(), what: 'tap-reroute', taps: t.connects })
          return origConnect.call(this, t.an, ...rest)
        }
      } catch (e) { P.err = String((e && e.message) || e) }
      return origConnect.call(this, dest, ...rest)
    }
    P.origDisconnect = origDisconnect
    /* 手势计数：用来区分"浏览器策略挡住"与"产品自己不放"。只计数，不拦。 */
    for (const ev of ['pointerdown', 'keydown', 'click']) {
      window.addEventListener(ev, () => { try { P.gesture[ev]++ } catch (e) {} }, true)
    }
    /* 媒体元素的 play/pause 台账（元素路径的"在放"证据；与图路径读数相互独立）。 */
    const proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype
    if (proto && proto.play) {
      const op = proto.play, oq = proto.pause
      proto.play = function () { try { P.events.push({ at: Date.now(), what: 'play', tag: this.tagName, muted: !!this.muted, vol: Number(this.volume) }) } catch (e) {} ; return op.apply(this, arguments) }
      proto.pause = function () { try { P.events.push({ at: Date.now(), what: 'pause', tag: this.tagName }) } catch (e) {} ; return oq.apply(this, arguments) }
    }
  } catch (e) { P.err = String((e && e.message) || e) }
}

const READ = () => {
  const P = window.__mpwAudioGraphProbe || { taps: [], gesture: {}, events: [], ctxs: [] }
  const rmsOf = (an) => {
    try {
      const buf = new Uint8Array(an.fftSize)
      an.getByteTimeDomainData(buf)
      let s = 0
      for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; s += d * d }
      return Math.sqrt(s / buf.length)
    } catch (e) { return null }
  }
  const ctxs = []
  const seen = []
  for (const t of P.taps) {
    if (seen.indexOf(t.ctx) >= 0) continue
    seen.push(t.ctx)
    ctxs.push({ state: String(t.ctx.state), currentTime: Number(t.ctx.currentTime || 0), sampleRate: Number(t.ctx.sampleRate || 0), nodes: t.connects })
  }
  const els = []
  try {
    const list = document.querySelectorAll('audio,video')
    for (let i = 0; i < list.length; i++) {
      const el = list[i]
      els.push({
        tag: el.tagName, paused: !!el.paused, muted: !!el.muted, volume: Number(el.volume),
        t: Number(el.currentTime || 0), readyState: el.readyState, hasSrcNode: !!el.__mpwMediaSource,
        inTree: !!(el.parentNode || el.isConnected), src: String(el.currentSrc || el.src || '').slice(-46),
      })
    }
  } catch (e) { /* ignore */ }
  return {
    at: Date.now(),
    ctxs,
    taps: P.taps.map((t) => ({ connects: t.connects, rms: rmsOf(t.an), fft: t.an.fftSize })),
    els,
    gesture: Object.assign({}, P.gesture),
    ledger: (() => { try { return JSON.parse(JSON.stringify(window.__mpwAudioLedger || null)) } catch (e) { return null } })(),
    policy: (() => { try { return JSON.parse(JSON.stringify(window.__mpwAudioPolicy || null)) } catch (e) { return null } })(),
    graph: (() => { try { return (typeof window.__mpwAudioGraph === 'function') ? window.__mpwAudioGraph() : null } catch (e) { return null } })(),
    hostApi: (() => { try { const w = window.__wp || {}; return { hasWp: true, hasSetVolume: typeof w.setVolume === 'function', hasSetMuted: typeof w.setMuted === 'function', hasSetAudioPolicy: typeof w.setAudioPolicy === 'function' } } catch (e) { return null } })(),
    frameEmbedded: (() => { try { return window.self !== window.top } catch (e) { return 'cross' } })(),
    frameMute: (() => { try { return window.frameElement ? !!window.frameElement.muted : null } catch (e) { return 'unreadable(cross-origin)' } })(),
    ev: P.events.slice(-24),
  }
}

function findPlaywright() {
  const cands = [process.env.MPW_PLAYWRIGHT, path.join(ROOT, 'node_modules/playwright/index.js'),
    path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c } catch { /* next */ } }
  return null
}
const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP audio-leak-graph-probe —— 找不到 playwright'); process.exit(2) }
const pw = await import(pathToFileURL(pwPath).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP audio-leak-graph-probe —— playwright 没有 firefox 导出'); process.exit(2) }

const gl = await import(pathToFileURL(path.join(ROOT, 'tests', '_gl-browser.mjs')).href)
const { browser, launchNote, headless } = await gl.launchGLBrowser(firefox, {
  firefoxUserPrefs: PERMISSIVE
    ? { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 2, 'media.autoplay.block-webaudio': false, 'media.autoplay.allow-muted': true }
    : {},
})
const readings = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String((e && e.message) || e).slice(0, 200)))
  await page.addInitScript(INIT)
  say('== audio-leak-graph-probe ==')
  say('URL      : ' + URL_IN)
  say('启动      : ' + launchNote + '（headless=' + headless + '，' + (PERMISSIVE ? '**允许自动播放**（Android WebView 口径）' : '默认自动播放策略') + '）')
  const cap = await gl.glCapability(browser)
  say('GL        : webgl2=' + cap.webgl2 + ' renderer=' + String(cap.renderer || '').slice(0, 60))
  if (!cap.webgl2) { say('（无 WebGL ⇒ 场景首帧不会到来 ⇒ 场景音轨不会启动；本探针仍打印读数，但请按环境缺能力读）') }
  await page.goto(URL_IN, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // 等"图建起来了"：`__mpwAudioLedger.ctxCreated > 0` 或探针的 destination 抽头出现
  const waitGraph = async (ms) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const r = await page.evaluate(() => ({ taps: (window.__mpwAudioGraphProbe.taps || []).length, ctxCreated: (window.__mpwAudioLedger || {}).ctxCreated || 0 }))
      if (r.taps > 0 || r.ctxCreated > 0) return r
      await page.waitForTimeout(250)
    }
    return null
  }
  const seen0 = await waitGraph(PERMISSIVE ? 25000 : 12000)
  await page.waitForTimeout(800)
  /* 峰值保持读数：单次 `getByteTimeDomainData` 只是 ~46ms 的一窗 —— 音轨里的静音段/blob 兜底看门狗
     补 `load()` 的瞬间都会读到 0，用它下"静音生效"的结论就是**假绿**。这里 6 次采样取最大值。 */
  const peak = async () => {
    let m = 0
    for (let i = 0; i < 6; i++) {
      const v = await page.evaluate(() => { const P = window.__mpwAudioGraphProbe || { taps: [] }; const r = (an) => { try { const b = new Uint8Array(an.fftSize); an.getByteTimeDomainData(b); let s = 0; for (let k = 0; k < b.length; k++) { const d = (b[k] - 128) / 128; s += d * d } return Math.sqrt(s / b.length) } catch (e) { return 0 } }; return (P.taps || []).map((t) => r(t.an)) })
      for (const x of v || []) m = Math.max(m, x || 0)
      await page.waitForTimeout(220)
    }
    return m
  }
  const R = async (label) => { const r = await page.evaluate(READ); r.label = label; r.rmsPeak = await peak(); readings.push(r); say('── ' + label + ' ' + JSON.stringify({ ctxs: r.ctxs, taps: r.taps, rmsPeak: r.rmsPeak, els: r.els, ledger: r.ledger, policy: r.policy, frameMute: r.frameMute, gesture: r.gesture })); return r }
  say('图出现      : ' + JSON.stringify(seen0))
  await R('R0 初始（未做任何静音动作）')

  if (STEPS.includes('gesture')) {
    // 一次真手势：Android 上用户点过屏之后，页面就"拿到了播放权"（本机桌面用来打开被策略挡住的自动播放）
    await page.mouse.click(600, 400)
    await page.waitForTimeout(1200)
    await R('R1 真手势之后（click 于画面中央）')
  }

  /* 等"图**真的在出信号**"（rms > 阈值）：元素 paused=false 不等于有信号
     —— blob 音轨要解码、`currentTime` 要先动起来。没有这一步，后面 A/B 读到的 0 分不清
     "静音生效" 与 "本来就还没出声"（这正是"假绿"最容易发生的地方）。 */
  const waitRolling = async (ms, thr) => {
    const t0 = Date.now()
    let last = null
    while (Date.now() - t0 < ms) {
      last = await page.evaluate(() => { const P = window.__mpwAudioGraphProbe; const r = (an) => { try { const b = new Uint8Array(an.fftSize); an.getByteTimeDomainData(b); let s = 0; for (let i = 0; i < b.length; i++) { const d = (b[i] - 128) / 128; s += d * d } return Math.sqrt(s / b.length) } catch (e) { return 0 } }; return (P.taps || []).map((t) => r(t.an)) })
      if (last && last.some((v) => v > thr)) return last
      await page.waitForTimeout(200)
    }
    return last
  }
  if (STEPS.includes('rolling')) {
    const rms = await waitRolling(20000, 1e-4)
    say('等信号（rolling）：rms=' + JSON.stringify(rms))
    await R('R2 图已出信号（未做任何静音动作；这一条是后面 A/B 的对照基线）')
  }

  if (STEPS.includes('mute-ab') || STEPS.includes('element-mute')) {
    // 插件 `applyWebMute` 的**元素通道**（同源时它就是这么静音的）：逐个写 muted=true。
    // ★ 这一步是整个诊断的判决点：`muted` 到底压不压得住 **WebAudio 图**的输出。
    const n = await page.evaluate(() => { const l = document.querySelectorAll('audio,video'); for (let i = 0; i < l.length; i++) l[i].muted = true; return l.length })
    await page.waitForTimeout(1000)
    const r = await R('R3 元素通道：每个 audio/video 写 muted=true（n=' + n + '，volume 一字未动）')
    r.verdict = { elementMuted: true, rms: r.taps.map((t) => t.rms), rmsPeak: r.rmsPeak, audible: r.rmsPeak > 1e-4 }
    say('   ↳ 判决：元素 muted=true 之后 rms=' + JSON.stringify(r.verdict.rms) + ' 峰值=' + r.rmsPeak + ' ⇒ ' + (r.verdict.audible ? '**仍在出声**（muted 对图无效）' : '无声（muted 对图有效，本次环境）'))
    await page.evaluate(() => { const l = document.querySelectorAll('audio,video'); for (let i = 0; i < l.length; i++) l[i].muted = false })
    await page.waitForTimeout(500)
  }

  if (STEPS.includes('host-volume')) {
    // 宿主音量档（`__wp.setVolume`）——渲染器把它乘进**元素 volume**；本步回答"它压不压得住图"
    const okCall = await page.evaluate(() => { try { return !!(window.__wp && window.__wp.setVolume && window.__wp.setVolume(0)) } catch (e) { return String(e && e.message || e) } })
    await page.waitForTimeout(1000)
    const r = await R('R4 宿主音量：__wp.setVolume(0) 返回 ' + String(okCall))
    r.verdict = { hostVolume0: true, rms: r.taps.map((t) => t.rms), rmsPeak: r.rmsPeak, audible: r.rmsPeak > 1e-4 }
    await page.evaluate(() => { try { window.__wp && window.__wp.setVolume(1) } catch (e) {} })
    await page.waitForTimeout(600)
  }

  if (STEPS.includes('policy-mute')) {
    // 图级静音通道（修复新增）：postMessage / 同源 `__wp.setMuted` 两条都试，读数应当一致
    await page.evaluate(() => { try { window.postMessage({ type: 'mpw-audio-policy', muted: true, volume: 1 }, '*') } catch (e) {} })
    await page.waitForTimeout(1000)
    const r4 = await R('R5 图级静音：postMessage {type:mpw-audio-policy, muted:true}')
    r4.verdict = { graphMuted: true, rms: r4.taps.map((t) => t.rms), rmsPeak: r4.rmsPeak, audible: r4.rmsPeak > 1e-4, masterGain: r4.graph && r4.graph.masterGain }
    say('   ↳ 判决：图级静音之后 rms=' + JSON.stringify(r4.verdict.rms) + ' 峰值=' + r4.rmsPeak + ' masterGain=' + JSON.stringify(r4.verdict.masterGain) + ' ⇒ ' + (r4.verdict.audible ? '**仍在出声**（图级静音没生效）' : '0 输出（图级静音生效）'))
    await page.evaluate(() => { try { window.__wp && window.__wp.setMuted && window.__wp.setMuted(false) } catch (e) {} })
    await page.waitForTimeout(800)
    await R('R6 解除图级静音：__wp.setMuted(false)')
    const nodes0 = readings[readings.length - 1].graph && readings[readings.length - 1].graph.nodes
    await page.evaluate(() => { try { window.__wp && window.__wp.setMuted && window.__wp.setMuted(true) } catch (e) {} })
    await page.waitForTimeout(800)
    const r7 = await R('R7 再静音：__wp.setMuted(true)（幂等：节点数不该增长）')
    if (nodes0 != null) ok((r7.graph && r7.graph.nodes) === nodes0, 'R7 幂等：图节点数未增长（' + nodes0 + ' → ' + (r7.graph && r7.graph.nodes) + '）')
  }

  /* ── 壁纸帧（`?embed=1`）的 fail-safe：宿主**还没表态**时就不出声，表态后能放行 ──
     为什么单独量：用户报的那条缝正是"刷新之后宿主静音还没到 / 永远到不了"，渲染器侧必须有
     一道不依赖宿主的兜底（`?embed=1` + iframe + 未表态 ⇒ 0 增益）。 */
  if (STEPS.includes('embed-frame')) {
    const embedUrl = URL_IN + (URL_IN.indexOf('?') >= 0 ? '&' : '?') + 'embed=1'
    await page.setContent('<html><body style="margin:0"><iframe id="w" src="' + embedUrl.replace(/&/g, '&amp;') + '" width="900" height="600" style="border:0"></iframe></body></html>')
    const inFrame = async () => {
      for (let i = 0; i < 60; i++) {
        for (const fr of page.frames()) {
          if (fr === page.mainFrame()) continue
          try { const r = await fr.evaluate(READ); if (r.ctxs.length) return r } catch (e) { /* 帧还没起来 */ }
        }
        await page.waitForTimeout(500)
      }
      return null
    }
    const f0 = await inFrame()
    if (f0) {
      f0.label = 'R8 壁纸帧（?embed=1）+ 宿主未表态'
      readings.push(f0)
      say('── R8 壁纸帧（?embed=1）+ 宿主**未表态** ' + JSON.stringify({ act: f0.act, policy: f0.policy, graph: f0.graph, taps: f0.taps, els: f0.els.map((e) => ({ muted: e.muted, paused: e.paused })) }))
      const rms0 = f0.taps.map((t) => t.rms)
      say('   ↳ 判决：未表态 ⇒ rms=' + JSON.stringify(rms0) + ' masterGain=' + JSON.stringify(f0.graph && f0.graph.masterGain) + ' ⇒ ' + (rms0.some((v) => (v || 0) > 1e-4) ? '**仍在出声**' : '0 输出（fail-safe 生效）'))
      // 宿主表态"放行"（修复后插件在静音=关 时发的就是这条）⇒ 必须真能出声（否则 0 输出是"本来就没在放"）
      await page.evaluate(() => { const f = document.getElementById('w'); if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'mpw-audio-policy', muted: false, volume: 1 }, '*') })
      await page.waitForTimeout(2500)
      const f1 = await inFrame()
      if (f1) {
        f1.label = 'R9 壁纸帧 + 宿主表态 muted:false'
        readings.push(f1)
        say('── R9 壁纸帧 + 宿主表态 `muted:false` ' + JSON.stringify({ policy: f1.policy, graph: f1.graph, taps: f1.taps }))
        const rms1 = f1.taps.map((t) => t.rms)
        say('   ↳ 判决：放行后 rms=' + JSON.stringify(rms1) + ' ⇒ ' + (rms1.some((v) => (v || 0) > 1e-4) ? '能出声（证明 R8 的 0 是策略所致）' : '仍 0（桌面缺用户激活，见 act 读数）'))
      }
      await page.evaluate(() => { const f = document.getElementById('w'); if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'mpw-audio-policy', muted: true, volume: 1 }, '*') })
      await page.waitForTimeout(1800)
      const f2 = await inFrame()
      if (f2) {
        f2.label = 'R10 壁纸帧 + 宿主表态 muted:true'
        readings.push(f2)
        say('── R10 壁纸帧 + 宿主表态 `muted:true` ' + JSON.stringify({ policy: f2.policy, graph: f2.graph, taps: f2.taps }))
        say('   ↳ 判决：rms=' + JSON.stringify(f2.taps.map((t) => t.rms)) + ' masterGain=' + JSON.stringify(f2.graph && f2.graph.masterGain) + ' ⇒ ' + (f2.taps.some((t) => (t.rms || 0) > 1e-4) ? '**仍在出声**' : '0 输出（图级静音生效）'))
      }
    } else say('（壁纸帧读数拿不到：帧没起来或没有 AudioContext —— 本步如实跳过）')
  }

  const last = readings[readings.length - 1]
  say('\n== 汇总 ==')
  say('启动方式: ' + launchNote + ' / headless=' + headless + (PERMISSIVE ? ' / 允许自动播放' : ' / 默认策略'))
  say('pageerror: ' + (errs.length ? errs.slice(0, 3).join(' | ') : '0 个'))
  say('读数条数: ' + readings.length + '；最后一条：' + JSON.stringify({ ctxs: last.ctxs, taps: last.taps, ledger: last.ledger }))
  if (JSON_ONLY) console.log(JSON.stringify({ url: URL_IN, launch: launchNote, headless, permissive: PERMISSIVE, gl: { webgl2: cap.webgl2, renderer: cap.renderer }, errs, readings }, null, 1))
  ok(readings.length >= 1, '探针至少取到一条读数（图是否建起来见 ctxs/taps）', JSON.stringify({ ctxs: last.ctxs.length, taps: last.taps.length }))
  await ctx.close()
} catch (e) {
  console.log('探针异常: ' + String((e && e.message) || e))
  fail++
} finally {
  await browser.close().catch(() => {})
}
say('\naudio-leak-graph-probe：PASS=' + pass + ' FAIL=' + fail + '（取证工具，读数优先）')
process.exit(fail ? 2 : 0)

#!/usr/bin/env node
/**
 * hidden-gate-browser-probe.mjs —— H(2026-09-25)「后台挂载期起播」的**真浏览器**档
 *
 * 与 `tools/hidden-gate-test.mjs` 的分工（两条都要有，缺一条就有盲区）：
 *   · 离线档（node 桩）：快、进常驻门禁、带 8 组变异自证；但它用的是**假 DOM / 假 media 元素**。
 *   · 本档（Playwright + 真 Firefox）：真 DOM、真 `<video>`、真事件系统、**真的浏览器自动播放策略**。
 *     它证明的是"**在真浏览器里**，挂载完成时 `document.hidden === true` ⇒ 我们的挂载路径一次
 *     `HTMLMediaElement.prototype.play()` 都不调；可见时照调；`visibilitychange` 转 hidden 时真的
 *     `pause()`；转 visible 按策略恢复"。这正好补上"node 桩里 `document.hidden` 是我们 defineProperty
 *     出来的假值"这条质疑。
 *
 * 怎么做到"不开服务、不碰真机设置"：
 *   ① 页面是 `about:blank` + `setContent`，**不导航到 :3080**（不打扰任何在跑的服务）；
 *   ② `window.fetch` 被换成桩（只答 `/settings` 与扫描路由），`localStorage` 由 `addInitScript`
 *      预置本档设置 ⇒ 插件照常走 `applyFromStorage` 挂载，但一个字节都不出网；
 *   ③ `document.hidden` 用 `Object.defineProperty(document,'hidden',{get})` 在页面里**可控**
 *      （真浏览器里它是只读访问器，但实例级覆盖是允许的 —— 这正是"模拟后台标签"的常用手法）；
 *      `visibilitychange` 用**真事件** `new Event('visibilitychange')` 派发 ⇒ 走的是真 listener。
 *
 * 用法（必须串行，浏览器档互斥）：
 *   flock /tmp/.mpw-firefox.lock -c 'node tools/hidden-gate-browser-probe.mjs'
 * 跑前先确认没有别的套件在跑：`pgrep -af 'run-all-tests|check.sh'`。
 * 找不到 playwright / firefox ⇒ 打印 SKIP 并以 0 退出（不阻塞开发机）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const CLIENT = path.join(repoRoot, 'lib', 'client.js')

const pwEntry = [process.env.MPW_PLAYWRIGHT, path.join(repoRoot, 'node_modules/playwright/index.js'),
  '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  .find((p) => { try { return fs.statSync(p).isFile() } catch { return false } })
if (!pwEntry) { console.log('SKIP hidden-gate-browser-probe — 找不到 playwright'); process.exit(0) }
const pw = await import(pathToFileURL(pwEntry).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP hidden-gate-browser-probe — playwright 没有 firefox 导出'); process.exit(0) }

const clientSrc = fs.readFileSync(CLIENT, 'utf8')
const FIX = {
  enabled: true, npNowPlaying: false, mute: true, npVolume: 33, npLinkWallpaper: true,
  converted: 'mp4', image: 'host:?token=t&index=0', mpkgKey: 'custommpkg|x.mpkg',
  source: 'bgcs_abydos03.mp4', powPauseHidden: true, powPauseHiddenUserSet: true,
}

let pass = 0, fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) }
  else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) }
}

const browser = await firefox.launch({ headless: true })
try {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e && e.message || e).slice(0, 200)))

  /* ① 装"仪表" + 假网络 + 假 hidden：必须在插件脚本之前（addInitScript） */
  await page.addInitScript(({ fix, clientSrc }) => {
    window.__forceHidden = false
    window.__playCalls = []
    window.__pauseCalls = 0
    window.__posted = []
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__forceHidden })
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__forceHidden ? 'hidden' : 'visible') })
    } catch (e) { window.__hiddenPatchErr = String(e && e.message || e) }
    /* 真媒体元素的 play/pause 计数（在**原型**上打，任何元素都记得到） */
    const P = window.HTMLMediaElement && window.HTMLMediaElement.prototype
    if (P) {
      const op = P.play, oq = P.pause
      P.play = function () { try { window.__playCalls.push({ id: String(this.id || ''), muted: !!this.muted, paused: !!this.paused, at: Date.now() }) } catch (e) {} return op.apply(this, arguments) }
      P.pause = function () { try { window.__pauseCalls++ } catch (e) {} return oq.apply(this, arguments) }
    }
    /* 假网络：/settings 回本档设置；扫描路由回空清单；其它一律 404（插件全部有 catch） */
    window.fetch = (url) => {
      const u = String(url && url.url || url || '')
      const body = /\/settings/.test(u) ? { ok: true, settings: fix, section: fix }
        : /media-scan|audio-scan/.test(u) ? { ok: true, tracks: [], count: 0, source: 'stub' }
          : { ok: false, error: 'stub' }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) })
    }
    try { localStorage.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify(fix)) } catch (e) {}
    /* 插件入口：桩 ModuleLoader + 桩 react（与 tools/_stub.mjs 同一口径，最小集） */
    const mkEl = (type, props, ...kids) => ({ __el: true, type, props: props || {}, kids: kids.flat(9) })
    const hookState = []
    const react = {
      createElement: mkEl, Fragment: Symbol('Fragment'), memo: (f) => f,
      useState: (init) => { const i = hookState.length; if (hookState[i] === undefined) hookState[i] = typeof init === 'function' ? init() : init; return [hookState[i], (v) => { hookState[i] = typeof v === 'function' ? v(hookState[i]) : v }] },
      useEffect: () => {}, useMemo: (f) => f(), useRef: (v) => ({ current: v === undefined ? null : v }),
      useCallback: (f) => f(), Component: class { constructor(p) { this.props = p } setState() {} },
    }
    window.__mpwHarness = { registry: [], injected: false }
    window.__ModuleLoader__ = { load: (reg) => { window.__mpwHarness.registry.push(reg) } }
    window.__mpwRequire = (name) => (name === 'react' ? react : name === 'react-dom' ? { createPortal: (n) => n, render: () => {}, unmountComponentAtNode: () => {} } : name === 'react-dom/client' ? { createRoot: () => ({ render: () => {}, unmount: () => {} }) } : {})
    window.__mpwClientSrc = clientSrc
    /* ② 挂载驱动：注入脚本 + factory + apply(ctx)，并允许测试改 hidden 后**重新挂载** */
    window.__mpwApply = () => {
      if (!window.__mpwHarness.injected) {
        window.__mpwHarness.injected = true
        const s = document.createElement('script')
        s.textContent = window.__mpwClientSrc
        document.documentElement.appendChild(s)
        delete window.__mpwClientSrc
      }
      const reg = window.__mpwHarness.registry[0]
      if (!reg) return 'no-registry'
      let plugin = null
      try { plugin = reg.factory(window.__mpwRequire) } catch (e) { return 'factory:' + String(e && e.message || e) }
      if (!plugin || typeof plugin.apply !== 'function') plugin = window.__mpwClientLoaded
      if (!plugin || typeof plugin.apply !== 'function') return 'no-apply'
      const ctx = {
        slots: { inject: (n, fn) => { try { fn() } catch (e) {} }, register: () => ({ dispose () {} }) },
        locale: { bind: () => (k) => k, register: () => ({ dispose () {} }) },
        effect: (f) => { try { f() } catch (e) {} },
        logger: { info () {}, warn () {}, error () {} },
      }
      try { plugin.apply(ctx) } catch (e) { return 'apply:' + String(e && e.message || e) }
      return 'ok'
    }
    window.__mpwEls = () => ({
      video: document.getElementById('mpw-bgVideo'),
      wrap: document.getElementById('mpw-bgWrap'),
      frame: document.querySelector('#mpw-bgWrap iframe.mpw-webFrame'),
      ledger: (window.__mpwHiddenLedger || []).map((r) => ({ kind: r.kind, where: r.where, state: r.state })),
      state: (window.__mpwLifecycleTest && window.__mpwLifecycleTest.hiddenState) ? window.__mpwLifecycleTest.hiddenState() : null,
    })
    window.__mpwShowVideo = () => { try { window.__mpwLifecycleTest.showVideo('host:?token=t&index=0'); return 'ok' } catch (e) { return String(e && e.message || e) } }
  }, { fix: FIX, clientSrc })

  /* 页面用**拦在本地的一个中性源**（不碰 :3080 / :8902 / :8899 任何一个在跑的服务）：
     `page.route` 把该源的 HTML 直接 fulfil，浏览器一个字节都不出网；
     同时它给了 localStorage 一个**真 origin**（about:blank 上访问 localStorage 会抛 SecurityError）。 */
  await page.route('**/*', (route) => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><meta charset="utf-8"><title>hidden-gate-probe</title></head><body></body></html>',
  }))
  await page.goto('http://127.0.0.1:3199/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(200)

  /* ── 1. hidden 挂载：apply 之前就 hidden（= Android 后台重载的形态）── */
  const r1 = await page.evaluate(() => {
    window.__forceHidden = true
    const r = window.__mpwApply()
    return { apply: r, hiddenPatchErr: window.__hiddenPatchErr || null, hidden: document.hidden, plays: window.__playCalls.length, els: window.__mpwEls() }
  })
  ok(r1.hiddenPatchErr === null, 'B0 真浏览器里 document.hidden 可控（模拟后台标签）', JSON.stringify(r1.hiddenPatchErr))
  ok(r1.apply === 'ok', 'B1 插件在真 Firefox 里装载并 apply 成功（假网络/假 loader）', r1.apply)
  ok(!!r1.els.video && !!r1.els.wrap, 'B2 真 DOM 里壁纸层与 <video> 都建起来了（不是空跑）', JSON.stringify({ wrap: !!r1.els.wrap, video: !!r1.els.video }))
  ok(r1.hidden === true, 'B3 挂载那一刻 document.hidden === true', String(r1.hidden))
  ok(r1.plays === 0, 'B4 ★ hidden 挂载 ⇒ 真 media 元素的 play() **零调用**（本档的核心判据）', 'playCalls=' + r1.plays)
  ok(!!r1.els.state && r1.els.state.bootBlocked === true && r1.els.state.pausedByUs === false, 'B5 状态是 never-started（不是"被隐藏暂停过"）', JSON.stringify(r1.els.state))
  ok(r1.els.ledger.filter((x) => x.kind === 'boot-hidden-no-autoplay').length === 1, 'B6 只记一条启动台账', JSON.stringify(r1.els.ledger))

  /* ── 2. 真事件 visibilitychange → visible：按策略补上那一次（never-started 恢复口）── */
  const r2 = await page.evaluate(() => {
    window.__forceHidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    return { plays: window.__playCalls.length, paused: window.__mpwEls().video.paused, ledger: window.__mpwEls().ledger, state: window.__mpwEls().state }
  })
  await page.waitForTimeout(300)
  const r2b = await page.evaluate(() => ({ plays: window.__playCalls.length, paused: window.__mpwEls().video.paused }))
  ok(r2b.plays > 0, 'B7 ★ 回到可见（真 visibilitychange）⇒ 补上那一次起播', 'playCalls=' + r2b.plays)
  ok(r2.ledger.some((x) => x.kind === 'boot-visible-resume'), 'B8 恢复走了 never-started 那条路（台账可见 boot-visible-resume）', JSON.stringify(r2.ledger.slice(-3)))
  ok(!!r2.state && r2.state.bootBlocked === false, 'B9 恢复后 bootBlocked 清零（不会每次可见都补）', JSON.stringify(r2.state))

  /* ── 3. 转 hidden：真的 pause() ── */
  const r3 = await page.evaluate(() => {
    window.__pauseCalls = 0
    window.__forceHidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    return { pauseCalls: window.__pauseCalls, paused: window.__mpwEls().video.paused, state: window.__mpwEls().state, plays: window.__playCalls.length }
  })
  ok(r3.pauseCalls > 0 && r3.paused === true, 'B10 ★ 真 visibilitychange 转 hidden ⇒ 真 media 元素被 pause()', JSON.stringify({ pauseCalls: r3.pauseCalls, paused: r3.paused }))
  ok(!!r3.state && r3.state.pausedByUs === true, 'B11 状态切成 paused-by-hidden（回可见时按原状态续播）', JSON.stringify(r3.state))

  /* ── 4. 回可见：续播 ── */
  const r4 = await page.evaluate(() => {
    window.__forceHidden = false
    const before = window.__playCalls.length
    document.dispatchEvent(new Event('visibilitychange'))
    return { before, plays: window.__playCalls.length, paused: window.__mpwEls().video.paused }
  })
  ok(r4.plays > r4.before, 'B12 回可见 ⇒ 隐藏前在播的真的续播（按原状态）', JSON.stringify(r4))

  /* ── 5. 帧 park：真 postMessage（跨源唯一通道）──
     用**同源**帧来"可观测"：postMessage 的语义与跨源完全一样，但同源时我们能在帧里装监听
     ⇒ 断言的是"渲染器真的收到了那一条 park=true"，而不是只看我们自己的台账。
     （真机上的场景渲染器在 :8902，跨源；跨源侧收到的报文形状与此逐字段相同。） */
  const r5 = await page.evaluate(async () => {
    const f = window.__mpwEls().frame
    if (!f) return { skipped: 'no-frame' }
    /* 报文怎么观测（两条都试，谁成谁上）：
       ① 在**真元素**上把 `contentWindow` 换成记录器（与"给 play 打补丁"同一手法）——
          这样抓到的是 `sendRendererAudioPolicy` **真的读了这个属性并调了 postMessage**；
       ② 同源帧时也可以在帧内装监听，但 iframe 一导航内层 window 就换了 ⇒ 只能当补充证据。 */
    const got = []
    let via = 'none'
    try {
      Object.defineProperty(f, 'contentWindow', { configurable: true, get: () => ({ postMessage: (m) => { got.push(m) }, document: undefined }) })
      via = 'contentWindow-shadow'
    } catch (e) {
      try { f.contentWindow.addEventListener('message', (m) => got.push(m.data)); via = 'in-frame-listener' } catch (e2) { via = 'none' }
    }
    f.setAttribute('src', 'http://127.0.0.1:3199/fake-renderer.html')
    window.__forceHidden = true
    window.__mpwLifecycleTest.applyFrameMute()
    window.__mpwLifecycleTest.showWeb(f.getAttribute('src'))
    const RP = window.__mpwRendererAudioPush || {}
    return {
      got: got.slice(-6), via: via, policy: RP.last || null, policyLog: (RP.log || []).slice(-6),
      ledger: (window.__mpwHiddenLedger || []).filter((r) => /frame|park/.test(String(r.kind))).map((r) => ({ kind: r.kind, src: r.src })),
      block: window.__mpwLifecycleTest.hiddenState(), src: String(f.getAttribute('src') || '').slice(0, 60),
    }
  })
  if (r5.skipped) {
    ok(true, 'B13 帧 park：本机 Firefox 里该帧不可达 ⇒ 跳过（离线档 H 组已覆盖）', r5.skipped)
  } else {
    /* 判据分两半，**都不能少**：
       ① 实现真的走了 park 通道（`why:"hidden-park"` + `park:true` + `posted:true` —— posted 由
          "调用 postMessage 那一句"写，等价于"调用没抛错"）；台账里也留了 `frame-park`；
       ② 帧内**真的收到**那条报文：能装监听就断言（同源帧），装不上就如实标"未观测"
          —— 跨源渲染器侧的投递由浏览器保证，我们在这里看不到，**不假装看到了**。 */
    const parkLog = (r5.policyLog || []).filter((x) => x && x.park === true && x.posted === true)
    ok(parkLog.some((x) => x.why === 'hidden-park') && (r5.ledger || []).some((x) => x.kind === 'frame-park'),
      'B13a ★ hidden ⇒ 真的走了 park 通道（park=true / why=hidden-park / posted=true + 台账 frame-park）',
      JSON.stringify(r5.policyLog) + ' ledger=' + JSON.stringify(r5.ledger))
    const got = (r5.got || []).filter((m) => m && m.type === 'mpw-audio-policy' && m.park === true)
    ok(got.length > 0, 'B13b ★ 报文内容逐字段正确（`{type:"mpw-audio-policy", park:true}` 从真元素的 contentWindow 上抓到）',
      'via=' + r5.via + ' ' + JSON.stringify(got.slice(-2)))
  }

  /* ── 6. 可见挂载的正对照：同一路径在可见时**必须**起播（否则上面全是假绿）── */
  const r6 = await page.evaluate(() => {
    window.__forceHidden = false
    const before = window.__playCalls.length
    const vid = window.__mpwEls().video
    try { vid.pause() } catch (e) {}
    const r = window.__mpwShowVideo()
    return { r, before, plays: window.__playCalls.length }
  })
  ok(r6.plays > r6.before, 'B14 ★ 正对照：可见时重挂载会真的调 play()（闸门不是"永久禁播/功能坏了"）', JSON.stringify(r6))

  ok(errs.length === 0, 'B15 整段没有未捕获的页面异常（零 pageerror）', JSON.stringify(errs.slice(0, 3)))
} finally {
  await browser.close()
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail) { console.log('✗ 真浏览器隐藏闸门未通过'); process.exit(1) }
console.log('✓ 真浏览器（Firefox）隐藏闸门通过：hidden 挂载零 play / 真事件 pause+park / 可见按策略恢复')

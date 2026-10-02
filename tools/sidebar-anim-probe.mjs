// tools/sidebar-anim-probe.mjs —— **真页面（:3080）**上量「左侧边栏收起动画」期间的 rAF 帧间隔 + longtask + MutationObserver 族开销
//
// 背景（批次 2 P1A）：点击左栏收起按钮，动画只跳 3 下就到位。此前一次临时测量（未入仓）：
//   插件生效时 rAF 峰值窗口 ≈650–684 ms，把插件 CSS/JS 中性化后 ≈267 ms。本探针把测量工具化、可复跑。
//   本档**只做测量**：不动 lib/client.js（修复 = P1B，等 3.15.5）。任务书里的 `?mpwperf=off`（apply()
//   最前面 return）**没有实现** —— 它要改 lib/client.js，而 docs/RELEASE.md 还没有 3.15.5 行（文件归属
//   约束）⇒ 对照组改用**页内精准中性化**（见下），等 3.15.5 之后补开关 + 登记进 docs/DIAGNOSTICS.md。
//
// 对照组（off）怎么"中性化"（页面脚本执行前包一层 MutationObserver 构造器，之后三步全记录、可审计）：
//   ① 摘插件样式：`style[data-plugin="dsh-mpkg-wallpaper"]`（插件唯一入口 getStyleEl 打的这个属性）；
//   ② 摘插件挂的常驻 DOM：#mpw-bgWrap（壁纸容器，含 img/video/iframe）、.mpw_np*（悬浮播放器）、
//      .mpw-hdrFrost（标题栏磨砂层）、body 上的 data-mpw-* 门控属性；
//   ③ 断插件自己的 MutationObserver：宿主把所有插件 client 打包进**同一个** `/plugins/??...` 组合响应，
//      没法按 URL 拦 ⇒ 用 needle 映射：lib/client.js 里每个 `new MutationObserver` 构造点的**前导 60 字符**
//      在组合响应文本里定位行号（顺带自证组合响应逐字含 client.js）⇒ 构造栈顶帧行号命中的族 = 插件的，
//      只断这些实例（宿主 observer 一个不碰）。映射不上（0 个 needle 命中）⇒ 如实记 `observerNeutralize:"failed"`
//      并继续（①②仍生效），不假装断干净了。
//   ⚠ 口径：中性化后插件代码仍在内存里（定时器/事件监听还在，1s/2s/3s 级 tick 窗口内最多一次），
//     壁纸也随 ② 一起没了 ⇒ "开"组读数**含壁纸渲染成本**，两组差值是「observer+CSS+壁纸」的总效应，
//     不是纯 observer 开销 —— 别过度解读。
//
// 量什么（每组 = on / off，各连跑 N 次，默认 3）：
//   · 收起按钮点击后 1.5 s 窗口内 rAF 帧间隔：帧数 / p50 / p95 / max / >50 ms 空档数；
//   · longtask（PerformanceObserver，Firefox 129+；不支持如实记 unsupported）；
//   · 每个 MutationObserver 族：注册数 / 窗口内批次数 / 批次耗时合计与最大 / p95 / 是否插件族 / 构造栈；
//   · 佐证：点击前后侧栏宽度变化（证明点击真的收起了）、bgVideo 是否在播。
//
// 诚实边界（与其它真机探针同规矩）：
//   · 页面要 DSH 鉴权 Cookie：复用 `tools/hdr-probe-mint-cookie.mjs`（自签、只读密钥、不落库）；
//   · 不写用户设置：settings.json 跑前 sha256 快照、跑完逐字节还原；默认拦掉插件往宿主的写回；
//     插件 localStorage 在探针自己的临时 profile 里，不碰用户浏览器；
//   · 收起按钮**先 dump 候选再锁定**（--scan 只打印不点击），不硬猜 aria-label；
//   · 稳定性：同组 3 次的 p95 波动 ≤15% 视为稳定；不稳就如实标 unstable，不编均值。
//
// 串行纪律（一次只开一个 Firefox）：脚本自己 flock（`MPW_PROBE_LOCKED=1` 防递归），也可外面再包
//   `flock /tmp/.mpw-firefox.lock -c 'node tools/sidebar-anim-probe.mjs'`；静音三件套 `withAudioMute()`。
//
// 用法:
//   node tools/sidebar-anim-probe.mjs --scan                 # 只 dump 收起按钮候选（不开测量、不改任何东西）
//   node tools/sidebar-anim-probe.mjs                        # 两组 × 3 次，写 tools/probe-out/sidebar-anim.json
//   node tools/sidebar-anim-probe.mjs --runs 3 --groups on,off --btn-index 0 --headed
// 退出码: 0 全部采集成功 / 2 blocked（页面/插件/按钮拿不到）/ 3 采集到了但有 run 失败
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { withAudioMute } from './_audio-mute.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
const has = (n) => argv.includes('--' + n)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(HERE, '..')
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const URL0 = 'http://' + AUTHORITY + '/'
const OUT = path.resolve(arg('out', path.join(PLUGIN, 'tools', 'probe-out', 'sidebar-anim.json')))
const WORK = path.resolve(arg('work', path.join(os.tmpdir(), 'mpw-sidebar-anim')))
const COOKIE = path.join(WORK, 'cookie.json')
const SCAN = has('scan')
const HEADED = has('headed')
const RUNS = Math.max(1, Number(arg('runs', '3')))
const GROUPS = String(arg('groups', 'on,off')).split(',').map((x) => x.trim()).filter(Boolean)
const BTN_INDEX = Number(arg('btn-index', '-1'))  // --scan 后可手动指定候选下标；默认按打分自动选
const SETTLE = Number(arg('settle', '1500'))      // reload/中性化后的稳定等待
const HOST_WAIT = Number(arg('host-wait', '8000'))
const WINDOW_MS = Number(arg('window', '1500'))   // 点击后的采样窗口
const VIEWPORT = (() => {
  const m = String(arg('viewport', '1920x1200')).match(/^(\d+)x(\d+)$/)
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1920, height: 1200 }
})()
const SETTINGS_JSON = path.resolve(arg('settings', path.join(os.homedir(), '.dsh-mpkg-wallpaper', 'settings.json')))
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/* needle 源：lib/client.js 里每个 `new MutationObserver` 构造点的前导 60 字符（组合响应逐字含 client.js 时才命中） */
const NEEDLE_LEN = 60
const clientSrc = (() => { try { return fs.readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8') } catch (e) { return '' } })()
const needles = []
{
  const re = /new MutationObserver/g
  let m
  while ((m = re.exec(clientSrc))) {
    const start = Math.max(0, m.index - NEEDLE_LEN)
    needles.push(clientSrc.slice(start, m.index))
  }
}

/* ── 0 串行锁：一次只开一个 Firefox（与其它探针共用同一把锁文件） ───────────────────── */
const LOCK = process.env.MPW_FIREFOX_LOCK || path.join(os.tmpdir(), '.mpw-firefox.lock')
if (process.env.MPW_PROBE_LOCKED !== '1' && process.env.MPW_PROBE_NO_FLOCK !== '1') {
  const hasFlock = spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0
  if (hasFlock) {
    const wait = String(Number(arg('lock-wait', '900')))
    const r = spawnSync('flock', ['-w', wait, LOCK, process.execPath, fileURLToPath(import.meta.url), ...argv], {
      stdio: 'inherit', env: Object.assign({}, process.env, { MPW_PROBE_LOCKED: '1' }),
    })
    process.exit(r.status === null ? 1 : r.status)
  }
  console.log('⚠ 本机没有 flock ⇒ 本次没有加串行锁（同时跑多个浏览器探针会互相干扰）')
}

/* ── 1 页面侧注入（每个 navigation 的文档脚本执行前）：MO 族记账 + longtask + rAF 采集器 ── */
const INIT_SCRIPT = `
(() => {
  if (window.__mpwAnimProbeInstalled) return
  window.__mpwAnimProbeInstalled = true
  // ── ① MutationObserver 构造器包装：一族 = 一个构造调用。
  //    标签 = 回调源码前 100 字 + 构造点栈顶 4 帧（帧里带 组合URL:行:列 ⇒ 行号可对回 needle 映射）。
  const NativeMO = window.MutationObserver
  const families = []      // { idx, sig, stack, frames[], observes, disconnects, batches, totalMs, maxMs, durs[] }
  const instances = []     // { inst, idx, stack } —— 中性化按栈行号精确断开
  const events = []        // { t, f, d }  批次(时间戳, 族下标, 耗时ms)
  const EV_CAP = 80000
  const parseFrames = (stack) => {
    // Firefox 帧：func@url:line:col；锚定行首取第一个 @ 作分隔（组合 URL 自身含 @，不能从右侧找）
    // 完整 URL 只留在内存（组合 URL 本身 >1KB，序列化截断会让行号丢失 ⇒ 必须在页内完成匹配）
    const out = []
    for (const fr of (stack || '').split(' | ')) {
      const m = fr.match(/^([^@\\s]*)@(.+):(\\d+):(\\d+)\\s*$/)
      if (m) out.push({ fn: m[1].slice(0, 60), url: m[2], line: Number(m[3]) })
    }
    return out
  }
  class MO extends NativeMO {
    constructor(cb) {
      let sig = ''
      try { sig = String(cb).replace(/\\s+/g, ' ').slice(0, 100) } catch (e) {}
      let stack = ''
      try { stack = String(new Error().stack || '').split('\\n').slice(1, 5).map(s => s.trim().replace(/^at /, '')).join(' | ') } catch (e) {}
      const idx = families.length
      const wrapped = function (records, obs) {
        const t0 = performance.now()
        const n = records && records.length
        try { return cb.call(this, records, obs) }
        finally {
          const dt = performance.now() - t0
          const f = families[idx]
          if (f) {
            f.batches++; f.totalMs += dt
            if (dt > f.maxMs) f.maxMs = dt
            if (f.durs.length < 6000) f.durs.push(dt)
          }
          if (events.length < EV_CAP) events.push({ t: Math.round(t0 * 100) / 100, f: idx, d: Math.round(dt * 1000) / 1000, n })
        }
      }
      super(wrapped)
      const frames = parseFrames(stack)
      families.push({ idx, sig, stack: stack.slice(0, 220), frames, observes: 0, disconnects: 0, batches: 0, totalMs: 0, maxMs: 0, durs: [] })
      instances.push({ inst: this, idx, frames })
      this.__mpwFam = idx
    }
    observe(target, opts) {
      const f = families[this.__mpwFam]
      if (f) f.observes++
      return super.observe(target, opts)
    }
    disconnect() {
      const f = families[this.__mpwFam]
      if (f) f.disconnects++
      return super.disconnect()
    }
  }
  window.MutationObserver = MO
  const hitFrames = (frames, map) => {
    for (const fr of frames || []) {
      const ls = map && map[fr.url.split('?')[0]]
      if (ls && ls.indexOf(fr.line) >= 0) return { line: fr.line }
    }
    return null
  }
  window.__mpwMo = {
    /* map = { URL去参: [构造点行号…] }（needle 映射）；给得出 ⇒ 逐族打 isPlugin 标签（完整 URL 不出页） */
    families: (map) => families.map((f) => {
      const out = { idx: f.idx, sig: f.sig, stack: f.stack, observes: f.observes, disconnects: f.disconnects }
      const m = hitFrames(f.frames, map)
      out.isPlugin = !!m
      if (m) out.pluginLine = m.line
      return out
    }),
    events: () => events.slice(),
    reset: () => { events.length = 0; for (const f of families) { f.batches = 0; f.totalMs = 0; f.maxMs = 0; f.durs.length = 0 } },
    /* 中性化：只断"构造点 (URL去参,行号) ∈ map"的实例 + 摘插件样式/常驻 DOM/门控属性。返回账目，绝不碰宿主 observer。 */
    neutralize: (map) => {
      let disconnected = 0, kept = 0
      const touched = []
      for (const it of instances) {
        const m = hitFrames(it.frames, map)
        if (m) { try { it.inst.disconnect(); disconnected++; touched.push({ idx: it.idx, line: m.line }) } catch (e) {} }
        else kept++
      }
      const styles = []
      for (const el of document.querySelectorAll('style[data-plugin="dsh-mpkg-wallpaper"]')) { styles.push(el.getAttribute('data-plugin')); el.remove() }
      let extraStyles = 0
      for (const el of document.querySelectorAll('style')) {
        const t = el.textContent || ''
        if ((t.indexOf('--mpw-') >= 0 || t.indexOf('data-mpw-') >= 0) && !el.getAttribute('data-plugin')) { el.remove(); extraStyles++ }
      }
      const dom = []
      for (const sel of ['#mpw-bgWrap', '.mpw-hdrFrost', '[class*="mpw_np"]']) {
        try { for (const el of document.querySelectorAll(sel)) { el.remove(); dom.push(sel) } } catch (e) {}
      }
      const bodyAttrs = []
      for (const a of Array.from(document.body.attributes)) if (/^data-mpw/.test(a.name)) { bodyAttrs.push(a.name); document.body.removeAttribute(a.name) }
      return { disconnected, kept, touched: touched.slice(0, 16), styles: styles.length, extraStyles, dom: dom.slice(0, 12), bodyAttrs: bodyAttrs.slice(0, 12) }
    },
    /* 只读校验：插件样式是否还在 */
    pluginStyleCount: () => document.querySelectorAll('style[data-plugin="dsh-mpkg-wallpaper"]').length,
  }
  // ── ② longtask（Firefox 129+；不支持就留空并在读取时报告）
  window.__mpwLongtasks = []
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__mpwLongtasks.push({ t: Math.round(e.startTime * 100) / 100, d: Math.round(e.duration * 100) / 100 })
    })
    po.observe({ entryTypes: ['longtask'] })
    window.__mpwLongtasksOk = true
  } catch (e) { window.__mpwLongtasksOk = false }
  // ── ③ rAF 采集器
  window.__mpwRafStart = () => {
    window.__mpwRafTs = []
    const loop = (t) => {
      if (!window.__mpwRafOn) return
      window.__mpwRafTs.push(t)
      window.__mpwRafId = requestAnimationFrame(loop)
    }
    window.__mpwRafOn = true
    window.__mpwRafId = requestAnimationFrame(loop)
    return true
  }
  window.__mpwRafStop = () => {
    window.__mpwRafOn = false
    try { cancelAnimationFrame(window.__mpwRafId) } catch (e) {}
    return window.__mpwRafTs || []
  }
})()
`

/* ── 2 页面侧采集器：按钮候选 dump / 点击前后佐证 / 窗口统计 ─────────────────────────── */
const SCAN_BUTTONS = () => {
  const pathOf = (el) => {
    const out = []
    let cur = el, depth = 0
    while (cur && cur.nodeType === 1 && depth < 7 && cur !== document.documentElement) {
      const p = cur.parentElement
      const idx = p ? Array.prototype.indexOf.call(p.children, cur) + 1 : 1
      out.push(String(cur.tagName || '').toLowerCase() + (cur.id ? '#' + cur.id : '') + (cur.className && typeof cur.className === 'string' && cur.className ? '.' + cur.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ':nth-child(' + idx + ')')
      cur = p; depth++
    }
    return out.reverse().join(' > ')
  }
  const out = []
  const seen = new Set()
  const push = (el, why) => {
    if (!el || seen.has(el)) return
    seen.add(el)
    const r = (() => { try { return el.getBoundingClientRect() } catch (e) { return null } })()
    if (!r) return
    const label = [el.getAttribute && el.getAttribute('aria-label'), el.getAttribute && el.getAttribute('title'), (el.textContent || '').trim().slice(0, 24)].filter(Boolean).join(' | ')
    out.push({
      why, label: String(label).slice(0, 90),
      ariaLabel: el.getAttribute ? el.getAttribute('aria-label') : null,
      ariaExpanded: el.getAttribute ? el.getAttribute('aria-expanded') : null,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      visible: r.width > 0 && r.height > 0,
      path: pathOf(el),
    })
  }
  for (const el of document.querySelectorAll('button,[role="button"],[aria-label],[title]')) {
    const lab = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.textContent || '')).trim()
    if (/收起|折叠|展开|侧栏|侧边栏|collapse|expand|sidebar/i.test(lab)) push(el, 'semantic')
  }
  for (const el of document.querySelectorAll('button,[role="button"]')) {
    let r = null
    try { r = el.getBoundingClientRect() } catch (e) { continue }
    if (r.x >= 0 && r.x < 80 && r.width > 0 && r.width <= 56 && r.height > 8 && r.height <= 56) push(el, 'left-edge')
  }
  return out
}

const SIDEBAR_STATE = () => {
  // [data-slot="sidebar"] 实测是 display:contents 0×0（真机调试 2026-10-03）⇒ 以 sidebarCol 优先，取第一个有宽度的
  const sels = ['[class*="sidebarCol"]', '.hHd-Xa_root', '[data-slot="sidebar"]']
  let first = null
  for (const sel of sels) {
    let el = null
    try { el = document.querySelector(sel) } catch (e) {}
    if (!el) continue
    const r = el.getBoundingClientRect()
    const c = getComputedStyle(el)
    const rec = { sel, w: Math.round(r.width), h: Math.round(r.height), display: c.display, visibility: c.visibility }
    if (!first) first = rec
    if (r.width > 2) return rec
  }
  return first
}

const BG_STATE = () => {
  const v = document.querySelector('#mpw-bgVideo')
  const w = document.querySelector('#mpw-bgWrap')
  return {
    bgWrap: !!w,
    video: v ? { readyState: v.readyState, paused: v.paused, muted: v.muted, w: v.videoWidth, h: v.videoHeight } : null,
  }
}

const COLLECT_WINDOW = (o) => {
  const t0 = o.t0, durMs = o.durMs, map = o.map || {}
  const ts = window.__mpwRafStop() || []
  const win = ts.filter((t) => t >= t0 && t <= t0 + durMs)
  const iv = []
  for (let i = 1; i < win.length; i++) iv.push(Math.round((win[i] - win[i - 1]) * 1000) / 1000)
  const sorted = iv.slice().sort((a, b) => a - b)
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : null)
  const gapsOver50 = iv.filter((x) => x > 50).length
  const lts = (window.__mpwLongtasks || []).filter((e) => e.t >= t0 && e.t <= t0 + durMs)
  const famAgg = new Map()
  for (const e of window.__mpwMo.events()) {
    if (e.t < t0 || e.t > t0 + durMs) continue
    let a = famAgg.get(e.f)
    if (!a) { a = { idx: e.f, batches: 0, totalMs: 0, maxMs: 0, durs: [] }; famAgg.set(e.f, a) }
    a.batches++; a.totalMs = Math.round((a.totalMs + e.d) * 1000) / 1000
    if (e.d > a.maxMs) a.maxMs = e.d
    if (a.durs.length < 6000) a.durs.push(e.d)
  }
  const meta = window.__mpwMo.families(map)
  const fams = []
  for (const a of famAgg.values()) {
    const d = a.durs.slice().sort((x, y) => x - y)
    const m = meta.find((x) => x.idx === a.idx) || {}
    fams.push({
      idx: a.idx, batches: a.batches, totalMs: a.totalMs, maxMs: a.maxMs,
      p95: d.length ? d[Math.min(d.length - 1, Math.floor(0.95 * (d.length - 1)))] : null,
      sig: m.sig || null, stack: m.stack || null, observes: m.observes, disconnects: m.disconnects,
      isPlugin: !!m.isPlugin, pluginLine: m.pluginLine === undefined ? null : m.pluginLine,
    })
  }
  fams.sort((x, y) => y.totalMs - x.totalMs)
  return {
    window: { t0: Math.round(t0 * 100) / 100, durMs },
    raf: {
      frames: win.length, intervals: iv.length,
      p50: pct(0.50), p95: pct(0.95), max: sorted.length ? sorted[sorted.length - 1] : null,
      gapsOver50,
    },
    longtask: { supported: !!window.__mpwLongtasksOk, count: lts.length, totalMs: Math.round(lts.reduce((s, e) => s + e.d, 0) * 100) / 100, maxMs: lts.length ? Math.max(...lts.map((e) => e.d)) : 0, entries: lts.slice(0, 20) },
    mo: { families: fams, totalBatches: fams.reduce((s, f) => s + f.batches, 0), totalMs: Math.round(fams.reduce((s, f) => s + f.totalMs, 0) * 100) / 100, constructedTotal: meta.length },
  }
}

/* ── 3 设置快照 / 输出骨架 ──────────────────────────────────────────────────────────── */
const snapFile = (p) => { try { if (!fs.existsSync(p)) return null; const buf = fs.readFileSync(p); return { buf, sha256: sha256(buf) } } catch (e) { return null } }
const settingsSnap = snapFile(SETTINGS_JSON)

const result = {
  probe: 'sidebar-anim-probe', at: new Date().toISOString(), authority: AUTHORITY, url: URL0,
  runs: RUNS, groups: GROUPS, windowMs: WINDOW_MS, viewport: VIEWPORT,
  note: '对照组 = 页内中性化（摘插件样式 data-plugin 标记 + 插件常驻 DOM + 按 needle 行号映射断开插件 MutationObserver；插件代码与定时器仍在内存，壁纸随 DOM 摘除一起没了）。?mpwperf=off 未实现（要动 lib/client.js，等 3.15.5）',
  blocked: null, candidates: null, button: null, needles: { count: needles.length }, combinedBundle: null,
  pluginActive: {}, groupsOut: [], pageErrors: [], hostPuts: 0, hostWritesBlocked: 0, settingsRestore: null,
}
const blocked = (why, detail) => {
  result.blocked = { why, detail: detail === undefined ? null : detail, at: new Date().toISOString() }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n')
  console.log('✗ blocked:' + why + (detail ? '  — ' + String(detail).slice(0, 300) : ''))
  process.exit(2)
}

/* needle → 组合响应行号映射（页内 fetch 每个组合 URL 并搜索；所有 /plugins/?? URL = script src ∪ resource entries） */
const mapPluginObserverLines = async (page) => {
  return page.evaluate(async (needles) => {
    const urls = new Set()
    for (const s of document.querySelectorAll('script[src]')) { if (s.src.indexOf('/plugins/??') >= 0) urls.add(s.src) }
    for (const r of performance.getEntriesByType('resource')) { if (r.name.indexOf('/plugins/??') >= 0) urls.add(r.name) }
    if (!urls.size) return { ok: false, why: 'no-combined-url' }
    const out = []
    for (const url of Array.from(urls).slice(0, 8)) {
      let text = ''
      try { text = await fetch(url).then((r) => r.text()) } catch (e) { out.push({ url: String(url).slice(0, 120), err: String(e && e.message || e) }); continue }
      const lineAt = (idx) => { let n = 1; for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++; return n }
      const verbatim = text.indexOf('apply failed:') >= 0
      const lines = []
      let hits = 0
      for (const nd of needles) {
        const p = text.indexOf(nd)
        if (p < 0) continue
        const at = text.indexOf('new MutationObserver', p + nd.length - 1)
        if (at >= 0 && at - p <= nd.length + 4) { lines.push(lineAt(at)); hits++ }
      }
      out.push({ url: String(url).slice(0, 160), key: url.split('?')[0], bytes: text.length, verbatim, needleHits: hits, lines })
    }
    return { ok: out.some((u) => u.needleHits > 0), urls: out }
  }, needles)
}

function med(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
  return a.length ? a[Math.floor(a.length / 2)] : null
}

let browser = null
try {
  /* ④ 签 Cookie（复用仓库既有机制） */
  try {
    fs.mkdirSync(WORK, { recursive: true })
    execFileSync(process.execPath, [path.join(HERE, 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { cwd: PLUGIN, stdio: ['ignore', 'pipe', 'inherit'] })
  } catch (e) {
    blocked('cookie-mint-failed', String((e && e.stderr) || (e && e.message) || e).slice(0, 300) + '（密钥在 ~/.dsh/.credentials.yaml）')
  }
  if (!fs.existsSync(COOKIE)) blocked('cookie-missing', COOKIE)
  const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))

  let pw = null
  try { pw = await import('playwright') } catch (e) { pw = null }
  const firefox = pw && ((pw.default && pw.default.firefox) || pw.firefox)
  if (!firefox) blocked('no-playwright-firefox', '本机没有 playwright 的 firefox（未起浏览器、未写设置）')

  browser = await firefox.launch({ headless: !HEADED, firefoxUserPrefs: withAudioMute() })
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'zh-CN' })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  await ctx.addInitScript(INIT_SCRIPT)
  const page = await ctx.newPage()
  // 拦掉插件往宿主 settings.json 的写回（GET 照常；探针不改用户真档）
  await page.route('**/api/mpkg-wallpaper/settings*', (route) => {
    const req = route.request()
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue()
    result.hostWritesBlocked++
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, blockedByProbe: 'sidebar-anim-probe' }) })
  })
  page.on('pageerror', (e) => result.pageErrors.push(String((e && e.message) || e).slice(0, 200)))
  page.on('response', (r) => { try { if (r.url().indexOf('/api/mpkg-wallpaper/settings') >= 0 && r.request().method() !== 'GET') result.hostPuts++ } catch (e) {} })

  const resp = await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const status = resp ? resp.status() : null
  if (status === 401 || status === 403) blocked('http-' + status, 'DSH 首页要鉴权 Cookie（自签的这枚没被接受？authority=' + AUTHORITY + '）')
  if (!resp || !resp.ok()) blocked('http-' + status, '首页不可用')

  const pluginReady = async () => page.waitForFunction(() => !!(globalThis.__mpwSectionTest && globalThis.__mpwPersist), null, { timeout: 20000 }).then(() => true).catch(() => false)
  result.pluginActive.on = await pluginReady()
  if (!result.pluginActive.on) blocked('plugin-not-active', '页面打开了但没有 __mpwSectionTest/__mpwPersist ⇒ 该页没装/没启用本插件')

  await page.waitForSelector('[data-slot="sidebar"],[class*="sidebarCol"]', { state: 'attached', timeout: HOST_WAIT }).catch(() => {})
  await page.waitForTimeout(SETTLE)

  /* ⑤ 收起按钮：先 dump 候选（--scan 到此为止），再按打分锁定 */
  result.candidates = await page.evaluate(SCAN_BUTTONS)
  if (SCAN) {
    console.log('── 收起按钮候选（' + result.candidates.length + ' 个）──')
    result.candidates.forEach((c, i) => console.log(String(i).padStart(3) + '  ' + (c.visible ? '可见' : '不可见') + '  rect=' + JSON.stringify(c.rect) + '  why=' + c.why + '  label=' + JSON.stringify(c.label) + '\n     path=' + c.path))
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n')
    process.exit(0)
  }
  const pick = (cands) => {
    const vis = cands.map((c, i) => ({ c, i })).filter((x) => x.c.visible)
    if (!vis.length) return null
    const score = (c) => {
      let s = 0
      const lab = c.label || ''
      if (/收起/.test(lab)) s += 40
      if (/折叠|collapse/i.test(lab)) s += 20
      if (/侧栏|侧边栏|sidebar/i.test(lab)) s += 15
      if (c.ariaExpanded !== null) s += 10
      if (c.why === 'semantic') s += 10
      if (c.rect[0] < 80) s += 5
      if (/展开/.test(lab) && !/收起|折叠/.test(lab)) s -= 25
      return s
    }
    vis.sort((a, b) => score(b.c) - score(a.c))
    return vis[0].i
  }
  let btnIdx = BTN_INDEX >= 0 ? BTN_INDEX : pick(result.candidates)
  if (btnIdx === null || !result.candidates[btnIdx]) blocked('no-collapse-button', '候选里没有一个可见的收起按钮（--scan 看清单后用 --btn-index 指定）')
  const chosen = result.candidates[btnIdx]
  result.button = { index: btnIdx, chosen, totalCandidates: result.candidates.length }
  // 点击选择器：扫描发现的真实 aria-label（不是猜的）；没有就用结构 path
  const clickSel = chosen.ariaLabel ? 'button[aria-label="' + chosen.ariaLabel.replace(/"/g, '\\"') + '"]' : chosen.path
  result.button.clickSel = clickSel
  console.log('  · 收起按钮 = 候选[' + btnIdx + '] ' + JSON.stringify(chosen.label) + '  clickSel=' + clickSel)

  /* ⑥ needle → 行号映射（中性化 ③ 的前提；顺带自证组合响应逐字含 client.js） */
  result.combinedBundle = await mapPluginObserverLines(page)
  const neutralizeMap = {}
  if (result.combinedBundle.ok) {
    for (const u of result.combinedBundle.urls) if (u.lines && u.lines.length) neutralizeMap[u.key] = u.lines
    const hit = result.combinedBundle.urls.reduce((s, u) => s + (u.needleHits || 0), 0)
    const bytes = result.combinedBundle.urls.reduce((s, u) => s + (u.bytes || 0), 0)
    console.log('  · 组合 bundle ' + result.combinedBundle.urls.length + ' 个 / ' + Math.round(bytes / 1024) + 'KB，逐字含 client.js 的 '
      + result.combinedBundle.urls.filter((u) => u.verbatim).length + ' 个；observer 构造点映射 ' + hit + '/' + needles.length)
    for (const u of result.combinedBundle.urls) console.log('    - ' + Math.round((u.bytes || 0) / 1024) + 'KB verbatim=' + !!u.verbatim + ' hits=' + (u.needleHits || 0) + ' lines=' + JSON.stringify(u.lines || []))
  } else {
    console.log('  · ⚠ 组合 bundle 映射失败：' + (result.combinedBundle.why || '0 命中') + ' ⇒ 中性化 ③（断 observer）不可用，只有 ①②')
  }

  /* ⑦ 单次 run：reload → 稳定 → （off：中性化）→ 清账 → 点收起 → 采窗口 */
  const oneRun = async (group, runIdx) => {
    const rec = { group, run: runIdx, ok: false }
    await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 60000 })
    rec.pluginActive = await pluginReady()
    if (group === 'on') {
      if (!rec.pluginActive) { rec.err = 'plugin-not-active-on-reload'; return rec }
    } else if (!rec.pluginActive) { rec.err = 'plugin-not-active-unexpected'; return rec }
    await page.waitForSelector('[data-slot="sidebar"],[class*="sidebarCol"]', { state: 'attached', timeout: HOST_WAIT }).catch(() => {})
    await page.waitForTimeout(SETTLE)
    if (group === 'off') {
      rec.neutralize = await page.evaluate((m) => window.__mpwMo.neutralize(m), neutralizeMap)
      rec.pluginStylesLeft = await page.evaluate(() => window.__mpwMo.pluginStyleCount())
    }

    const before = await page.evaluate(SIDEBAR_STATE)
    rec.sidebarBefore = before
    rec.bg = await page.evaluate(BG_STATE)

    let clickHow = null
    try {
      await page.click(clickSel, { timeout: 3000 })
      clickHow = 'playwright-click'
    } catch (e) {
      try {
        await page.hover('[data-slot="sidebar"],[class*="sidebarCol"]', { timeout: 1500 }).catch(() => {})
        await page.click(clickSel, { timeout: 2000 })
        clickHow = 'hover-then-click'
      } catch (e2) {
        try { await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.click() }, clickSel); clickHow = 'js-click(untrusted)' } catch (e3) { clickHow = null }
      }
    }
    if (!clickHow) { rec.err = 'click-failed'; return rec }
    rec.clickHow = clickHow

    const t0 = await page.evaluate(() => { window.__mpwMo.reset(); window.__mpwRafStart(); return performance.now() })
    await page.waitForTimeout(WINDOW_MS + 120)
    rec.after = await page.evaluate(SIDEBAR_STATE)
    rec.stats = await page.evaluate(COLLECT_WINDOW, { t0, durMs: WINDOW_MS, map: neutralizeMap })
    rec.ok = true
    rec.resized = before && rec.after ? { fromW: before.w, toW: rec.after.w, changed: Math.abs(before.w - rec.after.w) >= 40 } : null
    if (rec.resized && !rec.resized.changed) rec.warn = 'sidebar-width-unchanged (点击可能没生效)'
    return rec
  }

  /* ⑧ 两组 × N 次 */
  for (const group of GROUPS) {
    const runs = []
    for (let i = 1; i <= RUNS; i++) {
      const rec = await oneRun(group, i)
      runs.push(rec)
      const s = rec.stats && rec.stats.raf
      console.log('  [' + group + '#' + i + '] ' + (rec.ok
        ? 'frames=' + s.frames + ' p50=' + s.p50 + ' p95=' + s.p95 + ' max=' + s.max + ' >50ms=' + s.gapsOver50
          + ' mo=' + rec.stats.mo.totalBatches + '批/' + rec.stats.mo.totalMs + 'ms'
          + (rec.neutralize ? ' 中性化(断' + rec.neutralize.disconnected + '/样式' + rec.neutralize.styles + ')' : '')
        : 'FAIL: ' + rec.err)
        + (rec.warn ? ' ⚠' + rec.warn : ''))
      if (!rec.ok) continue
      await page.waitForTimeout(600)   // 收起按钮在收起态会从 DOM 消失（真机调试），复位靠下一次 run 的 reload
    }
    const okRuns = runs.filter((r) => r.ok && r.stats)
    const p95s = okRuns.map((r) => r.stats.raf.p95).filter((x) => Number.isFinite(x))
    const spread = p95s.length >= 2 ? Math.round(((Math.max(...p95s) - Math.min(...p95s)) / Math.max(1, Math.min(...p95s))) * 1000) / 10 : null
    result.groupsOut.push({
      agg: {
        group, runs: okRuns.length, failures: runs.length - okRuns.length,
        p95s, p95SpreadPct: spread, stable: spread !== null ? spread <= 15 : null,
        medians: {
          frames: med(okRuns.map((r) => r.stats.raf.frames)),
          p50: med(okRuns.map((r) => r.stats.raf.p50)),
          p95: med(p95s),
          max: med(okRuns.map((r) => r.stats.raf.max)),
          gapsOver50: med(okRuns.map((r) => r.stats.raf.gapsOver50)),
          longtask: med(okRuns.map((r) => r.stats.longtask.count)),
          moBatches: med(okRuns.map((r) => r.stats.mo.totalBatches)),
          moMs: med(okRuns.map((r) => r.stats.mo.totalMs)),
          pluginMoMs: med(okRuns.map((r) => r.stats.mo.families.filter((f) => f.isPlugin).reduce((s, f) => s + f.totalMs, 0))),
        },
      },
      runs,
    })
  }

  /* ⑨ 人读表 */
  console.log('\n── 侧栏收起动画测量（窗口 ' + WINDOW_MS + 'ms，每组 ' + RUNS + ' 次取中位）──')
  console.log('组          帧   p50    p95    max   >50ms  longtask  MO批次  MO耗时  插件MO耗时')
  for (const g of result.groupsOut) {
    const m = g.agg.medians
    const f = (x) => (x === null || x === undefined) ? '—' : String(Math.round(x * 100) / 100)
    console.log([g.agg.group.padEnd(10), f(m.frames).padEnd(5), f(m.p50).padEnd(7), f(m.p95).padEnd(7), f(m.max).padEnd(6), f(m.gapsOver50).padEnd(7), f(m.longtask).padEnd(10), f(m.moBatches).padEnd(8), f(m.moMs).padEnd(8), f(m.pluginMoMs)].join(' '))
  }
  const onG = result.groupsOut.find((g) => g.agg.group === 'on')
  const offG = result.groupsOut.find((g) => g.agg.group === 'off')
  if (onG && offG && onG.agg.medians.p95 && offG.agg.medians.p95) {
    const ratio = Math.round((onG.agg.medians.p95 / offG.agg.medians.p95) * 100) / 100
    result.onOffP95Ratio = ratio
    console.log('\n开/中性化 p95 比 = ' + ratio + '×（开组稳定=' + onG.agg.stable + '，中性化组稳定=' + offG.agg.stable + '）')
  }
  // on 组的插件族开销榜（P1B 的靶子）
  if (onG) {
    const fam = new Map()
    for (const r of onG.runs) for (const f of (r.stats ? r.stats.mo.families : [])) {
      if (!f.isPlugin) continue
      const k = f.sig || ('#' + f.idx)
      const cur = fam.get(k) || { batches: 0, totalMs: 0 }
      cur.batches += f.batches; cur.totalMs += f.totalMs
      fam.set(k, cur)
    }
    result.onPluginFamilies = Array.from(fam.entries()).map(([sig, v]) => ({ sig, batches: v.batches, totalMs: Math.round(v.totalMs * 100) / 100 })).sort((a, b) => b.totalMs - a.totalMs).slice(0, 8)
    if (result.onPluginFamilies.length) {
      console.log('\non 组插件族开销榜（3 次合计）：')
      for (const x of result.onPluginFamilies) console.log('  ' + x.totalMs + 'ms / ' + x.batches + '批  ' + x.sig.slice(0, 90))
    }
  }
  console.log('\n读数已落 ' + path.relative(PLUGIN, OUT))
} catch (e) {
  blocked('exception', String((e && e.stack) || e).slice(0, 600))
} finally {
  try { if (browser) await browser.close() } catch (e) {}
  if (settingsSnap) {
    const after = snapFile(SETTINGS_JSON)
    const same = after && after.sha256 === settingsSnap.sha256
    if (!same) {
      try { fs.writeFileSync(SETTINGS_JSON, settingsSnap.buf) } catch (e) {}
      const now = snapFile(SETTINGS_JSON)
      result.settingsRestore = { changedDuringRun: true, restored: !!(now && now.sha256 === settingsSnap.sha256) }
    } else {
      result.settingsRestore = { changedDuringRun: false }
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n')
}
const anyFail = result.groupsOut.some((g) => g.agg.failures > 0) || result.groupsOut.length < GROUPS.length
process.exit(anyFail ? 3 : 0)

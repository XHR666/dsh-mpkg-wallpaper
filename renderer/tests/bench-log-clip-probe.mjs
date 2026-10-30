// bench-log-clip-probe.mjs —— 输出区（控制台/调试）文本左缘**不许压在侧栏下面**（第 23 条，2026-09-22）
//
// 用户现象：「调试模式输出里前面的时间有一部分被左侧边栏切掉；展开壁纸配置也一样；把资源管理器收起来
// 还是被切。清空/重挂载之后又好了」——听上去是**布局状态**问题（侧栏宽度变了，输出区的左缘没跟着走）。
//
// 判据（几何量，不是观感）：在三种状态下（默认 / 展开壁纸配置 / 收起资源管理器）采样输出区里
// **每一行**的左缘，要求 `line.left >= sidebar.right - tol`（tol=1px）。CLIPPED = 有任意一行越界。
// 纯判据 `--selftest` 常驻门禁；`--live` 需要 :8902 + playwright（缺则 SKIP）。
import { AUDIO_MUTE_PREFS } from './_audio-mute.mjs'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { ROOT, WS } from './_root.mjs'

const argv = process.argv.slice(2)
const SELFTEST = argv.includes('--selftest')
const AUTHORITY = (() => { const i = argv.indexOf('--authority'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '127.0.0.1:8902' })()
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (label, why) => console.log('SKIP ' + label + ' —— ' + why)

/** 纯判据：一组行矩形有没有被侧栏压住（`null` = 没有可判对象）。 */
export function clipReport(lines, sidebar, tol = 1) {
  if (!Array.isArray(lines) || lines.length === 0) return null
  if (!sidebar || !(sidebar.right > 0)) return null
  const bad = lines.filter((l) => l && l.left < sidebar.right - tol)
  return { clipped: bad.length > 0, badCount: bad.length, worst: bad.length ? Math.min(...bad.map((l) => l.left)) : null, total: lines.length }
}

if (SELFTEST) {
  console.log('== S 纯判据自证 ==')
  const sb = { left: 0, right: 240 }
  ok(clipReport([{ left: 260 }, { left: 300 }], sb).clipped === false, 'S1 全部在侧栏右侧 ⇒ 不裁切')
  ok(clipReport([{ left: 260 }, { left: 200 }], sb).clipped === true, 'S2 有一行压进侧栏 ⇒ 裁切')
  ok(clipReport([{ left: 230 }], sb).clipped === true && clipReport([{ left: 239.5 }], sb, 1).clipped === false, 'S3 容差：1px 内不算裁切（left=230 算、239.5 不算）')
  ok(clipReport([], sb) === null && clipReport([{ left: 1 }], null) === null, 'S4 没有可判对象 ⇒ null（不许当通过）')
  /* S5 静态契约：长行必须**折行**（`overflow-wrap:anywhere`），否则一行比容器宽就长出横向滚动区、
     行首时间只能靠横滚才看得见（台账第 23 条的真机制）。补丁侧与静态表侧都要有，缺一处即红。 */
  {
    const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8') } catch (e) { return '' } }
    const need = [
      ['demo/bench-patch.js', '#logbody{white-space:pre-wrap;overflow-wrap:anywhere}'],
      ['demo/bench-patch.js', 'white-space:pre-wrap;overflow-wrap:anywhere}'],
      ['demo/index.html', 'html.bench-shell #logbody{white-space:pre-wrap;overflow-wrap:anywhere}'],
      ['demo/index.html', 'white-space:pre-wrap;overflow-wrap:anywhere}'],
      ['demo.html', '#log{position:fixed;bottom:0;left:0;right:0;z-index:9;padding:4px 8px;background:rgba(0,0,0,.75);font:11px monospace;white-space:pre-wrap;overflow-wrap:anywhere;height:35vh;overflow:auto;color:#8f8}'],
    ]
    const miss = need.filter(([f, t]) => !rd(f).includes(t)).map(([f, t]) => f + ' ← ' + t.slice(0, 40))
    ok(miss.length === 0, 'S5 输出区/调试区/渲染器页共 5 处日志规则都带 overflow-wrap:anywhere（长行折行 ⇒ 行首时间永不被推出）',
      miss.length ? miss.join(' | ') : '两处齐备')
  }
  console.log('\n── selftest 汇总：PASS=' + pass + ' FAIL=' + fail + '（未起浏览器）')
  process.exit(fail > 0 ? 1 : 0)
}

const pwPath = [process.env.MPW_PLAYWRIGHT, path.join(ROOT, 'node_modules/playwright/index.js'),
  path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js']
  .filter((p) => { try { return !!p && fs.existsSync(p) } catch (e) { return false } })[0]
if (!pwPath) { console.log('SKIP bench-log-clip-probe — 找不到 playwright（可用 MPW_PLAYWRIGHT=<path> 指定）'); process.exit(0) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP bench-log-clip-probe — playwright 没有 firefox 导出'); process.exit(0) }

/* ⚠ 必须显式开 WebGL2：无头 Firefox 默认**没有** WebGL2，页面会停在「启动失败: 当前浏览器不支持
   WebGL2」——此时 `__mpwLiveRes` 一类活档位读数永远缺失。本探针第一版就是漏了这行，把"环境缺能力"
   读成了"产品没跑到"，必须靠预置项把环境补齐。 */
const browser = await firefox.launch({ headless: true, firefoxUserPrefs: { ...AUDIO_MUTE_PREFS, 'webgl.force-enabled': true, 'gfx.webrender.software': true, 'webgl.out-of-process': false } })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(9000)

  /** 读几何：侧栏右缘 + 输出区每一行的左缘（含调试视图行）。 */
  const geom = () => page.evaluate(() => {
    /* ⚠ **隐藏元素必须跳过**：`display:none` 的 `getBoundingClientRect()` 全 0（left=0/right=0/top=0），
       不过滤就会把"没显示的行"当成"被侧栏切到 x=0"（本探针第一版就是这么假红的 —— 采样里
       `{left:0,right:0,top:0}` 就是它的签名）。判据只该看**真的在画**的行。 */
    const r = (el) => {
      try {
        const b = el.getBoundingClientRect()
        if (!(b.width > 0) && !(b.height > 0)) return null
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return null
        return { left: +b.left.toFixed(2), right: +b.right.toFixed(2), top: +b.top.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) }
      } catch (e) { return null }
    }
    const sidebar = document.getElementById('sidebar') || document.querySelector('#sidebar')
    const logs = document.getElementById('logs')
    const rows = []
    for (const sel of ['#debug-body .dbg-log > *', '#debug-body .dbg-layer', '#logbody .log-line', '#logbody > div', '#logs .logs-head']) {
      const list = document.querySelectorAll(sel)
      if (!list.length) continue
      for (const el of list) {
        const b = r(el)
        if (b) rows.push({ sel, cls: String(el.className || '').slice(0, 40), ...b })
      }
    }
    /* ---- 台账第 23 条的真症状：**行首那段时间被切掉**（不是行整体左缘） ----
       两个独立机制都会造成"前面的时间看不见"，所以两条都量：
         a) 水平滚动：某个可横滚祖先 `scrollLeft > 0` ⇒ 行首被推出可视区。这与用户说的
            「清空/重挂载后又好了」完全吻合（内容变短 ⇒ scrollLeft 自动归零）。
         b) 可见面板遮挡：任何**不透明**的悬浮面板（左右两栏都算）压住行首 ⇒ 时间被盖住。
       判据因此落在"时间戳 token 的左缘"上，而不是整行的左缘。 */
    const opaque = (el) => {
      try {
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.5) return false
        const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor || '')
        if (!m) return false
        const parts = m[1].split(',').map((x) => parseFloat(x))
        return parts.length < 4 || parts[3] > 0.5
      } catch (e) { return false }
    }
    const activeLogBox = ['#debug-body', '#logbody', '#dbg-log', '#logs'].map((id) => document.querySelector(id)).find((el) => el && r(el))
    const firstToken = (line) => {
      try {
        const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        let n
        while ((n = w.nextNode())) { if (n.nodeValue && n.nodeValue.trim()) break }
        if (!n) return null
        const rg = document.createRange(); rg.selectNodeContents(n)
        const b = rg.getBoundingClientRect()
        if (!(b.width > 0) && !(b.height > 0)) return null
        return { left: +b.left.toFixed(2), right: +b.right.toFixed(2), top: +b.top.toFixed(2), text: String(n.nodeValue).trim().slice(0, 24) }
      } catch (e) { return null }
    }
    const tokens = []
    const scrolls = []
    const seenBox = new Set()
    for (const line of document.querySelectorAll('#debug-body .dbg-layer, #logbody .log-line, #logbody > div, #dbg-log > div')) {
      const lb = r(line); if (!lb) continue
      const tk = firstToken(line); if (tk) tokens.push({ sel: line.id ? '#' + line.id : line.className || line.tagName.toLowerCase(), ...tk })
      for (let a = line.parentElement, i = 0; a && i < 6; a = a.parentElement, i++) {
        if (seenBox.has(a)) continue
        try {
          const cs = getComputedStyle(a)
          if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflow === 'auto' || cs.overflow === 'scroll') {
            seenBox.add(a)
            scrolls.push({ el: a.id ? '#' + a.id : (a.className || a.tagName.toLowerCase()).slice(0, 30), scrollLeft: a.scrollLeft, scrollWidth: a.scrollWidth, clientWidth: a.clientWidth, overflow: cs.overflowX })
          }
        } catch (e) {}
      }
    }
    const overlays = []
    for (const el of document.querySelectorAll('#sidebar, #sidebar *, #props, #props *, #explorer, #explorer *, aside, .panel, .dock')) {
      const b = r(el); if (!b || b.w < 60 || b.h < 24) continue
      try { const cs = getComputedStyle(el); if (!(cs.position === 'fixed' || cs.position === 'absolute' || cs.position === 'sticky')) continue } catch (e) { continue }
      if (!opaque(el)) continue
      overlays.push({ el: el.id ? '#' + el.id : (el.className || el.tagName.toLowerCase()).slice(0, 30), ...b })
    }
    const covered = []
    for (const tk of tokens) {
      for (const ov of overlays) {
        const vOverlap = ov.top <= tk.top + 8 && ov.top + ov.h >= tk.top + 2
        const hCover = ov.left <= tk.left + 1 && ov.right > tk.left + 1
        if (vOverlap && hCover) {
          covered.push({ token: tk.text, tokenLeft: tk.left, by: ov.el, overlayRight: ov.right })
        }
      }
    }
    return { sidebar: r(sidebar), logs: r(logs), rows: rows.slice(0, 24), logsHidden: !!(logs && logs.hasAttribute('hidden')),
      tokens: tokens.slice(0, 12), scrolls, overlays: overlays.slice(0, 8), covered, activeLogBox }
  })
  /** 往**当前可见**的日志容器里插一条 4000 字符无空格行（最坏情况：`pre-wrap` 也断不开）。 */
  const stressOn = () => page.evaluate(() => {
    const box = ['logbody', 'dbg-log', 'diag-body'].map((id) => document.getElementById(id)).find((el) => el && el.offsetParent !== null)
    if (!box) return false
    const line = document.createElement('div')
    line.setAttribute('data-probe-stress', '1')
    line.textContent = '00:00:00.000 ' + 'X'.repeat(4000)
    box.appendChild(line)
    box.scrollTop = box.scrollHeight
    return true
  })
  const stressOff = () => page.evaluate(() => { const el = document.querySelector('[data-probe-stress]'); if (el) el.remove() })

  const setProps = async (collapsed) => {
    await page.evaluate((want) => {
      const p = document.getElementById('props'); if (!p) return
      p.classList.toggle('bench-props-collapsed', !!want)
    }, collapsed)
    await page.waitForTimeout(700)
  }
  const setExplorer = async (collapsed) => {
    await page.evaluate((want) => {
      const b = document.getElementById('explorer-toggle') || document.getElementById('sidebar-toggle')
      if (b) { const on = b.getAttribute('aria-expanded') === 'true'; if (want === on) b.click() }
      else { const sb = document.getElementById('sidebar'); if (sb) sb.classList.toggle('bench-side-collapsed', !!want) }
    }, collapsed)
    await page.waitForTimeout(700)
  }

  const states = [
    { name: '默认', apply: async () => { await setProps(false); await setExplorer(false); await page.evaluate(() => { const t = document.getElementById('tab-console') || document.getElementById('tab-logs'); if (t) t.click() }); await page.waitForTimeout(700) } },
    { name: '展开壁纸配置', apply: async () => { await setProps(false) } },
    { name: '收起资源管理器', apply: async () => { await setExplorer(true) } },
    { name: '调试视图', apply: async () => { await page.evaluate(() => { const t = document.getElementById('tab-debug'); if (t) t.click(); const sw = document.getElementById('dbg-mode'); if (sw && !sw.checked) sw.click() }); await page.waitForTimeout(1200) } },
  ]
  let any = false
  for (const st of states) {
    await st.apply()
    const g = await geom()
    const rep = clipReport(g.rows, g.sidebar, 1)
    if (rep === null) { skip('第 23 条 · ' + st.name, '这一档采不到行（输出区空/隐藏）⇒ 无可判对象'); continue }
    any = true
    ok(rep.clipped === false, '第 23 条 · ' + st.name + '：输出区每行都不在侧栏下面（左缘 ≥ 侧栏右缘 − 1px）',
      JSON.stringify({ sidebarRight: g.sidebar && g.sidebar.right, rows: rep.total, bad: rep.badCount, worstLeft: rep.worst,
        sample: g.rows.filter((x) => x.left < (g.sidebar ? g.sidebar.right - 1 : 0)).slice(0, 3) }))
    /* 真症状①：行首时间戳被**横滚**推出可视区 */
    const scrolled = g.scrolls.filter((x) => x.scrollLeft > 0)
    ok(scrolled.length === 0, '第 23 条 · ' + st.name + '：日志容器没有横向滚动（行首没有被推出左缘）',
      JSON.stringify({ scrolls: g.scrolls, scrolled: scrolled.slice(0, 3), tokens: g.tokens.slice(0, 3) }))
    /* 真症状②：行首时间戳被任何可见不透明面板盖住 */
    ok(g.covered.length === 0, '第 23 条 · ' + st.name + '：行首时间戳没有被任何面板压住',
      JSON.stringify({ covered: g.covered.slice(0, 3), tokens: g.tokens.slice(0, 4), overlays: g.overlays.slice(0, 4) }))
    /* 真症状③（压力档）：一行比容器还宽（4000 个无空格字符 = 最坏情况）时，容器**不许**长出横向滚动区。
       修前 `#dbg-log` 实测 `scrollWidth:23020 / clientWidth:1094` ⇒ 行首时间只能靠横滚才看得见；
       修后靠 `overflow-wrap:anywhere` 折行。这条断言把"巧合"变成"契约"。 */
    await stressOn()
    const gs = await geom()
    const over = gs.scrolls.filter((x) => x.scrollWidth > x.clientWidth + 2)
    ok(over.length === 0, '第 23 条 · ' + st.name + '：超长行之后日志容器仍不横滚（行首时间无需横滚即可见）',
      JSON.stringify({ over: over.slice(0, 3), scrolls: gs.scrolls }))
    await stressOff()
  }
  if (!any) skip('第 23 条', '四种状态都采不到输出行（先往输出区写几行再判）')
} finally {
  await browser.close().catch(() => {})
  console.log('\nbench-log-clip-probe：PASS=' + pass + ' FAIL=' + fail)
  void os
  process.exit(fail > 0 ? 1 : 0)
}

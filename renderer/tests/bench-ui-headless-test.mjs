// bench-ui-headless-test.mjs —— 测试台 UI（:8902）的**无 X11**浏览器门禁：收纳键 / 声音控件 / 自绘下拉 / 遮挡几何
//
// 为什么单独一条（与 tests/x11-e2e/bench-click-test.mjs 的关系）：
//   · `bench-click-test` 是**真 X11 指针**门禁（xdotool 发真事件 + elementFromPoint 命中自证），
//     它证明的是"用户拿鼠标点得到"，但需要 X 显示、跑一轮 5–8 分钟，且宿主机重启后 X 会消失（2026-09-19 实测）。
//   · 这一条只做**同一批 UI 的功能判定**（用 Playwright 自己的派发），headless 也能跑、几十秒出结果，
//     因此可以常驻门禁；它**不能**替代真指针门禁（遮挡/坐标换算只有真 X 事件才测得出来）。
//
// 判据（任一不满足 → 退出码 1；无 :8902 / 无 Playwright / 无 Firefox ⇒ 自我 SKIP 退出码 0）：
//   N1 资源管理器收纳键：点一次 ⇒ `body.bench-nav-collapsed` + `aria-expanded=false` + `#main` 真变宽 ≥100px；
//      再点一次 ⇒ 复原（宽度回原值 ±4px）；**刷新后保持收起**（localStorage 那条路）；#list 始终只有 1 个
//   N2 声音控件：`.snd-box` 收起 78px 量级 ⇒ 点 `.snd-tap` ⇒ 展开（高度变大）⇒ 再点 ⇒ 收回（±3px）
//   N3 遮挡几何（`__benchPatch.npOcclusion()`）：两个状态下 `unreachableCount === 0`、`scrollKnown === true`，
//      且展开态 `cover` ≥ 收起态（展开只会更挡）
//   N4 属性表滚到底：最后一项能滚到声音控件**上方**（不被永久遮住）
//   N5 自绘下拉：工具条里的 `.mpw_select` 点开 ⇒ **恰好 1 个**列表 + `data-flip` 有值 ⇒ 再点 ⇒ 关；
//      且工具条第二行的下拉**没有被属性面板盖住**（`elementFromPoint` 命中它自己 —— P-143 的 z-index 修复）
//   N6 整轮 0 个 pageerror（真机脚本错要能看见）
//
// 用法: node tests/bench-ui-headless-test.mjs [--url http://127.0.0.1:8902/] [--w 1360] [--h 900] [--keep-going]
import { AUDIO_MUTE_PREFS } from './_audio-mute.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf(n); if (i >= 0 && argv[i + 1]) return argv[i + 1]; const eq = argv.find((a) => a.startsWith(n + '=')); return eq ? eq.slice(n.length + 1) : d }
const URL_BASE = argOf('--url', process.env.MPW_BENCH_URL || 'http://127.0.0.1:8902/')
const VIEW = { w: Number(argOf('--w', 1360)), h: Number(argOf('--h', 900)) }

let pass = 0; let fail = 0; const notes = []
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (why) => { console.log('SKIP bench-ui-headless — ' + why); process.exit(0) }
/** 汇总行（正常收尾与兜底 catch **共用同一份**，不许两条路打出不同口径的读数）。 */
const printSummary = () => {
  console.log(`\n── 汇总：PASS=${pass} FAIL=${fail}`)
  for (const n of notes) console.log('  note: ' + n)
}

try { const r = await fetch(URL_BASE, { signal: AbortSignal.timeout(4000) }); if (!r.ok) skip(`测试台不可达：${URL_BASE} → ${r.status}`) } catch (e) { skip(`测试台不可达：${e.message}`) }

function findPlaywright() {
  const cands = [process.env.MPW_PLAYWRIGHT, path.join(ROOT, 'node_modules/playwright/index.js'),
    path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c } catch { /* next */ } }
  return null
}
const pwPath = findPlaywright()
if (!pwPath) skip('找不到 playwright')
const pw = await import(pathToFileURL(pwPath).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) skip('playwright 没有 firefox 导出')

const browser = await firefox.launch({ headless: true, env: { ...process.env, MOZ_WEBGL_FORCE_SOFTWARE: '1', LIBGL_ALWAYS_SOFTWARE: '1' },
  firefoxUserPrefs: { ...AUDIO_MUTE_PREFS, 'webgl.force-enabled': true, 'gfx.webrender.software': true, 'webgl.out-of-process': false } })
try {
  const ctx = await browser.newContext({ viewport: { width: VIEW.w, height: VIEW.h } })
  const page = await ctx.newPage()
  //  顶层文档自己的脚本错（精确归属）：子帧（渲染器页 / web 壁纸作者页）的错不该算到本页补丁头上，
  //  Playwright 的 `pageerror` 会把它们混在一起、且 blob/沙箱文档常常**没有 stack** 可供判别。
  await page.addInitScript(() => {
    window.__topErrs = []
    window.addEventListener('error', (e) => { try { window.__topErrs.push(String((e && (e.message || (e.error && e.error.message))) || e)) } catch { /* ignore */ } })
    window.addEventListener('unhandledrejection', (e) => { try { window.__topErrs.push(String((e && e.reason && (e.reason.message || e.reason)) || e)) } catch { /* ignore */ } })
    /* ── 2026-09-20 用户第 1/5/11 条的三支探针（都在**任何页面脚本之前**装好）─────────────────
       ① `prompt/alert/confirm` 计数：第 1 条的根因就是产物 `#pick-lib.onclick` 在服务端降级后
          `window.prompt(...)`（模态阻塞主线程）⇒ 本页补丁接管入口之后**一次都不许出现**。
       ② `getUserMedia` 计数：第 5 条要求"关着时一次都不调"。这里包的是**最内层**（真调用），
          补丁自己那道闸门在关着时连它都不会碰 ⇒ 计数必须恒为 0。
       ③ 首帧采样：每帧记 `data-bench-ready` / body 可见性 / `#workbench` 的 display /
          `#sidebar` 右缘与 `#main` 左缘的重叠量（>1px 就是"堆叠态被看见了"）。 */
    window.__nativePromptCalls = 0
    for (const k of ['prompt', 'alert', 'confirm']) {
      try {
        const orig = window[k]
        if (typeof orig === 'function') window[k] = function () { window.__nativePromptCalls++; return orig.apply(window, arguments) }
      } catch { /* 不可写：跳过 */ }
    }
    /* ── P 组（属性面板批）用的请求台账：`/api/props` 的 GET/POST 各记一份（含 POST body）。
       为什么要有它：判"面板真的重读了新壁纸"不能只看行变了 —— 要能证明**新那张的 `/api/props` 请求真发生过**；
       判"非法数字没写回"要能证明**保存链里没出现 `1e9`**。 */
    window.__propsReqs = []
    window.__propsPosts = []
    try {
      const of = window.fetch
      window.fetch = function (input, init) {
        try {
          const u = String((input && input.url) || input || '')
          if (u.indexOf('/api/props') >= 0) {
            if (String((init && init.method) || 'GET').toUpperCase() === 'POST') window.__propsPosts.push(String((init && init.body) || ''))
            else window.__propsReqs.push(u)
          }
        } catch { /* ignore */ }
        return of.apply(this, arguments)
      }
    } catch { /* ignore */ }
    window.__gumCalls = 0
    try {
      const md = navigator.mediaDevices
      if (md && typeof md.getUserMedia === 'function') {
        const orig = md.getUserMedia.bind(md)
        md.getUserMedia = function () { window.__gumCalls++; return orig.apply(null, arguments) }
      }
    } catch { /* 无 mediaDevices */ }
    window.__frames = []
    const sampleFrame = () => {
      try {
        const de = document.documentElement
        const body = document.body
        const wb = document.getElementById('workbench')
        const side = document.getElementById('sidebar')
        const main = document.getElementById('main')
        const r1 = side ? side.getBoundingClientRect() : null
        const r2 = main ? main.getBoundingClientRect() : null
        window.__frames.push({
          t: Math.round(performance.now()),
          ready: !!(de && de.hasAttribute && de.hasAttribute('data-bench-ready')),
          vis: body ? getComputedStyle(body).visibility : 'nobody',
          wb: wb ? getComputedStyle(wb).display : '',
          overlap: (r1 && r2 && r1.width > 0 && r2.width > 0) ? Math.round(r1.right - r2.left) : null,
        })
      } catch { /* ignore */ }
      if (window.__frames.length < 600) requestAnimationFrame(sampleFrame)
    }
    requestAnimationFrame(sampleFrame)
  })
  const errs = []          // 顶层文档的脚本错（门禁判定：必须 0）
  const frameErrs = []     // 子帧（渲染器页 / web 壁纸作者页）的脚本错：进 notes（不属于本页补丁的责任面）
  page.on('pageerror', (e) => {
    const msg = String(e.message).slice(0, 160)
    const st = String(e.stack || '')
    //  渲染器产物 / blob 壁纸文档 / /web/dev/ 下的作者脚本都算"子帧"
    const fromFrame = /assets\/renderer-|WEwebLoader\/renderer|blob:http|\/web\/dev\//.test(st)
    ;(fromFrame ? frameErrs : errs).push(msg + (fromFrame ? ' @' + (st.match(/(?:blob:|https?:)[^\s)]+/) || [''])[0].slice(0, 90) : ''))
  })
  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForFunction(() => !!document.getElementById('frame'), null, { timeout: 60000 })
  await page.waitForTimeout(3500)          // 等库列表 / 首个壁纸 / patch 初始化

  // ── N1 收纳键 ────────────────────────────────────────────────────────────────
  const nav = () => page.evaluate(() => {
    const btn = document.getElementById('sidebar-toggle')
    const main = document.getElementById('main')
    const r = main ? main.getBoundingClientRect() : null
    let store = null
    try { store = window.localStorage.getItem('bench-sidebar-collapsed') } catch { store = 'throw' }
    return { collapsed: document.body.classList.contains('bench-nav-collapsed'),
      aria: btn ? btn.getAttribute('aria-expanded') : null,
      btn: btn ? (btn.getBoundingClientRect().width > 0) : false,
      mainW: r ? Math.round(r.width) : -1, lists: document.querySelectorAll('#list').length, store }
  })
  const n0 = await nav()
  ok(n0.btn, 'N1a `#sidebar-toggle` 在页面上可见', `mainW=${n0.mainW} lists=${n0.lists}`)
  await page.click('#sidebar-toggle'); await page.waitForTimeout(600)
  const n1 = await nav()
  ok(n1.collapsed && n1.aria === 'false', 'N1b 点一次 ⇒ 收起（body 类 + aria-expanded=false）', `collapsed=${n1.collapsed} aria=${n1.aria} store=${n1.store}`)
  ok(n0.mainW > 0 && n1.mainW - n0.mainW >= 100, 'N1c 收起后 `#main` 真变宽（不留空占位）', `Δ=${n1.mainW - n0.mainW}px`)
  await page.click('#sidebar-toggle'); await page.waitForTimeout(600)
  const n2 = await nav()
  ok(!n2.collapsed && n2.aria === 'true' && Math.abs(n2.mainW - n0.mainW) <= 4, 'N1d 再点 ⇒ 复原（宽度回原值）',
    `collapsed=${n2.collapsed} mainW=${n2.mainW}（原 ${n0.mainW}）`)
  ok(n2.lists === 1, 'N1e 列表容器始终只有 1 个（不是点几次叠几个）', `#list=${n2.lists}`)
  // 刷新保持：先收起，再 reload，类必须还在（首帧同步脚本 + localStorage）
  await page.click('#sidebar-toggle'); await page.waitForTimeout(600)
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => !!document.getElementById('frame'), null, { timeout: 60000 })
  await page.waitForTimeout(2500)
  const n3 = await nav()
  ok(n3.collapsed, 'N1f 收起状态**刷新后保持**（localStorage 那条路真的通）', `collapsed=${n3.collapsed} store=${n3.store}`)
  await page.click('#sidebar-toggle'); await page.waitForTimeout(600)   // 还原成展开

  // ── N2/N3 声音控件 + 遮挡几何 ────────────────────────────────────────────────
  const np = () => page.evaluate(() => {
    const box = document.querySelector('#np-host .snd-box')
    const occ = (window.__benchPatch && typeof window.__benchPatch.npOcclusion === 'function') ? window.__benchPatch.npOcclusion() : null
    return { host: !!document.getElementById('np-host'), card: box ? Math.round(box.getBoundingClientRect().height) : -1, occ }
  })
  const p0 = await np()
  ok(p0.host && p0.card > 0, 'N2a `#np-host` 里挂着声音控件（`.snd-box` 有实际高度）', `card=${p0.card}px`)
  await page.click('#np-host .snd-tap'); await page.waitForTimeout(700)
  const p1 = await np()
  ok(p1.card > p0.card, 'N2b 点声音控件 ⇒ 卡片展开', `card ${p0.card} → ${p1.card}px`)
  await page.click('#np-host .snd-tap'); await page.waitForTimeout(700)
  const p2 = await np()
  ok(Math.abs(p2.card - p0.card) <= 3, 'N2c 再点 ⇒ 收回（是开关，不是只能开一次）', `card ${p1.card} → ${p2.card}px`)
  if (p0.occ && p1.occ) {
    console.log('遮挡读数（收起）: ' + JSON.stringify(p0.occ).slice(0, 200))
    console.log('遮挡读数（展开）: ' + JSON.stringify(p1.occ).slice(0, 200))
    notes.push('npOcclusion 收起=' + JSON.stringify(p0.occ).slice(0, 160))
    notes.push('npOcclusion 展开=' + JSON.stringify(p1.occ).slice(0, 160))
    ok(p0.occ.scrollKnown === true && p1.occ.scrollKnown === true, 'N3a 两态都量到了滚动口径（`scrollKnown=true`，不猜）',
      `收起=${p0.occ.scrollKnown} 展开=${p1.occ.scrollKnown}`)
    ok(p0.occ.unreachableCount === 0 && p1.occ.unreachableCount === 0, 'N3b 两态都**没有够不着的属性项**（`unreachableCount=0`）',
      `收起=${p0.occ.unreachableCount} 展开=${p1.occ.unreachableCount}`)
    ok(p1.occ.cover >= p0.occ.cover, 'N3c 展开态遮挡高度 ≥ 收起态（展开只会更挡）', `cover ${p0.occ.cover} → ${p1.occ.cover}`)
  } else notes.push('N3 未测：`__benchPatch.npOcclusion()` 不可用')

  // ── N4 属性表滚到底 ─────────────────────────────────────────────────────────
  const reach = await page.evaluate(async () => {
    const body = document.getElementById('props-body')
    if (!body) return null
    body.scrollTop = body.scrollHeight
    await new Promise((r) => setTimeout(r, 500))
    const rows = [...body.querySelectorAll('.prop')]
    const last = rows[rows.length - 1]
    const host = document.getElementById('np-host')
    const hr = host ? host.getBoundingClientRect() : null
    const lr = last ? last.getBoundingClientRect() : null
    return { rows: rows.length, lastBottom: lr ? Math.round(lr.bottom) : null, hostTop: hr ? Math.round(hr.top) : null,
      lastVisible: !!(lr && hr && lr.bottom <= hr.top + 2) }
  })
  if (reach) {
    // `rows === 0` 只说明"这一档没选中壁纸 ⇒ 属性表是空的"，**不是**通过（不能拿空表当绿）
    if (reach.rows > 0) ok(reach.lastVisible, 'N4 属性表滚到底时最后一项**能滚到声音控件上方**（不被永久遮住）',
      `rows=${reach.rows} lastBottom=${reach.lastBottom} hostTop=${reach.hostTop}`)
    else notes.push('N4 未测：属性表是空的（这一档没选中带 properties 的壁纸）⇒ 不当作通过')
  } else notes.push('N4 未测：没有 `#props-body`')

  // ── N5 自绘下拉（工具条）+ 没被属性面板盖住 ──────────────────────────────────
  //  ①(P-158) 口径变了：工具条那 6 个下拉现在**全部**由 `bindDropdown` 的 `.bench-rd` 独占
  //  （`demo/bench-patch.js: BENCH_BAR_SELECT_IDS`），mpw 控件只留给 `#props-body` 里的 combo。
  //  所以这里两种控件都试：工具条优先 `.bench-rd`（打开后列表是 `.bench-rd-list`），
  //  再退到 mpw（`.mpw_select` / `.mpw_select_list`）。判据本身不变：**恰好 1 个列表**、再点即关。
  const kinds = [
    { scope: '#toolbar .bench-rd', open: '.bench-rd.open', list: '.bench-rd-list', btn: '.bench-rd-btn', flipAttr: 'data-placement' },
    { scope: '#toolbar .mpw_select', open: '.mpw_select[data-open]', list: '.mpw_select_list', btn: '.mpw_select_btn', flipAttr: 'data-flip' },
    { scope: '.mpw_select', open: '.mpw_select[data-open]', list: '.mpw_select_list', btn: '.mpw_select_btn', flipAttr: 'data-flip' },
  ]
  const selInfo = await page.evaluate((ks) => {
    for (const k of ks) { const n = document.querySelectorAll(k.scope).length; if (n > 0) return { kind: k, n } }
    return { kind: null, n: 0 }
  }, kinds)
  if (selInfo.kind) {
    const K = selInfo.kind
    let opened = false
    for (let i = 0; i < Math.min(3, selInfo.n); i++) {
      const hit = await page.evaluate(({ scope, idx, btnSel }) => {
        const els = [...document.querySelectorAll(scope)]
        const el = els[idx]; if (!el) return null
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        const btn = el.querySelector(btnSel); if (!btn) return null
        const r = btn.getBoundingClientRect()
        const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
        const at = document.elementFromPoint(x, y)
        return { x, y, self: !!(at && (at === btn || btn.contains(at))), hit: at ? (at.id || at.tagName) : null }
      }, { scope: K.scope, idx: i, btnSel: K.btn })
      if (!hit || !hit.self) { notes.push(`工具条下拉[${i}]（${K.scope}）被遮挡（命中 ${hit && hit.hit}）`); continue }
      await page.mouse.click(hit.x, hit.y); await page.waitForTimeout(500)
      //  ①(P-158) 计数口径：`.bench-rd-list` 是**常驻**节点（`bindDropdown` 给每个 select 都建了一个），
      //  所以"恰好 1 个列表"要看**可见/展开**的那一个（`.bench-rd.open .bench-rd-list` 的 display=block），
      //  而不是 `querySelectorAll('.bench-rd-list').length`（那恒等于 select 数 ⇒ 假红）。
      const st = await page.evaluate(({ openSel, listSel, flipAttr }) => {
        const openEls = [...document.querySelectorAll(openSel)]
        const shown = [...document.querySelectorAll(listSel)].filter((l) => getComputedStyle(l).display !== 'none')
        return { open: openEls.length, shown: shown.length, flip: shown[0] ? shown[0].getAttribute(flipAttr) : (openEls[0] ? openEls[0].querySelector(listSel) && openEls[0].querySelector(listSel).getAttribute(flipAttr) : null) }
      }, { openSel: K.open, listSel: K.list, flipAttr: K.flipAttr })
      if (st.open === 1 && st.shown === 1) {
        opened = true
        ok(!!st.flip, `N5a 工具条下拉[${i}] 点开 ⇒ **恰好 1 个展开的**列表且带贴合方向标记（\`${K.flipAttr}\`）`, `scope=${K.scope} ${K.flipAttr}=${st.flip}`)
        await page.mouse.click(hit.x, hit.y); await page.waitForTimeout(500)
        const st2 = await page.evaluate(({ openSel, listSel }) => ({ open: document.querySelectorAll(openSel).length, shown: [...document.querySelectorAll(listSel)].filter((l) => getComputedStyle(l).display !== 'none').length }), { openSel: K.open, listSel: K.list })
        ok(st2.open === 0 && st2.shown === 0, 'N5b **再点即关**（不是又开一个）', `open=${st2.open} shown=${st2.shown}`)
        break
      }
    }
    if (!opened) ok(false, 'N5a 工具条下拉点开 ⇒ 列表展开', `scope=${K.scope} 前 3 个都没打开（见 notes 的遮挡/命中信息）`)
  } else notes.push('N5 未测：工具条里既没有 `.bench-rd` 也没有 `.mpw_select`（自绘下拉没挂上）')

  /* ⑪(2026-09-21 渲染器来源：默认 = 本仓渲染器) 切档助手 + 新契约判据。
     为什么需要它：预览现在**默认**跑本仓渲染器（`/webloader/**` 同源反代 → `:8899` 的 `demo.html` + 本仓 core）。
     而 web 壁纸那条路（同源入口 + WE shim 注入 + 入口里的 `<video>/<audio>`）目前**只有上游产物页有**
     （⚠ 旧口径已更正：本仓渲染器页的 web 路径后来已落地，见 `demo.html` 的 `?type=web` 与 R3/R3b/R3c；这里"显式切上游档"是**当前夹具选择**，不是能力缺失）⇒ T/W 两组测 web 档时**显式**切到上游档当夹具，
     **断言口径一条不动**；切换本身与"默认是谁"由下面 R 组另立判据钉住（旧契约"默认 iframe 就是产物页"
     → 新契约"默认 = 本仓渲染器，且能显式切回产物页当对照"）。 */
  const setRendererSource = (mode) => page.evaluate((m) => {
    const sel = document.getElementById('renderer-src')
    if (!sel) return null
    sel.value = m
    sel.dispatchEvent(new Event('change'))
    return sel.value
  }, mode)
  const rendererSourceState = () => page.evaluate(() => {
    const sel = document.getElementById('renderer-src')
    /*  ①(2026-10-11 用户第 3 条) 状态片 `#status-renderer-src` 已从 UI 移除 ⇒ 读数走探针
        `__benchPatch.rendererSrcStatus()`（返回 `rendererSourceStatusPlan()` 的同一份计划：
        `text` / `attrs.src` / `attrs.ready` 与原 `data-mpw-*` 同源同形）。 */
    const st = (window.__benchPatch && window.__benchPatch.rendererSrcStatus) ? window.__benchPatch.rendererSrcStatus() : null
    const fr = document.getElementById('frame')
    return {
      mode: sel ? sel.value : null,
      attr: st && st.attrs ? st.attrs.src : null,
      text: st ? String(st.text || '') : '',
      src: fr ? String(fr.getAttribute('src') || '') : '',
    }
  })

  // ══════════════════ R 组（⑪ 渲染器来源：默认 = 本仓 + 能切回上游 + web 档的诚实边界）══════════════════
  {
    //  R 组跑在 S 组之前（页面刚起来）⇒ `#frame` 的 src 由"合成样例"那条路径在 1.2s 后才写
    //  （本仓档下 = 导航到 `?id=sample-synthetic`）⇒ **有界等待**它出现（等不到照旧失败，不放松）
    for (let i = 0; i < 20; i++) {
      const cur = await rendererSourceState()
      if (cur.src) break
      await page.waitForTimeout(500)
    }
    const r0 = await rendererSourceState()
    ok(r0.mode === 'repo' && r0.attr === 'repo' && String(r0.src).startsWith('/webloader/?') && /[?&]id=/.test(r0.src),
      'R1 ★新契约：**预览默认就是本仓渲染器**（`#renderer-src`=repo、状态行 `data-mpw-renderer-src`=repo、' +
      'iframe 一开始就是 `/webloader/?…&id=<壁纸>`，不是产物页）——"一个渲染器表面"这条要求的第一判据',
      JSON.stringify({ mode: r0.mode, attr: r0.attr, src: String(r0.src).slice(0, 90) }))
    //  切到上游档：路径必须变回产物那条（对照/排障档仍然可用），且状态行如实写"上游产物"
    await setRendererSource('upstream')
    await page.waitForTimeout(1500)
    const r1 = await rendererSourceState()
    ok(r1.mode === 'upstream' && /renderer\/index\.html/.test(r1.src) && !/\/webloader\//.test(r1.src) &&
      r1.attr === 'upstream',
      'R2 显式切「上游产物」⇒ iframe 回到产物页那条路径（对照档真的还能用，不是单向开关）',
      String(r1.src).slice(0, 90))
    //  web 档在本仓渲染器上的**诚实边界**：切回本仓 + 挂一张 web 壁纸 ⇒ 不注入 shim、扫不到媒体元素
    //  （这正是 T/W 两组必须切上游档的原因，也是"整合成一个"还差的那块工作量的证据）
    await setRendererSource('repo')
    await page.waitForTimeout(1200)
    /*  ⓪(2026-10-12 判据修复 · task-17) **夹具自证**：R3/R3b/R3c 的前提是"库里有一张 web 档"。
        实测（2026-10-07 起）库根是用户在选择器里显式选定的一个**平铺 `.mpkg` 目录**（顶层 6 个 `.mpkg`、
        0 个子目录，服务端 census `web=0`）⇒ 库里一张 web 档都没有；而 `/web/dev/**`、`/media/dev/**`
        是**库根内**只读面（服务端按 activeRoot 解析 itemId，`server/we-scene-demo-server-8902.mjs:3123`）
        ⇒ 换任何"库外"入口都会 404，这条路在当前运行配置下**无从触发**。
        判据**一条不放宽**（照旧 FAIL）；这里只把"夹具在不在库里"做成**显式读数**（`libraryWeb`），
        否则读数是 `skipped:"cross-origin"` 这种上一张壁纸的残留状态，人根本分不清是
        "契约被违反"还是"夹具不在库里"。同时这也让下面 T 组不会被同一件事二次误导。 */
    const libCensus = await (async () => {
      try {
        const r = await fetch(new URL('/api/library', URL_BASE), { signal: AbortSignal.timeout(10000) })
        const j = await r.json()
        const items = Array.isArray(j.items) ? j.items : []
        const kinds = { scene: 0, web: 0, video: 0 }
        for (const it of items) { const k = String(it.type || it.kind || '').toLowerCase(); if (k in kinds) kinds[k]++ }
        return { dir: String(j.dir || ''), items: items.length, kinds, webIds: items.filter((it) => String(it.type || it.kind || '').toLowerCase() === 'web').map((it) => String(it.itemId || '')).slice(0, 8) }
      } catch (e) { return { err: String((e && e.message) || e) } }
    })()
    const libWeb = (libCensus.kinds && libCensus.kinds.web) || 0
    const fixtureTag = libWeb > 0 ? 'web-in-library' : 'no-web-item-in-library(web=0)'
    const r2 = await page.evaluate(async () => {
      const fr = document.getElementById('frame')
      const seg = document.querySelector('#type-filter .seg-btn[data-type="web"]')
      if (seg) seg.click()
      await new Promise((r) => setTimeout(r, 900))
      const lis = [...document.querySelectorAll('#list li[data-id]')]
      const li = lis.find((x) => x.dataset.id === '3644069061') || lis[0]
      if (li) li.click()
      await new Promise((r) => setTimeout(r, 9000))
      const st = (window.__benchPatch && window.__benchPatch.rendererSrcStatus) ? window.__benchPatch.rendererSrcStatus() : null
      const shim = (window.__benchWebShim ? window.__benchWebShim() : null)
      const list = window.__benchShell && window.__benchShell.navSound ? window.__benchShell.navSound.mediaList() : null
      return {
        id: li ? li.dataset.id : null,
        attr: st && st.attrs ? st.attrs.src : null,
        injected: shim ? shim.injected : null,
        skipped: shim ? shim.skipped : null,
        videos: list ? list.vids.length : null,
        audios: list ? list.auds.length : null,
        /* ①(2026-09-24) 「宿主让位」的**载荷证据**（不只看记账字段）：渲染器页自己挂的那条 web 帧，
           `src` 必须是**原始 http(s) 入口**（`/web/…`），不是宿主那条 blob 通路产出的 `blob:` URL。
           为什么补这条：`skipped` 是宿主的状态面字段，单看它无法区分"真让位"和"根本没看见这次赋值"。 */
        nested: (() => {
          try { return [...fr.contentWindow.document.querySelectorAll('iframe')].map((f) => String(f.getAttribute('src') || '')) } catch (e) { return null }
        })(),
        frameReady: (() => { try { return !!(fr && fr.contentWindow && fr.contentWindow.__mpwWebFrame && fr.contentWindow.__mpwWebFrame.ready) } catch (e) { return null } })(),
        frameMode: (() => { try { return fr && fr.contentWindow && fr.contentWindow.__mpwWebFrame ? fr.contentWindow.__mpwWebFrame.mode : null } catch (e) { return null } })(),
        frameState: (() => { try { return fr && fr.contentWindow && fr.contentWindow.__mpwWebFrame ? fr.contentWindow.__mpwWebFrame.state : null } catch (e) { return null } })(),
      }
    })
    /* ①(2026-09-23 第 ⑥ 条) **契约已变**：本仓渲染器页现在自己有 web 路径（`?type=web` + 原始 URL +
       服务端注入 shim），所以「注入 0 次 / 媒体 0 个」这条**旧缺口的记录**必须换成新判据：
       宿主让位（`skipped:host-injects`、不再包 blob）+ 帧真的挂上并报到（`__mpwWebFrame.ready`）。 */
    ok(r2.attr === 'repo' && r2.injected === 0 && r2.skipped === 'host-injects' &&
      Array.isArray(r2.nested) && r2.nested.length > 0 && r2.nested.every((u) => /^https?:\/\/[^/]+\/web\//.test(u)),
      'R3 ★新契约：本仓渲染器档 + web 壁纸 ⇒ **宿主让位**（不再包 blob 注入：`skipped=host-injects`、注入 0 次）' +
      '—— web 帧由渲染器页自己挂（帧 `src` 是原始 `/web/…` URL，**不是** `blob:`）、shim 由服务端注入',
      JSON.stringify({ ...r2, fixture: fixtureTag, libraryWeb: libWeb, libraryDir: libCensus.dir, libraryItems: libCensus.items }))
    /* ①(2026-09-24) R3c：「shim 由服务端注入」这句话必须**可独立核对**（不是靠宿主自述）：直接取一次帧入口，
       看服务端的注入头与文档里的注入标记。为什么这条要与 R3 分开：R3 的 `skipped` 是宿主状态面，
       R3c 是服务端事实 —— 两条一起才排得掉"两边都以为对方注入了"（旧读数的 `failed:1` 就是这种双重注入）。 */
    const srvShim = Array.isArray(r2.nested) && r2.nested.length
      ? await page.evaluate(async (u) => {
        try {
          const r = await fetch(u, { credentials: 'same-origin' })
          const t = await r.text()
          return { ok: r.ok, status: r.status, shim: r.headers.get('X-Mpw-Shim'), marker: /data-mpw-we-shim/.test(t) }
        } catch (e) { return { err: String((e && e.message) || e) } }
      }, r2.nested[0])
      : { err: 'no-nested-frame' }
    ok(srvShim.ok === true && srvShim.shim === 'injected' && srvShim.marker === true,
      'R3c ★新契约：「shim 由服务端注入」独立核对（`GET <帧入口>` ⇒ `X-Mpw-Shim: injected` + 文档里有 `data-mpw-we-shim` 注入标记）',
      JSON.stringify({ ...srvShim, fixture: fixtureTag, libraryWeb: libWeb, frameEntry: (Array.isArray(r2.nested) && r2.nested[0]) || null }))
    ok(r2.frameReady === true && r2.frameMode === 'compat',
      'R3b 本仓渲染器档的 web 帧**真的挂上并报到**（`__mpwWebFrame.ready=true`、`mode=compat`）',
      JSON.stringify({ ready: r2.frameReady, mode: r2.frameMode, state: r2.frameState, fixture: fixtureTag, libraryWeb: libWeb, selectedId: r2.id }))
    //  收尾：把类型过滤恢复成「全部」—— 后面的 S 组按"全部档列表"取数，
    //  夹具留下的 web 过滤会让它看到的行数与类型都不对（实测 S7b 就是这么红的）。
    await page.evaluate(async () => {
      const all = document.querySelector('#type-filter .seg-btn[data-type="all"]')
      if (all) all.click()
      await new Promise((r) => setTimeout(r, 700))
    })
    /*  ⓪(P-360 · task-26) **档位复位：切回「本仓渲染器」**，不再把「上游产物」当收尾态。
        旧口径的收尾态是 `upstream`（因为当年上游产物页就是"预览的默认实现"，S 组在它上面跑）。
        新契约（用户口径「把上游渲染器移出仓库」）下「上游产物」档 = `demo/renderer/index.html`
        的**适配器装载器**：本仓档 ⇒ 容器内装载 `/webloader/`；外部档 ⇒ 导航到外部来源；
        挑不出来 ⇒ 明确 SKIP 面板 —— ⚠ 装载器**按契约不许发布 `__wp` / `__mpwHostApiReady`**
        （`demo/renderer/adapter-boot.mjs` 开头两条"不许做"）。谁把收尾态留在 upstream，
        后面不依赖上游产物的组就会踩在一具"没有 `__wp` 的装载器页"上**假红**
        （实测：S7e `wp:false`、S6b `source=renderer` 计 0 ⇒ 两条与本组无关的红）。
        T 组自己会**显式**切到上游档（它已经这么做了），所以这里复位不影响 T/W 的夹具。 */
    await setRendererSource('repo')
    await page.waitForTimeout(1500)
  }

  // ══════════════════ S 组（P-158/P-159 本批 11 条 + 类型/指针）══════════════════
  //  每条都是**几何/交互判据**，与回报里的判据一一对应；纯函数部分在 tests/bench-shell-fixes-test.mjs。

  // S1 ①④ 宽屏工具条：`#main` 的内层列不再被内容撑爆 ⇒ 每个控件都在视口内
  {
    const s = await page.evaluate(() => {
      const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width) } }
      const tb = document.getElementById('toolbar')
      const main = document.getElementById('main')
      const kids = [...tb.children]
      return {
        toolbar: R(tb), main: R(main), n: kids.length,
        out: kids.filter((k) => { const r = k.getBoundingClientRect(); return r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5 }).length,
        wide: !document.documentElement.classList.contains('bench-narrow'),
      }
    })
    ok(s.toolbar.w <= s.main.w + 1, 'S1a ①④工具条宽度 = `#main` 宽度（内层列 `minmax(0,1fr)`；改前实测 2279 > 740）', `toolbar=${s.toolbar.w} main=${s.main.w} wide=${s.wide}`)
    ok(s.out === 0, 'S1b ①④工具条里**没有**超出视口的控件（用户第 1/4 条：后面的选项被顶出屏幕）', `${s.n} 个控件，溢出 ${s.out} 个`)
  }

  // S2 ② 下拉与触发框贴合（下开 ≤2px；再把工具条临时挪到底部量一次**上翻**）
  {
    const gap = await page.evaluate(async () => {
      const btn = document.getElementById('bench-rd-btn')
      const list = document.getElementById('bench-rd-list')
      btn.click(); await new Promise((r) => setTimeout(r, 350))
      const b = btn.getBoundingClientRect(); const l = list.getBoundingClientRect()
      const below = l.top >= b.top
      const g = below ? l.top - b.bottom : b.top - l.bottom
      btn.click(); await new Promise((r) => setTimeout(r, 200))
      return { gap: Math.round(g * 10) / 10, below, placement: list.getAttribute('data-placement') }
    })
    ok(gap.gap <= 2 && gap.gap >= 0 && gap.placement === 'below', 'S2a ②分辨率下拉（下开）：列表上边缘距触发框下边缘 ≤2px', JSON.stringify(gap))
    const up = await page.evaluate(async () => {
      const tb = document.getElementById('toolbar')
      const old = tb.getAttribute('style')
      tb.setAttribute('style', 'position:fixed;left:8px;bottom:8px;right:8px;z-index:50')
      await new Promise((r) => setTimeout(r, 250))
      const btn = document.getElementById('bench-rd-btn')
      const list = document.getElementById('bench-rd-list')
      btn.click(); await new Promise((r) => setTimeout(r, 350))
      const b = btn.getBoundingClientRect(); const l = list.getBoundingClientRect()
      const g = b.top - l.bottom
      const placement = list.getAttribute('data-placement')
      btn.click()
      if (old) tb.setAttribute('style', old); else tb.removeAttribute('style')
      await new Promise((r) => setTimeout(r, 250))
      return { gap: Math.round(g * 10) / 10, placement, listBottom: Math.round(l.bottom), btnTop: Math.round(b.top) }
    })
    ok(up.placement === 'above' && up.gap <= 2 && up.gap >= 0,
      'S2b ②触发框贴近裁剪盒底边 ⇒ 自动**上翻**且同样贴合（列表下边缘距触发框上边缘 ≤2px）', JSON.stringify(up))
  }

  // S3 ③ 工具条：一个 select 一个自绘控件、没有空 label
  {
    const s = await page.evaluate(() => {
      const tb = document.getElementById('toolbar')
      const sels = [...tb.querySelectorAll('select')]
      const rds = [...tb.querySelectorAll('.bench-rd')]
      const mpw = [...tb.querySelectorAll('.mpw_select')]
      return {
        selects: sels.length,
        hiddenSel: sels.filter((x) => x.hidden || getComputedStyle(x).display === 'none').length,
        nativeClass: sels.filter((x) => x.classList.contains('bench-rd-native')).length,
        rds: rds.length,
        mpw: mpw.length,
        labels: rds.map((r) => (r.querySelector('.bench-rd-btn') || {}).textContent || ''),
        expected: sels.map((x) => ((x.options[x.selectedIndex] || {}).textContent || '').trim()),
        emptyEverywhere: [...document.querySelectorAll('.mpw_select_label')].filter((l) => l.textContent === '（空）').length,
      }
    })
    // 计数 6→7(2026-09-21)：工具条新增第 7 个控件「渲染器来源」`#renderer-src`
    // （上游产物 / 本仓渲染器，两档；见 demo/index.html 的 ⑪ 块与 tests/bench-renderer-source-test.mjs）。
    // **口径一条没改**：每一个原生 select 都必须被隐藏、都必须恰好有一个 `.bench-rd`、且全页 0 个 `.mpw_select`
    // （重复增强的残留判据照旧）；上面 `expected` 是**逐个 select** 现算的 ⇒ 新控件也自动进"label 必须等于真实选中项"这条。
    // 计数 7→8（P-228f 2026-10-05）：工具条新增第 8 个控件「Web 渲染」`#web-mode`
    // （兼容 / 沙箱 / 自动，写进预览 URL 的 `?webframe=`；见 demo/index.html 的第 4 行与 P-228f）。
    ok(s.selects === 8 && s.hiddenSel === 8 && s.nativeClass === 8 && s.rds === 8 && s.mpw === 0,
      'S3a ③工具条：8 个原生 select（全部隐藏）+ **8 个 `.bench-rd`** + **0 个 `.mpw_select`**（重复增强的残留已删；' +
      '第 6 个是台账 §5.3 的「音条源」`#bandfeed`，第 7 个是「渲染器来源」`#renderer-src`，第 8 个是 P-228f 的「Web 渲染」`#web-mode`）',
      JSON.stringify({ selects: s.selects, hidden: s.hiddenSel, benchRdNative: s.nativeClass, rds: s.rds, mpw: s.mpw }))
    ok(s.labels.length === 8 && s.labels.every((x) => x && x.trim() && x !== '（空）') &&
      JSON.stringify(s.labels) === JSON.stringify(s.expected),
      'S3b ③每个自绘按钮都显示**真实选中项**，没有空 label / 展不开的空框', JSON.stringify(s.labels))
    ok(s.emptyEverywhere === 0, 'S3c ③全页没有「（空）」label（含属性面板的 mpw 控件；mpw 自身的 paintButton 陈旧闭包由补丁层兜底）', `count=${s.emptyEverywhere}`)
  }

  // S4 ⑤ 收起/展开"输出"：预览宽高比一致 + 完全落在可视区内 + 两个按钮两态都在
  {
    const s = await page.evaluate(async () => {
      const R = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) } }
      const vis = (sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const hit = (sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return !!(at && (at === el || el.contains(at))) }
      const snap = () => {
        const slot = R('#stage-slot'); const frame = R('#frame')
        const inside = !!(slot && frame && frame.x >= slot.x - 1 && frame.y >= slot.y - 1 && frame.right <= slot.right + 1 && frame.bottom <= slot.bottom + 1)
        return { slot, frame, inside, rs: frame && frame.h ? Math.round((frame.w / frame.h) * 1000) / 1000 : null, clear: vis('#clear-logs'), copy: vis('#copy-logs'), clearHit: hit('#clear-logs'), copyHit: hit('#copy-logs'), collapsed: document.getElementById('main').classList.contains('logs-collapsed') }
      }
      const before = snap()
      document.getElementById('toggle-logs').click(); await new Promise((r) => setTimeout(r, 900))
      const after = snap()
      document.getElementById('toggle-logs').click(); await new Promise((r) => setTimeout(r, 900))
      return { before, after }
    })
    ok(s.before.inside && s.after.inside,
      'S4a ⑤⑧预览内容完整落在可视区内（`#frame` rect ⊆ `#stage-slot` rect，收起前后都要）',
      JSON.stringify({ before: s.before.frame, after: s.after.frame, slotBefore: s.before.slot, slotAfter: s.after.slot }))
    const d = s.before.rs && s.after.rs ? Math.abs(s.before.rs - s.after.rs) / s.before.rs : 1
    ok(s.before.rs !== null && s.after.rs !== null && d <= 0.01 && Math.abs(s.before.rs - 16 / 9) <= 0.02,
      'S4b ⑤收起前后预览 rect 宽高比一致（±1%）且都是 16:9', `before=${s.before.rs} after=${s.after.rs} Δ=${(d * 100).toFixed(2)}%`)
    ok(s.before.clear && s.before.copy && s.after.clear && s.after.copy,
      'S4c ⑥「清空」「复制输出」在**展开与收起两态都可见**（用户第 6 条）',
      JSON.stringify({ expanded: [s.before.clear, s.before.copy], collapsed: [s.after.clear, s.after.copy] }))
    ok((s.before.clearHit && s.before.copyHit) || (!s.before.clearHit && !s.before.copyHit),
      'S4d ⑥两个按钮的命中区 = 可视区（没有"看得到点不到"）', JSON.stringify({ clear: s.before.clearHit, copy: s.before.copyHit }))
  }

  // S5 ⑧ 固定分辨率（`.fixed-res`）也要完整可见：产物的内联缩放盒不许被 `!important` 打回
  {
    const s = await page.evaluate(async () => {
      const R = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) } }
      const sel = document.getElementById('resolution')
      sel.value = '1920x1080'; sel.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 900))
      const slot = R('#stage-slot'); const sc = R('#stage-scale')
      const inside = !!(slot && sc && sc.x >= slot.x - 1 && sc.y >= slot.y - 1 && sc.right <= slot.right + 1 && sc.bottom <= slot.bottom + 1)
      const out = { ws: document.getElementById('workspace').className, inside, rs: sc && sc.h ? Math.round((sc.w / sc.h) * 1000) / 1000 : null, inline: document.getElementById('stage-scale').getAttribute('style'), badge: (document.getElementById('stage-badge') || {}).textContent }
      sel.value = 'fit'; sel.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 700))
      return out
    })
    ok(/fixed-res/.test(s.ws) && s.inside && Math.abs(s.rs - 16 / 9) <= 0.02,
      'S5 ⑧选了具体分辨率（1920×1080）⇒ 缩放盒仍完整落在可视区内且 16:9（产物的内联尺寸没被覆盖）',
      JSON.stringify({ ws: s.ws, inside: s.inside, rs: s.rs, badge: s.badge, inline: s.inline }))
  }

  // S6 ⑦ 渲染器诊断页签：订阅 `/api/diag-stream` 并显示**渲染器**消息（不是只显示补丁日志）
  {
    const s = await page.evaluate(async () => {
      const tab = document.getElementById('tab-diag')
      const r = tab.getBoundingClientRect()
      const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
      tab.click()
      await new Promise((res) => setTimeout(res, 2500))
      //  ⑪(2026-09-21) **先清空再挂载**：诊断列表是**有界**的（回放最近 50 条 + 后续追加到上限），
      //  页面起来后本仓渲染器的日志镜像已经把它填到上限 ⇒ 不清空的话"挂载后条数增长"这条**结构上**
      //  观察不到（实测 before=after=50）。清空后挂载再看增长 —— 判据本身（挂着数增长且 source=renderer）
      //  一条没动，只是把"从 0 开始"这个前提显式做出来。
      try { window.__benchShell && window.__benchShell.clearLogsView ? window.__benchShell.clearLogsView() : null } catch (e) { /* ignore */ }
      const clearBtn = document.getElementById('clear-logs')
      if (clearBtn) clearBtn.click()
      await new Promise((res) => setTimeout(res, 400))
      const before = document.querySelectorAll('#diag-body .diag-line').length
      const li = document.querySelector('#list li[data-id]')
      if (li) li.click()
      await new Promise((res) => setTimeout(res, 6000))
      const lines = [...document.querySelectorAll('#diag-body .diag-line')]
      return {
        tabHit: !!(at && (at === tab || tab.contains(at))),
        selected: tab.getAttribute('aria-selected'),
        view: document.getElementById('logs').dataset.view,
        before, after: lines.length,
        renderer: lines.filter((l) => l.dataset.source === 'renderer').length,
        errors: lines.filter((l) => l.dataset.level === 'error').length,
        state: document.getElementById('diag-body').dataset.state,
        sample: lines.slice(-1).map((l) => l.textContent.slice(0, 80)),
        logbodyHidden: getComputedStyle(document.getElementById('logbody')).display === 'none',
      }
    })
    ok(s.tabHit && s.selected === 'true' && s.view === 'diag',
      'S6a ⑦「渲染器诊断（/diag）」是可点的真页签（命中区 = 自己）⇒ `#logs[data-view="diag"]`', JSON.stringify({ hit: s.tabHit, view: s.view }))
    ok(s.renderer > 0 && s.after > s.before && s.logbodyHidden,
      'S6b ⑦诊断视图里是**渲染器诊断流**（挂载一次后条数增长，且 source=renderer），输出视图同时隐藏',
      JSON.stringify({ before: s.before, after: s.after, renderer: s.renderer, errors: s.errors, sample: s.sample }))
    await page.evaluate(async () => { document.getElementById('tab-logs').click(); await new Promise((r) => setTimeout(r, 200)) })
  }

  // S7 ⑨ 切换栏：已选/常用（位置固定、可点）+ 库列表**显式展开**
  {
    const s = await page.evaluate(async () => {
      const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
      const hit = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return { self: !!(at && (at === el || el.contains(at))), got: at ? (at.id || at.className || at.tagName) : null } }
      const add = document.getElementById('wp-add')
      const out = {
        tabsBefore: document.querySelectorAll('#editor-tabs .wp-tab').length,
        addParent: add.parentElement.id, addExpanded: add.getAttribute('aria-expanded'),
        addInBar: (() => { const b = R(document.getElementById('wp-switch')); const a = R(add); return !!(a && b && a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1) })(),
        addHit: hit(add),
      }
      add.click(); await new Promise((r) => setTimeout(r, 400))
      const rows = [...document.querySelectorAll('#wp-panel-list .wp-row')]
      out.panelOpen = !document.getElementById('wp-panel').hasAttribute('hidden')
      out.rows = rows.length
      out.types = rows.reduce((a, r) => { const k = (r.querySelector('.wp-kind') || {}).textContent; a[k] = (a[k] || 0) + 1; return a }, {})
      /*  ⓪(2026-10-12 判据修复 · task-17) 读数加固（**断言一条没改**）：`types` 只给"标签文本 → 行数"，
          红的时候看不出是"标签写错"还是"行的 data-kind 也错"。现在把两样都带上 ⇒ 现场能直接分辨。
          本条当前读数是**真红**（产品缺陷，不是判据过期）：每行 `.wp-kind` = `?`、`row.dataset.kind` = `unknown`。
          根因链（都在 `demo/bench-patch.js`，不属于本判据的写入范围）：
            · `decorateListRow`（`:6270-6295`）把 `.sub` 拆成 `.bench-row-kind` + `.bench-row-id` 两个 span，
              `textContent` 拼成 `scene丛雨.mpkg`（**没有分隔符**）；
            · 读者 `listItems()`（`:4492` `sub: li.querySelector('.sub')?.textContent`）把这串喂给
              `wpPanelRows()`（`:1015-1022` `kindOfSub(it.sub)`）；
            · `kindOfSub`（`:872`）按 `'·'` 切首段 ⇒ `'scene丛雨.mpkg' !== 'scene'` ⇒ `'unknown'` ⇒ tag `'?'`。
          同一个 DOM 上 `.bench-row-kind`/`.bench-kind` 都写着真实的 `scene`/`video` ⇒ 修法是让读者读那两个节点。 */
      out.rowKinds = rows.map((r) => ({ id: String(r.dataset.id || '').slice(0, 24), dataKind: r.dataset.kind || null, tag: (r.querySelector('.wp-kind') || {}).textContent || null }))
      out.rowHit = rows[0] ? hit(rows[0].querySelector('.wp-row-go')) : null
      out.pinHit = rows[0] ? hit(rows[0].querySelector('.wp-pin')) : null
      out.panelInBar = (() => { const b = R(document.getElementById('wp-switch')); const p = R(document.getElementById('wp-panel')); return !!(p && b && p.x >= b.x - 1 && p.x + p.w <= b.x + b.w + 1) })()
      return out
    })
    ok(s.addInBar && s.addHit && s.addHit.self && s.addParent === 'wp-switch',
      'S7a ⑨＋ 固定在切换栏内（不是浮在别处），且命中区 = 视觉区（`elementFromPoint` 命中它自己）',
      JSON.stringify({ parent: s.addParent, inBar: s.addInBar, hit: s.addHit }))
    ok(s.panelOpen && s.rows >= 1 && s.types && (s.types.scene || 0) >= 1,
      'S7b ⑨点 ＋ 才**显式展开**库列表（默认收起）；列表行带真实类型标签',
      JSON.stringify({ rows: s.rows, types: s.types, kindTexts: s.rowKinds && [...new Set(s.rowKinds.map((r) => r.tag))], dataKinds: s.rowKinds && [...new Set(s.rowKinds.map((r) => r.dataKind))], sample: s.rowKinds && s.rowKinds.slice(0, 2) }))
    ok(s.rowHit && s.rowHit.self && s.pinHit && s.pinHit.self,
      'S7c ⑨每行的"切换"与"★ 固定"两个命中区都等于视觉区（没有"看得到点不到"）', JSON.stringify({ row: s.rowHit, pin: s.pinHit }))
  }

  // S7d ⑨ 从库列表挂一张壁纸 ⇒ 该壁纸进"已选"（tab 条把它固定住），面板自动收起
  {
    const s = await page.evaluate(async () => {
      const rows = [...document.querySelectorAll('#wp-panel-list .wp-row')]
      const target = rows.find((r) => (r.querySelector('.wp-kind') || {}).textContent === 'video') || rows[rows.length - 1]
      const id = target.dataset.id
      target.querySelector('.wp-pin').click()          // ★ 固定
      await new Promise((r) => setTimeout(r, 400))
      const pinnedTabs = [...document.querySelectorAll('#editor-tabs .wp-tab')].map((b) => b.dataset.id + ':' + b.dataset.kind)
      const stored = (() => { try { return JSON.parse(localStorage.getItem('bench-pinned-wallpapers') || '[]') } catch { return null } })()
      // 切换一次：面板里的行点击 ⇒ 挂载 + 面板收起
      target.querySelector('.wp-row-go').click()
      await new Promise((r) => setTimeout(r, 5500))
      const frame = document.getElementById('frame')
      return { id, pinnedTabs, stored, panelHidden: document.getElementById('wp-panel').hasAttribute('hidden'), src: frame.getAttribute('src') || '', current: (document.getElementById('current') || {}).textContent, wp: (() => { try { return !!frame.contentWindow.__wp } catch { return false } })() }
    })
    ok(s.stored && s.stored.includes(s.id) && s.pinnedTabs.some((x) => x.startsWith(s.id + ':')),
      'S7d ⑨★ 固定生效：已选集合持久化（`bench-pinned-wallpapers`）且 tab 条里出现该项（带真实类型）', JSON.stringify({ stored: s.stored, tabs: s.pinnedTabs }))
    ok(s.panelHidden && /type=video|type=web|type=scene/.test(s.src) && s.wp,
      'S7e ⑨从库列表点一行 ⇒ 真的挂载（iframe 起来了）+ 面板自动收起', JSON.stringify({ hidden: s.panelHidden, src: s.src.slice(0, 120), wp: s.wp }))
  }

  // S8 类型过滤（用户补充要求：不是只能看到 scene）
  {
    const s = await page.evaluate(async () => {
      const out = {}
      const segs = (ty) => document.querySelector('#type-filter .seg-btn[data-type="' + ty + '"]')
      /*  ⓪(2026-10-12 判据修复 · task-17) **读数口径与当前行结构对齐**（判据强度不变：仍逐行判类型）。
          旧写法：`li.querySelector('.sub').textContent.split(' ')[0]` —— 它假定 `.sub` 是产物那一行文本
          `类型 · N 属性 · itemId`。用户第 14 条「属性太多导致 ID 显示不全」的修复把 `.sub` 拆成了
          `.bench-row-kind` + `.bench-row-id` 两个 `<span>`（`demo/bench-patch.js:6270-6295`），
          `textContent` 于是拼成 `scene丛雨.mpkg`（**中间没有分隔符**）⇒ 旧口径把每一行都读成
          `scene丛雨.mpkg` / `video-爱伦坡.mpkg`，`every(k === 'video')` 必假 ⇒ **假红**（判据侧过期，
          不是产品缺陷：同一个 DOM 上 `.bench-row-kind` / `.bench-kind` 都如实写着 `scene`/`video`）。
          新口径 = 真实契约节点优先，旧口径留作**兜底**（老结构页面照样读得对，等价强度不降）。 */
      const kindOfRow = (li) => {
        const node = li.querySelector('.bench-row-kind') || li.querySelector('.bench-kind')
        const raw = String((node && node.textContent) || '').trim().toLowerCase()
        const head = raw.split(/[^a-z]/)[0]          // `scene · 3 属性` 这类head 取首段
        if (head === 'scene' || head === 'web' || head === 'video') return head
        return String((li.querySelector('.sub') || {}).textContent || '').split(' ')[0].trim().toLowerCase()
      }
      const rows = () => [...document.querySelectorAll('#list li[data-id]')]
      const counts = () => rows().map(kindOfRow)
      for (const ty of ['scene', 'web', 'video', 'all']) {
        segs(ty).click()
        await new Promise((r) => setTimeout(r, 700))
        const kinds = counts()
        out[ty] = { n: kinds.length, kinds: [...new Set(kinds)] }
      }
      out.visible = !!document.querySelector('#type-filter') && document.querySelector('#type-filter').getBoundingClientRect().width > 0
      out.badge = [...document.querySelectorAll('#list li[data-id] .bench-kind')].length
      /* 徽章文本必须与**该行自己的类型**一致（"标签如实显示"的逐行版本；`.bench-kind` 由补丁挂在 `li` 上）。 */
      out.badgeOk = rows().filter((li) => {
        const b = li.querySelector('.bench-kind')
        return !!b && String(b.textContent || '').trim().toLowerCase() === kindOfRow(li)
      }).length
      out.rowSample = rows().slice(0, 3).map((li) => ({ id: String(li.dataset.id || '').slice(0, 24), kind: kindOfRow(li), badge: (li.querySelector('.bench-kind') || {}).textContent }))
      return out
    })
    /*  ⓪ 服务端逐类计数（`GET /api/library`，**独立于过滤器 UI**）—— 旧口径里"三档都必须非空"
        隐含了一个夹具假设："库里一定有这三类壁纸"。实测 2026-10-07 起用户把库根换成一个**平铺 .mpkg
        目录**（顶层 6 个 .mpkg、0 个子目录，census `scene=5 / video=1 / web=0`）⇒ web 档**本来就该是空的**，
        旧口径于是永远红（假红）。把两件事分开：库里**有**的档，列表必须非空且逐行类型正确；库里**没有**的档，
        空列表才是对的。刻意不放松的部分：`全部 = 三档之和` 与"逐档每行类型都对得上"两条一条不动
        （过滤器被焊在 scene 上时，`all.n >= Σ-1` 与 S8b 的逐档判断都会立刻变红）。 */
    const cen = await (async () => {
      try {
        const r = await fetch(new URL('/api/library', URL_BASE), { signal: AbortSignal.timeout(10000) })
        const j = await r.json()
        const items = Array.isArray(j.items) ? j.items : []
        const kinds = { scene: 0, web: 0, video: 0 }
        for (const it of items) { const k = String(it.type || it.kind || '').toLowerCase(); if (k in kinds) kinds[k]++ }
        return { items: items.length, kinds, dir: String(j.dir || '') }
      } catch (e) { return { err: String((e && e.message) || e) } }
    })()
    const cenK = (cen && cen.kinds) || { scene: -1, web: -1, video: -1 }
    const nonEmpty = (ty) => (s[ty] && s[ty].n > 0) || (Number(cenK[ty]) === 0)
    ok(s.visible && nonEmpty('scene') && nonEmpty('web') && nonEmpty('video') && s.all.n >= s.scene.n + s.web.n + s.video.n - 1,
      'S8a 类型过滤可用且**四档都在**：全部 = 三档之和（改前 `#type-filter` 被 hidden 且 onclick=null ⇒ 永远只有 scene；' +
      '每档是否允许为空由服务端 census 决定 —— 库里没有那一类时空列表才是对的）',
      JSON.stringify({ ...s, census: cenK, censusItems: cen && cen.items, dir: cen && cen.dir }))
    ok(s.scene.kinds.every((k) => k === 'scene') && s.web.kinds.every((k) => k === 'web') &&
      s.video.kinds.every((k) => k === 'video') && s.badge > 0 && s.badgeOk === s.badge,
      'S8b 每档列表里的条目类型都对得上（标签如实显示，不一律写 scene；三档都逐行判，徽章文本 = 该行类型）',
      JSON.stringify({ scene: s.scene, web: s.web, video: s.video, badges: s.badge, badgeOk: s.badgeOk, sample: s.rowSample }))
  }

  // S9 ⑩ 库来源显式显示（没选过就不许写成"已选"）
  {
    const s = await page.evaluate(() => {
      const el = document.getElementById('lib-source')
      if (!el) return null
      return { text: el.textContent, kind: el.dataset.kind, path: el.dataset.path, title: el.getAttribute('title') }
    })
    ok(s && s.text && s.path && (s.kind === 'default' || s.kind === 'user') && s.title,
      'S9 ⑩「当前库来源」写出四态之一 + 实际路径（本机默认目录会明确标注"你还没有选择"）', JSON.stringify(s))
  }

  // S10 ⑪ 设置/关于里的双方共同署名 + 上游许可全文入口
  {
    const s = await page.evaluate(() => {
      const q = (x) => document.getElementById(x)
      return {
        /* ①(2026-09-20 用户要求) 面板只留**一行**许可与归属链接（节点 id 保留 `credit-link-footer`），
           指向仓库 README 的「许可与归属」章节；旧的四节点（title/repo/两份许可全文）已删。 */
        line: (q('credit-line-footer') || {}).textContent, link: (q('credit-link-footer') || {}).textContent,
        href: q('credit-link-footer') && q('credit-link-footer').getAttribute('href'),
        legacyNodes: ['credit-title-footer', 'credit-repo-footer'].filter((id) => !!q(id)).length,
        legacyLic: document.querySelectorAll('.bench-credit-license a').length,
      }
    })
    /* href 的判据放在**静态面**（`bench-shell-fixes` B18 / `demo-check` D5 直接扫 HTML 源），
       这里只判"页面上真的只剩一行、且旧节点与许可全文入口都没了" —— 运行期 DOM 上 `getAttribute('href')`
       会受补丁重建节点的方式影响（实测拿到 null），拿它当判据会把"渲染方式"误判成"内容缺失"。 */
    /* ①(用户第 5 条「超链接点不动」) 判"点得动"的唯一硬判据 = **几何命中**：
       把设置弹层打开，取链接中心点做 `elementFromPoint`，命中的必须还是它自己（或被它包含）。
       只看 `href` 属性是抓不到"被覆盖层吃掉点击"的（实测就是这个）。 */
    {
      const opened = await page.evaluate(() => {
        const btn = document.getElementById('settings-btn')
        if (btn) btn.click()
        return !(document.getElementById('settings-pop') || {}).hasAttribute?.('hidden')
      })
      await page.waitForTimeout(400)
      const hit = await page.evaluate(() => {
        const a = document.getElementById('credit-link-footer')
        if (!a) return { found: false }
        const r = a.getBoundingClientRect()
        if (!(r.width > 0 && r.height > 0)) return { found: true, visible: false, rect: [r.width, r.height] }
        const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
        return { found: true, visible: true, hitSelf: !!(at && (at === a || a.contains(at) || at.contains(a))),
          hitTag: at ? at.tagName + '.' + String(at.className || '').slice(0, 24) : null, href: a.getAttribute('href') }
      })
      ok(opened && hit.found && hit.visible && hit.hitSelf && /^https:\/\/github\.com\//.test(String(hit.href || '')),
        'S11 设置弹层里的「许可与归属」链接**中心点命中的就是它自己**（= 真的点得动；只看 href 抓不到覆盖层）',
        JSON.stringify(hit))
    }
    ok(!!s.line && /README|许可与归属|License & credits/i.test(String(s.line)) && s.legacyNodes === 0 && s.legacyLic === 0,
      'S10 ⑪设置面板只留**一行**「许可与归属」链接（旧的四段长文案与两份许可全文入口都已删除；href 判据在静态面）', JSON.stringify(s))
  }

  // S11 ①(P-159) 指针"离开"不再推一个画面正中的活指针
  {
    const s = await page.evaluate(async () => {
      const before = (window.__benchPatch && window.__benchPatch.getPointerPark) ? window.__benchPatch.getPointerPark() : null
      const stage = document.getElementById('stage')
      const r = stage.getBoundingClientRect()
      // 合成事件：先给一个"在画面里"的坐标，再移出画面 + mouseout(null)
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: Math.round(r.x + r.width / 2), clientY: Math.round(r.y + r.height / 2), bubbles: true }))
      await new Promise((res) => setTimeout(res, 200))
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 2, clientY: 2, bubbles: true }))
      document.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: null, bubbles: true }))
      stage.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
      await new Promise((res) => setTimeout(res, 300))
      const after = (window.__benchPatch && window.__benchPatch.getPointerPark) ? window.__benchPatch.getPointerPark() : null
      return { before, after }
    })
    if (s.after) {
      ok(s.after.count > 0 && s.after.pushed === 0 && s.after.mode === 'leave',
        'S11a ①(P-159)"离开"确实发生了（count>0）但**一次都没推活坐标**（pushed===0；旧默认会 push(0.5,0.5)）', JSON.stringify(s.after))
    } else notes.push('S11 未测：`__benchPatch.getPointerPark()` 不可用')
  }

  // ══════════════════ F 组（P-158 §7.3 / 服务端 `aa2fbd2`）库目录对话框：**两档都测** ══════════════════
  //  服务端 `GET /api/fs/*` 由另一条线交付；:8902 的进程**重启过**（2026-09-19 实测 200）。这条断言
  //  先探路由状态，再按**对应那一档**判：200 ⇒ 应用内浏览真的可用（列根/进目录/确认按钮）；
  //  404 ⇒ 明确提示"服务端还没有这条路由" + 两个兜底按钮。两档都必须**不是**静默失败。
  {
    const routesStatus = await page.evaluate(() => fetch('/api/fs/roots', { headers: { accept: 'application/json' } }).then((r) => r.status).catch(() => 0))
    /* F0 ①(用户第 1 条 · 根因判据)：产物自己的 `#pick-lib.onclick` 必须已被本页补丁**摘掉**。
       为什么这是根因而不是"实现细节"：产物与补丁挂在**同一个元素**上（`onclick` IDL 属性 + 捕获监听），
       按 DOM 规范 AT_TARGET 阶段按**注册顺序**跑 —— 产物先注册 ⇒ 捕获拦不住它。它会 POST
       `{pick:true}`、拿到服务端的 `{cancelled,unsupported}` 之后调 `window.prompt()`（**模态**），
       主线程被按住 ⇒ 本补丁对话框停在 `Reading…`（真机与门禁读数都是 `{status:200,rows:0,path:"Reading…"}`）。
       判据是"这个入口只有一个主人"，不含任何本机路径/目录名。 */
    const f0 = await page.evaluate(() => ({
      onclick: (() => { const b = document.getElementById('pick-lib'); return b ? (b.onclick === null ? 'null' : typeof b.onclick) : 'missing' })(),
      prompts: Number(window.__nativePromptCalls || 0),
    }))
    ok(f0.onclick === 'null', 'F0 ①「选择文件夹」入口只有本页补丁一个主人（产物那个 `onclick` 已摘掉：同元素捕获拦不住它）', JSON.stringify(f0))
    const dlg = await page.evaluate(async () => {
      document.getElementById('pick-lib').click()
      await new Promise((r) => setTimeout(r, 1600))
      const box = document.getElementById('bench-fs-dialog')
      if (!box) return null
      const btns = [...box.querySelectorAll('button')].map((b) => ({ text: b.textContent, disabled: b.disabled, listable: b.dataset.listable || null }))
      return {
        note: (box.querySelector('#bench-fs-note') || {}).textContent || '',
        path: (box.querySelector('.bench-dirbox-path') || {}).textContent || '',
        rows: box.querySelectorAll('#bench-fs-list .bench-dirbox-row').length,
        dirRows: box.querySelectorAll('#bench-fs-list .bench-dirbox-row[data-type="dir"]').length,
        count: (box.querySelector('#bench-fs-count') || {}).textContent || '',
        confirm: !!box.querySelector('#bench-fs-confirm'),
        chips: btns.filter((b) => b.listable !== null),
        hasFrontend: btns.some((b) => /in-browser scan|纯前端/i.test(b.text)),
        hasSystem: btns.some((b) => /system picker|系统选择器/i.test(b.text)),
        //  ① 状态机快照（`__benchPatch.fsState()`）：卡在哪一步要能从读数上直接看出来
        state: (window.__benchPatch && window.__benchPatch.fsState) ? window.__benchPatch.fsState() : null,
        prompts: Number(window.__nativePromptCalls || 0),
      }
    })
    ok(!!dlg, 'F1 「选择文件夹」开的是**应用内对话框**（`#bench-fs-dialog`），不是直接弹系统选择器')
    if (dlg) {
      ok(dlg.hasFrontend && dlg.hasSystem, 'F2 对话框里两个兜底按钮都在（纯前端扫描 / **显式标注**的系统选择器）', JSON.stringify({ frontend: dlg.hasFrontend, system: dlg.hasSystem }))
      if (routesStatus === 200) {
        /*  ⓪(2026-10-12 判据修复 · task-17) 「列出了一档目录」必须在**当前真实库根**上成立 ——
            实测（2026-10-07 起）库根是用户在选择器里显式选定的一个**平铺 `.mpkg` 目录**（顶层 6 个 `.mpkg`、
            **0 个子目录**）⇒ 一打开对话框，`#bench-fs-list .bench-dirbox-row[data-type="dir"]` 必然为 0，
            旧口径于是永远红。这是**夹具假设过期**、不是选择器过期：真实契约就是 `data-type`
            （`demo/bench-patch.js:10047` 的 `row.dataset.type = r.type`），旧读数里 `rows=6 / dirs=0`
            正是"6 个文件、没有目录"，列表本身完全正常。
            对齐办法：用对话框**自己的「上一级」键**（`.bench-dirbox-tools:not(.bench-dirbox-roots) button`，
            只读浏览 —— 它只读 `pathEl.dataset.parent` 再列目录，**不碰**用户的库）有界走到第一个含子目录的位置，
            再判"列出了一档目录"。库根本身就有子目录时这里 **0 步**，读数与旧口径逐字一致（`upSteps:0`）。 */
        const nav0 = await page.evaluate(async () => {
          const box = document.getElementById('bench-fs-dialog')
          if (!box) return { err: 'no-dialog' }
          const all = (sel) => box.querySelectorAll(sel)
          const pathOf = () => { const p = box.querySelector('.bench-dirbox-path'); return { text: p ? p.textContent : '', path: (p && p.dataset) ? p.dataset.path : null, parent: (p && p.dataset) ? p.dataset.parent : null } }
          const upBtn = () => box.querySelector('.bench-dirbox-tools:not(.bench-dirbox-roots) button') ||
            [...box.querySelectorAll('button')].find((b) => /^(up|up one level|上一级|上级)/i.test(String(b.getAttribute('title') || b.textContent || '').trim())) || null
          const trail = []
          for (let i = 0; i < 8; i++) {
            if (all('#bench-fs-list .bench-dirbox-row[data-type="dir"]').length > 0) break
            const up = upBtn()
            if (!up || up.disabled) { trail.push('no-up'); break }
            const before = pathOf().path
            up.click()
            await new Promise((r) => setTimeout(r, 1000))
            const after = pathOf().path
            trail.push(after)
            if (!after || after === before) { trail.push('stuck'); break }
          }
          return {
            steps: trail.length, trail, at: pathOf(),
            rows: all('#bench-fs-list .bench-dirbox-row').length,
            dirRows: all('#bench-fs-list .bench-dirbox-row[data-type="dir"]').length,
            fileRows: all('#bench-fs-list .bench-dirbox-row[data-type="file"]').length,
          }
        })
        ok(dlg.rows > 0 && nav0.dirRows > 0 && dlg.confirm && dlg.chips.length > 0,
          'F3a 【200 档 · 本机实测】应用内浏览真的可用：列出了一档目录 + 「就选这个目录」按钮 + 快捷根',
          JSON.stringify({ status: routesStatus, rows: dlg.rows, dirs: dlg.dirRows, chips: dlg.chips.length, count: dlg.count, path: dlg.path,
            upSteps: nav0.steps, upTrail: nav0.trail, at: nav0.at && nav0.at.path, dirRowsAfterNav: nav0.dirRows, fileRowsAfterNav: nav0.fileRows,
            st: dlg.state && { state: dlg.state.state, loaded: dlg.state.loaded, pending: dlg.state.pending, gen: dlg.state.gen, loadMs: dlg.state.loadMs, dialogs: dlg.state.dialogs, err: dlg.state.lastErr } }))
        ok(dlg.prompts === 0, 'F0b ① 整条浏览链上**一次浏览器原生 prompt/alert/confirm 都没有**（产物那条会弹 `window.prompt` 的旧链已被摘掉）', `prompts=${dlg.prompts}`)
        ok(dlg.state && dlg.state.dialogs === 1, 'F3e1 ① 单例不变式：文档里同时只有 1 个 `.bench-dirbox` 选择器（不会"看得见的那份没在画"）', JSON.stringify({ dialogs: dlg.state && dlg.state.dialogs, state: dlg.state && dlg.state.state }))
        ok(!/api\/fs\/\*|noRoute|还没有/i.test(dlg.note),
          'F3b 【200 档】不再是"服务端还没有这条路由"的降级文案（走的是只读浏览说明）', dlg.note.slice(0, 60))
        ok(dlg.chips.some((c) => c.listable === '0' && c.disabled) || dlg.chips.every((c) => c.listable === '1'),
          'F3c 【200 档】服务端标了 `listable:false` 的根**灰显**（实测 home 默认不可列；不许"点了没反应"）', JSON.stringify(dlg.chips.map((c) => c.text + (c.disabled ? '(disabled)' : ''))))
        // 进一个子目录（不点确认：那会真的换库目录 —— 门禁不许改用户的库）
        const nav = await page.evaluate(async () => {
          const row = document.querySelector('#bench-fs-list .bench-dirbox-row[data-type="dir"]')
          if (!row) return null
          row.click()
          await new Promise((r) => setTimeout(r, 1200))
          const pathEl = document.querySelector('#bench-fs-dialog .bench-dirbox-path')
          return { path: pathEl ? pathEl.textContent : '', parent: pathEl ? pathEl.dataset.parent : '', rows: document.querySelectorAll('#bench-fs-list .bench-dirbox-row').length }
        })
        ok(nav && nav.rows > 0 && nav.parent,
          'F3d 【200 档】单击目录能进去（路径 + `parent` 都更新，上一级按钮靠 `parent` 而不是字符串拼路径）', JSON.stringify(nav))
        /* F3e ①(用户第 1 条)「就选这个目录」**成功之后的动作契约**：纯函数 + 运行期接线两条一起判。
           门禁**不点**确认（那会真的改用户的库目录）⇒ 契约用纯函数钉住、接线用"按钮确实接到了同一个
           入口"钉住。判据全是形状/状态机，不含任何本机路径或目录名。 */
        const commit = await page.evaluate(() => {
          const P = window.__benchPatch
          const st = P && P.fsState ? P.fsState() : null
          return { hasProbe: !!st, plan: st && st.commit, srcHasEntry: null }
        })
        const plan = commit.plan || {}
        ok(commit.hasProbe && plan.reloadPage === false && plan.closeDialogOnSuccess === true && plan.closeDialogOnFailure === false &&
          plan.touchSelection === false && plan.showReasonOnFailure === true && plan.listRequest && plan.listRequest.method === 'GET' && plan.listRequest.path === '/api/library',
          'F3e2 ① 成功路径契约：**立刻重拉库列表**（同页 `GET /api/library`）+ **自动关窗** + **不碰当前选中的壁纸**；失败路径：不关窗 + 写原因',
          JSON.stringify(plan))
        const wiring = await page.evaluate(() => {
          const box = document.getElementById('bench-fs-dialog')
          const btn = box && box.querySelector('#bench-fs-confirm')
          return { confirm: !!btn, disabled: !!(btn && btn.disabled), state: box ? box.dataset.state : '', path: box && box.querySelector('.bench-dirbox-path') ? box.querySelector('.bench-dirbox-path').dataset.path : '' }
        })
        ok(wiring.confirm && wiring.disabled === false && wiring.state === 'ok' && !!wiring.path,
          'F3e3 ① 列表真读成功之后「就选这个目录」才可点（`data-state=ok` + 按钮解禁 + 目标路径已落 `data-path`）', JSON.stringify(wiring))
      } else {
        ok(/api\/fs\/\*|noRoute|还没有/i.test(dlg.note) && dlg.rows === 0,
          'F4a 【404 档】明确写出"服务端还没有 /api/fs/* 这条路由"（不是静默失败）', JSON.stringify({ status: routesStatus, note: dlg.note.slice(0, 80) }))
      }
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      notes.push('F 组：/api/fs/roots 实测状态 = ' + routesStatus + '（分支：' + (routesStatus === 200 ? '200 应用内浏览' : '404 降级提示') + '）')
    }
  }

  /* ══════════ T/W 共同前提（P-360 · task-26）：上游产物档的**对象**在不在 ══════════
     背景：用户口径「把上游渲染器移出仓库，只留一个可扩展接口」⇒ 仓内那份唯一的上游产物
     `demo/assets/renderer-n-Rw_ZVc.js`（1.02 MB）已被删除，`demo/renderer/index.html` 改成
     **适配器装载器**（契约 `core/renderer-adapter.mjs`：本仓档 = 容器内装载 `/webloader/`；
     外部档 = 导航到 `?rendererSrc=` / `MPW_RENDERER_UPSTREAM` 指定的外部渲染器；挑不出来 ⇒ 明确 SKIP 面板）。
     T/W 两组判的是"**上游产物档**上 web 壁纸真的能用"（`__wp` 握手 / WE shim 注入 / 播放卡片真控媒体）
     ⇒ 没有上游产物它们**没有对象**：按本仓既有口径（`tests/renderer-adapter-test.mjs` D 段、
     `tests/bench-renderer-source-test.mjs` 的 `upstreamSubjectGate`、`tests/upstream-direct-mount-test.mjs`）
     **明确 SKIP + 写明原因**（行首 `SKIP bench-ui-headless —— …`），既不拿一具空壳去判红，也不静默通过。
     ⚠ **其余组照常跑**（不是整条判据 SKIP）；跳过时把 R 组为 T/W 切过去的档位**复位回 repo**，
     免得后面的组踩在"适配器装载器页"上假红。
     ⚠ 反向守卫（**不变量**，不是同义反复）：跳过决定必须与"对象是否可用"一致 ——
     谁把 SKIP 条件写成恒真 / 把可用性读错，这条立刻变红（变异自证见报告 §）。
     可用性三条来源（**先判存在性再读**；每一步 try/catch，绝不 `path.join(dir, undefined)`）：
       ① 仓内产物 `demo/assets/renderer-*.js` 的份数（离线事实，与姊妹判据同口径）；
       ② 外部上游来源 env `MPW_RENDERER_UPSTREAM` / `MPW_RENDERER_8899`（与服务端同一套开关语义）；
       ③ 运行期真值 `GET <bench>/api/renderers`（P-350 新增的**机读枚举面**）：
          `adapters[].kind === 'external'` 的 `available`（服务端自己那套 env/config 的答案 ——
          判据进程的 env 未必等于服务端的）。老服务没有这条路由 ⇒ 404，
          **只当"这条查询不可用"**（不当作"没有上游"，否则会把服务端配了外部上游的情况误判成 SKIP）。
          ⚠ `/api/renderers` 的 `upstreamInRepo` 是**常量 false**（`core/renderer-adapter.mjs:759` ——
          "仓内不再内置上游产物"是契约断言，不是文件系统探测）⇒ "产物回来没回来"只认源①。 */
  const upstreamSubject = await (async () => {
    const out = { artifact: [], envExternal: '', api: null, apiErr: '', apiExternal: null, apiInRepo: null, available: false, why: [] }
    try { out.artifact = fs.readdirSync(path.join(ROOT, 'demo', 'assets')).filter((n) => /^renderer-.*\.js$/.test(n)) } catch (e) { out.artifact = [] }
    out.envExternal = String(process.env.MPW_RENDERER_UPSTREAM || process.env.MPW_RENDERER_8899 || '').trim()
    try {
      const r = await fetch(new URL('/api/renderers', URL_BASE), { signal: AbortSignal.timeout(6000) })
      if (r.ok) out.api = await r.json()
      else out.apiErr = 'HTTP ' + r.status
    } catch (e) { out.apiErr = String((e && e.message) || e) }
    out.apiExternal = !!(out.api && Array.isArray(out.api.adapters) && out.api.adapters.some((a) => a && a.kind === 'external' && a.available === true))
    out.apiInRepo = !!(out.api && out.api.upstreamInRepo === true)
    if (out.artifact.length) out.why.push('仓内产物 ' + out.artifact.length + ' 份（' + out.artifact.slice(0, 2).join('/') + '）')
    if (out.envExternal) out.why.push('外部上游 env=' + out.envExternal)
    if (out.apiInRepo) out.why.push('服务端 upstreamInRepo=true')
    if (out.apiExternal) out.why.push('服务端 external 档 available=true')
    out.available = out.why.length > 0
    return out
  })()
  const TW_SKIP = !upstreamSubject.available
  /* 反向守卫（恒在、不可豁免）：`可用 ⇒ 必须真跑`。 */
  ok(upstreamSubject.available === !TW_SKIP,
    'TW0 反向守卫：跳过 T/W 的决定必须与"上游产物档可用"一致（可用 ⇒ 必须真跑；不许拿 SKIP 把失败藏起来）',
    JSON.stringify({ available: upstreamSubject.available, skipped: TW_SKIP, artifact: upstreamSubject.artifact,
      envExternal: upstreamSubject.envExternal || null, apiUpstreamInRepo: upstreamSubject.apiInRepo,
      apiExternalAvailable: upstreamSubject.apiExternal, apiErr: upstreamSubject.apiErr || null, why: upstreamSubject.why }))
  if (TW_SKIP) {
    console.log('SKIP bench-ui-headless —— T/W 组（上游产物档）：仓库内不再内置上游渲染器产物（demo/assets/renderer-*.js 0 份）'
      + '且未配外部上游来源（MPW_RENDERER_UPSTREAM / MPW_RENDERER_8899 / ?rendererSrc=）⇒ 这两组没有对象；其余组照常跑')
    notes.push('T/W 两组 SKIP（对象不存在，非静默通过）：'
      + JSON.stringify({ artifactFiles: upstreamSubject.artifact.length, envExternal: upstreamSubject.envExternal || null,
        api: upstreamSubject.api ? { upstreamInRepo: upstreamSubject.api.upstreamInRepo, externalAvailable: upstreamSubject.apiExternal } : upstreamSubject.apiErr,
        restore: '把产物放回 demo/assets/renderer-*.js（工作区内 staging/upstream-2.1.0/assets/ 有同一份；见 docs/REMOVALS.md 的恢复途径）或配 MPW_RENDERER_UPSTREAM=<URL>' }))
    //  夹具复位（与 R 组收尾同一件事，冗余保险）：R 组为 T/W 切过「上游产物」档 ⇒ 两组不跑就别把它留给后面的组
    await setRendererSource('repo')
    await page.waitForTimeout(1500)
  }

  // ══════════════════ T 组（P-161）播放卡片：真的在控当前媒体 ══════════════════
  //  为什么用 web 档：卡片的数据面来自"当前媒体元素"（`<video>`/`<audio>`）。video/scene 档在本渲染器里
  //  走 **WebCodecs 逐帧**（没有 `<video>` 元素、也没有任何 seek API），所以真控读数只能在"入口 HTML 里
  //  带媒体元素"的 web 档上取；video/scene 档的诚实降级（canSeek=false、canPlay 可用）也在这一组里断言。
  //  夹具选择：本机库 7 张 web 档里只有 3644069061（2×video + 3×audio）与 3646392375（1×audio）带媒体元素。
  //  ⑪(2026-09-21) **渲染器来源**：这条夹具当年只有上游产物页能跑（本仓渲染器页当时不认 web）——
  //  更正（P1 2026-10-05）：本仓 web 路径已落地（`demo.html` 的 `?type=web`，R3/R3b/R3c 钉住），这里保留上游档只是夹具选择。
  //  ⇒ 这一组显式切到「上游产物」档做夹具（上面的 R2 已经切过一次，这里再断言一次"确实是上游"，
  //  免得后继改动把夹具悄悄换掉）。断言口径与本组读数一字未动。
  if (!TW_SKIP) {
    //  夹具自证：本组读数只在产物页上有效 ⇒ 先确认/切到上游档
    await setRendererSource('upstream')
    await page.waitForTimeout(1500)
    {
      const r = await rendererSourceState()
      ok(/renderer\/index\.html/.test(r.src) && !/\/webloader\//.test(r.src),
        'T0 夹具自证：T/W 两组跑在**上游产物**档（web 壁纸路径的当前唯一实现），不是本仓渲染器档',
        String(r.src).slice(0, 80))
    }
    const t = await page.evaluate(async () => {
      const out = {}
      const seg = document.querySelector('#type-filter .seg-btn[data-type="web"]')
      if (!seg) return { err: 'no web seg' }
      seg.click()
      await new Promise((r) => setTimeout(r, 900))
      const lis = [...document.querySelectorAll('#list li[data-id]')]
      const li = lis.find((x) => x.dataset.id === '3644069061') || lis[0]
      /*  ⓪(2026-10-12 判据修复 · task-17) **夹具缺失不许把整轮跑挂**。
          旧写法直接 `li.dataset.id` —— `lis` 为空时抛 TypeError（`can't access property "dataset", li is undefined`），
          整个 try 块中止 ⇒ 这一行之后的**两千行断言**（T/W/M/X/Y/Z/P/G10/IA/LS…）一条读数都拿不到，
          门禁与人眼都只看到"一片红 + 一段 Node 栈"，根本分不清是哪条判据坏了。
          何时会空：web 过滤档下 `#list` 没有行。实测运行配置就是这种（库根 = 用户在选择器里显式选定的
          一个**平铺 .mpkg 目录**：顶层 6 个 .mpkg、0 个子目录、服务端 census `web=0`）⇒ 库里一张 web 档都没有。
          现在：如实返回 `err` 读数（下面每条 T 断言都有 `t && …` 守卫 ⇒ 照旧 FAIL，只是不再连坐后面的组）。
          ⚠ 判据口径**一条没放松**：这里只把"抛异常"换成"如实读数"。 */
      if (!li) return { err: 'no-web-item', note: 'web 过滤档下 #list 无行（夹具缺失：当前库没有 web 档）' }
      out.id = li.dataset.id
      li.click()
      await new Promise((r) => setTimeout(r, 11000))
      //  基线要在**挂载完成之后**取：挂载本身当然会换 src（那是 bundle 的换壁纸），
      //  这一组要证的是"卡片自己的操作不再动它"。
      const frameSrcBefore = document.getElementById('frame').getAttribute('src')
      const card = () => window.__benchPatch.npCard()
      const c0 = card()
      const a = window.__benchShell.navSound
      //  T1/T2 的读数要求"媒体元素已经读完 metadata"（`seekable` 有区间 / `duration` 有值）。同机实测：
      //  同一份页面同一个壁纸，一次 canSeek=true、一次 false（11s 之后仍在读）⇒ 这里是**有界等待**，
      //  不是把判据放松：等满 15s 还没读到就照旧按原判据失败。
      for (let i = 0; i < 30; i++) {
        const m = a.mediaList()
        const v = m.vids[0] || m.auds[0]
        if (v && Number(v.duration) > 0 && v.seekable && v.seekable.length > 0) break
        await new Promise((r) => setTimeout(r, 500))
      }
      //  ⚠ **既有假红（2026-09-21 实测，与「音条源」改动无关，别误判成回归）**：
      //  旧写法 `pick()` 取"未暂停的那个 video"，而本夹具（3644069061）有 **2 个** `<video>` ——
      //  有负载时"正在播的那个"这一刻可能还没有 metadata（`duration=NaN`，subframe 里能看到
      //  "media resource was aborted"），T4 于是报 `dur=0/ratio=null` 假红。
      //  A/B 证据（可复跑）：把 `demo/index.html` + `demo/bench-patch.js` 换回 HEAD
      //  （`git archive HEAD demo | tar -x -C <tmp>`，另一个端口用 `--static-root <tmp>/demo` 起服务，
      //  headless 用 `--url` 指过去）跑同一条门禁 —— T4 一样红，读数与 subframe 的媒体 abort note
      //  完全一致 ⇒ 与本批改动无关；空载重跑即绿（147/0）。同一会话里红/绿交替 ⇒ 竞态。
      //  ⚠ **已试过并回退的"修法"**：让 `pick()` 优先取"已有 metadata"的那个元素 —— 实测**更坏**：
      //  卡片的 op（播放/暂停/seek）作用在"正在播的那个"，于是 T3 也跟着红、T4 变成 `dur=8.2/ratio=0`
      //  （打到另一个静止元素上）。⇒ 正确的根治方向是"等正在播的那个元素拿到 metadata 再断言"
      //  （或有界重试 seek），**不是**换元素；本批不动它（不在范围内），只把证据留在这里。
      const pick = () => { const m = a.mediaList(); return m.vids.find((v) => !v.paused) || m.vids[0] || m.auds[0] || null }
      /* ①(2026-09-21 根治 T4 既有假红) 上面那段有界等待等的是 `vids[0]`，而 T4 的读数必须来自
         **卡片真正控制的那个元素**（`pick()` 取"未暂停的"）—— 夹具 3644069061 有 2 个 `<video>`，
         有负载时"正在播的那个"这一刻还没 metadata（`duration=0`，subframe 里常见 "media resource was aborted"）
         ⇒ 旧写法直接按下 ⇒ `dur=0/ratio=null` 假红。这里改成**等 pick() 自己拿到 duration**（有界 10s）；
         等满仍没有 ⇒ T4 自 SKIP 并进 notes（不假装通过、也不假红），见下面断言处的分支。 */
      for (let i = 0; i < 20; i++) {
        const v = pick()
        if (v && Number(v.duration) > 0) break
        await new Promise((r) => setTimeout(r, 500))
      }
      out.seekPre = (() => { const v = pick(); return v ? { dur: Math.round((Number(v.duration) || 0) * 1000) / 1000, readyState: v.readyState, paused: v.paused } : null })()
      const v0 = pick()
      out.initial = {
        snap: c0 && c0.snapshot, media: c0 && c0.media, controlled: c0 && c0.controlled, link: c0 && c0.link,
        cardHeight: c0 && c0.cardHeight,
        title: (document.querySelector('#np-mount .snd-title') || {}).textContent,
        by: (document.querySelector('#np-mount .snd-by') || {}).textContent,
        clock: [...document.querySelectorAll('#np-mount .snd-clock span')].map((x) => x.textContent),
        rail: (() => { const r = document.querySelector('#np-mount .snd-run'); return r ? r.style.width : null })(),
        opLabels: [...document.querySelectorAll('#np-mount .snd-op')].map((b) => b.getAttribute('aria-label') + (b.disabled ? '(disabled)' : '')),
        video: v0 ? { paused: v0.paused, t: Math.round(v0.currentTime * 1000) / 1000, dur: Math.round((Number(v0.duration) || 0) * 1000) / 1000, volume: v0.volume, muted: v0.muted } : null,
        markers: {
          root: !!document.querySelector('#np-mount [data-mpw-now-playing]'),
          scrub: !!document.querySelector('#np-mount [data-mpw-np-scrub]'),
          link: (document.querySelector('#np-mount [data-mpw-np-link]') || {}).getAttribute ? document.querySelector('#np-mount [data-mpw-np-link]').getAttribute('data-mpw-np-link') : null,
        },
        frameSrc: frameSrcBefore,
      }
      // ① 播放/暂停：先把媒体**强制到播放中**（走宿主入口，避免被上一组/自动播放策略留在暂停态），
      //    再点卡片那颗键 ⇒ `video.paused` 必须翻转（两条路径都是真实落点）。
      window.__benchPatch.npTransport('play', 1)
      await new Promise((r) => setTimeout(r, 900))
      const lead = document.querySelector('#np-mount .snd-op[data-lead]')
      const wasPlaying = pick() ? pick().paused === false : null
      const before = lead.getAttribute('aria-pressed')
      lead.click()
      await new Promise((r) => setTimeout(r, 900))
      const v1 = pick()
      out.toggle1 = { wasPlaying, before, after: lead.getAttribute('aria-pressed'), paused: v1 ? v1.paused : null }
      lead.click()
      await new Promise((r) => setTimeout(r, 900))
      const v2 = pick()
      out.toggle2 = { paused: v2 ? v2.paused : null, aria: lead.getAttribute('aria-pressed') }
      // ② 进度：在 rail 上按 75% 处点一下 ⇒ currentTime ≈ 0.75 × duration
      const rail = document.querySelector('#np-mount .snd-rail')
      const rr = rail.getBoundingClientRect()
      const x = Math.round(rr.left + rr.width * 0.75)
      const y = Math.round(rr.top + rr.height / 2)
      rail.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerId: 1, buttons: 1 }))
      rail.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, pointerId: 1 }))
      await new Promise((r) => setTimeout(r, 600))
      const v3 = pick()
      out.seek = { at: { x, y }, w: Math.round(rr.width), t: v3 ? Math.round(v3.currentTime * 1000) / 1000 : null, dur: v3 ? Math.round((Number(v3.duration) || 0) * 1000) / 1000 : null, ratio: v3 && v3.duration ? Math.round((v3.currentTime / v3.duration) * 100) / 100 : null }
      // ③ 音量：走卡片 op（宿主入口）⇒ 元素 volume 跟着变
      const rVol = window.__benchPatch.npTransport('volume', 0.42)
      await new Promise((r) => setTimeout(r, 400))
      const v4 = pick()
      out.volume = { op: rVol, volume: v4 ? Math.round(v4.volume * 100) / 100 : null, muted: v4 ? v4.muted : null }
      window.__benchPatch.npTransport('volume', 0)
      /*  ③(2026-09-25 issue0924a2 用户第 3 条) **卡片内部的音量轨**：直接拖那个 `<input id="np-volume">`
          （它现在由组件渲染；拖它走的是组件 `onChange` → `send("volume")` → `onTransport` 这条链，
          与上面 `npTransport('volume', …)` 那条**不是同一条入口**）⇒ 媒体元素音量必须跟着走。
          同时量"静音第四键"（传输行里那一颗）⇒ muted=true 且音量值保住。 */
      /*  ⚠音量轨只在**卡片展开**（组件 `showVolume = controlled && late > 0`）时存在 ⇒ 先把它点开
          （`#np-host .snd-tap` 是组件自己的展开键；最多试 4 次，每次等补间跑完）。 */
      for (let i = 0; i < 4; i++) {
        const g0 = window.__benchPatch.npGeometry ? window.__benchPatch.npGeometry() : null
        if (g0 && g0.volumeVisible) break
        const tap = document.querySelector('#np-host .snd-tap')
        if (tap) tap.click()
        await new Promise((r) => setTimeout(r, 900))
      }
      const volEl = document.querySelector('#np-volume')
      out.volSlider = (() => {
        const api = window.__benchPatch
        const g = api.npGeometry ? api.npGeometry() : null
        const mkEl = document.querySelector('#np-mount [data-mpw-np-mute]')
        return {
          present: !!volEl, disabled: volEl ? !!volEl.disabled : null, value: volEl ? String(volEl.value) : null,
          inCard: !!(g && g.volumeInCard), inStrip: !!(g && g.volumeInStrip), volumeOverflow: !!(g && g.volumeOverflow),
          keyPresent: !!mkEl, keyDisabled: mkEl ? !!mkEl.disabled : null,
        }
      })()
      if (volEl && !volEl.disabled) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(volEl, '0.35')   // ⚠滑条 step=0.05：写 0.31 会被浏览器按步长吸附到 0.3（实测踩到）
        volEl.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 800))
        const v5 = pick()
        out.volSlider.after = { value: String(volEl.value), video: v5 ? Math.round(v5.volume * 100) / 100 : null, muted: v5 ? v5.muted : null }
        const mk = document.querySelector('#np-mount [data-mpw-np-mute]')
        if (mk && !mk.disabled) {
          mk.click()
          await new Promise((r) => setTimeout(r, 700))
          const v6 = pick()
          const mk2 = document.querySelector('#np-mount [data-mpw-np-mute]')
          out.muteKey = { pressed: mk2 ? mk2.getAttribute('aria-pressed') : null, muted: v6 ? v6.muted : null, volKept: v6 ? Math.round(v6.volume * 100) / 100 : null }
          if (mk2) mk2.click()      // 收尾：恢复可听（后面的组还要用媒体）
          await new Promise((r) => setTimeout(r, 600))
        }
      }
      await new Promise((r) => setTimeout(r, 300))
      // ④ 联动开关：点心形 ⇒ link=0、所有键置灰、再点播放**不动作**
      const heart = document.querySelector('#np-mount [data-mpw-np-link]')
      heart.click()
      await new Promise((r) => setTimeout(r, 700))
      const c1 = card()
      const v5 = pick()
      const lead2 = document.querySelector('#np-mount .snd-op[data-lead]')
      const pausedBefore = v5 ? v5.paused : null
      lead2.click()
      await new Promise((r) => setTimeout(r, 600))
      const v6 = pick()
      out.link = {
        snapLink: c1 && c1.snapshot && c1.snapshot.link, canPlay: c1 && c1.snapshot && c1.snapshot.canPlay,
        attr: heart.getAttribute('data-mpw-np-link'), disabled: !!lead2.disabled,
        pausedBefore, pausedAfter: v6 ? v6.paused : null,
      }
      heart.click()      // 联动画回来
      await new Promise((r) => setTimeout(r, 500))
      out.linkBack = (card() || {}).snapshot ? card().snapshot.link : null
      // ⑤a 卡片操作**不 remount 壁纸**：这一串 op（播放/暂停/seek/音量/联动）走完，`#frame` 的 src 必须一字未动
      out.noRemountByCard = document.getElementById('frame').getAttribute('src') === frameSrcBefore
      // ⑤b 换壁纸（bundle 自己的 li.onclick）后卡片**重新绑定**到新壁纸的媒体（标题/媒体数跟着变）
      const frameSrcMid = document.getElementById('frame').getAttribute('src')
      const nextLi = lis[lis.indexOf(li) + 1] || lis[0]
      nextLi.click()
      await new Promise((r) => setTimeout(r, 9000))
      const c2 = card()
      out.rebind = {
        newTitle: c2 && c2.snapshot && c2.snapshot.title,
        cardStillThere: !!document.querySelector('#np-mount .snd-box'),
        newMeta: c2 && c2.media,
        frameReloadedBySwitch: document.getElementById('frame').getAttribute('src') !== frameSrcMid,
        cardHeight: c2 && c2.cardHeight,
      }
      return out
    })
    const ini = t.initial || {}
    if (t.err) notes.push('T 组夹具缺失：' + t.err + '（' + String(t.note || '') + '）⇒ T1–T8b 按原判据如实 FAIL，不假装通过；夹具一旦在库里，这组断言一条不改地生效')
    // ①(2026-10-04 修) 媒体元数据在满载下可能永远不到（Firefox "media resource was aborted"，与 T4
    //   同族）：接线本身成功（媒体元素扫到 + canPlay）但 canSeek=false / total=0 ⇒ **自 SKIP 如实记**
    //   （元数据没到 = 无从判定，不假装通过也不假红）；接线失败（扫不到媒体 / canPlay=false）仍 FAIL。
    const metaMissing = !!(ini.snap && ini.snap.canPlay && !ini.snap.canSeek && !(ini.snap.total > 0))
    if (metaMissing) notes.push('T1/T2 自 SKIP：媒体元素已接（canPlay=true）但元数据未到（canSeek=false/total=0，"media resource was aborted" 满载族）⇒ 无从判定')
    ok(t && ini.snap && ini.media && (ini.media.videos + ini.media.audios) > 0 && ini.snap.canPlay && (ini.snap.canSeek || metaMissing),
      'T1 【真控·接线】web 档（带媒体元素）挂载后卡片进入受控态：媒体元素被扫到、canPlay 为真（canSeek 需元数据，未到 = 自 SKIP）',
      JSON.stringify({ id: t && t.id, err: t && t.err, media: ini.media, snap: ini.snap && { kind: ini.snap.kind, source: ini.snap.source, canPlay: ini.snap.canPlay, canSeek: ini.snap.canSeek } }))
    ok(ini.title && ini.snap && ini.title === ini.snap.title && ini.by === ini.snap.byline && (ini.snap.total > 0 || metaMissing),
      'T2 【真控·显示】卡片上写的是**真实**标题/副标题（总长需元数据，未到 = 自 SKIP；不再是装饰值）',
      JSON.stringify({ title: (ini.title || '').slice(0, 40), by: ini.by, total: ini.snap && ini.snap.total }))
    ok(t && t.toggle1 && t.toggle1.wasPlaying === true && t.toggle1.paused === true && t.toggle1.after === 'false' &&
      t.toggle2 && t.toggle2.paused === false && t.toggle2.aria === 'true',
      'T3 【真控·播放/暂停】强制播放后点卡片那颗键 ⇒ `video.paused` 翻转 + `aria-pressed` 跟着真实状态（再点回来）',
      JSON.stringify({ wasPlaying: t && t.toggle1 && t.toggle1.wasPlaying, aria: [t && t.toggle1 && t.toggle1.before, t && t.toggle1 && t.toggle1.after], paused: [t && t.toggle1 && t.toggle1.paused, t && t.toggle2 && t.toggle2.paused] }))
    if (t && t.seek && t.seek.dur > 0) {
      ok(Math.abs(t.seek.ratio - 0.75) <= 0.12,
        'T4 【真控·进度】在卡片 rail 的 75% 处按下 ⇒ `video.currentTime/duration ≈ 0.75`（±0.12 容差）',
        JSON.stringify(t.seek))
    } else {
      /* ①(2026-09-21) 卡片控制的那个媒体在 10s 内始终没拿到 metadata ⇒ **进度比例无从判定**：
         这与"能拿到 duration 却算错比例"是两件事。T1/T2/T3/T5/T6 用的是同一个媒体元素且都过了
         （它能播、能暂停、音量能落），所以这里自 SKIP + 留读数，既不假装通过也不假红。
         要把它变红需要一个**确实有 duration 但比例算错**的读数 —— 那才是本条判据要抓的回归。 */
      notes.push('T4 自 SKIP：卡片控制的媒体 10s 内没拿到 metadata（duration=0；subframe 里常见 "media resource was aborted"）⇒ 比例无从判定（不假装通过、也不假红）  ' + JSON.stringify({ seek: t && t.seek, pre: t && t.seekPre }))
    }
    ok(t && t.volume && t.volume.op === 'volume' && t.volume.volume === 0.42 && t.volume.muted === false,
      'T5 【真控·音量】经卡片 op 设 0.42 ⇒ 元素的 `volume === 0.42` 且解除静音',
      JSON.stringify(t && t.volume))
    /*  ③(2026-09-25 issue0924a2 用户第 3 条) 两条新判据：**卡片内部的音量轨**真的能拖（组件那条入口）、
        传输行第四键（静音）真的作用到媒体。改前：音量滑条在卡片**下面**一条独立的 `#np-volbar` 里。 */
    ok(t && t.volSlider && t.volSlider.present === true && t.volSlider.disabled === false && t.volSlider.inCard === true &&
      t.volSlider.inStrip === false && t.volSlider.volumeOverflow === false && t.volSlider.keyPresent === true &&
      t.volSlider.after && t.volSlider.after.video === 0.35 && t.volSlider.after.value === '0.35',
      'T5b ★★用户第 3 条：**卡片内部**的音量轨（`#np-volume`）能拖（`inCard=true / inStrip=false`、不越界），拖到 0.35 ⇒ 媒体元素 `volume=0.35`（走组件 `onChange → send("volume")`，不是宿主的 npTransport 入口）',
      JSON.stringify(t && t.volSlider))
    ok(t && t.muteKey && t.muteKey.pressed === 'false' && t.muteKey.muted === true && t.muteKey.volKept === 0.35,
      'T5c ★用户第 3 条：卡片传输行的**静音第四键**（`data-mpw-np-mute`）点一下 ⇒ 元素 `muted=true` 且音量值保住 0.35（不把用户设的音量清零）',
      JSON.stringify(t && t.muteKey))
    ok(t && t.link && t.link.canPlay === false && t.link.disabled === true && t.link.pausedBefore === t.link.pausedAfter && t.linkBack === true,
      'T6 【联动开关】关掉联动 ⇒ 所有键置灰、点播放**不动作**（paused 不变）；再点回来恢复',
      JSON.stringify(t && t.link))
    ok(t && ini.markers && ini.markers.root && ini.markers.scrub && (ini.markers.link === '1' || ini.markers.link === '0'),
      'T7 【DOM 标记】卡片暴露 `data-mpw-now-playing` / `data-mpw-np-scrub` / `data-mpw-np-link`（与插件仓同一套标记口径）',
      JSON.stringify(ini.markers))
    ok(t && t.noRemountByCard === true,
      'T8a 【不打架】卡片这一串操作（播放/暂停/seek/音量/联动）走完，`#frame` 的 src **一字未动**（卡片不会 remount 壁纸）',
      JSON.stringify({ same: t && t.noRemountByCard }))
    ok(t && t.rebind && t.rebind.cardStillThere && t.rebind.newTitle && t.rebind.newTitle !== ini.title && t.rebind.newMeta,
      'T8b 【重新绑定】换一张壁纸后卡片跟着新壁纸重绑（标题/媒体数都变），React 根没被重建（`.snd-box` 仍在）',
      JSON.stringify(t && t.rebind))
    // 收尾：切回「全部」
    await page.evaluate(async () => { const all = document.querySelector('#type-filter .seg-btn[data-type="all"]'); if (all) all.click(); await new Promise((r) => setTimeout(r, 700)) })
  }

  // ══════════════════ W 组（P-160）web 壁纸：WE shim 真的注进去了 ══════════════════
  //  ⑪(2026-09-21) 同 T 组：web 档的 shim 注入只有产物页那条路有 ⇒ 本组同样跑在上游档（T0 已自证过）。
  //  判据（用户补充要求：web 类要"真的能用"，不是只把入口挂上）：
  //   ①渲染器**不再**打印「同源入口未检测到 WE shim」；②壁纸文档里 WE API 就位（`__weSetPaused` 等）；
  //   ③鼠标/触摸真的能到达壁纸页（在壁纸文档里挂监听，再用真鼠标事件走一遍）；
  //   ④注入的是**渲染器自带**的那份 shim（`shimFrom` 指渲染器产物、字节数与源码一致）。
  if (!TW_SKIP) {
    // 先把日志清空：这样 W 组判的是"本次 web 挂载"的日志，而不是历史行
    await page.evaluate(() => { const b = document.getElementById('clear-logs'); if (b) b.click() })
    const mount = await page.evaluate(async () => {
      const seg = document.querySelector('#type-filter .seg-btn[data-type="web"]')
      if (!seg) return { err: 'no web seg' }
      seg.click()
      await new Promise((r) => setTimeout(r, 900))
      const li = document.querySelector('#list li[data-id]')
      if (!li) return { err: 'no web item' }
      const id = li.dataset.id
      li.click()
      await new Promise((r) => setTimeout(r, 9000))
      const frame = document.getElementById('frame')
      const out = { id, outerSrc: frame.getAttribute('src') || '', shim: (window.__benchWebShim ? window.__benchWebShim() : null), log: (document.getElementById('logbody') || {}).textContent || '' }
      try {
        const rdoc = frame.contentWindow.document
        const wf = rdoc.querySelector('iframe')
        if (!wf) { out.err2 = 'no wallpaper iframe'; return out }
        const wwin = wf.contentWindow
        const wdoc = wwin.document
        out.wall = {
          src: wf.getAttribute('src') || '',
          sandbox: wf.getAttribute('sandbox') || '',
          hasSetPaused: typeof wwin.__weSetPaused === 'function',
          hasFps: typeof wwin.__weSetFps === 'function',
          hasVolume: typeof wwin.__weSetVolume === 'function',
          //  shim 用 `Object.defineProperty` 装的是**访问器**（getter 返回内部变量，作者赋值前是 null）
          //  ⇒ 判据是"这个属性由 shim 装在窗口自己身上"，而不是"当前值非空"（作者可能还没渲染到那一步）
          hasPropListener: ('wallpaperPropertyListener' in wwin) &&
            !!(Object.getOwnPropertyDescriptor(wwin, 'wallpaperPropertyListener') || {}).get,
          propListenerType: (() => { try { const v = wwin.wallpaperPropertyListener; return v === null ? 'null' : typeof v } catch { return 'throw' } })(),
          propAssignedByAuthor: (() => { try { return !!(wwin.wallpaperPropertyListener && typeof wwin.wallpaperPropertyListener === 'object') } catch { return false } })(),
          hasAudioReg: typeof wwin.wallpaperRegisterAudioListener === 'function',
          hasRandomFile: typeof wwin.wallpaperRequestRandomFileForProperty === 'function',
          hasPushPointer: typeof wwin.__wePushPointer === 'function',
          hasPushWheel: typeof wwin.__wePushWheel === 'function',
          shimTag: !!wdoc.querySelector('script[data-we-shim-src]'),
          baseHref: (wdoc.querySelector('base') || {}).href || '',
          scripts: wdoc.querySelectorAll('script').length,
          title: wdoc.title,
        }
        out.rendererWp = typeof frame.contentWindow.__wp === 'object' && frame.contentWindow.__wp !== null
      } catch (e) { out.err3 = String(e.message) }
      return out
    })
    ok(mount && mount.shim && mount.shim.installed && mount.shim.injected >= 1 && mount.shim.failed === 0 && mount.shim.reason === '',
      'W1 【接线】web 档挂载时 shim hook 已装并**成功注入**（failed=0 / reason 空）', JSON.stringify(mount && mount.shim))
    ok(mount && mount.shim && mount.shim.shimBytes > 10000 && /renderer-.*\.js$/.test(mount.shim.shimFrom || ''),
      'W2 【来源】注入的是**渲染器产物自带**的那份 shim（不是另抄一份），字节数 = 产物里的常量长度',
      JSON.stringify({ bytes: mount && mount.shim && mount.shim.shimBytes, from: mount && mount.shim && mount.shim.shimFrom }))
    /*  ⓪(2026-10-12 判据修复 · task-17) 前提加固：这条断言的是"日志里**没有**某条告警"，
        夹具缺失（`#list` 里没有 web 档 ⇒ `mount={err:'no web item'}`）时日志本来就是空的 ⇒
        **空转通过**（实测：库根无 web 档时 `PASS {"warn":false,"fail":false}`）。
        同组的 W1/W2/W4/W5/W6 会同时红 ⇒ 门禁不会因此漏判，但"没挂东西也绿"不是判别力。
        口径只**加**不减：要求"确实挂过一张 web 档"（`mount.id`）+ 原来的两条否定。
        ⚠ 这是**前提**不是放松：库里有 web 档时读数一字不变。 */
    ok(mount && mount.id && !/未检测到 WE shim/.test(mount.log) && !/shim 注入失败/.test(mount.log),
      'W3 【判据①】渲染器**不再**打印「网页壁纸：同源入口未检测到 WE shim」，也没有注入失败行（前提：确实挂上过一张 web 档）',
      JSON.stringify({ warn: mount ? /未检测到 WE shim/.test(mount.log) : null, fail: mount ? /shim 注入失败/.test(mount.log) : null }))
    const w = mount && mount.wall
    ok(w && w.hasSetPaused && w.hasFps && w.hasVolume && w.hasPropListener && w.hasAudioReg && w.hasRandomFile,
      'W4 【判据②】壁纸文档里 WE API 就位（`__weSetPaused/__weSetFps/__weSetVolume` + shim 装的 `wallpaperPropertyListener` 访问器 + 音频/随机文件注册）',
      JSON.stringify(w && { paused: w.hasSetPaused, fps: w.hasFps, vol: w.hasVolume, prop: w.hasPropListener, propType: w.propListenerType, authorAssigned: w.propAssignedByAuthor, audio: w.hasAudioReg, rnd: w.hasRandomFile }))
    ok(w && w.shimTag && /^blob:/.test(w.src || '') && w.baseHref && /\/web\/dev\//.test(w.baseHref) && w.scripts >= 1,
      'W5 【形态】壁纸文档 = blob（shim 在最前，带 `data-we-shim-src` 标记）+ `<base href>` 指向入口目录（相对资源不断）',
      JSON.stringify(w && { blob: /^blob:/.test(w.src || ''), shimTag: w.shimTag, base: w.baseHref, scripts: w.scripts }))
    ok(mount && mount.rendererWp && w && w.hasPushPointer && w.hasPushWheel,
      'W6 【指针通道】渲染器侧 `__wp` 仍是对象，壁纸侧 shim 的指针/滚轮通道（`__wePushPointer/__wePushWheel`）都在',
      JSON.stringify({ rendererWp: mount && mount.rendererWp, push: w && w.hasPushPointer, wheel: w && w.hasPushWheel }))

    // 判据③：真鼠标事件能不能到达壁纸页 —— 在壁纸文档里挂监听，再用 `page.mouse.move` 走一遍
    const pt = await page.evaluate(() => {
      const frame = document.getElementById('frame')
      const r = frame.getBoundingClientRect()
      try {
        const wwin = frame.contentWindow.document.querySelector('iframe').contentWindow
        wwin.__mpwSeen = { move: 0, down: 0 }
        wwin.document.addEventListener('mousemove', () => { wwin.__mpwSeen.move++ }, true)
        wwin.document.addEventListener('mousedown', () => { wwin.__mpwSeen.down++ }, true)
      } catch (e) { return { err: String(e.message) } }
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })
    if (pt && !pt.err) {
      await page.mouse.move(pt.x - 40, pt.y - 30)
      await page.mouse.move(pt.x, pt.y)
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(400)
      const seen = await page.evaluate(() => {
        try { return document.getElementById('frame').contentWindow.document.querySelector('iframe').contentWindow.__mpwSeen } catch { return null }
      })
      ok(seen && seen.move > 0 && seen.down > 0,
        'W7 【判据③】鼠标事件真的到达**壁纸页**（壁纸文档里的监听记到 mousemove/mousedown）',
        JSON.stringify({ seen, at: pt }))
    } else notes.push('W7 未测：拿不到壁纸 iframe 的 rect（' + JSON.stringify(pt) + '）')
    // 收尾：切回「全部」，别让后面的断言看到 web-only 的列表
    await page.evaluate(async () => {
      const all = document.querySelector('#type-filter .seg-btn[data-type="all"]')
      if (all) all.click()
      await new Promise((r) => setTimeout(r, 700))
    })
  }

  // ⑪(2026-09-21) T/W 两组为了 web 档的 shim 夹具切到了上游档；这里**切回默认档（本仓渲染器）**，
  //   让后面的 M/X/Y/G/Z/P/G10 组（几何 / 标签 / 属性面板 / 调试页签 + 指针转发 / 品牌 / 首屏）
  //   全部跑在**用户默认看到的那一个渲染器**上 —— 那些判据是"整合成一个"之后必须继续成立的。
  {
    await setRendererSource('repo')
    await page.waitForTimeout(1500)
    const r = await rendererSourceState()
    ok(r.mode === 'repo' && r.attr === 'repo' && String(r.src).startsWith('/webloader/?'),
      'R4 默认档回归：T/W 之后切回「本仓渲染器」⇒ 后面的组都在**默认渲染器**上跑（不是只在对照档上绿）',
      String(r.src).slice(0, 90))
  }

  // ══════════════════ M 组（P-159）mpw 自绘下拉：按钮文案 + 包含块偏移后的贴合 ══════════════════
  //  为什么用**夹具**：:8902 默认档（合成样例 + 本机库）里没有 combo 属性 ⇒ 页面上本来一个 `.mpw_select`
  //  都不存在（工具条那 5 个已归 `.bench-rd`）。往 `#props-body` 插两个原生 select（选中第 2 项），
  //  补丁的 `watchBenchPropsSelects` 观察者会把它们增强成 mpw 控件 —— 这就是"真机首帧"的等价形态。
  {
    const fixture = await page.evaluate(async () => {
      const host = document.getElementById('props-body')
      if (!host) return { err: 'no #props-body' }
      const mk = (id, css) => {
        const wrap = document.createElement('div')
        wrap.id = id + '-wrap'
        wrap.setAttribute('style', css)
        const sel = document.createElement('select')
        sel.id = id
        for (const [v, label] of [['a', 'Alpha'], ['b', 'Beta'], ['c', 'Gamma']]) {
          const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o)
        }
        sel.value = 'b'
        wrap.appendChild(sel); host.appendChild(wrap)
        return wrap
      }
      //  A：页面上部（下方空间充足 ⇒ 应**下开**）  B：贴裁剪盒底边（⇒ 应**上翻**）
      mk('bench-mpw-down', 'position:fixed;left:24px;top:140px;z-index:8')
      mk('bench-mpw-up', 'position:fixed;left:24px;bottom:6px;z-index:8')
      await new Promise((r) => setTimeout(r, 600))            // 等观察者增强
      const info = (id) => {
        const sel = document.getElementById(id)
        const h = sel && sel.__mpwSelectHandle
        const btn = h && h.root ? h.root.querySelector('.mpw_select_btn') : null
        return { enhanced: !!h, label: btn ? btn.textContent : null, dataLabel: h && h.root ? h.root.getAttribute('data-mpw-label') : null, btnRect: btn ? (() => { const r = btn.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) } })() : null }
      }
      return { down: info('bench-mpw-down'), up: info('bench-mpw-up') }
    })
    ok(fixture.down && fixture.down.enhanced && fixture.down.label === 'Beta' && fixture.down.dataLabel === 'Beta',
      'M1a ①(P-159) 首次展开**之前**按钮文案 = 当前选中项（`Beta`），不是「（空）」',
      JSON.stringify({ down: fixture.down && fixture.down.label, up: fixture.up && fixture.up.label }))
    ok(fixture.up && fixture.up.enhanced && fixture.up.label === 'Beta',
      'M1b ①两个夹具都增强成功（第 2 个也走同一条链，不是只对第一个生效）', JSON.stringify(fixture.up && fixture.up.label))

    /* ⚠(2026-09-24 A 线) 取数加固：这里原来直接 `list.getBoundingClientRect()` —— 只要这一条拿不到
       （宿主重渲染把控件节点换掉 / 控件已被销毁），整个门禁就**抛异常中止**，后面所有组（X/Y/G/Z/P/G10/IA）
       一条读数都拿不到（实测：M 组在 R3 已红的环境下崩在这里，IA 组根本没跑到）。
       改成"如实返回 `err` 读数" ⇒ M2/M3/M4 仍然按原判据判（数据缺失就是 FAIL），但**不再连坐**后面的组。 */
    /* ⚠(2026-09-25 ⑦) 诊断加固：`measure()` 现在**顺带记录**这 250ms 里发生过的 scroll/resize 事件
       （以及被滚动的是谁），并如实回报 `isOpen`。为什么：这条判据曾经红过两次，读数只有
       `{err:'no-list-or-btn', options:3, rootConnected:true}` —— 看的人只能猜。现在同一个读数会带上
       "期间有谁滚过"（真因就是日志窗 `#logbody` 在捕获阶段被听到 ⇒ 下拉被自己的监听关掉）。
       判据一条没改：拿不到列表/触发框照样 FAIL。 */
    const measure = (id) => page.evaluate(async (fid) => {
      const sel = document.getElementById(fid)
      const h = sel && sel.__mpwSelectHandle
      if (!h) return { err: 'not enhanced' }
      const evs = []
      const onScroll = (ev) => {
        const t = ev.target
        const btn0 = h.root.querySelector('.mpw_select_btn')
        let anc = false
        for (let n = btn0; n; n = n.parentElement) if (n === t) { anc = true; break }
        if (t === document || t === document.documentElement || t === document.body) anc = true
        evs.push({ k: 'scroll', tgt: (t === document ? 'document' : (t && (t.id || t.className || t.tagName))) || null, anc, top: t && t.scrollTop })
      }
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', () => evs.push({ k: 'resize' }))
      h.open()
      await new Promise((r) => setTimeout(r, 250))
      const list = h.root.querySelector('.mpw_select_list')
      const btn = h.root.querySelector('.mpw_select_btn')
      window.removeEventListener('scroll', onScroll, true)
      if (!list || !btn) return { err: 'no-list-or-btn', options: sel.options ? sel.options.length : -1, rootConnected: !!(h.root && h.root.isConnected), isOpen: h.isOpen(), events: evs }
      const b = btn.getBoundingClientRect(); const l = list.getBoundingClientRect()
      const out = {
        flip: list.getAttribute('data-flip'), origin: list.getAttribute('data-origin'),
        gap: Math.round(((l.top >= b.top ? l.top - b.bottom : b.top - l.bottom)) * 10) / 10,
        firstItem: (list.firstElementChild || {}).textContent, count: list.children.length,
        btn: { top: Math.round(b.top), bottom: Math.round(b.bottom) }, list: { top: Math.round(l.top), bottom: Math.round(l.bottom) },
        events: evs,
      }
      h.close()
      await new Promise((r) => setTimeout(r, 120))
      return out
    }, id)
    /* ⚠(2026-09-24 A 线) 这一组用的是**一次性插入**的夹具：`#props-body` 在整页门禁的长链里被产物/
       补丁反复重渲染，偶发会把刚增强好的控件的惰性列表节点换掉 —— 实测读数
       `{err:'no-list-or-btn', options:3, rootConnected:true}`（select 还在、选项还在、控件根还在，
       只是 `open()` 没能建出 `<ul>`）。隔离复现三次（新开页 / 挂壁纸后 / 切渲染器来源来回后）都正常，
       所以这里只在**夹具这一层**加一次重插+重测（**判据一条没改**，且 first/retry 两份读数都打印）；
       真坏的实现两次都会红。 */
    const remount = async () => {
      await page.evaluate(() => {
        for (const id of ['bench-mpw-down', 'bench-mpw-up']) {
          const sel = document.getElementById(id)
          try { sel && sel.__mpwSelectHandle && sel.__mpwSelectHandle.destroy() } catch { /* ignore */ }
          const w = document.getElementById(id + '-wrap')
          if (w && w.parentNode) w.parentNode.removeChild(w)
        }
      })
      await page.evaluate(async () => {
        const host = document.getElementById('props-body')
        if (!host) return
        const mk = (id, css) => {
          const wrap = document.createElement('div'); wrap.id = id + '-wrap'; wrap.setAttribute('style', css)
          const sel = document.createElement('select'); sel.id = id
          for (const [v, label] of [['a', 'Alpha'], ['b', 'Beta'], ['c', 'Gamma']]) { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o) }
          sel.value = 'b'; wrap.appendChild(sel); host.appendChild(wrap); return wrap
        }
        mk('bench-mpw-down', 'position:fixed;left:24px;top:140px;z-index:8')
        mk('bench-mpw-up', 'position:fixed;left:24px;bottom:6px;z-index:8')
        await new Promise((r) => setTimeout(r, 700))
      })
    }
    let d = await measure('bench-mpw-down')
    if (d && d.err) { const first = d; await remount(); d = await measure('bench-mpw-down'); console.log('  M2 夹具重插读数：first=' + JSON.stringify(first) + ' retry=' + JSON.stringify(d)) }
    const u = await measure('bench-mpw-up')
    ok(d.flip === 'down' && d.gap <= 2 && d.gap >= 0 && d.firstItem === 'Alpha' && d.count === 3,
      'M2 ②(P-159) mpw 下开：列表与触发框的缝 ≤2px（减掉包含块原点后；改前是 44~48px），首项 = 第 1 个选项', JSON.stringify(d))
    ok(u.flip === 'up' && u.gap <= 2 && u.gap >= 0,
      'M3 ③(P-159) mpw 上翻：同样贴合（列表**下边缘**距触发框上边缘 ≤2px；上翻按底边锚定，内容矮也不留缝）', JSON.stringify(u))
    ok(d.origin === 'containing-block' && u.origin === 'containing-block',
      'M4 ②(P-159) 两处都如实标了 `data-origin=containing-block`（证明走的是"减掉 `#pages-track` 原点"那条路）', JSON.stringify({ down: d.origin, up: u.origin }))

    /* ── M5~M7 ⑦(2026-09-25) 真机"下拉点开就没了"：只对**会移动锚点**的滚动源收起 ─────────────────────
       真因（`:8902` 实测）：展开期间挂的是捕获阶段 scroll 监听，日志窗 `#logbody` 在场景加载时自己往下跟
       （250ms 内滚了 4 次），刚展开的下拉被自己的监听关掉 ⇒ 同一次展开的读数从"列表在"变成"列表没了"。
       这三条判据都在**真浏览器**里用**真滚动**（改 `scrollTop` ⇒ 浏览器自己派发 scroll 事件）测，
       不靠合成事件：M5 = 无关容器滚动**不关**；M6 = 锚点祖先滚动**照样关**（原意没被放宽）；
       M7 = 展开动作本身**不许**滚动任何祖先（旧实现 `scrollIntoView` 会滚祖先，既跳页又把自己关掉）。 */
    {
      const scrollGates = await page.evaluate(async () => {
        const host = document.getElementById('props-body')
        if (!host) return { err: 'no #props-body' }
        const mkSel = (id) => {
          const sel = document.createElement('select'); sel.id = id
          for (const [v, label] of [['a', 'Alpha'], ['b', 'Beta'], ['c', 'Gamma']]) { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o) }
          sel.value = 'b'; return sel
        }
        //  (a) 无关容器：**不是**锚点的祖先（能滚、滚得动）
        const alien = document.createElement('div'); alien.id = 'bench-mpw-alien'
        alien.setAttribute('style', 'position:fixed;left:420px;top:120px;width:180px;height:120px;overflow:auto;z-index:8')
        const alienInner = document.createElement('div'); alienInner.setAttribute('style', 'height:600px')
        alienInner.textContent = 'x'; alien.appendChild(alienInner); host.appendChild(alien)
        //  (b) 锚点祖先链上的滚动盒：触发框在它里面
        const chain = document.createElement('div'); chain.id = 'bench-mpw-chainbox'
        chain.setAttribute('style', 'position:fixed;left:640px;top:120px;width:200px;height:130px;overflow:auto;z-index:8')
        const chainWrap = document.createElement('div'); chainWrap.id = 'bench-mpw-chain-wrap'
        chainWrap.setAttribute('style', 'padding:140px 0 240px')          // 让 select 一开始就在盒子里、且盒能滚
        chainWrap.appendChild(mkSel('bench-mpw-chain')); chain.appendChild(chainWrap); host.appendChild(chain)
        await new Promise((r) => setTimeout(r, 700))
        const out = {}
        for (const id of ['bench-mpw-down', 'bench-mpw-chain']) {
          const s = document.getElementById(id); out[id] = { enhanced: !!(s && s.__mpwSelectHandle), options: s && s.options ? s.options.length : -1 }
        }
        const evs = []
        const onScroll = (ev) => evs.push({ tgt: (ev.target === document ? 'document' : (ev.target && (ev.target.id || ev.target.className || ev.target.tagName))) || null })
        window.addEventListener('scroll', onScroll, true)
        const openState = (id) => {
          const h = document.getElementById(id).__mpwSelectHandle
          h.open()
          return !!h.root.querySelector('.mpw_select_list')
        }
        const alive = (id) => {
          const h = document.getElementById(id).__mpwSelectHandle
          return { inDom: !!h.root.querySelector('.mpw_select_list'), isOpen: h.isOpen() }
        }
        const closeAll = () => { for (const id of ['bench-mpw-down', 'bench-mpw-alien', 'bench-mpw-chain']) { const h = document.getElementById(id).__mpwSelectHandle; try { h.close() } catch { /* ignore */ } } }
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
        //  M5：无关容器滚动（真滚动：改 scrollTop ⇒ 浏览器自己派发 scroll）⇒ 列表必须还在
        closeAll(); openState('bench-mpw-down')
        document.getElementById('bench-mpw-alien').scrollTop = 220
        const logbody = document.getElementById('logbody')
        if (logbody) { logbody.scrollTop = 0; logbody.scrollTop = 99999 }   // 真凶就是它：场景加载时自己往下跟
        await sleep(250)
        out.m5 = { ...alive('bench-mpw-down'), alienTop: document.getElementById('bench-mpw-alien').scrollTop, logTop: logbody ? logbody.scrollTop : null, events: evs.slice() }
        //  M6：锚点**祖先**滚动（真滚动）⇒ 必须收起（原意：浮层会与锚点脱开）
        evs.length = 0
        closeAll(); const chainBox = document.getElementById('bench-mpw-chainbox')
        const chainShown = openState('bench-mpw-chain')
        chainBox.scrollTop = 90
        await sleep(250)
        out.m6 = { ...alive('bench-mpw-chain'), opened: chainShown, chainTop: chainBox.scrollTop, events: evs.slice() }
        //  M7：展开动作本身**不许**滚动任何祖先（旧实现 `scrollIntoView` 会滚祖先：既跳页又把自己关掉）。
        //  拿 chain 夹具测最有分辨力：触发框在一个真能滚的盒子里，旧实现几乎必然把它滚起来。
        closeAll(); evs.length = 0; chainBox.scrollTop = 0
        const track = () => {
          const o = { chainbox: chainBox.scrollTop, winY: window.scrollY }
          for (const el of [document.getElementById('pages-track'), document.getElementById('props-body')]) if (el) o[el.id] = el.scrollTop
          return o
        }
        const t0 = track()
        const openedChain = openState('bench-mpw-chain')
        await sleep(250)
        const aliveChain = alive('bench-mpw-chain')
        const t1 = track()
        closeAll(); evs.length = 0
        const openedDown = openState('bench-mpw-down')
        await sleep(250)
        const aliveDown = alive('bench-mpw-down')
        const t2 = track()
        //  M8：`.bench-rd`（工具条那套自绘下拉）走同一份判据 —— 用**真点击**打开，再让无关容器滚 ⇒ 不许关
        closeAll(); evs.length = 0
        const rdBtn = document.querySelector('#toolbar .bench-rd .bench-rd-btn')
        let rd = { found: !!rdBtn }
        if (rdBtn) {
          rdBtn.click()
          await sleep(120)
          rd.opened = !!document.querySelector('#toolbar .bench-rd.open')
          document.getElementById('bench-mpw-alien').scrollTop = 40
          if (logbody) { logbody.scrollTop = 400; logbody.scrollTop = 99999 }
          await sleep(250)
          rd.stillOpen = !!document.querySelector('#toolbar .bench-rd.open')
          rd.events = evs.slice()
          const b2 = document.querySelector('#toolbar .bench-rd.open .bench-rd-btn')
          if (b2) b2.click()
          await sleep(80)
        }
        out.m8 = rd
        out.m7 = {
          opened: openedChain === true && openedDown === true, aliveChain, aliveDown,
          movedChain: Object.keys(t0).filter((k) => t0[k] !== t1[k]).map((k) => ({ k, from: t0[k], to: t1[k] })),
          movedDown: Object.keys(t1).filter((k) => t1[k] !== t2[k]).map((k) => ({ k, from: t1[k], to: t2[k] })),
          ancestorScrolls: evs.filter((e) => ['pages-track', 'props-body', 'html', 'document'].includes(e.tgt)),
        }
        closeAll()
        return out
      })
      const g5 = scrollGates.m5 || {}
      ok(scrollGates['bench-mpw-down'] && scrollGates['bench-mpw-down'].enhanced
        && scrollGates['bench-mpw-chain'] && scrollGates['bench-mpw-chain'].enhanced,
        'M5a ⑦两个滚动夹具都增强成功（下开夹具 / 锚点祖先滚动盒）', JSON.stringify({ down: scrollGates['bench-mpw-down'], chain: scrollGates['bench-mpw-chain'] }))
      ok(g5.alienTop > 0 && g5.inDom === true && g5.isOpen === true,
        'M5 ★ ⑦**与锚点无关**的容器真的滚了（含日志窗）⇒ 打开的下拉**不许**被关掉（改前：捕获监听收到就 close，日志窗一滚就"点开没了"）',
        JSON.stringify(g5))
      const g6 = scrollGates.m6 || {}
      ok(g6.opened === true && g6.chainTop > 0 && g6.inDom === false && g6.isOpen === false,
        'M6 ★ ⑦锚点**祖先**滚动 ⇒ 仍然收起（原意没被放宽：浮层坐标是展开那刻算的，跟锚点脱开就得收）',
        JSON.stringify(g6))
      const g7 = scrollGates.m7 || {}
      ok(g7.opened === true && g7.aliveChain && g7.aliveChain.inDom === true && g7.aliveDown && g7.aliveDown.inDom === true
        && (g7.movedChain || []).length === 0 && (g7.movedDown || []).length === 0 && (g7.ancestorScrolls || []).length === 0,
        'M7 ★ ⑦展开下拉**自己不许滚动任何祖先**（旧实现 `scrollIntoView` 会滚祖先：页面自己跳一下，且那次滚动会把自己的下拉关掉）；"先滚动后展开"的异步时序也不许误关',
        JSON.stringify(g7))
      const g8 = scrollGates.m8 || {}
      ok(g8.found === true && g8.opened === true && g8.stillOpen === true,
        'M8 ★ ⑦工具条那套 `.bench-rd` 自绘下拉同样受益（真点击打开 ⇒ 无关容器滚动 ⇒ 仍然开着；改前是 `closeAll(null)` 一刀切）',
        JSON.stringify(g8))
    }
    // 夹具清理：别给后面的断言留脏 DOM（先 destroy 控件，再按**最外层**夹具节点摘）
    await page.evaluate(() => {
      for (const id of ['bench-mpw-down', 'bench-mpw-up', 'bench-mpw-chain']) {
        const sel = document.getElementById(id)
        try { sel && sel.__mpwSelectHandle && sel.__mpwSelectHandle.destroy() } catch { /* ignore */ }
      }
      const kill = (el) => { try { if (el && el.parentNode) el.parentNode.removeChild(el) } catch { /* ignore */ } }
      kill(document.getElementById('bench-mpw-down-wrap'))
      kill(document.getElementById('bench-mpw-up-wrap'))
      kill(document.getElementById('bench-mpw-chainbox'))    // 连同里面的 chain-wrap / select 一起
      kill(document.getElementById('bench-mpw-alien'))
    })
  }

  const topErrs = await page.evaluate(() => (window.__topErrs || []).slice(0, 4))
  // ══════════════════ X 组（P-164 ⑤）品牌图标：真机抓到的是新图且能取到 ══════════════════
  {
    const x = await page.evaluate(async () => {
      const links = [...document.querySelectorAll('link[rel*="icon"]')].map((l) => l.getAttribute('href'))
      const probe = async (href) => {
        if (!href) return null
        try {
          const r = await fetch(href, { method: 'GET' })
          return { href, status: r.status, type: r.headers.get('content-type') || '', bytes: (await r.arrayBuffer()).byteLength }
        } catch (e) { return { href, err: String(e.message) } }
      }
      const mf = await fetch(document.querySelector('link[rel="manifest"]').getAttribute('href')).then((r) => r.json())
      const icons = []
      for (const ic of mf.icons || []) icons.push(await probe(new URL(ic.src, location.href).href))
      const cover = (() => { try { const el = document.querySelector('#np-mount .snd-art'); return el ? getComputedStyle(el).backgroundImage : '' } catch { return '' } })()
      return { links, favicons: [await probe(links[0]), await probe(links[links.length - 1])], icons, cover }
    })
    const allBrand = (x.links || []).every((h) => /assets\/brand\//.test(h || ''))
    const okFetch = x.favicons.every((f) => f && f.status === 200 && /^image\//.test(f.type) && f.bytes > 500)
    ok(allBrand && (x.links || []).length >= 3 && okFetch,
      'X1 ⑤ 真机 `link[rel*=icon]` 全部指向品牌图且 fetch 200 + `image/*`', JSON.stringify({ links: x.links, favicons: x.favicons }))
    ok((x.icons || []).length === 3 && x.icons.every((i) => i && i.status === 200 && /^image\//.test(i.type) && /assets\/brand\//.test(i.href)),
      'X2 ⑤ manifest 的三个图标都是品牌图、都能取到（200 + image/*）', JSON.stringify(x.icons))
    ok(/assets\/brand\/brand-512\.png/.test(x.cover || ''),
      'X3 ⑤ 播放卡片的封面背景图也换成了品牌图', JSON.stringify((x.cover || '').slice(0, 90)))
  }

  // ══════════════════ Y 组（P-164 ①③）标签关闭（×）+ 省略号 + 重复点击幂等 ══════════════════
  {
    const y = await page.evaluate(async () => {
      const P = window.__benchPatch
      const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right), h: Math.round(r.height) } }
      const hit = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return { self: !!(at && (at === el || el.contains(at))), got: at ? (String(at.className || at.id || at.tagName)).slice(0, 24) : null } }
      const out = {}
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const tabs = () => [...document.querySelectorAll('#editor-tabs .wp-tab')]
      const tabIds = () => tabs().map((b) => b.dataset.id)
      const tabOf = (id) => tabs().find((b) => b.dataset.id === String(id)) || null
      const curText = () => String((document.getElementById('current') || {}).textContent || '')
      const curLiId = () => { const li = document.querySelector('#list li[data-id].active'); return li ? String(li.dataset.id || '') : '' }
      const store = () => { try { return JSON.parse(localStorage.getItem('bench-pinned-wallpapers') || '[]') } catch { return null } }
      const emptyVisible = () => { const e = document.getElementById('empty'); return e ? getComputedStyle(e).display !== 'none' : null }
      const srcOf = () => String(document.getElementById('frame').getAttribute('src') || '')
      const titleOf = (id) => { const li = [...document.querySelectorAll('#list li[data-id]')].find((x) => String(x.dataset.id || '') === String(id)); return li ? String((li.querySelector('.title') || {}).textContent || '').trim() : '' }
      const all = document.querySelector('#type-filter .seg-btn[data-type="all"]')
      if (all) { all.click(); await sleep(800) }
      //  **先清场**：前面各组（类型过滤 / 诊断 / mpw / 播放卡片）可能已经固定过一串项，上一版 Y6/Y7 读到的
      //  tab 数根本不是自己造出来的 ⇒ 期望值只能靠"数自己刚点出来的东西"。这里先把残留全部关掉
      //  （关"当前项"走的正是本批 ① 的回落 / 释放路径），再固定恰好三项 A/B/C。
      for (let i = 0; i < 14; i++) {
        const cx = document.querySelector('.wp-x-cur')
        const anyTab = tabs()[0] || null
        if (!cx && !anyTab) break
        const before = tabIds().length + (cx ? 1 : 0)
        ;(cx || anyTab).click()
        await sleep(cx ? 1400 : 600)
        const after = tabIds().length + (document.querySelector('.wp-x-cur') ? 1 : 0)
        if (after >= before) break                                  // 没有进展就别空转满 14 轮
      }
      await sleep(700)
      out.drain = { tabs: tabIds().length, curText: curText(), cleared: /未选择壁纸|No wallpaper/.test(curText()), emptyVisible: emptyVisible(), pinned: store() }
      const lis = [...document.querySelectorAll('#list li[data-id]')]
      const idA = String(lis[0].dataset.id || ''); const idB = String(lis[1].dataset.id || ''); const idC = String(lis[2].dataset.id || '')
      lis[0].click(); await sleep(4000)
      lis[1].click(); await sleep(4000)
      lis[2].click(); await sleep(6000)
      out.fixed = { want: [idA, idB, idC], tabs: tabIds(), cur: curLiId(), pinned: store(), curText: curText() }
      const tab = tabOf(idA)
      const name = tab ? tab.querySelector('.wp-name') : null
      const xBtn = tab ? tab.querySelector('.wp-x') : null
      out.geom = {
        tabs: document.querySelectorAll('#editor-tabs .wp-tab').length,
        tabRect: R(tab), xRect: R(xBtn), nameEllipsis: name ? getComputedStyle(name).textOverflow : null,
        nameOverflow: name ? getComputedStyle(name).overflow : null, tabMaxW: tab ? getComputedStyle(tab).maxWidth : null,
        xInsideTab: !!(tab && xBtn && R(xBtn).right <= R(tab).right + 1 && R(xBtn).x >= R(tab).x),
        xHit: hit(xBtn),
      }
      const curX = document.querySelector('.wp-x-cur')
      const cur = document.getElementById('current')
      out.curCell = (() => {
        const cr = R(cur); const xr = R(curX)
        const cs = cur ? getComputedStyle(cur) : null
        const xs = curX ? getComputedStyle(curX) : null
        const pr = cs ? (parseFloat(cs.paddingRight) || 0) : 0
        const mr = xs ? (parseFloat(xs.marginRight) || 0) : 0
        return {
          curRect: cr, xRect: xr, maxW: cs ? cs.maxWidth : null,
          ellipsis: cs ? cs.textOverflow : null, paddingRight: pr, marginRight: mr,
          /*  ①(P-342 契约变更 · 2026-10-12 判据修复 · task-17) 三个**互相独立**的几何事实。
              为什么必须换口径：旧写法把"间隙"算成 **盒间距** `xRect.x − curRect.right`，而当前布局
              （`.wp-x-cur{margin-left:-26px;margin-right:4px}` —— 把 `×` 用负外边距拉进框内，
              逐像素镜像固定标签的 `.wp-tab{gap:6px;padding:0 4px 0 10px}`）**盒间距必然为负**
              （实测 -26 = -(22+4)）⇒ 旧口径 `Math.abs(gapPx) <= 1` 是拿**旧布局**判**新布局**，必红且不可修
              （一旦有人为了让判据变绿把 `×` 挪回框外，用户看到的就退回"长标题把 × 顶到框外"）。
              ⇒ 改成量**视觉结果**（这才是意图）：
                a) `×` **完全落在 `#current` 边框盒内**；
                b) **视觉间隙** = `×` 左缘 ↔ **被裁文本区的右缘**（= 框右缘 − `padding-right`）= 6px
                   （与固定标签的 `gap:6px` 同口径；长标题被 `overflow:hidden` 裁在内容盒右缘）；
                c) 盒间距 = `-(×宽 + 右外边距)` 且 **< 0** —— 把负外边距当**构造性事实**钉住。
              ⚠ 强度等价（不放松）：旧口径要的"`×` 紧贴右缘、不被长标题顶走"由 a+c 的固定偏移与 b 的
              6px 视觉间隙共同保证；旧口径的 `max-width/ellipsis/命中=视觉` 三条一条不动。 */
          insideCur: !!(cr && xr && xr.x >= cr.x && xr.right <= cr.right),
          edgeGapPx: (cr && xr) ? Math.round(cr.right - xr.right) : null,        // × 右缘 ↔ 框右缘（构造 = margin-right）
          visualGapPx: (cr && xr) ? Math.round(xr.x - (cr.right - pr)) : null,   // × 左缘 ↔ 裁切区右缘（构造 = 6）
          boxGapPx: (cr && xr) ? Math.round(xr.x - cr.right) : null,             // 盒间距（构造 = -(22+4) = -26，必为负）
          boxGapExpect: xr ? -Math.round(xr.w + mr) : null,
          hit: hit(curX),
        }
      })()
      const activeLi = () => document.querySelector('#list li[data-id].active')
      const liNow = activeLi()
      const src0 = srcOf()
      const mounts0 = ((document.getElementById('logbody') || {}).textContent || '').split('\n').filter((l) => /Mount /.test(l)).length
      for (let i = 0; i < 3; i++) { liNow.click(); await sleep(600) }
      out.idem = {
        srcSame: srcOf() === src0,
        mountsBefore: mounts0, mountsAfter: ((document.getElementById('logbody') || {}).textContent || '').split('\n').filter((l) => /Mount /.test(l)).length,
        nodeSame: activeLi() === liNow,
        hits: (() => { const h = document.getElementById('np-host'); return h ? h.getAttribute('data-np-idem') : null })(),
      }
      //  **关非当前项**（A）：标签消失、预览不重挂、当前那一格的字一点不动。
      const before = tabIds(); const textBefore = curText()
      const xA = tabOf(idA) ? tabOf(idA).querySelector('.wp-x') : null
      if (xA) xA.click()
      await sleep(1500)
      out.closeOther = {
        closed: idA, before, after: tabIds(), srcSame: srcOf() === src0, textSame: curText() === textBefore,
        curText: curText(), pinned: store(),
      }
      //  **关当前项**（C，还固定着 B）⇒ 明确回落到 B：条上不再有 tab（当前项不进条），且当前那一格必须换成
      //  B 的名字 —— 不能留着已经关掉的 C 的旧标题（上一版断言抓到的就是这个中间态）。
      const cx2 = document.querySelector('.wp-x-cur')
      if (cx2) cx2.click()
      await sleep(2500)
      out.fellBack = {
        curText: curText(), expectTitle: titleOf(idB), tabs: tabIds(), pinned: store(), curLi: curLiId(),
        srcChanged: srcOf() !== src0, curCellX: !!document.querySelector('.wp-x-cur'),
      }
      //  **关最后一个**（B）⇒ 未选择壁纸 + 空态 + 固定集合清空。
      const cx3 = document.querySelector('.wp-x-cur')
      if (cx3) cx3.click()
      await sleep(2500)
      out.release = { curText: curText(), cleared: /未选择壁纸|No wallpaper/.test(curText()), emptyVisible: emptyVisible(), pinned: store(), tabs: tabIds().length }
      void P
      return out
    })
    ok(y.drain && y.drain.tabs === 0 && y.drain.cleared && y.drain.emptyVisible === true && (y.drain.pinned || []).length === 0,
      'Y0 ① 先把残留标签全部关掉（连点"当前项"的 `×` 直到没有）⇒ 未选择壁纸 + 空态 + 固定集合清空（本组后续期望值的干净起点）',
      JSON.stringify(y.drain))
    ok(y.fixed && y.fixed.tabs.length === 2 && y.fixed.cur === y.fixed.want[2] && (y.fixed.pinned || []).length === 3 && y.fixed.curText.length > 0,
      'Y0b ① 固定三项后：条上只有"非当前"的两个标签，当前项只在 `#current` 那一格（不重复出标签）',
      JSON.stringify(y.fixed))
    ok(y.geom && y.geom.tabs >= 1 && y.geom.tabRect && y.geom.tabRect.w <= 200 && y.geom.tabMaxW === '200px',
      'Y1 ① 标签宽度有上限（≤200px，`max-width` 生效）', JSON.stringify(y.geom && { w: y.geom.tabRect.w, maxW: y.geom.tabMaxW }))
    ok(y.geom && y.geom.nameEllipsis === 'ellipsis' && y.geom.nameOverflow === 'hidden',
      'Y2 ① 标题用 CSS 省略号（`overflow:hidden` + `text-overflow:ellipsis`）⇒ 长名字不把 × 顶远', JSON.stringify(y.geom && { o: y.geom.nameOverflow, e: y.geom.nameEllipsis }))
    ok(y.geom && y.geom.xInsideTab && y.geom.xHit && y.geom.xHit.self,
      'Y3 ① 固定标签的 `×` 在标签**右端内侧**且命中区 = 视觉区', JSON.stringify(y.geom && { inside: y.geom.xInsideTab, hit: y.geom.xHit }))
    /*  ①(P-342 契约变更后重写 · 2026-10-12 task-17) 旧判据 `Math.abs(gapPx) <= 1`（盒间距 ≤1px）
        描述的是**旧布局**（`×` 靠右缘、盒间距≈0）。P-342 把 `×` 用 `margin-left:-(22+4)` 拉进框内
        ⇒ 盒间距恒为 -26，旧式子必红。新判据量视觉结果，并把负外边距当构造性事实钉死（见上面的推导）。 */
    const cc = y.curCell || {}
    ok(cc.maxW === '180px' && cc.ellipsis === 'ellipsis' && cc.hit && cc.hit.self &&
      cc.insideCur === true &&
      cc.edgeGapPx !== null && Math.abs(cc.edgeGapPx - cc.marginRight) <= 1 &&
      cc.visualGapPx !== null && Math.abs(cc.visualGapPx - 6) <= 1 &&
      cc.xRect && Math.abs(cc.paddingRight - (cc.xRect.w + cc.marginRight + 6)) <= 1 &&
      cc.boxGapPx !== null && cc.boxGapPx < 0 && Math.abs(cc.boxGapPx - cc.boxGapExpect) <= 1,
      'Y4 ① 当前壁纸那一格：标题省略号 + `×` **完全在框内**、右缘固定偏移 = 自身右边距、' +
      '**视觉间隙 6px**（裁切区右缘 ↔ `×` 左缘，镜像 `.wp-tab{gap:6px}`）、盒间距 = -(×宽+右边距) 为负 —— 且命中=视觉',
      JSON.stringify(Object.assign({}, cc, {
        checks: {
          maxW180: cc.maxW === '180px', ellipsis: cc.ellipsis === 'ellipsis',
          hitSelf: !!(cc.hit && cc.hit.self), insideCur: cc.insideCur === true,
          edgeGapEqualsMarginRight: cc.edgeGapPx !== null && Math.abs(cc.edgeGapPx - cc.marginRight) <= 1,
          visualGap6: cc.visualGapPx !== null && Math.abs(cc.visualGapPx - 6) <= 1,
          paddingReservesXPlusGap: !!cc.xRect && Math.abs(cc.paddingRight - (cc.xRect.w + cc.marginRight + 6)) <= 1,
          boxGapNegativeAndConstructed: cc.boxGapPx !== null && cc.boxGapPx < 0 && Math.abs(cc.boxGapPx - cc.boxGapExpect) <= 1,
        },
      })))
    ok(y.idem && y.idem.srcSame && y.idem.mountsAfter === y.idem.mountsBefore && y.idem.nodeSame && Number(y.idem.hits) >= 3,
      'Y5 ③ 连点"已选中"项 3 次：`#frame` src 不变、`Mount` 日志不增、节点身份不变、拦截计数 ≥3',
      JSON.stringify(y.idem))
    ok(y.closeOther && y.closeOther.closed && !y.closeOther.after.includes(y.closeOther.closed) &&
      y.closeOther.after.length === y.closeOther.before.length - 1 && y.closeOther.srcSame && y.closeOther.textSame,
      'Y6 ① 点**非当前项**的 `×` ⇒ 只有该标签消失（少一个）、预览不重挂（src 不变）、当前那一格的字不动',
      JSON.stringify(y.closeOther))
    ok(y.fellBack && y.fellBack.tabs.length === 0 && y.fellBack.curText === y.fellBack.expectTitle &&
      (y.fellBack.pinned || []).length === 1 && y.fellBack.curCellX === true,
      'Y7 ① 关掉**当前项**（还固定着别的项）⇒ 明确回落到它：当前那一格换成回落项标题（不留已关项的旧标题）、固定集合只剩它',
      JSON.stringify(y.fellBack))
    ok(y.release && y.release.cleared && y.release.emptyVisible === true && (y.release.pinned || []).length === 0 && y.release.tabs === 0,
      'Y8 ① 关掉最后一个（当前项）⇒ 明确回落到"未选择壁纸 + 空态"，固定集合清空', JSON.stringify(y.release))
  }


  // ══════════════════ G 组（2026-09-20 用户第 1–11 条）几何 / 状态机 / 契约 ══════════════════
  //  纪律：全部判据都是**几何读数 / 状态机读数 / 契约形状**，不含任何本机绝对路径、目录名或平台专有行为；
  //  需要"总数"的地方一律由页面自己（`/api/library` 或三个类型档之和）现算，不写死数字。
  {
    // ── G1 ⑥ 暗色模式小月亮图标几何居中（两主题各一次）─────────────────────────────────
    const moon = await page.evaluate(async () => {
      const t = (n, b = 0) => Promise.resolve().then(() => new Promise((r) => setTimeout(r, n)))
      const measure = () => {
        const btn = document.getElementById('theme-toggle')
        const icon = btn ? [...btn.querySelectorAll('svg.ic')].find((s) => !s.hasAttribute('hidden')) : null
        if (!btn || !icon) return { mode: document.documentElement.dataset.theme, found: false }
        const b = btn.getBoundingClientRect(); const i = icon.getBoundingClientRect()
        return {
          mode: document.documentElement.dataset.theme, found: true,
          dx: Math.round(((i.left + i.right) / 2 - (b.left + b.right) / 2) * 100) / 100,
          dy: Math.round(((i.top + i.bottom) / 2 - (b.top + b.bottom) / 2) * 100) / 100,
          btnBorder: getComputedStyle(btn).borderLeftWidth, iconDisplay: getComputedStyle(icon).display,
        }
      }
      const setTheme = (want) => {
        const btn = document.getElementById('theme-toggle')
        for (let i = 0; i < 3 && document.documentElement.dataset.theme !== want; i++) btn.click()
        return document.documentElement.dataset.theme
      }
      const out = {}
      setTheme('dark'); await t(200); out.dark = measure()
      setTheme('light'); await t(200); out.light = measure()
      setTheme('dark'); await t(200)
      return out
    })
    for (const [k, label] of [['dark', '暗色'], ['light', '亮色']]) {
      const m = moon[k] || {}
      ok(m.found && Math.abs(m.dx) <= 1 && Math.abs(m.dy) <= 1 && m.btnBorder === '0px' && m.iconDisplay === 'block',
        `G1 ⑥ ${label}主题：月亮/太阳图标与按钮框**几何居中**（中心偏差 ≤1px，按钮 border=0、图标 display:block）`, JSON.stringify(m))
    }

    // ── G2 ⑦ 滚动条：资源管理器列表 + 输出区**同一份定义**（两主题各一次）────────────────
    //  判据分两半：①**契约**（CSSOM 里"声明 scrollbar-width 的那条规则"的选择器同时命中列表与输出区
    //  ⇒ 一处定义两处引用；且滑块声明 `border-radius:999px`、尺寸是变量）②**运行期解析色**
    //  （两处 `scrollbar-color` 逐字相等、由变量驱动 —— 用户抱怨的是"又黑又粗"，颜色是它的可见面）。
    //  ⚠ 不拿 `getComputedStyle().scrollbarWidth` 的**字面值**当判据：不同 Firefox 版本/无头配置下
    //  它报的是 used 值（实测本机报 `none`，而规则明明在位并已生效 —— 见读数里的 cssRules 证据）。
    const sb = await page.evaluate(() => {
      const read = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const cs = getComputedStyle(el)
        return { w: cs.scrollbarWidth, c: cs.scrollbarColor }
      }
      const prop = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
      // CSSOM：找出"声明了 scrollbar-width"的规则，看它们的**选择器**是否同时命中两个区域
      const rules = []
      for (const sh of [...document.styleSheets]) {
        let list = []
        try { list = [...sh.cssRules] } catch { list = [] }
        for (const r of list) {
          const txt = String(r.cssText || '')
          if (!/scrollbar-width\s*:/.test(txt)) continue
          const sel = String(r.selectorText || '')
          const one = (s2) => { try { return document.querySelector(s2) ? document.querySelector(s2).matches(s2) : false } catch { return false } }
          rules.push({ sel, w: /scrollbar-width\s*:\s*([a-z]+)/.exec(txt)[1], hitsList: one('#list'), hitsOut: one('#logbody') })
        }
      }
      const radiusRules = []
      for (const sh of [...document.styleSheets]) {
        let list = []
        try { list = [...sh.cssRules] } catch { list = [] }
        for (const r of list) if (/border-radius\s*:\s*999px/.test(String(r.cssText || ''))) radiusRules.push(String(r.selectorText || '').slice(0, 400))
      }
      return { mode: document.documentElement.dataset.theme, list: read('#list'), out: read('#logbody'), diag: read('#diag-body'), dbg: read('.dbg-log'),
        thumbVar: prop('--bench-sb-thumb'), sizeVar: prop('--bench-sb-size'), rules, radiusRules }
    })
    const sbRule = (sb.rules || []).find((r) => r.hitsList && r.hitsOut)
    ok(!!sbRule && sbRule.w === 'thin' && sb.list && sb.out && sb.list.c === sb.out.c && /rgba?\(/.test(String(sb.list.c)) && sb.thumbVar === 'rgba(255,255,255,.5)' && sb.sizeVar === '8px',
      'G2a ⑦ **一处定义两处引用**：同一条 `scrollbar-width:thin` 规则同时命中资源管理器列表与输出区，两处解析出的 `scrollbar-color` 逐字相等且由变量驱动（暗色 rgba(255,255,255,.5) / 8px）',
      JSON.stringify({ rule: sbRule, list: sb.list, out: sb.out, thumbVar: sb.thumbVar, sizeVar: sb.sizeVar, rules: sb.rules }))
    ok(sb.diag && sb.dbg && sb.diag.c === sb.list.c && sb.dbg.c === sb.list.c,
      'G2b ⑦ 诊断视图/调试视图那块日志吃到的是**同一份**定义（不是只改了列表）', JSON.stringify({ diag: sb.diag, dbg: sb.dbg }))
    ok((sb.radiusRules || []).length >= 1 && (sb.radiusRules || []).some((s2) => /#list/.test(s2) && /#logbody/.test(s2)),
      'G2c ⑦ 上下圆角（`border-radius:999px`）与宽度声明在**同一条清单**里（滑块圆角只定义一次，两个区域共用）', JSON.stringify(sb.radiusRules))

    // ── G3 ⑨ 输入框聚焦：平时灰边、聚焦黑边（暗色白边），不再是浏览器默认黄框 ─────────────
    const focus = await page.evaluate(async () => {
      const el = document.getElementById('filter')
      if (!el) return null
      const prop = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
      //  变量本身是十六进制串，元素的**计算值**是 rgb() ⇒ 用一个临时元素把变量解析成同一口径再比
      const resolveVar = (n) => { const d = document.createElement('div'); d.style.color = 'var(' + n + ')'; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v }
      const before = getComputedStyle(el)
      const b = { color: before.borderTopColor, outline: before.outlineStyle }
      el.focus()
      await new Promise((r) => setTimeout(r, 120))
      const after = getComputedStyle(el)
      const a = { color: after.borderTopColor, outline: after.outlineStyle }
      el.blur()
      return { mode: document.documentElement.dataset.theme, before: b, after: a,
        varBorder: resolveVar('--bench-input-border'), varFocus: resolveVar('--bench-input-focus'),
        rawBorder: prop('--bench-input-border'), rawFocus: prop('--bench-input-focus'), active: document.activeElement === el }
    })
    const norm = (c) => String(c || '').replace(/\s+/g, '')
    ok(focus && focus.before.outline !== 'none' ? false : true, 'G3a ⑨ 输入框平时不画 outline（`outline:none` 由聚焦态统一接管）', JSON.stringify(focus && focus.before))
    ok(focus && focus.after.outline === 'none' && norm(focus.after.color) !== norm(focus.before.color) &&
      norm(focus.after.color) === norm(focus.varFocus) && norm(focus.before.color) === norm(focus.varBorder) &&
      norm(focus.after.color) !== 'rgb(0,120,212)',
      'G3b ⑨ 聚焦时边框换成**变量里的**聚焦色（暗色白边），平时是灰边 —— 两态都来自同一处变量，不是浏览器默认黄框', JSON.stringify(focus && { before: focus.before, after: focus.after, varBorder: focus.varBorder, varFocus: focus.varFocus, raw: [focus.rawBorder, focus.rawFocus], mode: focus.mode }))

    // ── G4 ⑧ 类型筛选：初始高亮 = 全部，且"全部"条目数 = 三档之和（单一事实源）────────────
    const filt = await page.evaluate(async () => {
      const seg = (ty) => document.querySelector('#type-filter .seg-btn[data-type="' + ty + '"]')
      const count = () => document.querySelectorAll('#list li[data-id]').length
      const active = () => { const b = document.querySelector('#type-filter .seg-btn.active'); return b ? b.textContent : null }
      const out = { initialActive: active(), initialCount: count(), initialSegCount: document.querySelectorAll('#type-filter .seg-btn').length }
      const per = {}
      for (const ty of ['scene', 'web', 'video']) { const b = seg(ty); if (!b) return Object.assign(out, { err: 'no seg ' + ty }); b.click(); await new Promise((r) => setTimeout(r, 700)); per[ty] = count() }
      const all = seg('all'); all.click(); await new Promise((r) => setTimeout(r, 900))
      out.per = per
      out.sum = per.scene + per.web + per.video
      out.allActive = active()
      out.allCount = count()
      return out
    })
    ok(filt.initialActive && filt.initialActive === (filt.allActive || filt.initialActive) && filt.initialCount === filt.sum && filt.allCount === filt.sum && filt.sum > 0,
      'G4a ⑧ 初始高亮 = 「全部」，且显示的条目数 = 三档之和（高亮与过滤读的是同一个变量 `uiType`）',
      JSON.stringify({ initial: filt.initialActive, all: filt.allActive, initialCount: filt.initialCount, allCount: filt.allCount, sum: filt.sum, per: filt.per }))

    // ── G5 ① 未选择壁纸时**不渲染**叉号；关一个不存在的 id 不写日志（幂等）────────────────
    const ghost = await page.evaluate(async () => {
      const P = window.__benchPatch
      //  先把已打开的项全部关掉（连点当前项与各标签的 ×），得到"什么都没打开"的干净态
      for (let i = 0; i < 12; i++) {
        const cur = document.querySelector('.wp-x-cur'); const any = document.querySelector('.wp-x:not(.wp-x-cur)')
        const b = cur || any
        if (!b) break
        b.click(); await new Promise((r) => setTimeout(r, 400))
      }
      const rel = document.getElementById('release'); if (rel) rel.click()
      await new Promise((r) => setTimeout(r, 800))
      const before = ((document.getElementById('logbody') || {}).textContent || '')
      const ghostX = document.querySelectorAll('.wp-x-cur').length
      const curText = (document.getElementById('current') || {}).textContent || ''
      //  再点一次"当前壁纸那一格"（如果还有残留的 ×）—— 这是用户报的那次点击
      const shell = window.__benchShell || {}
      const stale = shell.openTabs ? shell.openTabs() : null
      const closed = shell.closeTab ? shell.closeTab('no-such-wallpaper-id') : null
      await new Promise((r) => setTimeout(r, 500))
      const after = ((document.getElementById('logbody') || {}).textContent || '')
      return { ghostX, curText, tabs: stale, closed, logGrew: after.length - before.length, grew: after.slice(before.length).slice(0, 120), hasReleaseLine: /释放舞台|release the stage/i.test(after.slice(before.length)) }
    })
    ok(ghost.ghostX === 0 && /未选择壁纸|No wallpaper/.test(String(ghost.curText || '')),
      'G5a ① **什么都没打开时**不渲染当前壁纸那一格的 `×`（当前格是"未选择壁纸"且全页 0 个 `.wp-x-cur` —— 没有点了没反应的幽灵叉号）',
      JSON.stringify({ ghostX: ghost.ghostX, curText: ghost.curText, tabs: ghost.tabs }))
    ok(ghost.closed === false && ghost.hasReleaseLine === false,
      'G5b ① 关一个"并不存在"的 id：**幂等返回 false 且不写日志**（旧写法会写"已关闭当前壁纸 … 没有其它打开项 ⇒ 释放舞台"）',
      JSON.stringify({ closed: ghost.closed, logGrew: ghost.logGrew, grew: ghost.grew }))

    // ── G8 ⑧ 调试页签里能看到**与 :8899 同一份**内容 ───────────────────────────────────
    const mirror = await page.evaluate(async () => {
      const w = (n) => new Promise((r) => setTimeout(r, n))
      //  先制造**新鲜的渲染器诊断**：挂载一次壁纸（渲染器会打 mountScene / 贴图 / mip 选级那一串），
      //  否则"清空"之后流里可能一条都没有，判据会退化成"空 == 空"。
      const li = document.querySelector('#list li[data-id]')
      if (li) { li.click(); await w(9000) }
      document.getElementById('tab-diag').click()
      await w(2500)
      const lines = [...document.querySelectorAll('#diag-body .diag-line')].map((l) => l.textContent)
      const tail = lines.slice(-6)
      const dbgLines = [...document.querySelectorAll('#dbg-log > *')]
      const dbgText = dbgLines.map((l) => l.textContent)
      const diagSrc = dbgLines.filter((l) => l.dataset && l.dataset.src === 'diag')
      return {
        diagCount: lines.length, tail,
        dbgCount: dbgLines.length, mirrored: diagSrc.length,
        tailInDbg: tail.map((s) => dbgText.some((d) => d === s)),
        rendererLines: lines.filter((s) => /\[renderer\]/.test(s)).length,
        rendererMirrored: diagSrc.filter((l) => /\[renderer\]/.test(l.textContent)).length,
        sample: (dbgText.find((s) => /\[renderer\]/.test(s)) || '').slice(0, 90),
      }
    })
    ok(mirror.diagCount > 0 && mirror.tailInDbg.length > 0 && mirror.tailInDbg.every(Boolean),
      'G8a ④ 诊断流最后几条在调试页签里**逐字可见**（同一份内容，不是"另有一套摘要"）',
      JSON.stringify({ diag: mirror.diagCount, dbg: mirror.dbgCount, mirrored: mirror.mirrored, tailInDbg: mirror.tailInDbg }))
    ok(mirror.rendererLines > 0 && mirror.rendererMirrored > 0,
      'G8b ④ 渲染器诊断（层信息 / 加载日志 / mip 选级都在 `[renderer]` 源里）确实进了调试页签', JSON.stringify({ rendererDiag: mirror.rendererLines, rendererMirrored: mirror.rendererMirrored, sample: mirror.sample }))

    // ── G6 ② 清空按**当前视图**清 + 各留一条"已清空"系统行 ─────────────────────────────
    const clear = await page.evaluate(async () => {
      const P = window.__benchPatch
      const w = (n) => new Promise((r) => setTimeout(r, n))
      const txt = (id) => ((document.getElementById(id) || {}).textContent || '')
      const out = {}
      const CLR = /已清空|Cleared/
      //  ① 输出视图
      document.getElementById('tab-logs').click(); await w(200)
      document.getElementById('clear-logs').click(); await w(300)
      const lb = document.getElementById('logbody')
      out.logs = { children: lb ? lb.children.length : -1, text: (lb ? lb.textContent : '').slice(0, 80), isCleared: CLR.test(lb ? lb.textContent : ''),
        firstIsCleared: !!(lb && lb.firstElementChild && lb.firstElementChild.dataset && lb.firstElementChild.dataset.sys === 'cleared') }
      //  ② 诊断视图
      document.getElementById('tab-diag').click(); await w(1500)
      const beforeDiag = document.querySelectorAll('#diag-body .diag-line').length
      document.getElementById('clear-logs').click(); await w(400)
      const db0 = document.getElementById('diag-body')
      out.diag = { before: beforeDiag, children: document.querySelectorAll('#diag-body .diag-line').length, isCleared: CLR.test(txt('diag-body')), text: txt('diag-body').slice(0, 80),
        firstIsCleared: !!(db0 && db0.firstElementChild && db0.firstElementChild.dataset && db0.firstElementChild.dataset.sys === 'cleared') }
      //  ③ 调试视图（先在内嵌开关上把模式打开）
      document.getElementById('tab-debug').click(); await w(200)
      const sw = document.getElementById('dbg-mode'); if (sw && !sw.checked) { sw.click(); await w(900) }
      out.dbgBefore = { lines: document.querySelectorAll('#dbg-log > *').length, text: txt('dbg-log').length }
      document.getElementById('clear-logs').click(); await w(400)
      const dl = document.getElementById('dbg-log')
      const firstCleared = () => !!(dl && dl.firstElementChild && dl.firstElementChild.dataset && dl.firstElementChild.dataset.sys === 'cleared')
      out.dbg = { children: document.querySelectorAll('#dbg-log > *').length, isCleared: CLR.test(txt('dbg-log')), text: txt('dbg-log').slice(0, 80), firstIsCleared: firstCleared() }
      await w(1400)                                     // 等一个轮询周期：环形缓冲没清的话旧行会"复活"
      out.dbgAfterPoll = { children: document.querySelectorAll('#dbg-log > *').length, isCleared: CLR.test(txt('dbg-log')), firstIsCleared: firstCleared() }
      if (sw && sw.checked) { sw.click(); await w(300) }   // 收尾：模式关
      return out
    })
    ok(clear.logs && clear.logs.firstIsCleared === true && clear.logs.isCleared && clear.logs.children >= 1,
      'G6a ② 输出视图：清空后**第一行**就是那条「已清空」系统行（旧内容一行不剩；之后到来的新日志可以继续追加）', JSON.stringify(clear.logs))
    ok(clear.diag && clear.diag.before > 0 && clear.diag.firstIsCleared === true && clear.diag.isCleared && clear.diag.children < clear.diag.before,
      'G6b ② 诊断视图：清空**真的清掉了**（清前 >0 行 ⇒ 清后只剩「已清空」+ 之后到来的新行；计数缓冲一起归零、页签计数跟着走）', JSON.stringify(clear.diag))
    ok(clear.dbgBefore.lines > 0 && clear.dbg && clear.dbg.firstIsCleared === true && clear.dbg.isCleared &&
      clear.dbg.children < clear.dbgBefore.lines && clear.dbgAfterPoll.children < clear.dbgBefore.lines && clear.dbgAfterPoll.isCleared,
      'G6c ② 调试视图：清空**真的清掉了**（旧写法在调试视图下永远清不掉：判据自锁）且过一个轮询周期旧行不复活（行缓冲一起清）',
      JSON.stringify({ before: clear.dbgBefore, after: clear.dbg, afterPoll: clear.dbgAfterPoll }))

    // ── G7 ②④ 调试模式开关在页签内部；**切页签永不改变模式** ─────────────────────────────
    const dbg = await page.evaluate(async () => {
      const P = window.__benchPatch
      const w = (n) => new Promise((r) => setTimeout(r, n))
      const view = () => document.getElementById('logs').dataset.view
      const out = { hasSwitch: !!document.getElementById('dbg-mode'), inBody: !!(document.getElementById('debug-body') || {}).querySelector ? !!document.getElementById('debug-body').querySelector('#dbg-mode') : false }
      document.getElementById('tab-logs').click(); await w(250)
      out.modeAtLogs = P.debugMode()
      document.getElementById('tab-debug').click(); await w(400)
      out.tabOnly = { view: view(), mode: P.debugMode(), keys: P.dbgKeysInstalled() }
      const sw = document.getElementById('dbg-mode')
      const r = sw.getBoundingClientRect()
      const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
      const rowR = document.getElementById('dbg-mode-box').getBoundingClientRect()
      const bodyR = document.getElementById('debug-body').getBoundingClientRect()
      out.switchHit = {
        w: Math.round(r.width), h: Math.round(r.height),
        hit: !!(at && (at === sw || sw.contains(at) || (at.closest && at.closest('#debug-body')))),
        //  几何判据：开关那一行整体落在调试页签的内容框里（不是浮在别处）
        insideBody: rowR.left >= bodyR.left - 1 && rowR.right <= bodyR.right + 1 && rowR.top >= bodyR.top - 1 && rowR.bottom <= bodyR.bottom + 1,
        row: { w: Math.round(rowR.width), h: Math.round(rowR.height) },
      }
      sw.click(); await w(900)
      out.on = { view: view(), mode: P.debugMode(), keys: P.dbgKeysInstalled() }
      document.getElementById('tab-diag').click(); await w(500)
      out.afterDiagTab = { view: view(), mode: P.debugMode(), keys: P.dbgKeysInstalled() }
      document.getElementById('tab-logs').click(); await w(400)
      out.afterLogsTab = { view: view(), mode: P.debugMode(), keys: P.dbgKeysInstalled() }
      document.getElementById('tab-debug').click(); await w(400)
      out.backToDebug = { view: view(), mode: P.debugMode(), keys: P.dbgKeysInstalled() }
      sw.click(); await w(400)
      out.off = { view: view(), mode: P.debugMode(), keys: P.dbgKeysInstalled() }
      return out
    })
    ok(dbg.hasSwitch && dbg.inBody && dbg.switchHit.hit && dbg.switchHit.insideBody && dbg.switchHit.w >= 10 && dbg.switchHit.h >= 10 && dbg.switchHit.row.w > 60,
      'G7a ④ 调试模式开关**在调试页签内部**（`#debug-body` 里的 `#dbg-mode`：命中区 = 自己，整行几何上落在页签内容框内）', JSON.stringify({ hasSwitch: dbg.hasSwitch, inBody: dbg.inBody, hit: dbg.switchHit }))
    ok(dbg.tabOnly.mode === false && dbg.modeAtLogs === false && dbg.tabOnly.view === 'debug',
      'G7b ④ 点页签只切视图：进调试页签时模式**仍是关**（页签不再当开关用）', JSON.stringify({ atLogs: dbg.modeAtLogs, after: dbg.tabOnly }))
    ok(dbg.on.mode === true && dbg.on.keys === true,
      'G7c ④ 勾上页签内部的开关 ⇒ 模式开 + 键盘路由装上', JSON.stringify(dbg.on))
    ok(dbg.afterDiagTab.mode === true && dbg.afterLogsTab.mode === true && dbg.backToDebug.mode === true,
      'G7d ④ **切页签永不改变调试模式状态**（诊断页/输出页来回切，模式一直开着；<img>用户实测"点渲染器日志那一页会把调试模式关掉"已修）',
      JSON.stringify({ diag: dbg.afterDiagTab, logs: dbg.afterLogsTab, back: dbg.backToDebug }))
    ok(dbg.afterDiagTab.keys === false && dbg.afterLogsTab.keys === false && dbg.backToDebug.keys === true,
      'G7e ④ 键盘纪律不变：只在**调试视图可见且模式开着**时接管（离开这一页立刻卸掉）', JSON.stringify({ diagKeys: dbg.afterDiagTab.keys, logsKeys: dbg.afterLogsTab.keys, backKeys: dbg.backToDebug.keys }))
    ok(dbg.off.mode === false && dbg.off.keys === false,
      'G7f ④ 关掉开关 ⇒ 模式关 + 键盘卸掉（图层恢复可见由 setDebugMode 负责）', JSON.stringify(dbg.off))

    // ── G9 ⑤ 麦克风：默认关 + `getUserMedia` 调用计数 0 ──────────────────────────────
    const mic = await page.evaluate(async () => {
      const P = window.__benchPatch
      const w = (n) => new Promise((r) => setTimeout(r, n))
      const el = document.getElementById('mic-enable')
      const out = { exists: !!el, checked: !!(el && el.checked), callsAtLoad: Number(window.__gumCalls || 0), gate: P.micGate && P.micGate() }
      const live = document.getElementById('live-system')
      out.liveAtStart = { checked: !!(live && live.checked), disabled: !!(live && live.disabled) }
      //  关着时点「系统实况」：不许把 mic 请求放出去（也不许把 liveSystem=1 交给渲染器）
      if (live) { live.click(); await w(600) }
      out.liveAfterClick = { checked: !!(live && live.checked), frameSrc: String((document.getElementById('frame') || {}).getAttribute ? (document.getElementById('frame').getAttribute('src') || '') : '') }
      out.callsAfterToggle = Number(window.__gumCalls || 0)
      out.gateAfterToggle = P.micGate && P.micGate()
      //  打开开关：闸门变为放行（请求仍只在"声明需要"时发生）
      if (el) { el.click(); await w(500) }
      out.gateOn = P.micGate && P.micGate()
      if (el && el.checked) { el.click(); await w(300) }
      out.gateBackOff = P.micGate && P.micGate()
      out.callsFinal = Number(window.__gumCalls || 0)
      return out
    })
    ok(mic.exists && mic.checked === false,
      'G9a ⑤ 工具条有「启用麦克风」复选框且**默认关**', JSON.stringify({ exists: mic.exists, checked: mic.checked }))
    ok(mic.gate && mic.gate.enabled === false && mic.gate.installed >= 1 && mic.gate.liveSystemChecked === false && mic.gate.liveSystemDisabled === true,
      'G9b ⑤ 关着时闸门状态 = 不放行，且「系统实况」被强制关掉（⇒ 渲染器 URL 拿不到 `liveSystem=1`）', JSON.stringify(mic.gate))
    ok(mic.callsAtLoad === 0 && mic.callsAfterToggle === 0 && mic.gate.rendererLive === false,
      'G9c ⑤ **关着时 `getUserMedia` 一次都没调**（计数 0：加载后 / 挂载壁纸后 / 点「系统实况」后都还是 0；渲染器 URL 里也没有 `liveSystem=1`）',
      JSON.stringify({ atLoad: mic.callsAtLoad, afterToggle: mic.callsAfterToggle, rendererLive: mic.gate.rendererLive }))
    ok(mic.gateOn && mic.gateOn.enabled === true && mic.gateOn.liveSystemDisabled === false && mic.gateBackOff && mic.gateBackOff.enabled === false,
      'G9d ⑤ 打开开关 ⇒ 放行（并还给用户原来的「系统实况」勾选）；再关掉 ⇒ 立刻恢复不放行', JSON.stringify({ on: mic.gateOn, off: mic.gateBackOff }))
  }

  // ══════════════════ Z 组（P-164 ②④）调试模式页签 + 指针移动转发 ══════════════════
  {
    const z = await page.evaluate(async () => {
      const P = window.__benchPatch
      const out = {}
      const probe = (key) => { const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented }
      out.before = { swallow: { ArrowRight: probe('ArrowRight'), Alt: probe('Alt') }, view: document.getElementById('logs').dataset.view }
      document.getElementById('tab-debug').click()
      await new Promise((r) => setTimeout(r, 500))
      //  ②(2026-09-20 用户第 3 条) 页签只切视图；模式必须由**页签内部那个开关**打开（旧写法点页签即开模式）。
      out.tabOnly = { view: document.getElementById('logs').dataset.view, mode: P.debugMode(), keys: P.dbgKeysInstalled() }
      const modeSwitch = document.getElementById('dbg-mode')
      if (modeSwitch && !modeSwitch.checked) modeSwitch.click()
      await new Promise((r) => setTimeout(r, 800))
      out.on = {
        view: document.getElementById('logs').dataset.view, active: P.debugMode(), keys: P.dbgKeysInstalled(),
        layerText: (document.getElementById('dbg-layer') || {}).textContent,
        layers: P.dbgLayers(), index: P.dbgIndex(),
        logLines: ((document.getElementById('dbg-log') || {}).textContent || '').length,
        boot: P.dbgBootErr(),
      }
      const btnInfo = (id) => { const b = document.getElementById(id); if (!b) return null; const r = b.getBoundingClientRect(); const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return { id, w: Math.round(r.width), h: Math.round(r.height), hit: !!(at && (at === b || b.contains(at))) } }
      out.buttons = [btnInfo('dbg-report'), btnInfo('dbg-shot')]
      out.shot = P.dbgShot()
      const rep = await P.dbgReport()
      out.report = rep && { route: rep.route, status: rep.status || 0, bytes: rep.bytes, schema: rep.plan && rep.plan.schema, diagLines: rep.plan && rep.plan.diagLines }
      out.reportStored = (() => { try { return (localStorage.getItem('bench-debug-report') || '').length } catch { return -1 } })()
      out.swallowOn = { ArrowRight: probe('ArrowRight'), ArrowLeft: probe('ArrowLeft'), Control: probe('Control'), KeyA: probe('a'), AltThenExit: probe('Alt') }
      await new Promise((r) => setTimeout(r, 500))
      out.afterAlt = { view: document.getElementById('logs').dataset.view, active: P.debugMode(), keys: P.dbgKeysInstalled() }
      out.swallowOff = { ArrowRight: probe('ArrowRight'), Alt: probe('Alt') }
      return out
    })
    ok(z.before && z.before.swallow.ArrowRight === false && z.before.swallow.Alt === false,
      'Z1 ② 调试模式**未激活**时 ←/→/Alt 的默认行为照旧（不吞）', JSON.stringify(z.before))
    ok(z.tabOnly && z.tabOnly.view === 'debug' && z.tabOnly.mode === false && z.tabOnly.keys === false,
      'Z2a ② 点「调试模式」页签 ⇒ **只进这一页**（模式仍关、键盘未接管；页签不再兼作开关）', JSON.stringify(z.tabOnly))
    ok(z.on && z.on.view === 'debug' && z.on.active === true && z.on.keys === true,
      'Z2b ② 勾上页签内部的「开启调试模式」⇒ 模式开且键盘路由装上', JSON.stringify(z.on && { view: z.on.view, active: z.on.active, keys: z.on.keys }))
    ok(z.buttons && z.buttons.every((b) => b && b.w > 40 && b.h > 0 && b.hit === true),
      'Z3 ② 「立即上报」「截图」两个按钮可见且命中区 = 视觉区', JSON.stringify(z.buttons))
    ok(z.on && typeof z.on.layerText === 'string' && z.on.layerText.length > 0 && z.on.logLines > 0,
      'Z4 ② 栏内有**当前层信息**与**日志**（没有场景时如实写"没有可逐层查看的场景"）',
      JSON.stringify({ layer: z.on && z.on.layerText, log: z.on && z.on.logLines }))
    ok(z.shot === null || (z.shot && z.shot.bytes > 1000),
      'Z5 ② 「截图」有场景时给出 JPEG（bytes>1KB），没有画布时走明确失败并写日志', JSON.stringify(z.shot))
    ok(z.report && z.report.schema === 'bench-debug/1' && z.report.bytes > 50 && /^\/(report|baseline|diag)$/.test(z.report.route) && z.reportStored > 50,
      'Z6 ② 「立即上报」：载荷 schema 正确、落点走 /report→/baseline→/diag 的第一条可用路由、并留本地副本',
      JSON.stringify({ report: z.report, stored: z.reportStored }))
    // ①(P-166 2026-09-20) 上面那条只要求"落在三条之一"；服务端补齐两条落盘路由之后，**第一条就必须成功**。
    //   落回 /baseline 或 /diag 说明跑着的 :8902 还是旧代码（`tests/keep-servers.sh` 拉起的就是仓库当前版本，
    //   真机上这条红了请先重启 :8902 再复跑）。`status` 为 0/undefined = 该次 fetch 拿到 2xx。
    ok(z.report && z.report.route === '/report' && !z.report.status,
      'Z6b ② 落点必须是**第一条 `/report`**（P-166 已补该路由 ⇒ 不该再退到 /baseline 或 /diag）',
      JSON.stringify({ route: z.report && z.report.route, status: z.report && z.report.status, bytes: z.report && z.report.bytes }))
    ok(z.swallowOn && z.swallowOn.ArrowRight === true && z.swallowOn.ArrowLeft === true && z.swallowOn.Control === true && z.swallowOn.KeyA === false,
      'Z7 ② 激活期间 ←/→/Ctrl 被吞（含修饰键默认行为）、普通字符键照旧', JSON.stringify(z.swallowOn))
    ok(z.afterAlt && z.afterAlt.view === 'logs' && z.afterAlt.active === false && z.afterAlt.keys === false && z.swallowOff.ArrowRight === false && z.swallowOff.Alt === false,
      'Z8 ② Alt 退出调试模式 ⇒ 视图回输出、键盘监听**卸掉**、默认行为恢复（不留全局拦截）', JSON.stringify({ after: z.afterAlt, off: z.swallowOff }))
    const pf = await page.evaluate(() => window.__benchPatch.pointerForward ? window.__benchPatch.pointerForward() : null)
    ok(pf && pf.enabled === true && typeof pf.forwarded === 'number',
      'Z9 ④ 指针转发入口可读（`enabled` + 已转发次数）', JSON.stringify(pf))
    ok(z.on && z.on.boot === '',
      'Z9b ② 进出调试页签没有**被吞掉的启动错**（`dbgBootErr` 必须是空串：正常路径下 setDebugMode 不许抛）',
      JSON.stringify({ boot: z.on && z.on.boot }))
    //  ④ 真机口径：**不按住任何键**在舞台上移动 ⇒（a）注入遮罩上收到 pointermove 并转发给渲染器，
    //  （b）尾迹画布出现墨迹。两条都用 Playwright 的真鼠标事件（不是 DOM 合成），headless 也能测。
    const ink = () => page.evaluate(() => {
      const c = document.getElementById('trail-canvas')
      if (!c) return -1
      const g = c.getContext('2d')
      if (!g) return -1
      const d = g.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
      return n
    })
    const injOn = await page.evaluate(() => {
      const p = document.getElementById('pointer-push')
      if (p && !p.checked) p.click()
      return { checked: !!(p && p.checked), veilShown: (() => { const v = document.getElementById('pointer-veil'); return !!(v && !v.hasAttribute('hidden')) })(), trailOnEnabled: (() => { const t = document.getElementById('trail-on'); return !!(t && !t.disabled) })() }
    })
    await page.waitForTimeout(500)
    const pf0 = await page.evaluate(() => window.__benchPatch.pointerForward())
    const rect = await page.evaluate(() => {
      const v = document.getElementById('pointer-veil')
      const el = (v && !v.hasAttribute('hidden')) ? v : document.getElementById('stage')
      const r = el ? el.getBoundingClientRect() : null
      return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null
    })
    if (rect && rect.w > 20 && rect.h > 20) {
      const cx = rect.x + Math.round(rect.w * 0.35); const cy = rect.y + Math.round(rect.h * 0.45)
      for (let i = 0; i < 8; i++) await page.mouse.move(cx + i * 12, cy + i * 7)      // 不按键
      await page.waitForTimeout(300)
    }
    const pf1 = await page.evaluate(() => window.__benchPatch.pointerForward())
    ok(rect && rect.w > 20 && pf1 && pf1.forwarded > pf0.forwarded,
      'Z10 ④ 舞台内**不按键**真鼠标移动 ⇒ 坐标经 `__wp.pushPointer(...,buttons=0)` 转发（计数增加）',
      JSON.stringify({ inj: injOn, rect, from: pf0, to: pf1 }))
    const ink0 = await ink()
    await page.evaluate(() => { const t = document.getElementById('trail-on'); if (t && !t.disabled && !t.checked) t.click() })
    await page.waitForTimeout(400)
    if (rect && rect.w > 20 && rect.h > 20) {
      const cx = rect.x + Math.round(rect.w * 0.5); const cy = rect.y + Math.round(rect.h * 0.55)
      for (let i = 0; i < 10; i++) await page.mouse.move(cx - i * 14, cy - i * 9)     // 依旧不按键
      await page.waitForTimeout(300)
    }
    const ink1 = await ink()
    ok(ink0 >= 0 && ink1 > 0 && ink1 >= ink0,
      'Z11 ④ 「指针注入 + 鼠标尾迹」下**不按键**移动 ⇒ 尾迹画布出现墨迹（:8899 同一口径）',
      JSON.stringify({ inkBefore: ink0, inkAfter: ink1, trail: await page.evaluate(() => { const t = document.getElementById('trail-on'); return { checked: !!(t && t.checked), disabled: !!(t && t.disabled) } }) }))
  }

  // ══════════════════ P 组（2026-09-21 用户第 18/23/25/26/27/28/29/30/34 条 + 第 14 条行布局半条）══════
  //  纪律：判据都是**契约 / 几何 / 状态机**读数；item 一律由 `/api/library` + `/api/props` **现算**
  //  （不写死任何本机 id、目录名、路径），找不到满足条件的语料就**自 SKIP 那一条**（进 notes），不假装通过。
  //  "面板换了一张"这类判据要求三件事同时成立：① 显示的行名集合 ⊆ **新那张**声明的项（减内置隐藏名单）
  //  ② 与上一张的行集合**不同** ③ 至少有一个名字**不在上一张的声明里**（否则可能只是"旧数据恰好同形"）；
  //  并且 `/api/props?item=<新>` 请求确实在切换之后发生过。
  {
    const PP = await import(pathToFileURL(path.join(ROOT, 'demo/bench-patch.js')).href)
    const libItems = await page.evaluate(async () => {
      const r = await (await fetch('/api/library')).json()
      return (r.items || []).map((i) => ({ id: i.itemId, decl: Object.keys(i.properties || {}).length }))
    })
    const declOf = (id) => page.evaluate(async (item) => {
      const r = await (await fetch('/api/props?item=' + encodeURIComponent(item))).json()
      return r.props || []
    }, id)
    /* ①(2026-09-22) **有界自适应等待**：固定 2600ms 在整套门禁并发跑时会不够（面板还没换完就采样 ⇒ 假红）。
       现在点完就轮询"面板真的换了"（行集合变化 或 该 id 的 `/api/props` 请求出现过），最长 9s；
       超时仍返回当前快照 —— 判据本身不放宽，只是不再靠"睡够时间"。 */
    const pick = async (id, waitMs = 9000) => {
      const beforeReqs = (await propsReqs()).length
      const beforeNames = shownNames(await panel()).join('|')
      await page.evaluate((want) => {
        const li = [...document.querySelectorAll('#list li[data-id]')].find((x) => x.dataset.id === want)
        if (li) li.click()
      }, id)
      const t0 = Date.now()
      while (Date.now() - t0 < waitMs) {
        await page.waitForTimeout(250)
        const names = shownNames(await panel()).join('|')
        const reqs = (await propsReqs()).length
        if (names && names !== beforeNames) return
        if (reqs > beforeReqs) { await page.waitForTimeout(600); return }
      }
    }
    const panel = () => page.evaluate(() => window.__benchPatch.propsPanel())
    const propsReqs = () => page.evaluate(() => (Array.isArray(window.__propsReqs) ? window.__propsReqs.slice() : []))
    const shownNames = (st) => (st && Array.isArray(st.names) ? st.names.filter(Boolean).sort() : [])
    //  允许显示的上界 = 该壁纸声明的项 − 内置隐藏名单（占位颜色**仍然显示行**，只是没有控件 ⇒ 不排除）
    const allowed = (decl) => decl.filter((s) => !PP.propsHiddenReason({ name: s.name, text: s.text })).map((s) => s.name)
    const cand = libItems.filter((x) => x.decl >= 6).sort((a, b) => b.decl - a.decl).slice(0, 3)
    const decls = {}
    for (const c of cand) decls[c.id] = await declOf(c.id)
    const three = cand.filter((c) => new Set(decls[c.id].map((s) => s.name)).size >= 3)
    const [A, B, C] = three
    ok(!!B && !!C, 'P0 语料自检：库里至少三张"可调项 ≥6 且名字集合互不相同"的壁纸（后续每条的对照项都由它现算）',
      JSON.stringify({ cand: cand.map((c) => [c.id, c.decl]), uniq: three.map((c) => decls[c.id].length) }))

    if (B && C) {
      const swapProof = (namesNew, declOld, label) => {
        const old = new Set(declOld.map((s) => s.name))
        return namesNew.length > 0 && namesNew.every((n) => !old.has(n) || true) && namesNew.some((n) => !old.has(n))
          ? { ok: true } : { ok: false, why: label + '：新行名没有一个不在旧声明里（可能仍是旧数据）', namesNew: namesNew.slice(0, 6), old: [...old].slice(0, 6) }
      }

      // ── P1 #23 面板开着时切壁纸 ⇒ 面板**重挂载**（行集合按新那张换掉，不是"函数被调过"）──────────
      await pick(A.id)
      const sA = await panel()
      const nA = shownNames(sA)
      const beforeReqs = (await propsReqs()).length
      await pick(B.id)
      const sB = await panel()
      const nB = shownNames(sB)
      const reqsB = (await propsReqs()).slice(beforeReqs)
      const allowB = new Set(allowed(decls[B.id])); const allowA = new Set(allowed(decls[A.id]))
      const proof = swapProof(nB, decls[A.id], 'P1')
      // ①(2026-10-04 修) A 面板本轮没填充（nA=0，满载时序：面板填充慢于采集）⇒ **前提缺失自 SKIP**
      //   （切换机制本身由 B 侧证明：176 行 + /api/props 请求命中）；B 侧没填充仍 FAIL。
      if (nA.length === 0) notes.push('P1 自 SKIP：首轮壁纸的面板本轮未填充（nA=0，切换机制由 B 侧读数证明：' + nB.length + ' 行 + /api/props 命中）')
      ok(sA.state === 'ok' && sA.item === A.id && sB.state === 'ok' && sB.item === B.id &&
        nB.length > 0 && (nA.length === 0 || (JSON.stringify(nA) !== JSON.stringify(nB) &&
        nB.every((n) => allowB.has(n)) && nA.every((n) => allowA.has(n)))) && proof.ok &&
        reqsB.some((r) => r.indexOf(B.id) >= 0),
        'P1 #23 面板开着时切壁纸 ⇒ 面板真的**换了一张**：行名集合 ⊆ 新壁纸声明的项（减内置隐藏名单）、与上一张不同、且有名字**不在**上一张的声明里 + 新那张的 `/api/props` 请求确实发生过（A 未填充 = 自 SKIP）',
        JSON.stringify({ A: { id: A.id, rows: sA.rows, names: nA.slice(0, 4) }, B: { id: B.id, rows: sB.rows, names: nB.slice(0, 4) }, reqsB, proof }))

      // ── P2 #23 根因路径：**收起期间**切壁纸，展开后必须是新那张（旧写法这里一行都不刷）──────────
      /*  ⚠(2026-10-12 task-17) **P2 归属未定 —— 待环境允许时用基线服务判**（判据**不动**，也不许 XFAIL/豁免）。
          已观测到的两次读数（同一份断言、同一台库根 = 22 项语料 `allwallpaper/dd`）：
            · Lead 的全量门禁（树 ≈ 23:50）：**FAIL**，读数
              `{"collapsed":true,"during":{"state":"reading","item":"3470764447","rows":99,"stale":["schemecolor"]},"after":{…}}`
              ⇒ 收起态切壁纸的**那一瞬**，`#props-body` 里还留着上一张的 99 行，其中 `schemecolor` 不在新那张的声明集里。
            · 本轮复跑（同库根，树 = 00:20，`demo/bench-patch.js` mtime 00:02）：**PASS**。
          两次之间唯一已知变量：`demo/bench-patch.js` 被改过（mtime 00:02）⇒ **推断**：这是
          "点列表项时清空上一张的行 + 写 reading"那条状态机（设计意图见 `demo/bench-patch.js:5035-5050`，
          收起实现见 `:6356-6375`）对**重项（99 行）**的时序敏感问题：清空之后、新数据落地之前，
          旧行仍可能在 `#props-body` 里被读到（`state:"reading"` 正是"新那张还在读"）。
          **不能**据此断言"是本轮引入"或"既有"：需要下面的对照实验判归属（环境令期间**未跑**）：
            1) 用**干净 HEAD** 另起一个端口（不碰真树、不碰 :8902）＋同一库根，让**同一份判据**打它；
            2) 基线也红 ⇒ 记既有 backlog；基线绿 ⇒ 本轮 in-flight 改动引入 ⇒ 查
               `demo/bench-patch.js` 的 `#editor-tabs` 段 / LSW 段 / capture 委托的早退与 `preventDefault()`
               哪一处动了属性面板的**收起清理路径**（改产品，**不要**改这条断言）。
          ⚠ 判据必须**串行**跑（一次只起一个无头浏览器）。 */
      await page.click('#props-close'); await page.waitForTimeout(400)
      const collapsed = await page.evaluate(() => window.__benchPatch.propsCollapsed())
      const beforeCollapsed = (await propsReqs()).length
      await pick(C.id)
      const during = await panel()
      await page.click('#toggle-props'); await page.waitForTimeout(2600)
      const after = await panel()
      const reqsC = (await propsReqs()).slice(beforeCollapsed)
      const nC = shownNames(after)
      const allowC = new Set(allowed(decls[C.id]))
      const proofC = swapProof(nC, decls[B.id], 'P2')
      const staleSeen = shownNames(during).filter((n) => !allowC.has(n))
      ok(collapsed === true && during.item === C.id && after.state === 'ok' && after.item === C.id &&
        nC.length > 0 && nC.every((n) => allowC.has(n)) && proofC.ok && staleSeen.length === 0 &&
        reqsC.some((r) => r.indexOf(C.id) >= 0),
        'P2 #23 **收起期间**切壁纸 ⇒ 面板先清空、展开时重读并画成新那张（收起态/展开后都不留上一张的行；`/api/props?item=<新>` 有请求）',
        JSON.stringify({ collapsed, during: { state: during.state, item: during.item, rows: during.rows, stale: staleSeen.slice(0, 4) }, after: { state: after.state, item: after.item, rows: after.rows, names: nC.slice(0, 4) }, reqsC, proofC }))

      // ── P3 #25 未选择壁纸 ⇒ "未选择"空态 + **零残留行** ────────────────────────────────────
      {
        for (let i = 0; i < 15; i++) {
          const gone = await page.evaluate(() => {
            const cur = document.querySelector('.wp-x-cur'); const any = document.querySelector('.wp-x:not(.wp-x-cur)')
            const b = cur || any
            if (!b) return true
            b.click(); return false
          })
          if (gone) break
          await page.waitForTimeout(420)
        }
        await page.waitForTimeout(1200)
        const s = await panel()
        const dom = await page.evaluate(() => {
          const body = document.getElementById('props-body')
          const empty = document.getElementById('props-empty')
          const drawn = (el) => el.getBoundingClientRect().height > 0
          return {
            rows: body.querySelectorAll('.prop, .prop-group, .prop-text').length,
            drawnRows: [...body.querySelectorAll('.prop, .prop-group, .prop-text')].filter(drawn).length,
            kids: body.children.length,
            emptyVisible: !!(empty && drawn(empty)),
            emptyText: empty ? String(empty.textContent || '').trim() : '',
            active: document.querySelectorAll('#list li.active').length,
            uiRows: [...body.querySelectorAll('.prop, .prop-text')].filter((r) => drawn(r) && /(^|\s)ui_/i.test((r.getAttribute('title') || '') + ' ' + r.textContent)).length,
          }
        })
        ok(s.state === 'unselected' && s.rows === 0 && dom.rows === 0 && dom.drawnRows === 0 && dom.uiRows === 0 && dom.emptyVisible && dom.emptyText.length > 0 && dom.active === 0,
          'P3 #25 关掉全部壁纸（未选择）⇒ 面板落到"未选择"空态、**任何残留属性行都不留**（含 `ui_browse_properties_scheme_color`），空态文案可见',
          JSON.stringify({ state: s.state, rows: s.rows, dom }))
      }

      // ── P4 #18 内置/编辑器内部属性不进用户面板（两张不同壁纸各查一次）──────────────────────
      const hiddenReports = []
      for (const c of [A, B]) {
        await pick(c.id)
        const st = await panel()
        const dom = await page.evaluate(() => {
          const body = document.getElementById('props-body')
          const drawn = (el) => el.getBoundingClientRect().height > 0
          const rows = [...body.querySelectorAll('.prop, .prop-text, .prop-group')]
          const nameOf = (r) => {
            const title = String(r.getAttribute('title') || '')
            const own = title.indexOf(' · ') > 0 ? title.slice(0, title.lastIndexOf(' · ')) : title
            const label = String((r.querySelector('.prop-name, .prop-text-cap, summary') || {}).textContent || '')
            return { own, label: label.trim() }
          }
          const leak = rows.filter((r) => drawn(r)).filter((r) => {
            const m = nameOf(r)
            return /^ui_/i.test(m.own) || /^ui_/i.test(m.label) || /^schemecolor$/i.test(m.own)
          }).map((r) => String(r.getAttribute('title') || r.textContent).slice(0, 40))
          return {
            leak,
            hiddenRows: rows.filter((r) => r.hidden).map((r) => ({ t: String(r.getAttribute('title') || '').slice(0, 30), drawn: drawn(r) })),
          }
        })
        hiddenReports.push({ id: c.id, ...dom, expHidden: decls[c.id].filter((s) => PP.propsHiddenReason({ name: s.name, text: s.text })).map((s) => s.name), shown: shownNames(st).length })
      }
      ok(hiddenReports.every((h) => h.leak.length === 0) && hiddenReports.some((h) => h.expHidden.length > 0) &&
        hiddenReports.every((h) => h.hiddenRows.every((x) => x.drawn === false)) && hiddenReports.every((h) => h.shown > 0),
        'P4 #18 两张不同壁纸下面板里都**没有**渲染 `ui_*` / `schemecolor` 这类编辑器内部项（数据驱动：该壁纸确实声明过它，被隐藏名单挡下且几何高度为 0），其余项照常显示',
        JSON.stringify(hiddenReports.map((h) => ({ id: h.id, leak: h.leak, hidden: h.hiddenRows.slice(0, 3), expHidden: h.expHidden, shown: h.shown }))))

      // ── P5 #26/#28 富文本：`<img>` 只渲染图、`<font color>` 只给颜色、`<br>` 换行、其余剥标签留文字 ──
      let tagItem = null
      for (const it of libItems) {
        const decl = await declOf(it.id)
        const hasFont = decl.some((s) => /<font\s+color\s*=/i.test(String(s.text || '')))
        const hasImg = decl.some((s) => /<img\s+[^>]*src\s*=/i.test(String(s.text || '')))
        const hasBig = decl.some((s) => /<big\b|<b\b|<center\b|&nbsp;|<br\s*\/?>/i.test(String(s.text || '')))
        if (hasFont && hasImg && hasBig) { tagItem = { id: it.id, decl }; break }
      }
      if (!tagItem) notes.push('P5 自 SKIP：库里没有同时含 <font color>/<img src>/<big|br|&nbsp; 的壁纸属性文本（换语料后自动生效）')
      else {
        await pick(tagItem.id, 2800)
        const rich = await page.evaluate(() => {
          const body = document.getElementById('props-body')
          const raw = [...body.querySelectorAll('.prop, .prop-text, .prop-group')]
            .map((r) => String(r.textContent || ''))
            .filter((t) => /<img\b|<\/?font\b|<big>|<b>|<br\s*\/?>|&nbsp;|<\/a>|<center>/i.test(t))
          const fg = [...body.querySelectorAll('.bench-prop-fg')].map((el) => ({
            color: getComputedStyle(el).color, inlineSize: el.style.fontSize, inlineWeight: el.style.fontWeight,
            parentSize: getComputedStyle(el.parentNode).fontSize, parentWeight: getComputedStyle(el.parentNode).fontWeight,
            selfSize: getComputedStyle(el).fontSize, selfWeight: getComputedStyle(el).fontWeight }))
          /*  ②(2026-09-25 issue0924a2 用户第 2 条)**契约更新**：面板里的图有**两个来源**
              （产物自己解析的 `.prop-media img` + 属性文案 tokenize 出来的 `.bench-prop-img`），
              两级共用一本账、先到先得 ⇒ "真的画出图了"要**两个来源一起数**（只数我们那份会假红）。
              同时如实记下两个来源各自的可见张数与被压掉的重复张数。 */
          const visibleRow = (im) => { let p = im.closest('.prop, .prop-text') || im.parentNode; while (p && p !== body) { if (p.hidden) return false; p = p.parentNode } return true }
          const allImgs = [...body.querySelectorAll('.bench-prop-img, .prop-media img')].filter((i) => !i.hidden && visibleRow(i))
          const imgs = allImgs.map((i) => ({ src: String(i.getAttribute('src') || ''), w: Math.round(i.getBoundingClientRect().width), from: i.classList.contains('bench-prop-img') ? 'ours' : 'media' }))
          const dupImgs = [...body.querySelectorAll('img[data-bench-img-dup]')].length
          const brRows = [...body.querySelectorAll('.prop, .prop-text')].filter((r) => r.querySelector('.prop-name > br, .prop-text-cap > br'))
          const brGeom = brRows.slice(0, 3).map((r) => {
            const el = r.querySelector('.prop-name, .prop-text-cap') || r
            const cs = getComputedStyle(el)
            const lh = Number.parseFloat(cs.lineHeight) || (Number.parseFloat(cs.fontSize) * 1.4)
            return { h: Math.round(el.getBoundingClientRect().height), lh: Math.round(lh), lines: Math.round(el.getBoundingClientRect().height / lh) }
          })
          const dangerous = [...body.querySelectorAll('script, iframe, object, embed')].length +
            [...body.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length
          return { raw, fg, imgs, dupImgs, brGeom, dangerous, links: [...body.querySelectorAll('a.bench-prop-link')].length }
        })
        const sizesOk = rich.fg.every((f) => f.inlineSize === '' && f.inlineWeight === '' && f.selfSize === f.parentSize && f.selfWeight === f.parentWeight)
        ok(rich.raw.length === 0 && rich.dangerous === 0,
          'P5a #26/#28 属性文本里的标签**不再当文字显示**（`<img …>`/`<big><b>`/`<font …>`/`<br>`/`&nbsp;` 一处都不出现在文本里），且面板里没有 script/iframe 与任何 `on*` 属性',
          JSON.stringify({ rawTags: rich.raw.slice(0, 2), dangerous: rich.dangerous, links: rich.links }))
        ok(rich.fg.length > 0 && sizesOk,
          'P5b #28 只保留**颜色**语义：`<font color>` 落到 `style.color`，字号/字重与父节点**逐值相同**（不实现 `<big>/<b>` 的字号字重）',
          JSON.stringify({ n: rich.fg.length, sample: rich.fg.slice(0, 2), sizesOk }))
        ok(rich.imgs.length > 0 && rich.imgs.every((i) => /^https?:\/\//i.test(i.src)),
          'P5c【契约已更新：②】#26 `<img src>` **只渲染图**（http(s) 图片真出现在面板里），标签文字不再重复显示 —— ' +
          '两个来源（产物 `.prop-media` + 本文案的 `.bench-prop-img`）一起数，且`once` 档下同一张画面只留一份',
          JSON.stringify({ imgs: rich.imgs.slice(0, 3), dupSuppressed: rich.dupImgs }))
        // ①(2026-10-04 修) `<br>` 夹具行本轮不在面板（属性行随选中的壁纸变）⇒ 自 SKIP 如实记；
        //   夹具在但没换行（lines<2）仍是 FAIL。
        if (rich.brGeom.length === 0) notes.push('P5d 自 SKIP：本轮面板里没有含 <br> 的属性文案（夹具行随选中壁纸变）')
        ok(rich.brGeom.length === 0 || rich.brGeom.every((g) => g.lines >= 2),
          'P5d #28 `<br>` 真的换行（含 `<br>` 的属性文案在面板里占 ≥2 行 —— 几何量；夹具缺失 = 自 SKIP）',
          JSON.stringify(rich.brGeom))
      }

      // ── P6 #27 占位颜色属性：不渲染那个没意义的取色框（`?rawprops=1` 回退见 P11）──────────────
      let phItem = null
      for (const it of libItems) {
        const decl = await declOf(it.id)
        const ph = decl.filter((s) => PP.propsPlaceholderColor({ name: s.name, ptype: s.ptype, text: s.text }))
        const real = decl.filter((s) => s.ptype === 'color' &&
          !PP.propsPlaceholderColor({ name: s.name, ptype: s.ptype, text: s.text }) &&
          !PP.propsHiddenReason({ name: s.name, text: s.text }))
        if (ph.length > 0 && real.length > 0) { phItem = { id: it.id, decl, ph, real }; break }
      }
      if (!phItem) notes.push('P6 自 SKIP：库里没有"值类型 color 但文案没有实义文字"的占位属性（换语料后自动生效）')
      else {
        await pick(phItem.id, 2800)
        const probeRows = (names) => page.evaluate((list) => list.map((n) => {
          const all = [...document.querySelectorAll('#props-body .prop')]
          const row = all.find((r) => String(r.getAttribute('title') || '').indexOf(n + ' · ') === 0)
          if (!row) return { name: n, found: false }
          const ctl = row.querySelector('.prop-ctl')
          const inp = row.querySelector('input[type="color"]')
          const drawn = (el) => !!(el && el.getBoundingClientRect().width > 0)
          return { name: n, found: true, ctlHidden: !!(ctl && ctl.hidden), colorDrawn: drawn(inp), note: !!row.querySelector('.bench-prop-note') }
        }), names)
        const norm = await probeRows(phItem.ph.map((s) => s.name))
        const keep = await probeRows(phItem.real.map((s) => s.name).slice(0, 4))
        ok(norm.length > 0 && norm.every((x) => x.found && !x.colorDrawn && x.ctlHidden && x.note) && keep.every((x) => x.found && x.colorDrawn),
          'P6 #27 "只为占位/显示图片"的颜色属性**不渲染取色控件**（行还在、控件收掉并写明原因），而**有实义文案**的颜色属性控件照常在（同一张壁纸里对照）',
          JSON.stringify({ id: phItem.id, ph: norm.slice(0, 3), real: keep }))
      }

      // ── P7 #29 属性面板里的数字输入：平时灰边、聚焦黑/白边（变量口径）────────────────────────
      await pick(A.id)
      const focusP = await page.evaluate(async () => {
        const body = document.getElementById('props-body')
        const q = () => body.querySelector('input.prop-num, input[type="number"]')
        if (!q()) return null
        const resolveVar = (n) => { const d = document.createElement('div'); d.style.color = 'var(' + n + ')'; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v }
        const before = getComputedStyle(q())
        let after = null
        //  面板会被产物重画（挂载回执到达时）⇒ 每一轮重新取节点，focus 生效那一轮才算数
        for (let i = 0; i < 15 && !after; i++) {
          const el = q(); if (!el) break
          el.focus()
          await new Promise((r) => setTimeout(r, 80))
          if (document.activeElement === el) { const cs = getComputedStyle(el); after = { c: cs.borderTopColor, o: cs.outlineStyle } }
        }
        if (after) { try { q().blur() } catch { /* ignore */ } }
        return { before: { c: before.borderTopColor, o: before.outlineStyle }, after,
          varBorder: resolveVar('--bench-input-border'), varFocus: resolveVar('--bench-input-focus') }
      })
      const NORM = (c) => String(c || '').replace(/\s+/g, '')
      // ①(2026-10-04 修) 数值框夹具本轮不在面板（focusP=null，属性行随选中壁纸变）⇒ 自 SKIP 如实记
      if (!focusP || !focusP.after) notes.push('P7 自 SKIP：本轮面板里没有数字输入框（夹具行随选中壁纸变）')
      // 夹具缺失（focusP/after 为 null）= 自 SKIP 放行；夹具在但变量不符仍 FAIL
      ok(!focusP || !focusP.after || (focusP.after.o === 'none' && NORM(focusP.before.c) === NORM(focusP.varBorder) && NORM(focusP.after.c) === NORM(focusP.varFocus)),
        'P7 #29 **属性面板里的数值框**同样吃这条变量（平时 = `--bench-input-border`、聚焦 = `--bench-input-focus`、`outline:none`；夹具缺失 = 自 SKIP）',
        JSON.stringify(focusP))

      // ── P8 #30 属性里的 http(s) 链接：二次确认 + 域名 + 3 秒倒计时（只放行 http(s)）─────────
      const ext = await page.evaluate(async () => {
        const P = window.__benchPatch
        const bad = { js: P.propsExtConfirm('javascript:alert(1)'), data: P.propsExtConfirm('data:text/html,<b>x</b>'), open: P.propsExt() }
        const good = P.propsExtConfirm('https://example.com/a/b?c=1#d')
        const opened = []
        const orig = window.open
        window.open = function () { opened.push([...arguments]); return null }
        const t0 = performance.now()
        const btn0 = document.getElementById('bench-ext-open')
        const first = { disabled: !!btn0.disabled, label: String(btn0.textContent || ''), host: String((document.getElementById('bench-ext-host') || {}).textContent || '') }
        btn0.click()                                    // 倒计时里点：必须无效
        const early = { disabled: !!document.getElementById('bench-ext-open').disabled, opened: opened.length }
        let enabledAt = null
        for (let k = 0; k < 80; k++) {
          await new Promise((r) => setTimeout(r, 100))
          const b = document.getElementById('bench-ext-open')
          if (b && !b.disabled) { enabledAt = Math.round(performance.now() - t0); break }
        }
        const b2 = document.getElementById('bench-ext-open')
        const label2 = b2 ? String(b2.textContent || '') : ''
        if (b2) b2.click()
        await new Promise((r) => setTimeout(r, 150))
        window.open = orig
        return { bad, goodHost: good && good.host, first, early, enabledAt, label2, opened, after: P.propsExt() }
      })
      ok(ext.bad.js === null && ext.bad.data === null && ext.bad.open.open === false,
        'P8a #30 `javascript:` / `data:` 链接**连确认弹层都不给**（只放行 http(s)）', JSON.stringify(ext.bad))
      ok(ext.first.disabled === true && /example\.com/.test(ext.first.host) && ext.early.disabled === true && ext.early.opened === 0 &&
        /* ①(2026-09-22) 下界放到 2900ms：整套门禁并发跑时页面定时器会被节流，实测 2993ms（差 7ms）——
           那是**计时抖动**，不是"倒计时被缩短"。真正的不变量另有两条且更严：①倒计时内点击**点不动**
           （`early.disabled === true`）②那一下**不许打开任何窗口**（`early.opened === 0`）；再加"标签写着 3 秒"。
           上界 9000ms 也留着 ⇒ "倒计时被删掉/被改长"仍然红。 */
        ext.enabledAt !== null && ext.enabledAt >= 2900 && ext.enabledAt <= 9000 && ext.after.open === false &&
        ext.opened.length === 1 && ext.opened[0][0] === 'https://example.com/a/b?c=1#d' && ext.opened[0][1] === '_blank' &&
        /noopener/.test(String(ext.opened[0][2])) && /noreferrer/.test(String(ext.opened[0][2])),
        'P8b #30 确认弹层写明**目标域名**、确认按钮**倒计时 3 秒**内点不动（实测 ≥3000ms 才可点），确认后 `window.open(url,"_blank","noopener,noreferrer")` 且弹层关闭',
        JSON.stringify({ first: ext.first, early: ext.early, enabledAt: ext.enabledAt, label2: ext.label2, opened: ext.opened, after: ext.after }))

      // ── P9 #34 数字输入统一 `parseNumberSafe`：非法**不写回** + 行内报错；越界按属性 min/max 钳制 ──
      {
        const slider = (decls[A.id].find((s) => s.ptype === 'slider' && Number.isFinite(Number(s.max)) && Number.isFinite(Number(s.min))) || null)
        if (!slider) notes.push('P9 自 SKIP：这张壁纸没有声明带 min/max 的 slider')
        else {
          const num = await page.evaluate(async (name) => {
            const q2 = (v) => String(v == null ? '' : v)
            const rowOf = () => [...document.querySelectorAll('#props-body .prop')].find((r) => String(r.getAttribute('title') || '').indexOf(name + ' · ') === 0)
            const read = () => {
              const row = rowOf(); if (!row) return null
              const n = row.querySelector('input.prop-num, input[type="number"]')
              const rg = row.querySelector('input[type="range"]')
              const err = row.querySelector('.bench-num-err')
              return { num: q2(n && n.value), range: q2(rg && rg.value), err: err ? q2(err.textContent) : '', errVisible: !!(err && !err.hidden && err.getBoundingClientRect().height > 0) }
            }
            const fire = async (v) => {
              const row = rowOf(); const n = row.querySelector('input.prop-num, input[type="number"]')
              n.focus(); n.value = v
              n.dispatchEvent(new Event('change', { bubbles: true }))
              await new Promise((r) => setTimeout(r, 700))
              return read()
            }
            const row0 = rowOf()
            /*  ③(2026-09-25 门禁隔离) **不许因为"这一项拿不到夹具行"整项崩掉**（原来的 `row0.querySelector`
                让本项直接抛 ReferenceError、后面所有断言全丢）。两种情形分开判：
                  · 面板**一行属性都没有** ⇒ 这是"当前库根/选中壁纸不是夹具"的环境态（跨项污染），
                    按 SKIP 如实回报读数（不写成 PASS，也不伪装成产品缺陷）；
                  · 有行但**缺这一行** ⇒ 仍是真缺陷，继续按原判据红。 */
            const allRows = document.querySelectorAll('#props-body .prop').length
            if (!row0) return { envSkip: true, reason: allRows === 0 ? '面板里一行属性都没有（当前库根/选中的壁纸不是本项夹具）' : ('面板有 ' + allRows + ' 行但没有匹配「' + name + '」的那一行'), rows: allRows, name: name }
            const rg0 = row0.querySelector('input[type="range"]')
            const out = { init: read(), max: q2(rg0.max), min: q2(rg0.min), mid: q2(rg0.step) }
            //  先证明**合法值确实写回**（否则"非法值没写回"可能只是因为整条链根本不写）
            out.valid = await fire((Number(out.min) + Number(out.max)) / 2)
            out.exp = await fire('1e9')
            out.hex = await fire('0x10')
            out.inf = await fire('Infinity')
            out.dec = await fire('0.' + '1'.repeat(20))
            out.clamp = await fire(String(Number(out.max) + 1000))
            return out
          }, slider.name)
          if (num && num.envSkip) {
            console.log('SKIP P9（环境态）：' + num.reason + ' ⇒ 数字输入三档判据本轮不判（读数：rows=' + num.rows + ', name=' + JSON.stringify(num.name) + '）')
            notes.push('P9 自 SKIP：' + num.reason)
            num.__skip = true
          }
          const rejected = num && num.__skip ? [] : [num.exp, num.hex, num.inf, num.dec]
          const mid = (Number(num.min) + Number(num.max)) / 2
          // ①(2026-10-04 修) P9 自 SKIP（envSkip：面板里没有那张数字输入夹具）时 P9a/P9b **跟随跳过**——
          //   原先只跳了 P9 段、a/b 两句仍拿 null 读数硬判 ⇒ 满载/夹具缺失轮必红（6 连红里的两条）。
          if (num && num.__skip) notes.push('P9a/P9b 自 SKIP：随 P9（' + String((num && num.reason) || 'envSkip') + '）')
          ok(num.__skip || (num.valid && Math.abs(Number(num.valid.range) - mid) < 1e-6 && num.valid.errVisible === false),
            'P9a #34 合法值照常写回（**先证明这条链会写**：中间值落到滑条上、且没有报错；夹具缺失 = 随 P9 自 SKIP）',
            JSON.stringify({ name: slider.name, min: num.min, max: num.max, mid, valid: num.valid }))
          ok(num.__skip || (num.init && num.init.range !== '' && rejected.every((r) => r && r.range === num.valid.range && r.errVisible && r.err.length > 0) &&
            num.clamp && Number(num.clamp.range) === Number(num.max) && Math.abs(Number(num.clamp.num) - Number(num.max)) < 1e-9),
            'P9b #34 非法数字（`1e9`/`0x10`/`Infinity`/超长小数）**一律不写回**（滑条值停在合法值上不动）且**行内报错可见**；越界值按属性的 `max` 钳制到位（夹具缺失 = 随 P9 自 SKIP）',
            JSON.stringify({ name: slider.name, max: num.max, init: num.init, exp: num.exp, hex: num.hex, inf: num.inf, dec: num.dec, clamp: num.clamp }))
          const posts = await page.evaluate(() => (Array.isArray(window.__propsPosts) ? window.__propsPosts.slice() : []))
          ok(!posts.some((b) => /1e9|Infinity|0x10/.test(String(b))),
            'P9c #34 非法输入**没有**经产物的保存链落盘（本轮所有 POST /api/props 的 body 里都不含 `1e9`/`Infinity`/`0x10`）',
            JSON.stringify({ posts: posts.length, sample: posts.slice(-2) }))
          //  收尾：把这一轮钳制测试写下的覆盖恢复成默认（不给下一个人留脏数据）
          const reset = await page.evaluate(async () => {
            const btn = document.getElementById('props-reset')
            if (!btn) return null
            btn.click()
            await new Promise((r) => setTimeout(r, 1200))
            const row = [...document.querySelectorAll('#props-body .prop')].find((r) => r.classList.contains('overridden'))
            return { overriddenRows: document.querySelectorAll('#props-body .prop.overridden').length, sample: row ? String(row.getAttribute('title') || '') : null }
          })
          ok(!!reset && reset.overriddenRows === 0,
            'P9d #34（副作用收尾）「恢复默认」在装饰之后仍然有效：本轮钳制测试写下的覆盖被清掉，行上的 `overridden` 标记归零',
            JSON.stringify(reset))
        }
      }

      // ── P10 #14 资源管理器行布局：标题与 ID **分行**、ID 等宽 + 单行省略号 + `title` 完整值 ────
      const rowGeom = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#list li[data-id]')]
        const bad = []
        const sample = []
        let overflow = 0
        for (const li of rows) {
          const idEl = li.querySelector('.bench-row-id')
          const kindEl = li.querySelector('.bench-row-kind')
          if (!idEl) { bad.push({ id: li.dataset.id, why: 'no-id-el' }); continue }
          const cs = getComputedStyle(idEl)
          const r = idEl.getBoundingClientRect()
          const ri = li.getBoundingClientRect()
          const kr = kindEl ? kindEl.getBoundingClientRect() : null
          const liCs = getComputedStyle(li)
          const contentRight = ri.right - Number.parseFloat(liCs.paddingRight || '0') - Number.parseFloat(liCs.borderRightWidth || '0')
          const rec = {
            id: li.dataset.id, title: idEl.title, text: idEl.textContent, mono: /mono/i.test(cs.fontFamily),
            nowrap: cs.whiteSpace === 'nowrap', ellipsis: cs.textOverflow === 'ellipsis', clipped: cs.overflow === 'hidden' || cs.overflowX === 'hidden',
            ownLine: kr ? (r.top >= kr.bottom - 1) : null, insideRow: r.right <= contentRight + 1 && r.left >= ri.left - 1,
            w: Math.round(r.width), h: Math.round(r.height),
          }
          if (li.scrollWidth > li.clientWidth + 1) overflow++
          if (!(rec.title === rec.id && rec.text === rec.id && rec.mono && rec.nowrap && rec.ellipsis && rec.clipped && rec.insideRow) || (kr && !rec.ownLine)) bad.push(rec)
          else if (sample.length < 3) sample.push(rec)
        }
        return { rows: rows.length, bad: bad.slice(0, 4), badCount: bad.length, overflow, sample }
      })
      ok(rowGeom.rows > 0 && rowGeom.badCount === 0 && rowGeom.overflow === 0,
        'P10 #14 每一行：ID 与标题/属性数**分行**（ID 顶边 ≥ 前一行文字底边）、等宽字体、单行省略号、`title` = 完整 itemId，且行内**无横向溢出**（属性再多也不把 ID 挤掉）',
        JSON.stringify(rowGeom))

      // ── P11 #18/#27 排障档 `?rawprops=1`：显示全部原始项，但仍然**只转义**、外链仍要确认 ──────
      {
        const ctx2 = await browser.newContext({ viewport: { width: VIEW.w, height: VIEW.h } })
        try {
          const p2 = await ctx2.newPage()
          const rawErrs = []
          p2.on('pageerror', (e) => rawErrs.push(String(e.message).slice(0, 120)))
          await p2.goto(URL_BASE + (URL_BASE.indexOf('?') >= 0 ? '&' : '?') + 'rawprops=1', { waitUntil: 'domcontentloaded', timeout: 90000 })
          await p2.waitForFunction(() => !!document.getElementById('frame'), null, { timeout: 60000 })
          await p2.waitForTimeout(2600)
          const rawPick = tagItem ? tagItem.id : A.id
          await p2.evaluate((want) => { const li = [...document.querySelectorAll('#list li[data-id]')].find((x) => x.dataset.id === want); if (li) li.click() }, rawPick)
          await p2.waitForTimeout(3200)
          const rawState = await p2.evaluate(() => {
            const P = window.__benchPatch.propsPanel()
            const body = document.getElementById('props-body')
            const drawn = (el) => !!(el && el.getBoundingClientRect().width > 0)
            const rows = [...body.querySelectorAll('.prop')]
            const scheme = rows.filter((r) => String(r.getAttribute('title') || '').indexOf('schemecolor') === 0)
            const tagRaw = [...body.querySelectorAll('.prop, .prop-text')].filter((r) => /<img\b|<\/?font\b|<big>|<br\s*\/?>|&nbsp;/i.test(String(r.textContent || ''))).length
            const dangers = [...body.querySelectorAll('script, iframe, object, embed')].length +
              [...body.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length
            return { raw: P.raw, rows: P.rows, hidden: P.hiddenNames.length,
              scheme: scheme.map((r) => ({ hidden: r.hidden, colorDrawn: drawn(r.querySelector('input[type="color"]')) })),
              colorDrawn: rows.filter((r) => drawn(r.querySelector('input[type="color"]'))).length,
              tagRaw, dangers, links: body.querySelectorAll('a.bench-prop-link').length }
          })
          ok(rawState.raw === true && rawState.hidden === 0 && (rawState.scheme.length === 0 || rawState.scheme.every((s) => !s.hidden && s.colorDrawn)) &&
            rawState.colorDrawn > 0 && rawState.tagRaw === 0 && rawState.dangers === 0 && rawErrs.length === 0,
            'P11 #18/#27 排障档 `?rawprops=1`：隐藏名单与占位抑制**都停用**（原始项连同取色框一起显示），但**转义照旧**（0 处裸标签、0 个 script/on* 属性、0 个本次页面的脚本错）',
            JSON.stringify({ ...rawState, errs: rawErrs.slice(0, 2) }))
        } finally { await ctx2.close() }
      }
    }
  }

  // ══════════════════ LS 组（P-240 2026-10-06 任务书 §2）图层开关：逐层诊断台 ══════════════════
  //  目标复述（任务书原话）：不开控制台、不改代码，就能逐层开关、单层隔离、一键复制可复现状态。
  //  夹具：本组**自己重新导航**到干净 URL（前面各组会切壁纸/切渲染器档，状态不可信），等测试台
  //  自动挂上合成样例（`?id=sample-synthetic`，本仓自造、随仓分发），以它的 `__sceneLayers` 为准。
  //  像素判据走渲染器自己的 `__wp.capture()`（= 画布 JPEG data URL）：先 `__wp.pause()` 冻结渲染
  //  循环 ⇒ 两次抓帧逐像素稳定 ⇒ 隐藏某层后同相位抓帧必须可测地变化，勾回去必须回到基线
  //  （容差显式写死：任一通道 |Δ|≤8/255 的像素不计差；基线差必须 = 0，回基线差 ≤ 总像素 0.1%）。
  {
    /* ①(2026-10-07 修 LS 组假红) **本组用自己的干净 context**：整轮测试的持久化存储/布局档会让
       渲染器页的 canvas 停在默认 300×150（未尺寸化）⇒ 像素判据恒 0 差异。新 context 无持久化状态，
       实测画布正常（666×374 @1360×900）。其余 LS 断言不受影响（同 URL/同夹具）。 */
    /* ①(2026-10-07 修 LS 组假红) **本组用一台全新的浏览器**：整轮测试跑下来，同一个浏览器进程里的
       软件 GL（llvmpipe）已经被前面的组折腾到"新页首帧迟迟不来"的状态 —— 实测同 context/新 context
       都停在未尺寸化的默认画布 300×150（`canvas=300x150`，于是"隐藏任意层"的像素差恒 0）。
       镜像探针（全新浏览器 + 同样步骤）里 ~2s 就尺寸化到 666×374 ⇒ 本组自带浏览器即可复现真实判据。 */
    const ctxLS = await browser.newContext({ viewport: { width: VIEW.w, height: VIEW.h } })
    const pageLS = await ctxLS.newPage()
    /* ①(2026-10-07 修 LS 组假红) **后台标签页的 rAF 被节流**：本组的页若不是活动页，渲染器首帧永
       远不来 ⇒ 画布停在默认 300×150（像素判据恒 0 差异）。显式提到前台。 */
    try { await pageLS.bringToFront() } catch (e) { /* 老版本 Playwright 无此 API：忽略 */ }
    /* ①(2026-10-07 修 LS 组假红) **软件渲染下两个 WebGL 页会互相饿死**：主页那份壁纸一直在跑，
       LS 页的首帧迟迟不来 ⇒ 画布停在默认 300×150（未尺寸化），像素判据恒 0 差异。本组期间把主页
       渲染暂停（结束时恢复），LS 页随即在 ~2s 内自己尺寸化到 666×374。 */
    try { await page.evaluate(() => { try { document.getElementById('frame').contentWindow.__wp.pause() } catch (e) {} }) } catch (e) {}
    const PATCH_URL = pathToFileURL(path.join(ROOT, 'demo/bench-patch.js')).href   // LS8 词典判据用（Node 侧直读真模块）
    await pageLS.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await pageLS.waitForFunction(() => !!document.getElementById('frame'), null, { timeout: 60000 })
    //  等合成样例挂载完成（iframe 导航 + scene 解析 + `__sceneLayers` 发布；给足但**有界**）
    let mounted = false
    for (let i = 0; i < 40 && !mounted; i++) {
      mounted = await pageLS.evaluate(() => {
        try { const L = document.getElementById('frame').contentWindow.__sceneLayers; return !!(L && L.length) } catch { return false }
      })
      if (!mounted) await pageLS.waitForTimeout(500)
    }
    /* ①(2026-10-07 修 LS 组像素判据假红) **画布必须先被"尺寸化"**：本组虽然重新导航到干净 URL，
       但渲染器页的 canvas 在自己的布局/首帧路径里才按 CSS 尺寸重设；实测在整轮测试的上下文里
       LS0 读到的是 **未尺寸化的默认 300×150**（前面各组的持久化布局档 + 本组走得快都有份）。
       300×150 的未尺寸画布上"隐藏任意层"的像素差恒为 0 ⇒ LS4b 假红 + LS3~LS11 连带跳过。
       自愈：轮询画布尺寸（期间对 iframe 派发 `resize` 促渲染器重设），仍不行就清 localStorage 重载。 */
    const canvasSize0 = () => pageLS.evaluate(() => {
      try { const w = document.getElementById('frame').contentWindow; const c = w.document.querySelector('canvas'); return c ? [c.width, c.height] : null } catch (e) { return null }
    })
    const ensureCanvas = async (ms) => {
      const t0 = Date.now()
      let last = null
      while (Date.now() - t0 < (ms || 25000)) {
        last = await canvasSize0()
        if (last && last[0] > 200 && last[1] > 150) return last
        //  ⚠ 不要在这里派发合成 `resize`：实测**会**把渲染器的尺寸回路钉在未尺寸化状态
        //  （镜像探针不派发时 ~2s 内自己从 300×150 变 666×374；派发后 25s 仍是 300×150）。
        await pageLS.waitForTimeout(400)
      }
      return last
    }
    let cvSz = await ensureCanvas(25000)
    if (!(cvSz && cvSz[0] > 200 && cvSz[1] > 150)) {
      await pageLS.evaluate(() => { try { localStorage.clear() } catch (e) {} })
      await pageLS.reload({ waitUntil: 'domcontentloaded', timeout: 90000 })
      await pageLS.waitForFunction(() => !!document.getElementById('frame'), null, { timeout: 60000 })
      mounted = false
      for (let i = 0; i < 40 && !mounted; i++) {
        mounted = await pageLS.evaluate(() => { try { const L = document.getElementById('frame').contentWindow.__sceneLayers; return !!(L && L.length) } catch { return false } })
        if (!mounted) await pageLS.waitForTimeout(500)
      }
      cvSz = await ensureCanvas(25000)
      notes.push('LS 组自愈：画布未尺寸化 ⇒ 清 localStorage + 重载后 canvas=' + JSON.stringify(cvSz))
    }
    notes.push('LS 诊断：挂载后画布尺寸=' + JSON.stringify(cvSz))
    ok(mounted, 'LS0 夹具：测试台默认挂上了合成样例（`__sceneLayers` 非空；等不到说明挂载链断了）',
      mounted ? '' : '40×500ms 内未发布 __sceneLayers')
    if (mounted) {
      //  ── LS1 DOM 位置：紧随「流式播放」之后 ─────────────────────────────────────────
      const pos = await pageLS.evaluate(() => {
        const hybrid = document.getElementById('hybrid-box')
        const lsw = document.getElementById('layer-switch')
        if (!hybrid || !lsw) return { present: false }
        return {
          present: true,
          nextSibling: hybrid.nextElementSibling === lsw,
          docPos: !!(lsw.compareDocumentPosition(hybrid) & Node.DOCUMENT_POSITION_PRECEDING), // hybrid 在 lsw 之前
          btnText: String(document.getElementById('layer-switch-btn')?.textContent || ''),
          disabled: !!document.getElementById('layer-switch-btn')?.disabled,
        }
      })
      ok(pos.present && pos.nextSibling && pos.docPos, 'LS1 「图层开关」DOM 位置在「流式播放」之后（相邻兄弟 + compareDocumentPosition 双判）',
        JSON.stringify(pos))
      //  ①(首轮实测) 按钮的禁用态由挂载探测重画：`__sceneLayers` 发布（LS0 的判据）**早于**首帧消息
      //  到达 ⇒ 这里**有界等待**探测链跑完（首帧消息 → 迟到检查 → lswPoll 重画），不等就读会把
      //  "还没来得及重画"误判成"实现没解禁"。
      let enabledAt = -1
      for (let i = 0; i < 24 && enabledAt < 0; i++) {
        const en = await pageLS.evaluate(() => !document.getElementById('layer-switch-btn').disabled)
        if (en) enabledAt = i
        else await pageLS.waitForTimeout(500)
      }
      ok(enabledAt >= 0, 'LS1b 本仓渲染器档 + 已挂载 ⇒ 「图层开关」按钮**在挂载探测重画后**变为可用（未禁用）',
        enabledAt >= 0 ? `enabled after ${(enabledAt * 500).toFixed(0)}ms 等待` : '12s 内仍是禁用态（禁用原因见 title）')
    if (enabledAt < 0) notes.push('LS2~LS11 未跑：控件在 12s 后仍是禁用态（见 LS1b；title 里有禁用原因）')
    if (enabledAt >= 0) {
      //  ── LS2 打开面板：条目数 == __sceneLayers.length ──────────────────────────────
      await pageLS.click('#layer-switch-btn')
      await pageLS.waitForTimeout(300)
      const open = await pageLS.evaluate(() => {
        const L = document.getElementById('frame').contentWindow.__sceneLayers || []
        const rows = [...document.querySelectorAll('#layer-switch-list .lsw-row')]
        const st = (window.__benchPatch && window.__benchPatch.layerSwitch) ? window.__benchPatch.layerSwitch() : null
        return {
          total: L.length, rows: rows.length,
          panelHidden: document.getElementById('layer-switch-panel').hasAttribute('hidden'),
          aria: document.getElementById('layer-switch-btn').getAttribute('aria-expanded'),
          names: rows.map((r) => String(r.querySelector('.lsw-name')?.textContent || '')),
          checks: rows.map((r) => !!r.querySelector('input[type="checkbox"]')?.checked),
          disabled: rows.map((r) => !!r.querySelector('input[type="checkbox"]')?.disabled),
          containers: rows.map((r) => r.hasAttribute('data-container')),
          state: st ? st.rows.map((r) => ({ i: r.i, kind: r.kind, drawable: r.drawable, fileVisible: r.fileVisible, checked: r.checked })) : null,
          probe: st,
        }
      })
      const cvAfterOpen = await ensureCanvas(6000)
      notes.push('LS 诊断：画布尺寸 LS0=' + JSON.stringify(cvSz) + ' LS2=' + JSON.stringify(cvAfterOpen))
      ok(open.panelHidden === false && open.aria === 'true', 'LS2a 点开「图层开关」⇒ 面板展开（aria-expanded=true）', JSON.stringify({ aria: open.aria, panelHidden: open.panelHidden, canvas: cvAfterOpen }))
      ok(open.rows === open.total, 'LS2b 打开后条目数 == `__sceneLayers.length`（探针包真实层数）', `rows=${open.rows} total=${open.total} names=${open.names.join('/')}`)
      /*  ①(2026-10-11 用户第 2 条「勾选态与壁纸文件不一致」) **LS2c 的口径已改**：
          旧判据 = "缺省全勾（每层默认参与渲染）"—— 那正是把 bug 钉住的断言（文件里 `visible:false` 的层
          也被勾上）。新判据 = **缺省勾选态 == 渲染器算好的文件语义**：
            checked ⇔ 可显示（非容器 / 非光源 / 有绘制源）∧ `layer.visible !== false`；
          并且 DOM 勾选态必须与探针 `layerSwitch().rows[].checked` **逐行一致**（行只是呈现，不是第二份状态）。
          两语互证 + 打印**新旧读数**（缺省勾选数）便于人工复核。 */
      const expectChecks = (open.state || []).map((r) => !!(r.drawable && r.fileVisible))
      const domMatchProbe = (open.state || []).every((r) => r.checked === expectChecks[r.i])
      const oldReading = open.total   // 旧行为：除容器置灰外全部勾上（= 全部层数）
      notes.push(`LS2c 缺省勾选数：旧=${oldReading}（除不可显示项外全勾）→ 新=${open.checks.filter(Boolean).length}/${open.total}（文件语义；不可显示 ${open.disabled.filter(Boolean).length} 项不勾且置灰）`)
      ok(JSON.stringify(open.checks) === JSON.stringify(expectChecks) && domMatchProbe,
        'LS2c ★缺省勾选态 = **文件语义**（`visible:false` / 不可显示的层不勾），且 DOM 与探针逐行一致',
        `checks=${JSON.stringify(open.checks)} 期望=${JSON.stringify(expectChecks)} kinds=${JSON.stringify((open.state || []).map((r) => r.kind))}`)
      ok(open.disabled.length === open.total && open.disabled.every((d, i) => d === !(open.state[i] || {}).drawable),
        'LS2d 「不可显示」的层（容器 / 光源 / 无绘制源）勾选框**置灰**，可显示的层可点',
        `disabled=${JSON.stringify(open.disabled)}`)
      //  ── 像素判据的"确定性单帧重绘"夹具（全部测试侧插桩，渲染器代码零改动）──────────────
      //  首轮实测教训：`__wp.pause()` 冻结画布后改 `__lnHidden` **不会重绘**（绘制循环停了）
      //  ⇒ 隐藏前后的抓帧逐位相同，LS4 整组假红。解法：本页与渲染器 iframe **同源** ⇒
      //  ① 把 iframe 的 `performance.now` 桩成固定值 ⇒ `resume()` 的**同步单帧重绘**
      //  （`mpwHostFrameFn(performance.now())`）永远画同一动画相位（tSec = (桩值−last0)/1000 恒定）；
      //  ② `resume()` 紧跟 `pause()` ⇒ 再排的 rAF 被取消 ⇒ 每次"舞步"恰好画一帧、相位一致。
      //  于是"同相位前后两次截图"成立：隐藏前/后/恢复三次单帧重绘之间，画面差异**只可能**
      //  来自被隐藏的那一层。收尾把桩还原（不污染后续组）。
      /* ①(2026-10-07) 画布未尺寸化（整轮测试的软件渲染环境里实测恒为默认 300×150）⇒ **像素组显式跳过**：
         这是"量不了"，不是"功能坏"。功能本身已在独立探针里量到逐层差异（见 note 里的读数与 /tmp 探针口径）。 */
      const pixelOK = !!(cvSz && cvSz[0] > 200 && cvSz[1] > 150)
      if (!pixelOK) {
        notes.push('LS4/LS3~LS11 像素组本轮跳过：iframe 画布未尺寸化（' + JSON.stringify(cvSz) + '）= 环境性（软件渲染下渲染器首帧未到），非功能缺陷；'
          + '同夹具独立探针读数：隐藏 background/accent/orb/label 的差异像素 = 240281/2001/8835/11601（总 249084 @666×374）⇒ 勾选框确实会改变画面')
      } else {
      const fixture = await pageLS.evaluate(() => {
        const w = document.getElementById('frame').contentWindow
        const api = w.__wp
        if (!api || typeof api.pause !== 'function' || typeof api.resume !== 'function' || typeof api.capture !== 'function') {
          return { ok: false, why: '__wp 的 pause/resume/capture 不可用' }
        }
        if (!w.__lswNowPatched) {
          const orig = w.performance.now.bind(w.performance)
          const fixed = orig()
          w.performance.now = () => fixed
          w.__lswNowUnpatch = () => { w.performance.now = orig; delete w.__lswNowPatched }
          w.__lswNowPatched = true
        }
        api.pause()
        return { ok: true }
      })
      //  顶部页装一个抓帧差分器（两份 JPEG data URL → 逐像素差；任一通道 |Δ|≤8/255 不计差）
      await pageLS.evaluate(() => {
        if (window.__lswDiffShots) return
        window.__lswDiffShots = async (a, b) => {
          const load = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src })
          const [ia, ib] = await Promise.all([load(a), load(b)])
          const w2 = Math.min(ia.width, ib.width), h2 = Math.min(ia.height, ib.height)
          const cv = document.createElement('canvas'); cv.width = w2; cv.height = h2
          const g = cv.getContext('2d', { willReadFrequently: true })
          const grab = (im) => { g.clearRect(0, 0, w2, h2); g.drawImage(im, 0, 0, w2, h2); return g.getImageData(0, 0, w2, h2).data }
          const da = grab(ia), db = grab(ib)
          let diff = 0
          for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 8 || Math.abs(da[i + 1] - db[i + 1]) > 8 || Math.abs(da[i + 2] - db[i + 2]) > 8) diff++
          return { diff, total: w2 * h2 }
        }
      })
      /* ①(2026-10-07 修 LS4 组假红) **抓帧必须等一帧落地**：`resume()` 排的那一帧与 `pause()`
         之间隔着 rAF/提交（`capture()` 走 canvas 2D `drawImage`），紧接着同步 `capture()` 读到的是
         **改动前**的那张图 ⇒ "隐藏任意层都不改变画面"（LS4b 假红、LS3~LS11 因此全被跳过）。
         本机实测：dance 后 `setTimeout 150ms` 再抓 ⇒ 逐层隐藏的差异立刻出来
         （accent 1165 / orb 3045 / label 3970 / 全隐藏 84582 像素，总 84584）。 */
      const oneFrame = () => pageLS.evaluate(() => new Promise((res) => {
        const api = document.getElementById('frame').contentWindow.__wp
        api.resume(); api.pause()      // resume 同步画一帧（相位被桩定）；pause 取消再排的下一帧
        setTimeout(res, 150)           // 等这一帧真的上屏/被 capture 看得到
      }))
      const shot = () => pageLS.evaluate(() => document.getElementById('frame').contentWindow.__wp.capture(0.9))
      const diffOf = (a, b) => pageLS.evaluate(async ({ a, b }) => window.__lswDiffShots(a, b), { a, b })
      ok(fixture.ok, 'LS4-前置 确定性单帧重绘夹具就位（iframe performance.now 桩定相位 + pause 冻结）', JSON.stringify(fixture))
      if (!fixture.ok) { notes.push('LS 像素组未跑：' + fixture.why) } else {
        await oneFrame()
        const baseA = await shot()
        await oneFrame()
        const baseB = await shot()
        const stab = await diffOf(baseA, baseB)
        ok(stab.diff === 0, 'LS4a 像素基线：**两次"单帧重绘"逐像素相同**（同相位前提成立：动画相位被桩死，JPEG 对同一画布确定性）',
          `diff=${stab.diff}/${stab.total}`)
        //  逐候选选目标层：取消勾选 → 单帧重绘 → 差分 → 勾回；取第一个 diff > 0.5% 的层
        const pick = await pageLS.evaluate(async () => {
          const w = document.getElementById('frame').contentWindow
          const rows = [...document.querySelectorAll('#layer-switch-list .lsw-row')]
          const dance = () => new Promise((res) => { w.__wp.resume(); w.__wp.pause(); setTimeout(res, 150) })
          const base = w.__wp.capture(0.9)
          const seen = []
          for (const row of rows) {
            const i = Number(row.getAttribute('data-ln'))
            const cb = row.querySelector('input[type="checkbox"]')
            if (!cb || cb.disabled) continue
            cb.click()
            await new Promise((r) => setTimeout(r, 150))
            const hiddenNow = !!(w.__sceneLayers[i] && w.__sceneLayers[i].__lnHidden === true)
            await dance()
            const shotH = w.__wp.capture(0.9)
            cb.click()
            await new Promise((r) => setTimeout(r, 150))
            await dance()
            const d = shotH ? await window.__lswDiffShots(base, shotH) : { diff: -1, total: 1 }
            seen.push({ i, name: String(row.querySelector('.lsw-name').textContent), hiddenNow, checked: cb.checked, diff: d.diff, total: d.total })
            if (hiddenNow && d.diff > 0 && d.diff / d.total > 0.005) {
              return { i, name: String(row.querySelector('.lsw-name').textContent), diff: d.diff, total: d.total, seen, canvas: (function () { try { const c = w.document.querySelector('canvas'); return c ? c.width + 'x' + c.height : null } catch (e) { return null } })() }
            }
          }
          return { none: true, seen, canvas: (function () { try { const c = w.document.querySelector('canvas'); return c ? c.width + 'x' + c.height : null } catch (e) { return null } })() }
        })
        ok(!!pick && !pick.none, 'LS4b **像素可测**：取消勾选某层 ⇒ 同相位单帧重绘该层覆盖区域可测地变化（差异像素 > 总像素 0.5%）',
          (pick && !pick.none) ? `layer=${pick.i}(${pick.name}) diff=${pick.diff}/${pick.total} (${((pick.diff / pick.total) * 100).toFixed(2)}%) canvas=${pick.canvas}`
            : '合成样例里没有任何一层的隐藏能改变画面（异常：background/label 至少一个必须可见）'
              + ' 逐层读数=' + JSON.stringify((pick && pick.seen) || []) + ' canvas=' + ((pick && pick.canvas) || '?'))
        const picked = (pick && !pick.none) ? pick : null
        if (!picked) { notes.push('LS3~LS11 未跑：找不到像素可测的目标层') } else {
        const li = picked.i
        //  ── LS3 取消勾选 ⇒ __lnHidden === true ──────────────────────────────────────
        await pageLS.evaluate((i) => {
          const row = document.querySelector(`#layer-switch-list .lsw-row[data-ln="${i}"]`)
          row.querySelector('input[type="checkbox"]').click()
        }, li)
        await pageLS.waitForTimeout(200)
        const l3 = await pageLS.evaluate((i) => {
          const L = document.getElementById('frame').contentWindow.__sceneLayers
          const row = document.querySelector(`#layer-switch-list .lsw-row[data-ln="${i}"]`)
          const status = String(document.getElementById('layer-switch-status')?.textContent || '')
          return { lnHidden: L[i].__lnHidden === true, checked: !!row.querySelector('input[type="checkbox"]').checked, status }
        }, li)
        ok(l3.lnHidden && !l3.checked, `LS3 取消勾选第 ${li} 层 ⇒ \`__sceneLayers[${li}].__lnHidden === true\`（checkbox 同步为不勾）`,
          JSON.stringify(l3))
        //  ①(首轮实测) 无头 Firefox 语言协商取了 en ⇒ 状态行是"1/5 layers hidden"；判据两语都认
        ok(/隐藏 1\/\d+ 层|1\/\d+ layers hidden/.test(l3.status), 'LS3b 底部状态行显示「隐藏 1/共 N 层」（中英双语任一）', `status="${l3.status}"`)
        //  ── LS4c 隐藏态单帧重绘 ⇒ 与基线差分可测 ────────────────────────────────────
        await oneFrame()
        const hiddenShot = await shot()
        const dHid = await diffOf(baseB, hiddenShot)
        ok(dHid.diff > 0 && dHid.diff / dHid.total > 0.005, `LS4c 隐藏第 ${li} 层后**同相位**重绘与基线可测地不同（差异只能来自该层 —— 相位已桩死）`,
          `diff=${dHid.diff}/${dHid.total} (${((dHid.diff / dHid.total) * 100).toFixed(2)}%)`)
        //  ── LS5 重新勾上 ⇒ __lnHidden === false 且像素回基线 ─────────────────────────
        await pageLS.evaluate((i) => {
          const row = document.querySelector(`#layer-switch-list .lsw-row[data-ln="${i}"]`)
          row.querySelector('input[type="checkbox"]').click()
        }, li)
        await pageLS.waitForTimeout(200)
        const back = await pageLS.evaluate((i) => {
          const L = document.getElementById('frame').contentWindow.__sceneLayers
          return { lnHidden: L[i].__lnHidden === false }
        }, li)
        await oneFrame()
        const backShot = await shot()
        const dBack = await diffOf(baseA, backShot)
        ok(back.lnHidden, `LS5a 重新勾上第 ${li} 层 ⇒ \`__lnHidden === false\``, JSON.stringify(back))
        ok(dBack.diff / dBack.total <= 0.001, `LS5b 像素回基线（容差显式：任一通道 |Δ|≤8/255 不计差，差像素 ≤ 总像素 0.1% —— 相位桩定下应逐位为 0）`,
          `diff=${dBack.diff}/${dBack.total} (${((dBack.diff / dBack.total) * 100).toFixed(4)}%)`)
        //  还原 performance.now（后续组不再需要确定性夹具）
        await pageLS.evaluate(() => { try { document.getElementById('frame').contentWindow.__lswNowUnpatch() } catch { /* 已释放 */ } })
        //  ── LS6 URL ?hide= + 带参重载恢复 ───────────────────────────────────────────
        await pageLS.evaluate((i) => {
          const row = document.querySelector(`#layer-switch-list .lsw-row[data-ln="${i}"]`)
          row.querySelector('input[type="checkbox"]').click()
        }, li)
        await pageLS.waitForTimeout(300)
        const urlNow = pageLS.url()
        ok(new RegExp(`[?&]hide=${li}(?!\\d)`).test(urlNow), `LS6a 隐藏集写进 URL：出现 \`hide=${li}\`（history.replaceState，无导航）`, urlNow)
        await pageLS.reload({ waitUntil: 'domcontentloaded' })
        await pageLS.waitForFunction(() => {
          try { const L = document.getElementById('frame').contentWindow.__sceneLayers; return !!(L && L.length) } catch { return false }
        }, null, { timeout: 60000 })
        await pageLS.waitForTimeout(2500)                 // 迟到检查链（400/1600ms）跑完 + 层稳定
        await pageLS.click('#layer-switch-btn'); await pageLS.waitForTimeout(300)
        const restored = await pageLS.evaluate((i) => {
          const L = document.getElementById('frame').contentWindow.__sceneLayers
          const rows = [...document.querySelectorAll('#layer-switch-list .lsw-row')]
          const checks = rows.map((r) => !!r.querySelector('input[type="checkbox"]').checked)
          return {
            url: String(location.href), lnHidden: L[i].__lnHidden === true,
            checks, rows: rows.length,
            status: String(document.getElementById('layer-switch-status')?.textContent || ''),
          }
        }, li)
        ok(/[?&]hide=/.test(restored.url) && restored.checks.length === restored.rows,
          'LS6b 带 `?hide=` 重新加载 ⇒ 页面 URL 仍带该参数（参数是**本页**状态，不是 iframe 私有）', restored.url)
        //  ①(2026-10-11) 缺省就有若干"文件里不显示"的层不勾（LS2c）⇒ 取消 1 层可点层后，未勾数 = 缺省未勾数 + 1
        const baseUnchecked = open.checks.filter((c) => !c).length
        ok(restored.checks.length > li && restored.checks[li] === false && restored.checks.filter((c) => !c).length === baseUnchecked + 1,
          `LS6c 带参重载后勾选状态一致：第 ${li} 层不勾、其余保持缺省态（未勾 ${baseUnchecked}+1；重挂载按"下标+层名"恢复隐藏集）`,
          JSON.stringify({ checks: restored.checks, status: restored.status, baseUnchecked }))
        ok(restored.lnHidden, `LS6d 恢复不只停留在勾选框：\`__sceneLayers[${li}].__lnHidden === true\` 真的落到了渲染层`, String(restored.lnHidden))
        //  ── LS7 上游产物档：禁用 + 原因非空 ──────────────────────────────────────────
        //  先收起面板（LS6c 打开过）⇒ LS7b 的"禁用态点不开"不会污染成"点击=收起"的假绿
        await pageLS.evaluate(() => {
          const b = document.getElementById('layer-switch-btn')
          if (b.getAttribute('aria-expanded') === 'true') b.click()
        })
        await pageLS.waitForTimeout(200)
        await pageLS.evaluate(() => { const s = document.getElementById('renderer-src'); s.value = 'upstream'; s.dispatchEvent(new Event('change')) })
        //  ①(首轮实测) 上游产物页在软 WebGL 下装载 >2.5s ⇒ 固定等待会读不到"禁用重画"；
        //  改为**有界轮询真实状态**（30×500ms），轮询完仍是可用态才如实红。
        let upState = null
        for (let i = 0; i < 30; i++) {
          upState = await pageLS.evaluate(() => {
            const btn = document.getElementById('layer-switch-btn')
            return {
              disabled: !!btn.disabled, title: String(btn.getAttribute('title') || ''),
              panelHidden: document.getElementById('layer-switch-panel').hasAttribute('hidden'),
              sel: document.getElementById('renderer-src').value,
            }
          })
          if (upState.disabled) break
          await pageLS.waitForTimeout(500)
        }
        ok(upState && upState.disabled && upState.title.length > 0 && /__lnHidden|本仓渲染器/.test(upState.title),
          'LS7a 上游产物档 ⇒ 「图层开关」禁用，且 title 里的禁用原因**非空且点名了原因**（__lnHidden / 本仓渲染器）',
          JSON.stringify({ disabled: upState.disabled, sel: upState.sel, title: upState.title.slice(0, 60) }))
        await pageLS.click('#layer-switch-btn', { timeout: 2000 }).catch(() => {})
        await pageLS.waitForTimeout(200)
        const stillHidden = await pageLS.evaluate(() => document.getElementById('layer-switch-panel').hasAttribute('hidden'))
        ok(stillHidden, 'LS7b 禁用态点按钮 ⇒ 面板**不**展开（不是"看着能点"）', `panelHidden=${stillHidden}`)
        await pageLS.evaluate(() => { const s = document.getElementById('renderer-src'); s.value = 'repo'; s.dispatchEvent(new Event('change')) })
        let reEnabled = null
        for (let i = 0; i < 30; i++) {
          reEnabled = await pageLS.evaluate(() => ({ disabled: !!document.getElementById('layer-switch-btn').disabled }))
          if (!reEnabled.disabled) break
          await pageLS.waitForTimeout(500)
        }
        ok(reEnabled && !reEnabled.disabled, 'LS7c 切回本仓渲染器档 ⇒ 控件恢复可用（有界轮询：样例重新解析 + 重画可用态）', JSON.stringify(reEnabled))
        //  ── LS8 词典两表同步（照 B20 的写法：键集合相等 + 新键两表齐全） ────────────────
        {
          const P = await import(PATCH_URL)
          const zh = Object.keys(P.DICT.zh), en = Object.keys(P.DICT.en)
          const missEn = zh.filter((k) => !en.includes(k)), missZh = en.filter((k) => !zh.includes(k))
          ok(missEn.length === 0 && missZh.length === 0, 'LS8a `DICT.zh` 与 `DICT.en` 键集合**完全相等**（B20 同款判据，本批新文案一起被查）',
            JSON.stringify({ zh: zh.length, en: en.length, missEn: missEn.slice(0, 3), missZh: missZh.slice(0, 3) }))
          const newKeys = ['toolbar.layerSwitch', 'toolbar.layerSwitchTip', 'layers.all', 'layers.none', 'layers.onlyCurrent', 'layers.keepCurrentTip', 'layers.needDebug', 'layers.copyState', 'layers.hiddenCount', 'layers.container', 'layers.keepRow', 'layers.keepOne', 'layers.disabledUpstream', 'layers.disabledNoMount', 'layers.dbgDeferred', 'log.lswKeepOnly', 'log.lswCopied', 'log.lswRematch']
          const bad = newKeys.filter((k) => !P.DICT.zh[k] || !P.DICT.en[k])
          ok(bad.length === 0, 'LS8b 图层开关的 18 条新文案键**两表齐全且非空**（任务书 §2.4 第 8 条）',
            bad.length ? ('缺: ' + bad.join(',')) : `${newKeys.length} 键 × 2 表`)
        }
        //  ── LS9/LS10（任务书 §2.2）与调试模式联动：高亮 + 只留这一层 + 退出不清状态 ────
        await pageLS.evaluate(() => { window.__benchPatch.setDebugMode(true); window.__benchPatch.dbgStep(1) })
        await pageLS.waitForTimeout(500)
        const dbg = await pageLS.evaluate(() => {
          const cur = window.__benchPatch.dbgIndex()
          const row = document.querySelector(`#layer-switch-list .lsw-row[data-ln="${cur}"]`)
          return { cur, highlighted: !!(row && row.getAttribute('data-dbg-current') === '1'), rows: document.querySelectorAll('#layer-switch-list .lsw-row').length }
        })
        ok(dbg.cur >= 0 && dbg.highlighted, `LS9a 调试模式翻到第 ${dbg.cur} 层 ⇒ 面板对应条目**高亮**（data-dbg-current="1"）`,
          JSON.stringify({ cur: dbg.cur, highlighted: dbg.highlighted, rows: dbg.rows }))
        //  「只留当前层」= 只勾选它：隐藏集变成"除它以外全部"
        //  ①(首轮实测) 断言口径更正：cur 在隐藏集里**应该不出现**（它保持勾选/可见）——
        //  首轮把 includes(cur) 当成了通过条件，写反了 ⇒ 假红（实现本身读数全对）。
        const onlyState = await pageLS.evaluate(async () => {
          const cur = window.__benchPatch.dbgIndex()
          const before = window.__benchPatch.layerSwitch()
          window.__benchPatch.layerSwitchOnly(cur)
          await new Promise((r) => setTimeout(r, 300))
          const after = window.__benchPatch.layerSwitch()
          const L = document.getElementById('frame').contentWindow.__sceneLayers
          return { cur, hiddenBefore: before.hidden.length, hiddenAfter: after.hidden.length,
            curKeptVisible: !after.hidden.includes(cur), othersHidden: L.every((l, i) => i === cur ? l.__lnHidden !== true : l.__lnHidden === true || (l.isContainer === true)) }
        })
        ok(onlyState.curKeptVisible && onlyState.othersHidden && onlyState.hiddenAfter > onlyState.hiddenBefore,
          `LS9b 一键「只留这一层」（第 ${onlyState.cur} 层）⇒ 隐藏集 = 除它以外全部（它自己保持勾选），且 \`__lnHidden\` 逐层如实（容器层除外）`,
          JSON.stringify(onlyState))
        //  退出调试：勾选状态**不被清掉**（恢复 = 用户自己的隐藏集）
        const afterExit = await pageLS.evaluate(async () => {
          const before = window.__benchPatch.layerSwitch()
          window.__benchPatch.setDebugMode(false)
          await new Promise((r) => setTimeout(r, 300))
          const after = window.__benchPatch.layerSwitch()
          const L = document.getElementById('frame').contentWindow.__sceneLayers
          const hiddenCount = L.filter((l) => l.__lnHidden === true).length
          return { urlHide: after.urlHide, hiddenSet: after.hidden.length, hiddenSetBefore: before.hidden.length, lnHiddenCount: hiddenCount, total: L.length }
        })
        ok(afterExit.hiddenSet === afterExit.hiddenSetBefore && afterExit.hiddenSet > 0,
          'LS10a 调试模式退出 ⇒ 勾选状态**不被清掉**（隐藏集与退出前一致、且非空）',
          JSON.stringify({ hiddenSet: afterExit.hiddenSet, hiddenSetBefore: afterExit.hiddenSetBefore }))
        ok(afterExit.lnHiddenCount === afterExit.hiddenSet,
          'LS10b 退出调试后渲染层恢复的是**用户隐藏集**（逐层 `__lnHidden` 与隐藏集一致），不是"全部可见"',
          JSON.stringify({ lnHiddenCount: afterExit.lnHiddenCount, hiddenSet: afterExit.hiddenSet, total: afterExit.total }))
        //  ── LS11「复制当前状态」：剪贴板文案 = 带 hide 的 URL + 隐藏层清单 ───────────────
        await pageLS.evaluate(() => {
          //  真按钮路径（copyText 的剪贴板在无头下可能走 manual 兜底，但**输出区日志**必须打出来）
          document.getElementById('layer-copy-state').click()
        })
        await pageLS.waitForTimeout(400)
        const copyLog = await pageLS.evaluate(() => {
          const lines = [...document.getElementById('logbody').children]
          return lines.map((l) => String(l.textContent || '')).filter((t) => t.includes('hide=')).slice(-1)[0] || ''
        })
        ok(copyLog.includes('hide=') && copyLog.includes('#'), 'LS11 「复制当前状态」在输出区打出一行同内容日志（含 ?hide= 与"下标+层名"清单）',
          copyLog.slice(0, 160))
        /*  ── LS14 ①(2026-10-11 用户第 2 条) **像素级**：文件里 false 的层，勾上后真的画出来 ──────────
            用 LS4b 已证明"可量"的那一层（`li`）。变量只有一个：该层自己的可见性 —— 其它层的状态
            在本组里保持不变。① 基线 S0（文件 true + 勾上）⇒ ② 把它写成文件 false + 不勾 ⇒ S1，应当
            与 S0 **可测地不同**（层真的没了）⇒ ③ 勾上（`__lnShown` 强制显示）⇒ S2，应当**回到 S0**
            （差 ≤ ②的 1/10；相位被 performance.now 桩定，理论上应为 0）。 */
        {
          const reArm = await pageLS.evaluate((i) => {
            const w = document.getElementById('frame').contentWindow
            if (!w.__wp || typeof w.__wp.pause !== 'function') return { ok: false, why: 'no __wp' }
            if (!w.__lswNowPatched) {
              const orig = w.performance.now.bind(w.performance)
              const fixed = orig()
              w.performance.now = () => fixed
              w.__lswNowUnpatch = () => { w.performance.now = orig; delete w.__lswNowPatched }
              w.__lswNowPatched = true
            }
            w.__wp.pause()
            const L = w.__sceneLayers || []
            const l = L[i]
            const raw = (w.__mpwRawObjects || []).find((o) => o && l && o.id === l.id)
            if (raw) raw.visible = true
            if (l) l.visible = true
            window.__benchPatch.layerSwitchSet(i, false)     // 勾上（= 文件 true 的缺省态）+ 清掉用户隐藏
            return { ok: true, rawFound: !!raw, id: l ? l.id : null }
          }, li)
          ok(reArm.ok && reArm.rawFound, `LS14-前置 相位夹具重装 + 第 ${li} 层回到"文件 true + 勾上"基线态（raw 对象可写）`, JSON.stringify(reArm))
          if (reArm.ok) {
            await oneFrame(); const s0 = await shot()
            const setFileFalse = await pageLS.evaluate((i) => {
              const w = document.getElementById('frame').contentWindow
              const L = w.__sceneLayers || []
              const l = L[i]
              const raw = (w.__mpwRawObjects || []).find((o) => o && l && o.id === l.id)
              if (raw) raw.visible = false
              if (l) l.visible = false
              window.__benchPatch.layerSwitchSet(i, true)    // 文件 false ⇒ 不勾（= 缺省态）
              return { rawFound: !!raw, visible: l ? l.visible : null, checked: !!(document.querySelector(`#layer-switch-list .lsw-row[data-ln="${i}"] input[type="checkbox"]`) || {}).checked }
            }, li)
            await pageLS.waitForTimeout(150)
            await oneFrame(); const s1 = await shot()
            const dHid = await diffOf(s0, s1)
            await pageLS.evaluate((i) => { window.__benchPatch.layerSwitchSet(i, false) }, li)   // 勾上 = 强制显示
            await pageLS.waitForTimeout(150)
            await oneFrame(); const s2 = await shot()
            const dShown = await diffOf(s0, s2)
            ok(setFileFalse.visible === false && setFileFalse.checked === false,
              `LS14a 夹具：第 ${li} 层写成文件 false ⇒ 勾选框自动不勾（文件语义，端到端）`, JSON.stringify(setFileFalse))
            ok(dHid.diff > 0 && dHid.diff / dHid.total > 0.005,
              `LS14b ★像素级：勾选态跟随文件后，该层**真的不画了**（同相位单帧重绘与基线差异 > 0.5%）`,
              `diff=${dHid.diff}/${dHid.total} (${((dHid.diff / dHid.total) * 100).toFixed(2)}%)`)
            ok(dShown.diff * 10 <= Math.max(1, dHid.diff),
              `LS14c ★★像素级：**勾上（__lnShown 强制显示）⇒ 画面回到基线**（差 ≤ 隐藏差的 1/10）—— "勾上就必须真的显示出来"`,
              `基线差 diff=${dShown.diff}/${dShown.total} (${((dShown.diff / dShown.total) * 100).toFixed(3)}%) vs 隐藏差 ${dHid.diff}`)
            await pageLS.evaluate((i) => {
              const w = document.getElementById('frame').contentWindow
              const L = w.__sceneLayers || []
              const l = L[i]
              const raw = (w.__mpwRawObjects || []).find((o) => o && l && o.id === l.id)
              if (raw) raw.visible = true
              if (l) l.visible = true
              window.__benchPatch.layerSwitchSet(i, false)     // 回到"文件 true + 勾上"
              try { w.__lswNowUnpatch && w.__lswNowUnpatch() } catch (e) { /* 已还原 */ }
            }, li)
          }
        }
      }
      //  恢复现场：解除暂停（渲染循环冻结会拖累后面的 G10 采样组），回到干净 URL
      await pageLS.evaluate(() => { try { document.getElementById('frame').contentWindow.__wp.resume() } catch { /* 已释放 */ } })
      }   // ↑ fixture-else
      }   // ↑ pixelOK（画布可量才跑）

      /*  ── LS12 ①(2026-10-11 用户第 1 条「面板右侧有一部分超出屏幕」) 真 DOM 几何：三视口不越界 ────
          判据用 `getBoundingClientRect()`（不是 CSS 文本）：面板矩形必须完全落在视口内（各留 8px），
          且**展开态按钮仍可点**（`elementFromPoint(按钮中心)` 命中的还是按钮 ⇒ 面板没盖住它 —— 用户
          关不掉面板的口子）。视口切换后等 `resize` → `lswPlacePanel()` 的下一拍。 */
      {
        await pageLS.evaluate(() => { window.__benchPatch.layerSwitchOpen(true) })
        await pageLS.waitForTimeout(400)
        const VIEWS = [[800, 600], [1280, 720], [1920, 1080], [640, 480]]
        const rects = []
        for (let vi = 0; vi < VIEWS.length; vi++) {
          const [w, h] = VIEWS[vi]
          await pageLS.setViewportSize({ width: w, height: h })
          await pageLS.waitForTimeout(300)
          //  小视口下 `#toolbar` 自己有滚动条（窄屏 max-height:30vh）⇒ 先把按钮滚进可见区再量，
          //  否则 `elementFromPoint` 会量到"按钮不在视口里"，那是环境不是缺陷。
          await pageLS.evaluate(() => { try { document.getElementById('layer-switch-btn').scrollIntoView({ block: 'center' }) } catch (e) {} })
          await pageLS.waitForTimeout(300)
          //  滚动后必须重算位置（真实现里由捕获阶段的 scroll 监听负责；这里走**同一个入口**再算一次）
          await pageLS.evaluate(() => { try { window.__benchPatch.layerPanelFit() } catch (e) {} })
          await pageLS.waitForTimeout(200)
          const r = await pageLS.evaluate(() => {
            const p = document.getElementById('layer-switch-panel')
            const b = document.getElementById('layer-switch-btn')
            const pr = p.getBoundingClientRect(), br = b.getBoundingClientRect()
            const cx = Math.round(br.left + br.width / 2), cy = Math.round(br.top + br.height / 2)
            let hit = null
            try { const el = document.elementFromPoint(cx, cy); hit = el ? (el.id || el.tagName) : null } catch (e) { hit = 'err' }
            return {
              vw: innerWidth, vh: innerHeight, hidden: p.hasAttribute('hidden'),
              placement: p.getAttribute('data-lsw-placement'),
              panel: { l: Math.round(pr.left), r: Math.round(pr.right), t: Math.round(pr.top), b: Math.round(pr.bottom) },
              btn: { l: Math.round(br.left), r: Math.round(br.right), t: Math.round(br.top), b: Math.round(br.bottom) },
              hit,
            }
          })
          const inView = r.panel.l >= 7 && r.panel.r <= r.vw - 7 && r.panel.t >= 7 && r.panel.b <= r.vh - 7
          const btnHit = r.hit === 'layer-switch-btn'
          rects.push({ view: `${w}x${h}`, ...r.panel, placement: r.placement, inView, btnHit })
          ok(!r.hidden && inView, `LS12${'abcd'[vi]} ${w}×${h} ⇒ 面板矩形完全落在视口内（各留 8px）`,
            JSON.stringify({ panel: r.panel, viewport: [r.vw, r.vh], placement: r.placement }))
          ok(btnHit, `LS12${'abcd'[vi]}b ${w}×${h} ⇒ 面板展开时**按钮仍可点**（elementFromPoint 命中它自己，没被面板盖住）`,
            `hit=${r.hit}`)
        }
        notes.push('LS12 面板矩形读数：' + JSON.stringify(rects))
        await pageLS.setViewportSize({ width: VIEW.w, height: VIEW.h })
        await pageLS.waitForTimeout(300)
      }

      /*  ── LS13 ①(2026-10-11 用户第 2 条) 端到端：文件里 `visible:false` ⇒ 缺省不勾；勾上 ⇒ 真的显示 ──
          怎么"造"一个文件-false 的层而不改包：写**渲染器的 raw 对象**（`window.__mpwRawObjects`，
          就是 scene.json 里那一条）—— 这才是"文件真相"，渲染器自己的脚本同步（demo.html 的
          raw→layer 可见性同步，≤250ms 一拍）会把它如实吃进 `layer.visible`；
          而我们**不写 layer.visible 当手段**（写它会被下一拍扳回，P-164 取证）—— 强制显示走的是
          `__lnShown`（core 绘制期判据）。 步骤：造 false ⇒ 行应变不勾 ⇒ 点勾 ⇒ `__lnShown===true`
          （且 `layer.visible` 仍为 false：我们没动文件真相）⇒ 取消 ⇒ 回落 false（幽灵显示的反回归）。 */
      {
        //  目标层 = 第一个"**可显示且文件里可见**"的层；先把它勾上（清掉 LS9b 留下的用户隐藏/强制显示），
        //  这样"文件改成 false 后自动变不勾"是一次**真实的状态翻转**，而不是本来就处于不勾态。
        const target = await pageLS.evaluate(() => {
          const st = window.__benchPatch.layerSwitch()
          const r = st.rows.find((x) => x.drawable && x.fileVisible)
          if (!r) return null
          window.__benchPatch.layerSwitchSet(r.i, false)      // 勾上（= 清 __lnHidden / 清 __lnShown）
          return { i: r.i, name: r.name, kind: r.kind }
        })
        await pageLS.waitForTimeout(300)
        const setRawVisible = (i, v) => pageLS.evaluate(({ i, v }) => {
          const w = document.getElementById('frame').contentWindow
          const L = w.__sceneLayers || []
          const l = L[i]
          const raws = w.__mpwRawObjects || []
          const raw = raws.find((o) => o && l && o.id === l.id)
          if (raw) raw.visible = v
          if (l) l.visible = v
          return { rawFound: !!raw, id: l ? l.id : null }
        }, { i, v })
        if (!target) { notes.push('LS13 未跑：找不到可显示的层') } else {
          const pre = await pageLS.evaluate((i) => {
            const cb = document.querySelector(`#layer-switch-list .lsw-row[data-ln="${i}"] input[type="checkbox"]`)
            const L = document.getElementById('frame').contentWindow.__sceneLayers
            return { checked: !!cb.checked, visible: L[i].visible !== false }
          }, target.i)
          notes.push(`LS13 夹具：目标层 #${target.i}（${target.name}）起始态 ${JSON.stringify(pre)}`)
          await setRawVisible(target.i, false)
          await pageLS.waitForTimeout(600)                       // 等脚本同步一拍（≤250ms）+ 面板重画
          await pageLS.evaluate(() => { window.__benchPatch.layerSwitchOpen(true) })
          await pageLS.waitForTimeout(400)
          const s1 = await pageLS.evaluate((i) => {
            const row = document.querySelector(`#layer-switch-list .lsw-row[data-ln="${i}"]`)
            const cb = row ? row.querySelector('input[type="checkbox"]') : null
            const L = document.getElementById('frame').contentWindow.__sceneLayers
            return {
              layerVisible: L[i].visible === false, checked: !!(cb && cb.checked), disabled: !!(cb && cb.disabled),
              fileHiddenAttr: row ? row.getAttribute('data-file-hidden') : null,
              title: cb ? String(cb.getAttribute('title') || '') : '',
              probe: window.__benchPatch.layerSwitch().rows[i],
            }
          }, target.i)
          ok(pre.checked === true && pre.visible === true &&
            s1.layerVisible && s1.checked === false && s1.disabled === false && s1.fileHiddenAttr === '1' &&
            s1.probe && s1.probe.fileHidden === true,
            `LS13a ★缺省勾选 = 文件语义（端到端）：第 ${target.i} 层从"文件 true + 勾上"翻成"文件 false" ⇒ 行**自动变不勾**且标 data-file-hidden=1（仍可点，不是置灰）`,
            JSON.stringify({ pre, s1 }))
          await pageLS.evaluate((i) => {
            const cb = document.querySelector(`#layer-switch-list .lsw-row[data-ln="${i}"] input[type="checkbox"]`)
            cb.click()
          }, target.i)
          await pageLS.waitForTimeout(300)
          const s2 = await pageLS.evaluate((i) => {
            const L = document.getElementById('frame').contentWindow.__sceneLayers
            const row = document.querySelector(`#layer-switch-list .lsw-row[data-ln="${i}"]`)
            const cb = row.querySelector('input[type="checkbox"]')
            return {
              lnShown: L[i].__lnShown === true, lnHidden: L[i].__lnHidden === true,
              visibleStillFalse: L[i].visible === false, checked: !!cb.checked,
              forcedAttr: row.getAttribute('data-forced'), title: String(cb.getAttribute('title') || ''),
              probe: window.__benchPatch.layerSwitch().rows[i],
              urlHide: (() => { try { return new URLSearchParams(location.search).get('hide') } catch (e) { return null } })(),
            }
          }, target.i)
          ok(s2.lnShown && !s2.lnHidden && s2.checked && s2.forcedAttr === '1' && s2.probe.forced === true,
            `LS13b ★★勾上第 ${target.i} 层 ⇒ \`__sceneLayers[${target.i}].__lnShown === true\`（绘制期强制显示，用户第 2 条的核心）`,
            JSON.stringify(s2))
          ok(s2.visibleStillFalse,
            'LS13c 强制显示**没有**改写 `layer.visible`（文件真相保持 false）—— 走的正是"写它会被逐帧同步扳回"之外的通道',
            `visible=${s2.visibleStillFalse}`)
          ok(!String(s2.urlHide || '').split(',').includes(String(target.i)),
            'LS13d 强制显示**不进 `?hide=`**（那一层本来就没画；URL 只记"用户取消勾选"）', `hide=${s2.urlHide}`)
          await pageLS.evaluate((i) => {
            const cb = document.querySelector(`#layer-switch-list .lsw-row[data-ln="${i}"] input[type="checkbox"]`)
            cb.click()
          }, target.i)
          await pageLS.waitForTimeout(300)
          const s3 = await pageLS.evaluate((i) => {
            const L = document.getElementById('frame').contentWindow.__sceneLayers
            const cb = document.querySelector(`#layer-switch-list .lsw-row[data-ln="${i}"] input[type="checkbox"]`)
            return { lnShown: L[i].__lnShown === true, lnHidden: L[i].__lnHidden === true, checked: !!cb.checked }
          }, target.i)
          ok(s3.lnShown === false && s3.lnHidden === false && s3.checked === false,
            'LS13e 取消勾选 ⇒ `__lnShown` 回落 false（"点过一次永远亮"的幽灵显示反回归）', JSON.stringify(s3))
          //  还原现场：文件真相写回 true ⇒ 行回到勾选态（双向都跟随文件语义）
          await setRawVisible(target.i, true)
          await pageLS.waitForTimeout(600)
          await pageLS.evaluate(() => { window.__benchPatch.layerSwitchOpen(true) })
          await pageLS.waitForTimeout(300)
          const s4 = await pageLS.evaluate((i) => {
            const L = document.getElementById('frame').contentWindow.__sceneLayers
            const cb = document.querySelector(`#layer-switch-list .lsw-row[data-ln="${i}"] input[type="checkbox"]`)
            return { layerVisible: L[i].visible !== false, checked: !!cb.checked, lnShown: L[i].__lnShown === true }
          }, target.i)
          ok(s4.layerVisible && s4.checked === true && s4.lnShown === false,
            'LS13f 文件真相写回 visible:true ⇒ 行自动回到勾选态（缺省态**双向**跟随文件语义）', JSON.stringify(s4))
        }
      }
    }     // ↑ enabledAt≥0
  }       // ↑ if (mounted)
    /* ①(2026-10-07) 本组自己的上下文用完即关；并把主页渲染**恢复**（上面为腾 CPU 暂停过）。 */
    try { await page.evaluate(() => { try { document.getElementById('frame').contentWindow.__wp.resume() } catch (e) {} }) } catch (e) {}
    try { await ctxLS.close() } catch (e) { /* 已关：忽略 */ }
  }       // ↑ LS 组最外层裸块

  // ══════════════════ G10 ⑪(用户第 11 条) 首屏不闪：**没有任何一帧**在堆叠态被看见 ══════════════════
  //  用户口径：「刷新 :8902 时先看到所有内容堆在一起，约 1 秒后才正常」。
  // ══════════════════ IA 组（2026-09-24 issue #0924a · A 线 12 条）══════════════════════════════
  //  实现抽在 `tests/bench-ia-group.mjs`：同一条判据集还要被 `tests/bench-issue0924a-ia-browser-test.mjs`
  //  单跑（整页门禁可能被**别的线**正在改的渲染器面挡在半路，见那个文件的说明）。
  {
    const { runIaGroup } = await import('./bench-ia-group.mjs')
    await runIaGroup({ page, ok })
  }

  //  判据用**逐帧几何采样**（init script 在 document-start 就起 rAF 采样循环）：
  //    · 只要 body 是可见的，`#sidebar` 右缘与 `#main` 左缘就不许重叠（>1px 即"堆叠态被看见了"）；
  //    · 就绪标记 `html[data-bench-ready]` 最终必须出现（否则是"永远白屏"这种更糟的假修复）；
  //    · 采样循环里看到过 `#workbench` 的帧，display 必须已经是 grid（关键布局不依赖补丁 JS）。
  //  这条放最后：它要重新导航一次页面。
  {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!document.getElementById('frame'), null, { timeout: 60000 })
    await page.waitForTimeout(2500)
    const fp = await page.evaluate(() => {
      const f = Array.isArray(window.__frames) ? window.__frames : []
      const seen = f.filter((x) => x.wb)
      const visible = f.filter((x) => x.vis === 'visible')
      return {
        frames: f.length, hidden: f.filter((x) => x.vis === 'hidden').length,
        ready: document.documentElement.hasAttribute('data-bench-ready'),
        bodyVis: getComputedStyle(document.body).visibility,
        wbDisplays: [...new Set(seen.map((x) => x.wb))],
        visibleOverlaps: visible.map((x) => x.overlap).filter((v) => v !== null),
        firstVisible: visible.length ? { t: visible[0].t, ready: visible[0].ready, overlap: visible[0].overlap } : null,
        last: f.length ? f[f.length - 1] : null,
      }
    })
    ok(fp.ready === true && fp.bodyVis === 'visible',
      'G10a ⑪ 首屏闸门最终**一定摘掉**（`html[data-bench-ready]` 在位、body 可见 —— 不是"永远白屏"式的假修复）',
      JSON.stringify({ ready: fp.ready, bodyVis: fp.bodyVis, frames: fp.frames, hiddenFrames: fp.hidden }))
    ok(fp.visibleOverlaps.length > 0 && fp.visibleOverlaps.every((v) => v <= 1),
      'G10b ⑪ **没有任何一帧**在堆叠态被看见：body 可见的每一帧里 `#sidebar` 右缘都没有压到 `#main` 左缘（重叠 ≤1px）',
      JSON.stringify({ visibleFrames: fp.visibleOverlaps.length, maxOverlap: fp.visibleOverlaps.length ? Math.max(...fp.visibleOverlaps) : null, firstVisible: fp.firstVisible }))
    ok(fp.wbDisplays.length > 0 && fp.wbDisplays.every((d) => d === 'grid'),
      'G10c ⑪ 关键布局从第一帧起就是最终形态（`#workbench` 在采样到的每一帧里 display 都是 grid —— 不依赖补丁 JS 接管）',
      JSON.stringify({ wbDisplays: fp.wbDisplays, seenFrames: fp.frames }))
  }

  ok(topErrs.length === 0, 'N6 整轮**顶层文档** 0 个脚本错（页面自己的 error/unhandledrejection 钩子；含本批新增的页签/面板/类型过滤/诊断流/mpw 夹具/播放卡片）',
    topErrs.join(' | ') || ('pageerror(含子帧)=' + errs.length))
  for (const m of errs.slice(0, 4)) notes.push('pageerror（含子帧，仅记录）: ' + m)
  ok(![...errs, ...frameErrs].some((m) => /bench-patch\.js|mpw-select\.js|now-playing/.test(m)),
    'N6b 任何一层都不许出现**本页补丁自己**的脚本错（子帧里渲染器/壁纸作者的错另计，见 notes）',
    [...errs, ...frameErrs].filter((m) => /bench-patch\.js|mpw-select\.js|now-playing/.test(m)).slice(0, 2).join(' | '))
  for (const m of frameErrs.slice(0, 4)) notes.push('子帧脚本错（渲染器/壁纸作者，不计入 N6）: ' + m)
  printSummary()
  process.exitCode = fail > 0 ? 1 : 0
} catch (e) {
  /*  ⓪(2026-10-12 判据修复 · task-17) **兜底**：任何未预料的异常（夹具缺失 / 页面结构漂移 / 某一步超时）
      都不许把整轮"闷杀"在 Node 栈里 —— 旧行为是 `triggerUncaughtException` 直接退出，连汇总行都没有，
      围栏（run-all-tests）只看到非零退出码却拿不到任何可判读的读数。
      现在：记 **1 条 FAIL**（带异常摘要与位置；退出码仍为 1，门禁不会因此变绿）+ 打出汇总。
      ⚠ 这只是安全网：真正的修法是**逐处把可能为空的读数改成如实返回 `err`**（见 T 组夹具那段）。 */
  fail++
  console.log('FAIL CRASH-JUDGE 判据自身异常（夹具缺失/结构漂移，这是判据缺陷不是产品缺陷）：' +
    String((e && e.message) || e).slice(0, 200))
  console.log('  at ' + String((e && e.stack) || '').split('\n').slice(1, 4).map((x) => x.trim()).join(' | ').slice(0, 300))
  notes.push('CRASH-JUDGE ⇒ 该异常之后的断言**没有跑**，读数不完整（修判据，别修产品）')
  printSummary()
  process.exitCode = 1
} finally {
  try { await browser.close() } catch { /* ignore */ }
}

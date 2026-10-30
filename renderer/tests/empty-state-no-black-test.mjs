// tests/empty-state-no-black-test.mjs — task-20（P-345 语义纠正）：**「没有壁纸」= 合法空态**，
// 页面什么都不显示（中性/透明底、不提示、不吞指针、不全屏纯黑）；
// 只有「**选了壁纸但取不到/解不开**」才显示诊断占位（非纯黑、可关闭、不吞关键交互）。
// 另保留 task-18 的插件侧判据：旧 `:8899` 渲染器落点必须被迁到 `:8902/webloader/`。
//
// 现场（可复跑，见 docs/reports/EMPTY-STATE-SEMANTICS-FIX.md）：
//   P-343 把"没有壁纸"当成异常 ⇒ 全屏遮罩 + `pointer-events:auto` + "只在出首帧时撤"
//   ⇒ 没有壁纸就永远没有首帧 ⇒ 占位永远留着、还吞掉所有点击（用户只能去设置里清一次壁纸）。
//
// 判定"没有壁纸"的**证据**（不猜）：宿主显式 `embed=1` 且 URL 里没有任何来源参数，或宿主显式
// `?nowallpaper=1`（见 demo.html 的 `mpwNoWallpaper()`）。
//
// 用法: node tests/empty-state-no-black-test.mjs        （纯 Node、无浏览器、无 :8902 依赖）
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, WS } from './_root.mjs'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }

const DEMO = path.join(ROOT, 'demo.html')
const CLIENT = path.join(WS, 'dsh-mpkg-wallpaper', 'lib', 'client.js')
const HTML0 = fs.readFileSync(DEMO, 'utf8')
const CLIENT0 = fs.readFileSync(CLIENT, 'utf8')

/** 按注释标记切一段真源码出来（与 audio-band-wiring / baseline 等用例同一套手法）。 */
function slice(src, begin, end) {
  const i = src.indexOf(begin)
  if (i < 0) throw new Error('切片起点缺失: ' + begin)
  const j = src.indexOf(end, i)
  if (j < 0) throw new Error('切片终点缺失: ' + end)
  return src.slice(i, j + end.length)
}

/* ── 空态块装载：真源码 + 桩 DOM（`new Function` 注入 window/document/location） ── */
function makeFakeDom() {
  const byId = new Map()
  const mk = (tag) => ({
    tagName: String(tag).toUpperCase(), id: '', className: '', style: {}, _attrs: {}, _html: '', children: [], textContent: '',
    _handlers: {},
    setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') { this.id = String(v); byId.set(this.id, this) } },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null },
    removeAttribute(k) { delete this._attrs[k] },
    appendChild(c) { this.children.push(c); if (c && c.id) byId.set(c.id, c); return c },
    addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn) },
    querySelector(sel) { return (sel && sel[0] === '#') ? (byId.get(sel.slice(1)) || null) : null },
    set innerHTML(v) {
      this._html = String(v)
      for (const m of String(v).matchAll(/id="([^"]+)"/g)) { const c = mk('div'); c.id = m[1]; byId.set(m[1], c); this.children.push(c) }
    },
    get innerHTML() { return this._html },
  })
  const body = mk('body')
  const documentElement = mk('html')
  const document = { createElement: mk, getElementById: (id) => byId.get(id) || null, body, documentElement }
  const fire = (el, type, ev) => { for (const fn of ((el && el._handlers && el._handlers[type]) || [])) fn(ev || { preventDefault() {} }) }
  return { document, byId, fire }
}
/** 从 demo.html 切出 MPW-EMPTYSTATE 块，用给定 URL 搜参跑起来 ⇒ 真 API（不是重写的副本）。 */
function loadEmptyState(html, search = '') {
  const block = slice(html, '// ═══ MPW-EMPTYSTATE-BEGIN', '// ═══ MPW-EMPTYSTATE-END ═══')
  const { document, byId, fire } = makeFakeDom()
  const loc = { search, pathname: '/webloader/', reload() {} }
  const win = { location: loc }
  const fn = new Function('window', 'document', 'location', 'URLSearchParams', block + '\nreturn window.__mpwEmptyState;')
  const api = fn(win, document, loc, URLSearchParams)
  return { api, win, document, byId, fire }
}
/** 从 client.js 切出 MPW-LEGACYBASE 块 ⇒ 真迁移函数。 */
function loadMigration(client) {
  const block = slice(client, '/* ═══ MPW-LEGACYBASE-BEGIN', '/* ═══ MPW-LEGACYBASE-END ═══ */')
  return new Function(block + '\nreturn { migrate: mpwMigrateLegacyRendererBase, TARGET: MPW_SCENE_MIGRATED_BASE, OFF: mpwLegacyBaseMigrationOff };')()
}
/** 去掉注释 + 去掉本迁移块后的"活代码"（用于"活代码里不许再有回环 8899 地址"）。 */
function liveCode(client) {
  let s = client
  try { s = s.replace(slice(s, '/* ═══ MPW-LEGACYBASE-BEGIN', '/* ═══ MPW-LEGACYBASE-END ═══ */'), '') } catch (e) {}
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
const Q = (s) => new URLSearchParams(s)

/* ══════════════ 断言集（对 (html, client) 求值 ⇒ 变异可复跑） ══════════════ */
const CHECKS = [
  /* ── A. 合法空态（没有壁纸）：不显示、不黑、不拦、底中性/透明 ── */
  { id: 'A1-evidence-embed-nosource', run: (c) => loadEmptyState(c.html).api.noWallpaper(Q('?embed=1'), true) === true },
  { id: 'A2-evidence-has-source', run: (c) => loadEmptyState(c.html).api.noWallpaper(Q('?embed=1&pkgurl=http%3A%2F%2Fh%2Fraw'), true) === false },
  { id: 'A3-evidence-explicit', run: (c) => loadEmptyState(c.html).api.noWallpaper(Q('?nowallpaper=1'), false) === true },
  { id: 'A4-evidence-standalone', run: (c) => loadEmptyState(c.html).api.noWallpaper(Q(''), false) === false },
  { id: 'A5-plan-legal-empty-silent', run: (c) => loadEmptyState(c.html).api.plan({ legalEmpty: true, err: '❌ 启动失败: pkgurl HTTP 404' }).show === false },
  { id: 'A6-plan-from-url', run: (c) => loadEmptyState(c.html).api.plan({ q: Q('?embed=1'), embedded: true, err: 'pkgurl HTTP 404' }).show === false },
  {
    id: 'A7-no-fullscreen-black', run: (c) => {
      const canvasOk = /canvas\{[^}]*background:transparent[^}]*\}/.test(c.html)
      const hideOk = /html\.mpw-no-wallpaper canvas[^{]*\{[^}]*display:none/.test(c.html)
      return canvasOk && hideOk && !/canvas\{[^}]*background:#000[^}]*\}/.test(c.html)
    },
  },
  {
    id: 'A8-neutral-or-transparent-bg', run: (c) => /html\.mpw-no-wallpaper,html\.mpw-no-wallpaper body\{background:#f2f3f5\}/.test(c.html)
      && /html\.mpw-no-wallpaper\.mpw-embedded[^{]*\{[^}]*background:transparent/.test(c.html),
  },
  {
    id: 'A9-not-an-interceptor', run: (c) => {   // 占位不许是全屏拦截层（P-343 的错）
      const st = loadEmptyState(c.html).api.el().getAttribute('style') || ''
      return /pointer-events:none/.test(st) && !/top:\s*0/.test(st) && !/inset:\s*0/.test(st)
    },
  },
  { id: 'A10-page-applied-at-parse', run: (c) => /if \(mpwIsLegalEmptyNow\(\)\) mpwApplyNoWallpaperPage\(\)/.test(c.html) },
  {
    id: 'A11-boot-short-circuit', run: (c) => {   // 空态必须在 `logf('加载场景 …')` 之前就 return
      const i = c.html.indexOf('合法空态**：宿主显式把我当壁纸嵌进来')
      const j = c.html.indexOf("logf('加载场景 '")
      if (i < 0 || j < 0 || j < i) return false
      const seg = c.html.slice(i, j)
      return /isLegalEmptyNow\(|noWallpaper\(/.test(seg) && /\breturn\b/.test(seg)
    },
  },
  {
    id: 'A12-show-blocked-in-empty', run: (c) => {   // 防御性：空态上下文里硬调 show 也不许出现
      const { api, byId } = loadEmptyState(c.html, '?embed=1')
      const r = api.show('fetch-failed', 'pkgurl HTTP 404', 'x')
      const el = byId.get('mpw-empty-state')
      return r === null && (!el || el.getAttribute('data-mpw-empty') === null)
    },
  },

  /* ── B. 失败态（选了壁纸但取不到）：诊断占位，非纯黑、不全屏、可关闭、不吞交互 ── */
  { id: 'B1-plan-fetch-failed', run: (c) => { const p = loadEmptyState(c.html).api.plan({ err: '❌ 启动失败: pkgurl HTTP 404' }); return p.show === true && p.kind === 'fetch-failed' } },
  { id: 'B2-not-black', run: (c) => { const st = loadEmptyState(c.html).api.el().getAttribute('style') || ''; return /background:#ffffff/.test(st) && !/background:#000/.test(st) && !/background:#0d1117/.test(st) } },
  { id: 'B3-not-fullscreen', run: (c) => { const st = loadEmptyState(c.html).api.el().getAttribute('style') || ''; return /max-width/.test(st) && /bottom:\s*\d/.test(st) && !/top:\s*0/.test(st) && !/inset:\s*0/.test(st) } },
  {
    id: 'B4-closable', run: (c) => {
      const { api, byId, fire } = loadEmptyState(c.html)
      api.show('fetch-failed', 'pkgurl HTTP 404', '壁纸取不到')
      const el = byId.get('mpw-empty-state')
      const shown = el.getAttribute('data-mpw-empty') === 'fetch-failed' && el.style.display === 'block'
      fire(byId.get('mpw-empty-state-close'), 'click')
      const closed = el.getAttribute('data-mpw-empty') === null && el.style.display === 'none'
      return shown && closed
    },
  },
  { id: 'B5-no-pointer-swallow', run: (c) => { const st = loadEmptyState(c.html).api.el().getAttribute('style') || ''; return /pointer-events:none/.test(st) && (c.html.match(/pointer-events:auto/g) || []).length >= 2 } },
  {
    id: 'B6-show-hide', run: (c) => {
      const { api, byId } = loadEmptyState(c.html)
      api.show('fetch-failed', 'pkgurl HTTP 404', '壁纸取不到：容器打不开（404/超时）')
      const el = byId.get('mpw-empty-state')
      const shown = el.getAttribute('data-mpw-empty') === 'fetch-failed' && el.style.display === 'block' && byId.get('mpw-empty-state-title').textContent === '壁纸取不到：容器打不开（404/超时）'
      api.hide()
      return shown && el.getAttribute('data-mpw-empty') === null && el.style.display === 'none'
    },
  },

  /* ── C. 双向：喂正常壁纸 ⇒ A 与 B 都不得出现占位；真失败 ⇒ 必须看得见 ── */
  {
    id: 'C1-normal-wallpaper-green', run: (c) => {   // 双向①：正常壁纸 ⇒ 既**不判空态**，也**不出占位**
      const { api } = loadEmptyState(c.html, '?embed=1&pkgurl=http%3A%2F%2Fh%2Fraw%3Fcustom%3D1')
      const a = api.noWallpaper(Q('?embed=1&pkgurl=http%3A%2F%2Fh%2Fraw%3Fcustom%3D1'), true) === false
      const b = api.plan({ hasFrame: true, err: 'pkgurl HTTP 404' }).show === false
      return a && b
    },
  },
  {
    id: 'C2-real-failure-still-visible', run: (c) => {   // 反向：真的失败了（有来源）必须看得见 —— 不许"一律不显示"换绿
      const { api } = loadEmptyState(c.html, '?embed=1&pkgurl=http%3A%2F%2Fh%2Fraw%3Fcustom%3D1')
      const p = api.plan({ q: Q('?embed=1&pkgurl=http%3A%2F%2Fh%2Fraw'), embedded: true, err: '❌ 启动失败: pkgurl HTTP 404' })
      return p.show === true && p.kind === 'fetch-failed'
    },
  },

  /* ── D. 插件侧：旧 :8899 渲染器落点迁移（task-18 保留） ── */
  { id: 'D1-8899-root', run: (c) => loadMigration(c.client).migrate('http://127.0.0.1:8899/?pkgurl=X&embed=1') === 'http://127.0.0.1:8902/webloader/?pkgurl=X&embed=1' },
  { id: 'D2-localhost-8899', run: (c) => loadMigration(c.client).migrate('http://localhost:8899/') === 'http://127.0.0.1:8902/webloader/' },
  { id: 'D3-already-8902', run: (c) => { const u = 'http://127.0.0.1:8902/webloader/?pkgurl=X&embed=1'; return loadMigration(c.client).migrate(u) === u } },
  { id: 'D4-non-loopback', run: (c) => { const u = 'http://10.0.0.5:8899/?pkgurl=X'; return loadMigration(c.client).migrate(u) === u } },
  { id: 'D5-8899-with-path', run: (c) => { const u = 'http://127.0.0.1:8899/elysia/scene-scripts.js'; return loadMigration(c.client).migrate(u) === u } },
  { id: 'D6-garbage-safe', run: (c) => { const m = loadMigration(c.client).migrate; return m(undefined) === undefined && m('') === '' && m('not a url') === 'not a url' && m({}) instanceof Object } },
  { id: 'D7-rollback', run: (c) => { const m = loadMigration(c.client); const u = 'http://127.0.0.1:8899/?pkgurl=X'; return m.migrate(u, { sceneBaseLegacy: true }) === u && m.OFF({ sceneBaseLegacy: true }) === true } },
  { id: 'D8-target-consistent', run: (c) => { const t = loadMigration(c.client).TARGET; const m = /const MPW_SCENE_DEFAULT_BASE = "([^"]+)"/.exec(c.client); return !!m && m[1] === t } },
  {
    id: 'D9-wired-normalize', run: (c) => {
      const i = c.client.indexOf('function mpwNormalizeSection(s0)')
      if (i < 0) return false
      const body = c.client.slice(i, i + 6000)
      return /mpwMigrateLegacyRendererBase\(s0\.webUrl/.test(body) && /!webNeeds\)\s*return s0/.test(body)
    },
  },
  { id: 'D10-no-live-8899', run: (c) => !/(127\.0\.0\.1|localhost|\[::1\]):8899/.test(liveCode(c.client)) },
]

function runSuite(ctx) {
  const red = []
  for (const chk of CHECKS) { try { if (!chk.run(ctx)) red.push(chk.id) } catch (e) { red.push(chk.id) } }
  return red
}
const idsOf = (p) => CHECKS.map((x) => x.id).filter((i) => i.startsWith(p))
const sorted = (a) => a.slice().sort()

/* ══════════════ ① 真源码：必须全绿 ══════════════ */
console.log('\n== ① 真源码（demo.html + lib/client.js）==')
const redReal = runSuite({ html: HTML0, client: CLIENT0 })
for (const chk of CHECKS) ok(chk.id, !redReal.includes(chk.id))
console.log('  读数：断言 ' + CHECKS.length + ' 条，红 ' + redReal.length + ' 条' + (redReal.length ? ' → ' + redReal.join(',') : ''))

/* ══════════════ ② 变异自证：期望红集 == 实际红集 ══════════════ */
console.log('\n== ② 变异自证（把语义改坏 ⇒ 判据必须红；红集必须与期望逐条相等）==')
const MUTATIONS = [
  {
    name: 'M1 合法空态也弹占位（= P-343 的语义）',
    mk: (c) => ({ html: c.html.replace("if (legal) return { show: false, kind: 'legal-empty', title: '', detail: '' }", "if (legal) return { show: true, kind: 'fetch-failed', title: 'x', detail: '' }"), client: c.client }),
    expect: ['A5-plan-legal-empty-silent', 'A6-plan-from-url'],
  },
  {
    name: 'M2 占位改回全屏遮罩 + 深底 + 吞指针',
    mk: (c) => ({
      html: c.html
        .replace("'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);'", "'position:fixed;left:0;top:0;right:0;bottom:0;'")
        .replace('background:#ffffff;color:#1f2328;', 'background:#0d1117;color:#e6edf3;')
        .replace("text-align:left;pointer-events:none'", "text-align:center'"),
      client: c.client,
    }),
    expect: ['A9-not-an-interceptor', 'B2-not-black', 'B3-not-fullscreen', 'B5-no-pointer-swallow'],
  },
  {
    name: 'M3 删掉"空态 = 中性/透明底 + 藏 canvas"的规则',
    mk: (c) => ({ html: c.html.replace(/html\.mpw-no-wallpaper[^\n]*\n/g, ''), client: c.client }),
    expect: ['A7-no-fullscreen-black', 'A8-neutral-or-transparent-bg'],
  },
  {
    name: 'M4 空态证据判定失效（noWallpaper 恒 false）',
    mk: (c) => ({ html: c.html.replace('function mpwNoWallpaper(q, embedded) {', 'function mpwNoWallpaper(q, embedded) {\n    return false;'), client: c.client }),
    expect: ['A1-evidence-embed-nosource', 'A3-evidence-explicit', 'A6-plan-from-url', 'A12-show-blocked-in-empty'],
  },
  {
    name: 'M5 去掉 boot 里的合法空态短路（空态仍会去取默认包）',
    mk: (c) => {
      const i = c.html.indexOf('合法空态**：宿主显式把我当壁纸嵌进来')
      const j = c.html.indexOf("logf('加载场景 '")
      return { html: c.html.slice(0, c.html.lastIndexOf('/*', i)) + c.html.slice(j), client: c.client }
    },
    expect: ['A11-boot-short-circuit'],
  },
  {
    name: 'M6 show() 不再被空态闸门挡住',
    mk: (c) => ({ html: c.html.replace("if (mpwIsLegalEmptyNow() && String(kind) !== 'explicit') { mpwEmptyStateHide(); return null }", 'if (false) { }'), client: c.client }),
    expect: ['A12-show-blocked-in-empty'],
  },
  {
    name: 'M7 "关闭"按钮变成死按钮',
    mk: (c) => ({ html: c.html.replace("if (close) close.addEventListener('click', function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); mpwEmptyStateHide() })", "if (close) close.addEventListener('click', function (ev) {})"), client: c.client }),
    expect: ['B4-closable'],
  },
  {
    name: 'M8 一律不显示（把失败态也吞掉 = 用"不显示"换绿）',
    mk: (c) => ({ html: c.html.replace("    if (s.hasFrame) return { show: false, kind: 'rendering', title: '', detail: '' }", "    if (s.hasFrame) return { show: false, kind: 'rendering', title: '', detail: '' }\n    return { show: false, kind: 'silent', title: '', detail: '' }"), client: c.client }),
    expect: ['B1-plan-fetch-failed', 'C2-real-failure-still-visible'],
  },
  {
    name: 'M9 迁移函数退化成恒等（return u）',
    mk: (c) => ({ html: c.html, client: c.client.replace('return MPW_SCENE_MIGRATED_BASE.replace(/\\/+$/, "") + "/" + String(p.search || "");', 'return u;') }),
    expect: ['D1-8899-root', 'D2-localhost-8899'],
  },
  {
    name: 'M10 迁移目标改回旧默认 :8899',
    mk: (c) => ({ html: c.html, client: c.client.replace('const MPW_SCENE_MIGRATED_BASE = "http://127.0.0.1:8902/webloader/";', 'const MPW_SCENE_MIGRATED_BASE = "http://127.0.0.1:8899/";') }),
    expect: ['D1-8899-root', 'D2-localhost-8899', 'D8-target-consistent'],
  },
  {
    name: 'M11 归一化早退分支漏掉 webNeeds（存量档被静默跳过）',
    mk: (c) => ({ html: c.html, client: c.client.replace('if (!need && !bsNeeds && !phNeeds && !alphaFlip && !webNeeds) return s0;', 'if (!need && !bsNeeds && !phNeeds && !alphaFlip) return s0;') }),
    expect: ['D9-wired-normalize'],
  },
  {
    name: 'M12 在活代码里塞回回环 :8899 地址字面量',
    mk: (c) => ({ html: c.html, client: c.client.replace('function mpwNormalizeSection(s0) {', 'const MPW_STRAY_LEGACY = "http://127.0.0.1:8899/";\n\t\tfunction mpwNormalizeSection(s0) {') }),
    expect: ['D10-no-live-8899'],
  },
]
let mutBad = 0
for (const m of MUTATIONS) {
  const ctx = m.mk({ html: HTML0, client: CLIENT0 })
  const actual = sorted(runSuite(ctx))
  const expect = sorted(m.expect)
  const same = JSON.stringify(actual) === JSON.stringify(expect)
  if (!same) mutBad++
  console.log((same ? '  ✓ ' : '  ✗ ') + m.name)
  console.log('      期望红集 == 实际红集 : ' + (same ? '是' : '否') + '  期望[' + expect.join(',') + ']  实际[' + actual.join(',') + ']')
}
ok('② 全部 ' + MUTATIONS.length + ' 个变异体的「期望红集 == 实际红集」', mutBad === 0, '不一致 ' + mutBad + ' 个')

/* ══════════════ ③ 读数 ══════════════ */
console.log('\n== ③ 读数 ==')
const es = loadEmptyState(HTML0).api
console.log('  · 证据判定 ?embed=1（无来源）             → noWallpaper = ' + es.noWallpaper(Q('?embed=1'), true))
console.log('  · 证据判定 ?embed=1&pkgurl=…（选了壁纸）  → noWallpaper = ' + es.noWallpaper(Q('?embed=1&pkgurl=x'), true))
console.log('  · 证据判定 ?nowallpaper=1（宿主显式未选） → noWallpaper = ' + es.noWallpaper(Q('?nowallpaper=1'), false))
console.log('  · 空态裁决（合法空态 + 取包 404）         → ' + JSON.stringify(es.plan({ legalEmpty: true, err: '❌ 启动失败: pkgurl HTTP 404' })))
console.log('  · 失败裁决（有来源 + 取包 404）           → ' + JSON.stringify(es.plan({ err: '❌ 启动失败: pkgurl HTTP 404' })))
console.log('  · 占位样式（底部卡片/浅底/不吞指针）       → ' + (es.el().getAttribute('style') || '').slice(0, 150))
const mig = loadMigration(CLIENT0)
console.log('  · 旧 :8899 落点 → ' + mig.migrate('http://127.0.0.1:8899/?pkgurl=X&embed=1'))

console.log('\n' + (fail === 0 ? '✅ PASS' : '❌ FAIL') + '：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)

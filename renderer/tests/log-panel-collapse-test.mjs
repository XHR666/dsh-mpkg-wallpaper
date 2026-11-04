// log-panel-collapse-test.mjs — Q8（用户第 15 项）底部日志区可收纳：demo.html 内联面板脚本 + 假 DOM
//
// 需求逐条冻结（用户第 15 项原文）：
//   ① 手柄可往下拖 → 日志变矮，**剩余可见区域仍可滚动**（#log 保持 overflow:auto + 显式高度）
//   ② 拖到底/点箭头 → **完全收起**（日志本体 height=0 且 display:none = 离屏，不遮壁纸；只剩右下角小箭头）
//   ③ 收起后**箭头翻转**（▾ → ▴）可再拉出（点箭头或向上拖都行）
//   ④ 状态记 localStorage（'collapsed' / 高度比例），刷新后保持
//   ⑤ 纯前端：不碰渲染管线（只在 #log/#logbar 上写 style/class）
//
// 做法：从 demo.html 切出 `<script id="mpw-log-panel">` 的整段，喂给假 document/window/localStorage，
// 用真实事件回调驱动（pointerdown/move/up、keydown、resize），断言 DOM 侧的可观察结果。
import fs from 'node:fs'

const HTML = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')
const checks = []
const push = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })
const near = (a, b, eps = 0.51) => Math.abs(a - b) <= eps

function slicePanel(src) {
  const i = src.indexOf('<script id="mpw-log-panel">')
  if (i < 0) throw new Error('demo.html 里找不到 <script id="mpw-log-panel">')
  const j = src.indexOf('</script>', i)
  return src.slice(src.indexOf('>', i) + 1, j)
}
const PANEL_SRC = slicePanel(HTML)

// ── 假 DOM ─────────────────────────────────────────────────────────────────
function mkEl(id) {
  const el = {
    id, style: {}, title: '', textContent: '', _attrs: {}, _cls: new Set(), listeners: {},
    classList: {
      add: (c) => el._cls.add(c),
      remove: (c) => el._cls.delete(c),
      contains: (c) => el._cls.has(c),
    },
    setAttribute: (k, v) => { el._attrs[k] = String(v) },
    getAttribute: (k) => el._attrs[k],
    addEventListener: (t, h) => { (el.listeners[t] = el.listeners[t] || []).push(h) },
    fire: (t, ev) => { for (const h of (el.listeners[t] || [])) h(Object.assign({ preventDefault() {}, cancelable: true }, ev)) },
  }
  return el
}
function mkEnv({ search = '', store = {} } = {}) {
  const els = { log: mkEl('log'), logbar: mkEl('logbar'), logarrow: mkEl('logarrow'), logtip: mkEl('logtip') }
  const win = { innerHeight: 720, PointerEvent: function PointerEvent() {}, listeners: {} }
  win.addEventListener = (t, h) => { (win.listeners[t] = win.listeners[t] || []).push(h) }
  win.fire = (t, ev) => { for (const h of (win.listeners[t] || [])) h(Object.assign({ preventDefault() {}, cancelable: true }, ev)) }
  const doc = { getElementById: (id) => els[id] || null }
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
  }
  const run = new Function('document', 'window', 'localStorage', PANEL_SRC + '\nreturn window.__mpwLogPanel')
  const api = run(doc, win, ls)
  return { els, win, ls, store, api, log: els.log, bar: els.logbar, arrow: els.logarrow, tip: els.logtip }
}

console.log('[Q8] 底部日志区可收纳（demo.html 内联面板脚本 + 假 DOM）')
push('Q8a 面板脚本独立可运行且暴露 __mpwLogPanel', typeof mkEnv({}).api === 'object', 'srcLines=' + PANEL_SRC.split('\n').length)

// ① 默认 35vh 展开（与旧 max-height:35vh 等效），手柄贴在上沿
{
  const e = mkEnv()
  push('Q8b 默认展开 35vh（720 → 252px），日志可见', e.log.style.height === '252px' && e.log.style.display === '', JSON.stringify({ h: e.log.style.height, d: e.log.style.display }))
  push('Q8c 手柄 bottom = 日志高度（贴在日志上沿）', e.bar.style.bottom === '252px', e.bar.style.bottom)
  push('Q8d 默认箭头 ▾（可收起）', e.arrow.textContent === '▾' && !e.bar.classList.contains('collapsed'), e.arrow.textContent)
  push('Q8e 日志保持 overflow:auto（部分拉下后剩余区域滚动由 CSS 保证）', /#log\{[^}]*overflow:auto/.test(HTML), '#log 规则')
  push('Q8f aria-expanded=true', e.bar.getAttribute('aria-expanded') === 'true')
}

// ② 点箭头 → 完全收起（离屏、不遮壁纸）；③ 箭头翻转；点回去 → 恢复
{
  const e = mkEnv()
  e.bar.fire('pointerdown', { clientY: 468, pointerId: 1 })
  e.win.fire('pointerup', { clientY: 468, pointerId: 1 })          // 没移动 = 点击（up 监听在 window 上）
  push('Q8g 点箭头 → 完全收起：日志 height=0 + display:none（离屏不遮壁纸）',
    e.log.style.height === '0px' && e.log.style.display === 'none', JSON.stringify({ h: e.log.style.height, d: e.log.style.display }))
  push('Q8h 收起后手柄 bottom=0 且缩成右下角小药丸（collapsed 类）', e.bar.style.bottom === '0px' && e.bar.classList.contains('collapsed'))
  push('Q8i 收起后箭头翻转 ▴ 且 aria-expanded=false', e.arrow.textContent === '▴' && e.bar.getAttribute('aria-expanded') === 'false', e.arrow.textContent)
  push('Q8j 收起状态写入 localStorage（key mpw-log-h = collapsed）', e.store['mpw-log-h'] === 'collapsed', JSON.stringify(e.store))
  e.bar.fire('pointerdown', { clientY: 700, pointerId: 2 })
  e.win.fire('pointerup', { clientY: 700, pointerId: 2 })          // 再点一次 = 拉出
  push('Q8k 再点箭头 → 拉回上次高度 252px（箭头回 ▾）', e.log.style.height === '252px' && e.arrow.textContent === '▾' && !e.bar.classList.contains('collapsed'), e.log.style.height)
}

// ④ 拖动：往上拖 = 变高、往下拖 = 变矮（部分可见）；拖动结束保存比例；<24px 吸附为完全收起
{
  const e = mkEnv()
  e.bar.fire('pointerdown', { clientY: 468, pointerId: 1 })         // h=252
  e.win.fire('pointermove', { clientY: 468 - 200, pointerId: 1 })   // 上拖 200 → 452
  push('Q8l 向上拖 200px → 高度 252→452（日志变高）', e.log.style.height === '452px' && e.bar.style.bottom === '452px', e.log.style.height)
  e.win.fire('pointerup', { clientY: 268, pointerId: 1 })
  push('Q8m 拖动结束写入比例（452/720≈0.628）', near(Number(e.store['mpw-log-h']), 0.628, 0.002), String(e.store['mpw-log-h']))
  e.bar.fire('pointerdown', { clientY: 268, pointerId: 2 })
  e.win.fire('pointermove', { clientY: 268 + 120, pointerId: 2 })   // 下拖 120 → 332（部分拉下）
  push('Q8n 向下拖 120px → 高度 452→332（部分拉下，内容仍可滚动）', e.log.style.height === '332px' && e.log.style.display === '', e.log.style.height)
  e.win.fire('pointermove', { clientY: 468 + 400, pointerId: 2 })   // 一路拖过底 → 吸附 0
  push('Q8o 拖到 <24px → 吸附为完全收起（collapsed）', e.log.style.height === '0px' && e.bar.classList.contains('collapsed'), e.log.style.height)
  e.win.fire('pointerup', { clientY: 868, pointerId: 2 })
  // 收起后向上拖也能拉出（不必点箭头）
  e.bar.fire('pointerdown', { clientY: 704, pointerId: 3 })
  e.win.fire('pointermove', { clientY: 704 - 300, pointerId: 3 })
  push('Q8p 收起状态下向上拖 300px → 直接拉出 300px', e.log.style.height === '300px' && !e.bar.classList.contains('collapsed'), e.log.style.height)
  e.win.fire('pointerup', { clientY: 404, pointerId: 3 })
}

// ⑤ 高度上限/窗口缩放/键盘
{
  const e = mkEnv()
  e.bar.fire('pointerdown', { clientY: 468, pointerId: 1 })
  e.win.fire('pointermove', { clientY: -5000, pointerId: 1 })       // 疯狂上拖
  push('Q8q 高度封顶 85% 窗口（720 → 612px）', e.log.style.height === '612px', e.log.style.height)
  e.win.fire('pointerup', { clientY: 108, pointerId: 1 })
  e.win.innerHeight = 1000
  e.win.fire('resize', {})
  push('Q8r 窗口缩放后按比例重算（0.85×1000=850 → 封顶 850）', e.log.style.height === '850px', e.log.style.height)
  e.bar.fire('keydown', { key: 'End' })
  push('Q8s 键盘 End → 收起', e.log.style.height === '0px' && e.store['mpw-log-h'] === 'collapsed', e.log.style.height)
  e.bar.fire('keydown', { key: 'Enter' })
  push('Q8t 键盘 Enter → 展开回比例高度', e.log.style.height === '850px', e.log.style.height)
  e.bar.fire('keydown', { key: 'ArrowDown' })
  push('Q8u 键盘 ArrowDown → 降 32px', e.log.style.height === '818px', e.log.style.height)
  e.bar.fire('keydown', { key: 'Home' })
  push('Q8v 键盘 Home → 回到默认 35%', e.log.style.height === '350px', e.log.style.height)
}

// ⑥ 刷新记忆：'collapsed' 与比例两种历史值都能还原
{
  const c = mkEnv({ store: { 'mpw-log-h': 'collapsed' } })
  push('Q8w 上次收起 → 重载仍是收起（日志离屏 + 箭头 ▴）', c.log.style.height === '0px' && c.log.style.display === 'none' && c.arrow.textContent === '▴')
  const f = mkEnv({ store: { 'mpw-log-h': '0.500' } })
  push('Q8x 上次半开 → 重载还原 50%（720→360px）', f.log.style.height === '360px' && f.arrow.textContent === '▾', f.log.style.height)
  const bad = mkEnv({ store: { 'mpw-log-h': 'garbage' } })
  push('Q8y 非法记忆值 → 回落默认 35%', bad.log.style.height === '252px', bad.log.style.height)
  // localStorage 抛错（插件 strict 不透明源）不得让面板崩掉
  const els = { log: mkEl('log'), logbar: mkEl('logbar'), logarrow: mkEl('logarrow'), logtip: mkEl('logtip') }
  const win = { innerHeight: 720, PointerEvent: function PointerEvent() {}, addEventListener: () => {} }
  const throwing = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('SecurityError') } }
  let threw = null
  try { new Function('document', 'window', 'localStorage', PANEL_SRC)({ getElementById: (id) => els[id] || null }, win, throwing) } catch (e) { threw = e.message }
  push('Q8z 不透明源（localStorage 抛 SecurityError）下面板仍可用', threw === null && els.log.style.height === '252px', String(threw))
}

// ⑦ 不影响渲染/上报：日志文本仍原样可取（height 只是样式），且不新增 URL 开关
{
  push('Q8aa 面板只写 #log/#logbar 的样式与 class，不搬动日志节点（textContent 仍由 logf 追加）', /logEl\.style\.height/.test(PANEL_SRC) && !/innerHTML|removeChild|appendChild/.test(PANEL_SRC))
  const flags = [...HTML.matchAll(/new URLSearchParams\(location\.search\)\.(?:get|has)\('([\w-]+)'\)/g)].map((m) => m[1])
  push('Q8ab Q8 未引入新 URL 开关（纯 localStorage 记忆，diag-flags 计数不变）', !flags.includes('log') && flags.includes('noparticles') && flags.includes('pts'), JSON.stringify([...new Set(flags)].slice(0, 6)) + '…')
}

let pass = 0
for (const c of checks) { console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail !== undefined ? '  — ' + c.detail : ''}`); if (c.ok) pass++ }
console.log(`\n${pass}/${checks.length} 通过（Q8 日志区收纳）`)
process.exit(pass === checks.length ? 0 : 1)

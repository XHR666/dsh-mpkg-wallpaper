// 一次性 UI 表面审计：用 playwright 连 Android WebView CDP（9222），逐处打开/悬停，采集浮层表面数据。
// 用法: node tools/ui-surface-audit.mjs <out.json>
import { chromium } from 'playwright'
import fs from 'node:fs'

const outFile = process.argv[2] || '/tmp/ui-audit.json'
const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = b.contexts()[0]
const p = ctx.pages().find((x) => x.url().includes('127.0.0.1:3080')) || ctx.pages()[0]
await p.bringToFront().catch(() => {})

const dump = () => p.evaluate(() => {
  const surfaces = []
  const sel = 'div,ul,section,aside,nav'
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect()
    if (r.width < 80 || r.height < 24 || r.width > innerWidth * 0.98 * 1.02) continue
    const s = getComputedStyle(el)
    const bb = getComputedStyle(el, '::before')
    const isOverlay = s.position === 'fixed' || s.position === 'absolute'
    if (!isOverlay) continue
    const bg = s.backgroundColor
    const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)'
    const bBg = bb.backgroundColor && bb.backgroundColor !== 'rgba(0, 0, 0, 0)' ? bb.backgroundColor : ''
    const bd = (s.backdropFilter && s.backdropFilter !== 'none') ? s.backdropFilter : ''
    const bbd = (bb.backdropFilter && bb.backdropFilter !== 'none') ? bb.backdropFilter : ''
    if (!hasBg && !bBg && !bd && !bbd) continue
    surfaces.push({
      cls: String(el.className || el.tagName).slice(0, 70),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      z: s.zIndex, bg: hasBg ? bg.slice(0, 60) : '', bBg: bBg.slice(0, 50), bd: bd.slice(0, 40), bbd: bbd.slice(0, 34),
      border: (s.borderTopWidth + ' ' + s.borderTopColor).slice(0, 40), radius: s.borderRadius.slice(0, 16),
    })
  }
  return { url: location.href, attrs: [].slice.call(document.body.attributes).filter((a) => a.name.indexOf('data-mpw') === 0).map((a) => a.name), surfaces: surfaces.slice(0, 14) }
})

const esc = async () => { for (let i = 0; i < 2; i++) { await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(120) } }
const blank = async () => { await p.mouse.click(640, 700).catch(() => {}); await p.waitForTimeout(150) }

const DANGER = /暂停|停止|发送|继续执行目标|pause|stop|kill|interrupt/i
const find = (spec) => p.evaluate((s) => {
  const all = [].slice.call(document.querySelectorAll('button,[role="button"],div,span,a,li'))
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.width < 6 || r.height < 6 || r.y < -5 || r.y > innerHeight) continue
    const t = (el.textContent || '').trim()
    const a = el.getAttribute('aria-label') || ''
    let hit = false
    if (/暂停|停止|发送|继续执行目标|pause|stop|kill|interrupt/i.test(t + '|' + a)) return null
    if (s.text && t === s.text) hit = true
    else if (s.textRe && new RegExp(s.textRe).test(t) && t.length < (s.maxLen || 20)) hit = true
    else if (s.ariaRe && new RegExp(s.ariaRe).test(a)) hit = true
    else if (s.clsRe && new RegExp(s.clsRe).test(String(el.className))) hit = true
    if (s.yMin && r.y < innerHeight * s.yMin) hit = false
    if (!hit) continue
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), t: t.slice(0, 18), a: a.slice(0, 18) }
  }
  return null
}, spec)

const targets = [
  { id: 'hover-new-session', kind: 'hover', spec: { text: '新会话', yMax: 200 } },
  { id: 'hover-sidebar-row', kind: 'hover', spec: { clsRe: 'sessionRow', yMin: 0.4 } },
  { id: 'hover-rail-mark', kind: 'hover', spec: { clsRe: 'eGxaPq_mark(?!Unloaded)' } },
  { id: 'click-more-menu', kind: 'click', spec: { text: '更多', yMin: 0.85 } },
  { id: 'click-settings', kind: 'click', spec: { text: '设置', yMin: 0.5 } },
  { id: 'click-plus-menu', kind: 'click', spec: { ariaRe: '加号|附件|上传|更多操作', yMin: 0.7 } },
  { id: 'click-permission', kind: 'click', spec: { textRe: '权限|完全权限|工作区内修改', yMin: 0.7, maxLen: 12 } },
  { id: 'click-model', kind: 'click', spec: { textRe: 'DeepSeek-V4|1017', yMin: 0.7, maxLen: 24 } },
  { id: 'click-reasoning', kind: 'click', spec: { textRe: '^(Max|High|Low|Off)$', yMin: 0.7 } },
  { id: 'click-bgtask', kind: 'click', spec: { textRe: '个后台任务运行中', maxLen: 20 } },
  { id: 'click-subagent', kind: 'click', spec: { textRe: '个子智能体', maxLen: 20 } },
  { id: 'click-team', kind: 'click', spec: { text: '智能体团队' } },
  { id: 'click-outline', kind: 'click', spec: { textRe: '历史提问|大纲', maxLen: 14 } },
  { id: 'click-header-dots', kind: 'click', spec: { ariaRe: '更多|菜单|设置', yMax: 0.15 } },
  { id: 'click-right-toggle', kind: 'click', spec: { ariaRe: '侧边栏|右侧|面板' } },
  { id: 'click-plugins', kind: 'click', spec: { text: '插件' } },
  { id: 'click-recycle', kind: 'click', spec: { text: '回收站' } },
]

const results = []
for (const t of targets) {
  const rec = { id: t.id, kind: t.kind, ok: false }
  try {
    await esc(); await blank()
    // filter yMax in find via separate pass is not supported by spec schema; approximate: use returned el
    const el = await find({ ...t.spec, yMax: undefined })
    if (!el) { rec.err = 'target not found'; results.push(rec); continue }
    // yMax check (avoid header dots hitting sidebar '更多')
    if (t.spec.yMax && el.y > innerHeight * t.spec.yMax) { rec.err = 'yMax skip'; results.push(rec); continue }
    if (/暂停|停止|发送|继续执行目标|pause|stop/i.test((el.t || '') + '|' + (el.a || ''))) { rec.err = 'danger target skip'; results.push(rec); continue }
    rec.target = el
    if (t.kind === 'hover') { await p.mouse.move(el.x - 3, el.y - 3); await p.waitForTimeout(80); await p.mouse.move(el.x, el.y); await p.waitForTimeout(900) }
    else { await p.mouse.click(el.x, el.y); await p.waitForTimeout(900) }
    rec.data = await dump()
    rec.ok = true
  } catch (e) { rec.err = String(e && e.message || e).slice(0, 160) }
  results.push(rec)
  process.stderr.write('  done ' + t.id + (rec.ok ? ' ✓' : ' ✗ ' + (rec.err || '')) + '\n')
}
await esc(); await blank()
fs.writeFileSync(outFile, JSON.stringify({ at: Date.now(), results }, null, 1))
console.log('WROTE ' + outFile + ' targets=' + results.length + ' ok=' + results.filter((r) => r.ok).length)
await b.close()

// tools/sidebar-frost-team-panel-test.mjs —— P-307：展开「智能体团队」不得摘掉左侧栏磨砂（用户 bug 回归）
//
// 现象（用户原话）：「把智能体团队展开时，会导致左侧边栏的模糊效果消失；一关闭又恢复」。
// 根因（真机读数 + 源码切片复现，见 docs/HEADER-FROST.md §8）：
//   `setupSblurObserver()` 的 `check()` 原来在**全文档**里找"近全屏 fixed 弹层"（第一支），
//   而智能体团队面板（DSH `dsh-experimental-client-ui-agent-team` 的 `.VoX2oq_panel`，
//   `role=dialog` + `data-team-panel`，`position:fixed`，`max-height:min(680px,100vh-32px)`）
//   是 `createPortal(…, document.body)` ⇒ 与侧栏**没有祖先关系**，"侧栏 backdrop-filter 变成
//   fixed 后代 containing block"这个问题根本不存在，却照样触发 `data-mpw-sblur-off`
//   ⇒ `buildCss` 的 `body[data-mpw-sblur-off] [class*="sidebarCol"]{backdrop-filter:none!important}`
//   把侧栏磨砂摘掉。收起时 portal 节点卸载 ⇒ 属性摘除 ⇒ 磨砂恢复（与用户描述逐字吻合）。
// 修法（P-307）：第一支限定为"**真的是 `[class*="sidebarCol"]` 后代**"（第二支本来就这样）；
//   回退位 `?sblurscope=legacy` ⇒ 逐位回"全文档"口径。**不动任何 CSS**。
//
// 判据三段 + 变异自证（期望红集 == 实际红集）：
//   A 纯逻辑：把真源码的 `SBLUR_SCOPE_LEGACY`/`mpwInSidebarSubtree`/`isFullDlg`/`isOpenOverlay`/`hasDlg`
//     切出来（**不复制逻辑**），在假 DOM 上跑六种世界；
//   B 属性落点：`tools/_stub.mjs` 跑**真插件 + 真 `check()`**（钩子 `__mpwLifecycleTest.sblurCheck`），
//     断言 body portal 面板**不**打 `data-mpw-sblur-off`、sidebarCol 后代 overlay **打**；
//     ⚠ 口径如实标注：B 段**不扩 `_stub`**，只在**用例内**覆盖 `document.querySelectorAll`/`getComputedStyle`/
//     `innerWidth/innerHeight`（避免影响其余 20 个用桩的测试）；这是"用例内假 DOM"，不是桩的默认语义。
//   C CSS 面：侧栏磨砂基础规则仍带 `:not([data-mpw-holds-layer])`、摘除规则仍只由 `sblur-off` 触发
//     （本次修法不改 CSS ⇒ 防将来误改）。
// 用法: node tools/sidebar-frost-team-panel-test.mjs
//   MPW_SBLUR_CLIENT=<file>  —— 只读别的副本（变异自证用；默认 lib/client.js）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadPlugin } from './_stub.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const CLIENT = process.env.MPW_SBLUR_CLIENT || path.join(ROOT, 'lib', 'client.js')
const src = fs.readFileSync(CLIENT, 'utf8')
const CHILD = process.argv.includes('--child')

const rows = []
const ok = (id, why, cond, detail = '') => rows.push({ id, why, pass: !!cond, detail: String(detail) })
/* `_stub` 只能给 globalThis 打桩一次，且 client.js 首句是 `if (globalThis.__mpwClientLoaded) return …`
   ⇒ 重复装载（B4 换 `?sblurscope=legacy` 再装一次）前必须清掉模块标记（与 bs-compat-default-test 同法）。 */
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce', '__mpwBsVerAt', '__mpwGlobalWired', '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwSectionTest', '__mpwLifecycleTest']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* 删不掉也不抛 */ } } }

/* ══════════════════ A. 切片：真源码（找不到就红，绝不静默） ══════════════════ */
const sScope = src.indexOf('const SBLUR_SCOPE_LEGACY')
const sHooks = src.indexOf('let mpwSblurCheck = null;')
const sFull = src.indexOf('const isFullDlg = (el) => {')
const sOpen = src.indexOf('const isOpenOverlay = (el) => {')
const sHas = src.indexOf('const hasDlg = Array.from(')
const sHasEnd = src.indexOf(';', src.indexOf('isFullDlg);', sHas))
const found = sScope > 0 && sHooks > sScope && sFull > sHooks && sOpen > sFull && sHas > sOpen && sHasEnd > sHas
if (!CHILD) {
  ok('A0', '真源码五个锚点可定位（SBLUR_SCOPE_LEGACY / mpwSblurCheck / isFullDlg / isOpenOverlay / hasDlg）',
    found, `scope=${sScope} hooks=${sHooks} full=${sFull} open=${sOpen} has=${sHas}`)
}
const BLOCK = found ? [
  src.slice(sScope, sHooks + 'let mpwSblurCheck = null;'.length),
  src.slice(sFull, sOpen),
  src.slice(sOpen, sHas),
  src.slice(sHas, sHasEnd + 1),
].join('\n') : ''

/* 假 DOM（只实现本判定用到的 API；与真 DOM 同语义：computed / rect / closest / 属性） */
const matchOne = (el, one) => {
  one = one.trim()
  if (!el || el.nodeType !== 1) return false
  const desc = one.split(/\s+/)
  if (desc.length > 1) {                       // 后代选择器 A B：subject 只可能是最后一个 token
    const subject = desc[desc.length - 1]
    if (!matchOne(el, subject)) return false
    let p = el.parentElement
    while (p) { if (matchOne(p, desc.slice(0, -1).join(' '))) return true; p = p.parentElement }
    return false
  }
  const cls = String(el.className || '')
  let m
  if ((m = /^\[class\*=?"?([^"\]]+)"?\]$/.exec(one))) return cls.includes(m[1])
  if ((m = /^\.([\w-]+)$/.exec(one))) return cls.split(/\s+/).includes(m[1])
  if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(one))) return el.getAttribute(m[1]) === m[2]
  if ((m = /^\[([\w-]+)\]$/.exec(one))) return el.hasAttribute(m[1])
  if ((m = /^([a-z]+)\[([\w-]+)\]$/i.exec(one))) return el.tagName === m[1].toUpperCase() && el.hasAttribute(m[2])
  return false
}
const matches = (el, sel) => String(sel).split(',').some((one) => matchOne(el, one))
const mkNode = (o = {}) => {
  const attrs = new Map(Object.entries(o.attrs || {}))
  const n = {
    nodeType: 1, tagName: String(o.tag || 'div').toUpperCase(), className: o.cls || '', style: {}, dataset: {},
    parentElement: o.parent || null, children: [],
    __cs: o.cs || { position: o.fixed ? 'fixed' : 'static', display: 'block', visibility: 'visible', opacity: '1', backdropFilter: 'none' },
    __rect: o.rect || { width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 },
    classList: {
      add: (c) => { n.className = (n.className + ' ' + c).trim() },
      remove: (c) => { n.className = n.className.split(/\s+/).filter((x) => x && x !== c).join(' ') },
      contains: (c) => n.className.split(/\s+/).includes(c),
    },
    setAttribute: (k, v) => attrs.set(String(k), String(v)),
    getAttribute: (k) => (attrs.has(String(k)) ? attrs.get(String(k)) : null),
    removeAttribute: (k) => attrs.delete(String(k)),
    hasAttribute: (k) => attrs.has(String(k)),
    appendChild: (c) => { n.children.push(c); c.parentElement = n; return c },
    querySelector: () => null, querySelectorAll: () => [],
    closest: (sel) => { let cur = n; while (cur) { if (matches(cur, sel)) return cur; cur = cur.parentElement } return null },
    getBoundingClientRect: () => n.__rect,
    matches: (sel) => matches(n, sel), contains: () => false,
  }
  if (o.parent) o.parent.children.push(n)
  return n
}
const mkDoc = (nodes, body) => ({ body, documentElement: mkNode({ tag: 'html' }), querySelectorAll: (sel) => nodes.filter((n) => matches(n, sel)) })

const VH = 900, VW = 1440
const rect = (w, h) => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h })
const evalPredicate = (nodes, search, vh = VH) => {
  if (!found) return null
  const body = mkNode({ tag: 'body' })
  const doc = mkDoc(nodes, body)
  const fn = new Function('document', 'window', 'getComputedStyle', 'location',
    BLOCK + '\n; return { hasDlg: hasDlg, legacy: SBLUR_SCOPE_LEGACY };')
  return fn(doc, { innerWidth: VW, innerHeight: vh }, (el) => el.__cs, { search: search || '' })
}
// 病例（真机形态）：① team panel = body portal + fixed + role=dialog + 最多 680px 高
const mkTeam = (parent, h = 680) => mkNode({ cls: 'VoX2oq_panel', role: 'dialog', fixed: true, parent, rect: rect(500, h), attrs: { role: 'dialog' } })
// ② 设置弹窗 = **sidebarCol 的后代**（真机已知案例：VOzbGW_overlay，摘磨砂是**必要**的，防 254px）
const mkSettings = (parent) => mkNode({ cls: 'VOzbGW_overlay', fixed: true, parent, rect: rect(1440, 900) })

const teamPortal = evalPredicate([mkTeam(mkNode({ tag: 'body' }))], '')
const sidebarNode = mkNode({ cls: 'pI_x6G_sidebarCol' })
const settingsInSidebar = evalPredicate([sidebarNode, mkSettings(sidebarNode)], '')
const empty = evalPredicate([mkNode({ cls: 'pI_x6G_sidebarCol' })], '')
const sbA4 = mkNode({ cls: 'pI_x6G_sidebarCol' })
const teamInSidebar = evalPredicate([sbA4, mkTeam(sbA4)], '')
const teamShort = evalPredicate([mkTeam(mkNode({ tag: 'body' }), 500)], '')
const teamLegacy = evalPredicate([mkTeam(mkNode({ tag: 'body' }))], '?sblurscope=legacy')
ok('A1', '体 portal 的智能体团队面板（fixed role=dialog 500×680, vh=900）⇒ **不**触发摘除', teamPortal && teamPortal.hasDlg === false, JSON.stringify(teamPortal))
ok('A2', '设置弹窗（sidebarCol 后代 1440×900）⇒ 仍触发摘除（254px 修复保持）', settingsInSidebar && settingsInSidebar.hasDlg === true, JSON.stringify(settingsInSidebar))
ok('A3', '没有任何弹层 ⇒ 不触发', empty && empty.hasDlg === false, JSON.stringify(empty))
ok('A4', '同一面板若挂到 sidebarCol 下 ⇒ 触发（判据有分辨力）', teamInSidebar && teamInSidebar.hasDlg === true, JSON.stringify(teamInSidebar))
ok('A5', '?sblurscope=legacy ⇒ 回到旧"全文档"口径（team panel 也触发）', teamLegacy && teamLegacy.hasDlg === true && teamLegacy.legacy === true, JSON.stringify(teamLegacy))
ok('A6', '面板高度 < 70%vh（500 < 630）⇒ 不触发（高度判据仍生效）', teamShort && teamShort.hasDlg === false, JSON.stringify(teamShort))

/* ══════════════════ B. 真实现 + 桩：属性落点 ══════════════════ */
const armDom = (nodes) => {
  const doc = globalThis.document
  globalThis.innerWidth = VW
  globalThis.innerHeight = VH
  doc.querySelectorAll = (sel) => nodes.filter((n) => matches(n, sel))
  globalThis.getComputedStyle = (el) => (el && el.__cs) || { position: 'static', display: 'block', visibility: 'visible', opacity: '1', backdropFilter: 'none' }
  return doc
}
if (!CHILD) {
  let boot = null, hooks = null
  try { boot = loadPlugin({ quiet: true }); hooks = globalThis.__mpwLifecycleTest } catch (e) { boot = null }
  ok('B0', '真插件装载 + 判据钩子 `__mpwLifecycleTest.sblurCheck` 已接线',
    !!(hooks && typeof hooks.sblurCheck === 'function' && typeof hooks.sblurScopeLegacy === 'function'), boot ? 'ok' : 'loadPlugin 抛错')
  if (hooks && typeof hooks.sblurCheck === 'function') {
    const body = globalThis.document.body
    // B1 body portal 面板 ⇒ 不摘
    armDom([mkTeam(body)])
    const r1 = hooks.sblurCheck()
    ok('B1', '真 check()：body portal 的 role=dialog 面板 ⇒ body **不**带 data-mpw-sblur-off',
      r1 && r1.ready === true && r1.off === false, JSON.stringify(r1))
    // B2 sidebarCol 后代 overlay ⇒ 摘（回归：254px 修复）
    globalThis.document.body.removeAttribute('data-mpw-sblur-off')
    const sb = mkNode({ cls: 'pI_x6G_sidebarCol' })
    armDom([sb, mkSettings(sb)])
    const r2 = hooks.sblurCheck()
    ok('B2', '真 check()：sidebarCol 后代的 overlay ⇒ body **带** data-mpw-sblur-off（254px 修复保持）',
      r2 && r2.ready === true && r2.off === true, JSON.stringify(r2))
    // B3 空 ⇒ 不摘
    globalThis.document.body.removeAttribute('data-mpw-sblur-off')
    armDom([])
    const r3 = hooks.sblurCheck()
    ok('B3', '真 check()：无弹层 ⇒ body 不带 data-mpw-sblur-off', r3 && r3.ready === true && r3.off === false, JSON.stringify(r3))
    // B4 回退档接线：?sblurscope=legacy ⇒ 面板在 body 也摘（逐位回旧）
    reset()
    try { loadPlugin({ quiet: true, search: '?sblurscope=legacy' }) } catch (e) { /* 见断言 */ }
    const h2 = globalThis.__mpwLifecycleTest
    const legacyOn = h2 && typeof h2.sblurScopeLegacy === 'function' ? h2.sblurScopeLegacy() : null
    const body2 = globalThis.document.body
    armDom([mkTeam(body2)])
    const r4 = h2 && typeof h2.sblurCheck === 'function' ? h2.sblurCheck() : null
    ok('B4', "回退位接线：?sblurscope=legacy ⇒ legacy=true 且面板在 body 也摘除（逐位回旧口径）",
      legacyOn === true && r4 && r4.ready === true && r4.off === true, `legacy=${legacyOn} ${JSON.stringify(r4)}`)
  }
}

/* ══════════════════ C. CSS 面（本次修法不改 CSS；变异子进程只跑 A 段 ⇒ 期望红集恰为 ['A1']） ══════════════════ */
if (!CHILD) {
  ok('C1', '侧栏磨砂基础规则仍带 :not([data-mpw-holds-layer])',
    /body\[data-mpw-sblur\] \[class\*="sidebarCol"\]:not\(\[data-mpw-holds-layer\]\)/.test(src), '')
  ok('C2', '摘除规则仍只由 body[data-mpw-sblur-off] 触发（未改成别的作用域）',
    /body\[data-mpw-sblur\]\[data-mpw-sblur-off\] \[class\*="sidebarCol"\]/.test(src), '')
  ok('C3', 'CSS 里没有出现 sblurscope（回退位只在 JS 判定层，不落 CSS）',
    !/data-mpw-sblur[^\n]*sblurscope/.test(src) && !/sblurscope[^\n]*backdrop-filter/.test(src), '')
  ok('C4', 'hasDlg 第一支就是本次修法点（SBLUR_SCOPE_LEGACY || mpwInSidebarSubtree(el)）',
    found && /some\(\(el\) => \(SBLUR_SCOPE_LEGACY \|\| mpwInSidebarSubtree\(el\)\) && isOpenOverlay\(el\)\)/.test(src), '')
}

/* ══════════════════ 变异自证：把修法撤掉 ⇒ 期望红集 ['A1'] ══════════════════ */
const failed = rows.filter((r) => !r.pass).map((r) => r.id)
if (CHILD) {
  console.log('MUTANT-RED:' + JSON.stringify(failed))
  process.exit(failed.length ? 1 : 0)
}
let mutOk = false, mutDetail = '未跑'
try {
  const mutated = src.replace(
    'some((el) => (SBLUR_SCOPE_LEGACY || mpwInSidebarSubtree(el)) && isOpenOverlay(el))',
    'some(isOpenOverlay)')
  if (mutated === src) throw new Error('变异替换点未命中（修法措辞变了）')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-sblur-mut-'))
  const f = path.join(dir, 'client.mutant.js')
  fs.writeFileSync(f, mutated)
  const out = (() => { try { return execFileSync(process.execPath, [path.join(import.meta.dirname, 'sidebar-frost-team-panel-test.mjs'), '--child'], { env: Object.assign({}, process.env, { MPW_SBLUR_CLIENT: f }), encoding: 'utf8' }) } catch (e) { return String((e && e.stdout) || '') } })()
  const m = /MUTANT-RED:(\[.*\])/.exec(out)
  const got = m ? JSON.parse(m[1]) : null
  const want = ['A1']
  mutOk = Array.isArray(got) && got.length === want.length && got.every((x, i) => x === want[i])
  mutDetail = `红集=${JSON.stringify(got)}（期望 ${JSON.stringify(want)}）`
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
} catch (e) { mutDetail = '变异自证异常: ' + String(e && e.message || e).slice(0, 160) }
ok('M1', '变异自证：撤掉"限侧栏后代"⇒ 恰好 A1 变红', mutOk, mutDetail)

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + (r.detail ? ' — ' + r.detail : ''))
if (mutOk) console.log('    MUTANT-RED-OK M1 ' + mutDetail)
console.log(`===== sidebar-frost-team-panel: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

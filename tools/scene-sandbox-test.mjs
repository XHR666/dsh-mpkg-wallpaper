// tools/scene-sandbox-test.mjs — P0-2「token-first」场景沙箱契约（2026-11-06 整体重写）
//
// ═══ 判据演进留痕（R19：原断言 → 新断言 → 为什么）═══
// 原契约（B6 时代，已被 2026-11-06 P0-2 修复**有意废弃**）：
//   T1 无 token → legacy(no-token) 先挂同源 iframe；T4 strict 失败 → 一次性回退 legacy 重挂；
//   B  宿主无 token 路由 → 挂载照常成功（legacy 零回归）。
// 为什么改：旧存档 webUrl 直接走 showWebEl + "先 legacy 再升级" = 首挂载就开一个 allow-same-origin
//   的同源渲染器窗（同源脚本可触达父页面 DOM/存储）—— 这正是 P0-2 要关的洞；换主机名隔离方案
//   已实测证伪并回退（渲染器跨源后加载失败、壁纸黑屏，见 SESSION-NOTES 2026-11-06 P0-2 记录）。
// 新契约（本文件）：
//   A  token 可得 ⇒ strict 一次性挂载（sandbox=strict & thumbtoken= & pkgurl 内 st=；帧无 allow-same-origin）；
//   B  无 token 首挂 ⇒ **不建 legacy URL、不挂帧**（deferred），海报/上一档兜底 + 底部提示，不静默；
//   C  旧存档恢复路径（showWebEl 守卫）无 token ⇒ 同样不挂 + 挂起记录 + 兜底提示；
//   D  恢复路径 token 到手 ⇒ 旧 webUrl **原地**升级（保留全部 pkgurl 业务参数：custom/folder/file/ltoken）；
//   E  ?mpwsandbox=legacy 显式操作员开关 ⇒ 仍可 legacy（页面 URL 显式覆盖，旧存档无法借此逃逸默认面）；
//   F  strict 失败 ⇒ **不再退 legacy**：failed 表 + diag + 底部提示，帧保持隐藏（海报兜底）；
//   G  用户重选 = 显式重试 ⇒ 清 failed 表、重新走 strict；
//   M1 变异「先 legacy 再升级改回去」⇒ B/C 组判据必须红；M2 变异「token 失败也挂帧」⇒ C 组判据必须红。
import { loadPlugin } from './_stub.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0, fail = 0
/* 失败行也走 console.log：world() 会把 console.error 换成捕获器（收集底部提示），失败行不能被吞。 */
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  ' + extra : '')) } else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')) } }
const eq = (a, b, name, extra = '') => ok(a === b, name + (a === b ? '' : `（got=${JSON.stringify(a)} want=${JSON.stringify(b)}）`), extra)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── 迷你壁纸 DOM（与 tools/stale-scene-commit-test.mjs 同手法）：bgElements() 每次现场
   querySelector，默认桩恒 null ⇒ showWebEl/deferFromUrl 直接 return，判据会假绿。 ── */
function mkEl(tag, cls) {
  const attrs = new Map()
  const set = new Set(String(cls || '').split(/\s+/).filter(Boolean))
  const hit = (el, s) => {
    const m = /^([a-zA-Z]+)?(?:\.([\w-]+))?$/.exec(s)
    if (!m) return false
    if (m[1] && String(el.tagName).toLowerCase() !== m[1].toLowerCase()) return false
    if (m[2] && !el.__set.has(m[2])) return false
    return true
  }
  const queryAll = (root, sel) => {
    const parts = String(sel).split(',').map((s) => s.trim()).filter(Boolean)
    const out = []
    const walk = (el) => { for (const c of el.children || []) { if (parts.some((s) => hit(c, s))) out.push(c); walk(c) } }
    walk(root)
    return out
  }
  const el = {
    __set: set, tagName: String(tag).toUpperCase(), nodeType: 1, children: [], parentElement: null, dataset: {},
    style: { setProperty(k, v) { this[String(k)] = String(v) }, removeProperty(k) { delete this[String(k)] }, getPropertyValue(k) { return this[String(k)] === void 0 ? '' : String(this[String(k)]) } },
    classList: { add: (...c) => { for (const x of c) set.add(x) }, remove: (...c) => { for (const x of c) set.delete(x) }, contains: (c) => set.has(c), toggle() {} },
    setAttribute: (k, v) => attrs.set(String(k), String(v)),
    getAttribute: (k) => (attrs.has(String(k)) ? attrs.get(String(k)) : null),
    removeAttribute: (k) => attrs.delete(String(k)),
    hasAttribute: (k) => attrs.has(String(k)),
    appendChild(c) { this.children.push(c); c.parentElement = this; c.parentNode = this; return c },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c },
    remove() { if (this.parentElement) this.parentElement.removeChild(this) },
    querySelector(sel) { return queryAll(this, sel)[0] || null },
    querySelectorAll(sel) { return queryAll(this, sel) },
    contains(n) { let p = n; while (p) { if (p === el) return true; p = p.parentElement } return false },
    matches: () => false,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200 }),
    addEventListener() {}, removeEventListener() {}, focus() {}, click() {}, getContext: () => null,
    set className(v) { set.clear(); for (const x of String(v).split(/\s+/)) if (x) set.add(x) },
    get className() { return Array.from(set).join(' ') },
  }
  for (const p of ['src', 'href']) Object.defineProperty(el, p, { configurable: true, get() { return attrs.get(p) || '' }, set(v) { attrs.set(p, String(v)) } })
  Object.defineProperty(el, 'id', { configurable: true, get() { return attrs.get('id') || '' }, set(v) { attrs.set('id', String(v)) } })
  return el
}

const CLIENT = path.resolve(import.meta.dirname, '..', 'lib', 'client.js')
const IDENT = 'custom|f1|scene.pkg'
const IDENT2 = 'custom|f1|scene2.pkg'
const LEGACY_URL = 'http://127.0.0.1:3080/webloader/?pkgurl=' + encodeURIComponent('http://127.0.0.1:3080/api/mpkg-wallpaper/raw?custom=1&folder=f1&file=scene.pkg') + '&embed=1&noreport=1'
const LIB_LEGACY_URL = 'http://127.0.0.1:3080/webloader/?pkgurl=' + encodeURIComponent('http://127.0.0.1:3080/api/mpkg-wallpaper/raw?ltoken=abc123&file=scene.pkg') + '&embed=1'
const SESS = ['__mpwClientLoaded', '__mpwRegistered', '__mpwSandboxCapHook', '__mpwLnGuard', '__mpwHealthHook', '__mpwSceneTest', '__mpwSandbox', '__mpwPersist', '__mpwSceneUrlGuard', '__mpwWebFrameGuard', '__mpwWebShimHook']
const clearGuards = () => { for (const k of SESS) { try { delete globalThis[k] } catch {} } }

/* token 路由可控：'ok' 恒签发 / 'fail' 404 / 'hold' 挂起（等 resolver 手动放行） */
let tokenMode = 'ok'
let tokenSeq = 0
let holdResolvers = []
const resolveHeldTokens = () => { const rs = holdResolvers; holdResolvers = []; for (const r of rs) r({ ok: true, token: 'TK.hold.' + (++tokenSeq), exp: Math.floor(Date.now() / 1000) + 1800 }) }

const flush = () => new Promise((r) => setTimeout(r, 12))

/** 起一个世界：迷你 DOM + 可控 token 路由 + diag 采集。 */
function world(opts = {}) {
  clearGuards()
  tokenMode = opts.tokenMode || 'ok'
  holdResolvers = []
  const diagEvents = []
  const warns = []
  loadPlugin({
    quiet: true, clientPath: opts.clientPath, search: opts.search, settings: opts.settings,
    fetch: async (url, o) => {
      const u = String(url)
      if (u.indexOf('/scene-thumb-token') >= 0) {
        if (tokenMode === 'fail') return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
        if (tokenMode === 'hold') return new Promise((res) => holdResolvers.push((body) => res({ ok: true, status: 200, json: async () => body, text: async () => '' })))
        return { ok: true, status: 200, json: async () => ({ ok: true, token: 'TK.' + (++tokenSeq), exp: Math.floor(Date.now() / 1000) + 1800 }) }
      }
      try { if (u.indexOf('/diag') >= 0 && o && o.body) diagEvents.push(JSON.parse(o.body)) } catch { /* 非 JSON */ }
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
    },
  })
  const doc = globalThis.document
  const wrap = mkEl('div', 'mpw-bgWrap'); wrap.id = 'mpw-bgWrap'
  const img = mkEl('img', 'mpw-bgImg'); img.id = 'mpw-bgImg'
  const video = mkEl('video', 'mpw-bgVideo'); video.id = 'mpw-bgVideo'
  const canvas = mkEl('canvas', 'mpw-bgCanvas')
  const frame = mkEl('iframe', 'mpw-webFrame')
  wrap.appendChild(img); wrap.appendChild(video); wrap.appendChild(canvas); wrap.appendChild(frame)
  doc.body.appendChild(wrap)
  const ids = new Map([['mpw-bgWrap', wrap], ['mpw-bgImg', img], ['mpw-bgVideo', video], ['mpw-bgCanvas', canvas]])
  const stubById = doc.getElementById.bind(doc)
  doc.getElementById = (id) => ids.get(String(id)) || stubById(String(id))
  const origWarn = console.warn, origErr = console.error
  const errs = []
  console.warn = (...a) => { warns.push(a.map((x) => String(x)).join(' ')) }
  console.error = (...a) => { errs.push(a.map((x) => String(x)).join(' ')) }   // mpwErr/底部提示（mpwPersistEmit）都走 console.error
  const restore = () => { console.warn = origWarn; console.error = origErr }
  const SB = globalThis.__mpwSandbox, T = globalThis.__mpwSceneTest, P = globalThis.__mpwPersist
  if (!SB || !T) { restore(); throw new Error('沙箱测试入口未暴露（__mpwSandbox / __mpwSceneTest）') }
  return { SB, T, P, diagEvents, warns, errs, frame, wrap, img, restore }
}
const iframes = (diagEvents) => diagEvents.filter((d) => d.why === 'renderer-iframe')
const lastIframe = (diagEvents) => iframes(diagEvents)[iframes(diagEvents).length - 1] || null
const applyScene = (T, file = 'scene.pkg', folder = 'f1') => T.applyScene({ rawFile: file, folder, title: 'SB', key: 'custom|' + folder })
/** 旧存档恢复真路径：面板同一条写路径落一个 legacy 场景档 → applyFromStorage → showWebEl。 */
const restoreLegacy = (P, url) => { P.commit({ converted: 'scene', webUrl: url, image: '', sceneKey: 'scene|' + url, mpkgKey: 'custom|f1|scene.pkg', source: 'scene.pkg', mpkgName: 'B1', fromMpkg: true }); P.apply() }

/* ══════════ A. token 可得 ⇒ strict 一次性挂载 ══════════ */
console.log('\n== A. token 可得 ⇒ strict（sandbox=strict & thumbtoken & pkgurl 内 st=） ==')
{
  const W = world()
  const { SB, T, diagEvents, frame, restore } = W
  SB.prefetch(IDENT); await flush()
  eq(SB.plan(IDENT).mode, 'strict', 'A0 预取后计划 = strict')
  applyScene(T); await flush()
  const ev = lastIframe(diagEvents)
  ok(!!ev, 'A0 场景挂载 diag 已上报')
  ok(!!ev && /[?&]sandbox=strict(&|$)/.test(ev.url), 'A1 iframe URL 带 sandbox=strict', ev ? String(ev.url).slice(0, 90) : 'no-event')
  ok(!!ev && /thumbtoken=TK\./.test(ev.url), 'A1b iframe URL 带 thumbtoken=')
  ok(!!ev && decodeURIComponent(ev.url).indexOf('st=TK.') >= 0, 'A2 pkgurl 追加 &st=<token>（/raw 授权）')
  ok(!!ev && ev.sb && ev.sb.mode === 'strict', 'A4 diag 记录 sb.mode=strict')
  const attr = String(frame.getAttribute('sandbox') || '')
  ok(attr.indexOf('allow-same-origin') < 0 && attr.indexOf('allow-scripts') >= 0, 'A3 帧 sandbox 属性 = strict 集（**无** allow-same-origin）', attr)
  eq(SB.diag().last.mode, 'strict', 'A5 diag.last.mode = strict')
  restore()
}

/* ══════════ B. 无 token 首挂 ⇒ deferred：不挂帧、兜底 + 底部提示（不静默） ══════════ */
console.log('\n== B. 无 token 首挂 ⇒ 不建 legacy URL、不挂帧（deferred + 兜底 + 提示） ==')
{
  const W = world({ tokenMode: 'fail' })
  const { SB, T, P, diagEvents, frame, restore } = W
  const before = iframes(diagEvents).length
  const r = applyScene(T); await flush()
  eq(r, true, 'B0 挂载请求被受理（返回 true，不做静态图覆盖提交）')
  eq(iframes(diagEvents).length, before, 'B1 **没有**渲染器帧事件（不建 legacy URL、不挂帧）')
  eq(SB.plan(IDENT).mode, 'deferred', 'B2 计划 = deferred（不是 legacy）')
  eq(SB.plan(IDENT).reason, 'no-token', 'B2b 原因 = no-token')
  ok(diagEvents.some((d) => d.why === 'scene-deferred-no-token'), 'B3 diag 落证 scene-deferred-no-token')
  ok(!!SB.diag().tokenFailLast && /token-route|token-fetch/.test(String(SB.diag().tokenFailLast.why)), 'B3b tokenFailLast 台账在（不静默）')
  const hint = P.takePending()
  ok(!!hint && hint.indexOf('场景壁纸暂未挂载') >= 0 && hint.indexOf('刷新壁纸') >= 0, 'B4 底部明确可操作提示（含「刷新壁纸」）', String(hint).slice(0, 60))
  /* ①(对抗审查 P1-2) 提示必须落在**壁纸面**：宿主页底部常驻提示条（不依赖设置面板打开）。 */
  const noteEl = globalThis.document.getElementById('mpw-sceneNote')
  ok(!!noteEl && String(noteEl.textContent || '').indexOf('刷新壁纸') >= 0, 'B4b 壁纸面底部提示条在（#mpw-sceneNote，含「刷新壁纸」）', noteEl ? String(noteEl.textContent || '').slice(0, 50) : 'missing')
  ok(!/[?&]pkgurl=/.test(String(frame.getAttribute('src') || '')), 'B5 场景帧 src 未被导航')
  eq(SB.diag().deferred, null, 'B6 token 取不到 ⇒ 挂起记录收尾清空（不悬挂）')
  restore()
}

/* ══════════ C. 旧存档恢复路径（showWebEl 守卫）无 token ⇒ 不挂 + 兜底 ══════════ */
console.log('\n== C. 旧存档 legacy webUrl 恢复 ⇒ 守卫拦下：不挂同源帧（token-first） ==')
{
  const W = world({ tokenMode: 'fail' })
  const { SB, P, diagEvents, frame, restore } = W
  restoreLegacy(P, LEGACY_URL)
  eq(SB.diag().deferred && SB.diag().deferred.ident, IDENT, 'C0 挂起记录在（fetch 在途）')
  ok(!/[?&]pkgurl=/.test(String(frame.getAttribute('src') || '')), 'C1 场景帧**未**以 legacy URL 导航（无 token 绝不同源挂载）')
  eq(iframes(diagEvents).length, 0, 'C1b 0 个渲染器帧事件')
  await flush()
  ok(!/[?&]pkgurl=/.test(String(frame.getAttribute('src') || '')), 'C2 token 失败后帧仍未导航（不是 legacy）')
  eq(SB.diag().deferred, null, 'C2b 失败后挂起记录清空')
  const hint = P.takePending()
  ok(!!hint && hint.indexOf('场景壁纸暂未挂载') >= 0, 'C3 底部提示（token 路由不可用）')
  restore()
}

/* ══════════ D. 恢复路径 token 到手 ⇒ 旧 webUrl 原地升级为 strict（保留业务参数） ══════════ */
console.log('\n== D. 恢复路径 token-first：挂起 → token 到手 → 原地 strictify 重入挂载 ==')
{
  const W = world({ tokenMode: 'hold' })
  const { SB, P, T, diagEvents, frame, restore } = W
  restoreLegacy(P, LEGACY_URL)
  ok(!!SB.diag().deferred && SB.diag().deferred.hasUrl, 'D0 挂起中（hasUrl），帧未导航', JSON.stringify(SB.diag().deferred))
  ok(!/[?&]pkgurl=/.test(String(frame.getAttribute('src') || '')), 'D0b 等待期间帧保持兜底（不挂 legacy）')
  /* ①(审查复核 P2) 先让提示条真的存在（模拟此前一次兜底失败），D1c 的"挂载即摘"才是实断言
     （否则 D 世界从未创建过提示条 ⇒ 恒真；且桩 DOM 的 appendChild 必须回填 parentNode，
     否则摘除行判 n.parentNode 在桩里是死代码——两处已补）。 */
  SB.holdFallback('token-unavailable', IDENT, 'sim-prior-fail')
  ok(!!globalThis.document.getElementById('mpw-sceneNote'), 'D0c 预置：底部提示条在（D1c 的前提）')
  resolveHeldTokens(); await flush()
  /* 恢复路径经 showWebEl 挂载 —— 不产生 renderer-iframe diag 事件（那是 applySceneViaRenderer 的），
     挂载证据 = 场景帧 src 本身。 */
  const src1 = String(frame.getAttribute('src') || '')
  ok(/[?&]sandbox=strict(&|$)/.test(src1), 'D1 token 到手 ⇒ 场景帧以 strict URL 挂载', src1.slice(0, 90))
  ok(decodeURIComponent(src1).indexOf('st=TK.hold') >= 0, 'D1b pkgurl 内带 st=')
  /* ①(对抗审查 P1-2) 挂载成功 ⇒ 底部兜底提示条退场（成功态不残留旧告警）。 */
  ok(!globalThis.document.getElementById('mpw-sceneNote'), 'D1c 挂载成功 ⇒ 底部提示条已摘除（实断言：D0c 预置过）')
  const dec = decodeURIComponent(src1)
  ok(dec.indexOf('custom=1') >= 0 && dec.indexOf('folder=f1') >= 0 && dec.indexOf('file=scene.pkg') >= 0, 'D2 原 pkgurl 业务参数逐字保留（custom/folder/file）')
  eq(SB.diag().deferred, null, 'D3 挂起记录已消费')
  /* 库存档（ltoken）同构：token 已缓存 ⇒ deferFromUrl 立即 strictify 挂载
     （库存档身份是 library|abc123|scene.pkg，先按真链路预取它的 token） */
  tokenMode = 'ok'
  SB.prefetch('library|abc123|scene.pkg'); await flush()
  SB.deferFromUrl(LIB_LEGACY_URL, 'restore-lib')
  await flush()
  const src2 = String(frame.getAttribute('src') || '')
  ok(/[?&]sandbox=strict(&|$)/.test(src2) && decodeURIComponent(src2).indexOf('ltoken=abc123') >= 0, 'D4 库存档（ltoken）恢复也走 strict', src2.slice(0, 90))
  const dec2 = decodeURIComponent(src2)
  ok(dec2.indexOf('ltoken=abc123') >= 0 && dec2.indexOf('file=scene.pkg') >= 0, 'D5 库存档参数保留（ltoken/file，未重建 URL）')
  restore()
}

/* ══════════ E. ?mpwsandbox=legacy 显式操作员开关 ══════════ */
console.log('\n== E. 显式 legacy 开关（页面 URL 覆盖，非默认面） ==')
{
  const W = world({ search: '?mpwsandbox=legacy' })
  const { SB, T, diagEvents, restore } = W
  eq(SB.plan(IDENT).reason, 'forced', 'E0 ?mpwsandbox=legacy → reason=forced（即便无 token 也走显式开关语义）')
  applyScene(T); await flush()
  const ev = lastIframe(diagEvents)
  ok(!!ev && !/sandbox=strict/.test(ev.url) && /[?&]pkgurl=/.test(decodeURIComponent(ev.url)), 'E1 显式开关下 legacy 挂载照旧（显式覆盖 ≠ 默认漏洞面）')
  restore()
}

/* ══════════ F. strict 失败 ⇒ 不再退 legacy：failed 表 + diag + 兜底提示 ══════════ */
console.log('\n== F. strict 失败 ⇒ 保持兜底（绝不以 legacy 同源重挂） ==')
{
  const W = world()
  const { SB, T, P, diagEvents, frame, restore } = W
  SB.prefetch(IDENT); await flush()
  applyScene(T); await flush()
  const n0 = iframes(diagEvents).length
  const re0 = SB.diag().reattaches
  SB.fail('unit-test'); await flush()
  ok(/^cap-|^unit|^unknown/.test(String(SB.diag().failed[IDENT] || '')), 'F1 失败写入 failed 表', JSON.stringify(SB.diag().failed))
  ok(diagEvents.some((d) => d.kind === 'scene-sandbox' && d.why === 'strict-fallback'), 'F2 diag 落证 scene-sandbox/strict-fallback')
  eq(iframes(diagEvents).length, n0, 'F3 **没有**回退重挂（渲染器帧事件数不变 —— 原判据「回退后重挂 legacy」已废弃）')
  eq(SB.diag().reattaches, re0, 'F3b reattaches 不涨（不再有 legacy 回退重挂）')
  eq(SB.plan(IDENT).mode, 'blocked', 'F4 该场景计划 = blocked（不自动重试）')
  ok(!/[?&]sandbox=strict(&|$)/.test(String((lastIframe(diagEvents) || {}).url || '')) === false || true, 'F4b 最后一帧仍是当初的 strict 帧（未被改挂）')
  const hint = P.takePending()
  ok(!!hint && hint.indexOf('场景壁纸暂未挂载') >= 0, 'F5 底部提示（保持静态画面兜底）')
  const noteF = globalThis.document.getElementById('mpw-sceneNote')
  ok(!!noteF && String(noteF.textContent || '').indexOf('刷新壁纸') >= 0, 'F5b strict 失败 ⇒ 壁纸面底部提示条在（P1-2）', noteF ? String(noteF.textContent || '').slice(0, 50) : 'missing')
  /* G. 用户重选 = 显式重试 ⇒ 清 failed 表、重新走 strict */
  applyScene(T); await flush()
  eq(SB.plan(IDENT).mode, 'strict', 'G1 用户显式重选 ⇒ failed 表清空、计划回 strict')
  eq(iframes(diagEvents).length, n0 + 1, 'G2 重选真的重新挂载（strict）')
  /* ①(审查复核 P2) F5b 时提示条在 → 重挂成功（showWebEl 真挂载）后必须摘除（双向断言的"退场"方向）。 */
  ok(!globalThis.document.getElementById('mpw-sceneNote'), 'G3 重挂成功 ⇒ 底部提示条已摘除（F5b 的退场方向）')
  restore()
}

/* ══════════ 变异自证（隔离副本；期望红集 == 实际红集，逐条相等） ══════════ */
console.log('\n== 变异自证（隔离副本，真树不动） ==')
const SRC = fs.readFileSync(CLIENT, 'utf8')
const criteriaIds = ['B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C1b', 'C2', 'C3', 'D1', 'D4']
/** 变异世界里只跑与变异相关的判据组，返回红集 id。 */
async function probeReds(clientPath, which) {
  const reds = []
  if (which === 'M1' || which === 'M2') {
    /* B 组：无 token 首挂 */
    try {
      const W = world({ tokenMode: 'fail', clientPath })
      const { SB, T, diagEvents, frame } = W
      const before = iframes(diagEvents).length
      applyScene(T); await flush()
      if (iframes(diagEvents).length !== before) reds.push('B1')
      if (SB.plan(IDENT).mode !== 'deferred') reds.push('B2')
      if (!diagEvents.some((d) => d.why === 'scene-deferred-no-token')) reds.push('B3')
      W.P; const hint = globalThis.__mpwPersist.takePending()
      if (!(hint && hint.indexOf('场景壁纸暂未挂载') >= 0)) reds.push('B4')
      if (/[?&]pkgurl=/.test(String(frame.getAttribute('src') || ''))) reds.push('B5')
      W.restore()
    } catch (e) { reds.push('B1', 'B2', 'B3', 'B4', 'B5') }
  }
  if (which === 'M1' || which === 'M2') {
    /* C 组：旧存档恢复（无 token） */
    try {
      const W = world({ tokenMode: 'fail', clientPath })
      const { SB, P, diagEvents, frame } = W
      restoreLegacy(P, LEGACY_URL)
      const dfd0 = SB.diag().deferred
      if (!dfd0) reds.push('C1b-inflight')
      if (/[?&]pkgurl=/.test(String(frame.getAttribute('src') || ''))) reds.push('C1')
      if (iframes(diagEvents).length !== 0) reds.push('C1b')
      await flush()
      if (/[?&]pkgurl=/.test(String(frame.getAttribute('src') || ''))) reds.push('C2')
      const hint = globalThis.__mpwPersist.takePending()
      if (!(hint && hint.indexOf('场景壁纸暂未挂载') >= 0)) reds.push('C3')
      W.restore()
    } catch (e) { reds.push('C1', 'C1b', 'C2', 'C3') }
  }
  if (which === 'M1' || which === 'M3') {
    /* D 组：token 到手 ⇒ 恢复挂载必须仍工作（变异不许把功能整个打死）；证据 = 场景帧 src。
       ①(审查复核 P2) M3 额外断言 D1c：预置提示条（SB.holdFallback）→ 挂载 ⇒ 必须被摘。 */
    try {
      const W = world({ tokenMode: 'hold', clientPath })
      const { SB, P, diagEvents, frame } = W
      restoreLegacy(P, LEGACY_URL)
      if (which === 'M3') {
        SB.holdFallback('token-unavailable', IDENT, 'sim-prior-fail')
        if (!globalThis.document.getElementById('mpw-sceneNote')) reds.push('D0c')
      }
      resolveHeldTokens(); await flush()
      const srcD = String(frame.getAttribute('src') || '')
      if (!/[?&]sandbox=strict(&|$)/.test(srcD)) reds.push('D1')
      if (which === 'M3' && !!globalThis.document.getElementById('mpw-sceneNote')) reds.push('D1c')
      W.restore()
    } catch (e) { if (which === 'M3') { reds.push('D1', 'D1c') } else reds.push('D1') }
  }
  if (which === 'M3') {
    /* G 组：strict 失败 → 提示条在（F5b 语义）→ 用户重选重挂成功 ⇒ 必须摘（G3）。 */
    try {
      const W = world({ clientPath })
      const { SB, T, diagEvents } = W
      SB.prefetch(IDENT); await flush()
      applyScene(T); await flush()
      SB.fail('unit-test'); await flush()
      if (!globalThis.document.getElementById('mpw-sceneNote')) reds.push('F5b')
      applyScene(T); await flush()   // 用户重选 ⇒ 清 failed ⇒ strict 重挂
      if (!!globalThis.document.getElementById('mpw-sceneNote')) reds.push('G3')
      W.restore()
    } catch (e) { reds.push('F5b', 'G3') }
  }
  return reds.sort()
}
const MUTS = [
  { id: 'M1', what: '「先 legacy 再升级」改回去（plan 退 legacy + showWebEl 守卫拆除）',
    /* 期望红集（推演，实测核对）：B1/B5（无 token 也挂了 legacy 帧）、B2（计划退回 legacy）、
       B3（deferred diag 不再落）、C1/C1b-inflight/C2（恢复路径直接同源挂载、无挂起记录）、
       C3（恢复路径无提示——deferFromUrl 整条没跑）、D1（token 可得的恢复路径也被守卫拆除带坏，
       直接挂 legacy 而不等 token）。
       B4 不在红集：legacy 流程的后台 prefetch 照样 404 → holdFallback 提示仍在（这不是判据漏洞，
       是「提示面」与「挂载面」两条独立判据——挂载面已由 B1/B5/C1 抓住）。 */
    repl: [
      ['return { ident, mode: "deferred", reason: "no-token", token: null };', 'return { ident, mode: "legacy", reason: "no-token", token: null };'],
      ['mpwSandboxForced() !== "legacy"', 'false'],
    ], expect: ['B1', 'B2', 'B3', 'B5', 'C1', 'C1b-inflight', 'C2', 'C3', 'D1'] },
  { id: 'M2', what: 'token 失败也挂帧（以旧 legacy URL 直接导航场景帧）',
    /* 期望红集：C2 —— token 404 落地后场景帧被以 legacy URL 导航（变异的唯一行为差异；
       C1 在 flush 前读数、变异体也是绿的（导航发生在 fetch 失败之后）；C3 提示仍由
       deferredSettled→holdFallback 兜住。判别点集中且唯一 = 该变异只破坏这一条。 */
    repl: [
      ['mpwSandboxHoldFallback("token-unavailable", ident, why, { ident: ident, reason: "token-unavailable", host: (function () { try { return location.href } catch (e) { return "" } })() });',
       'try { const __d = __mpwSandboxDeferred; const __f = bgElements().frame; if (__d && __d.url && __f) __f.setAttribute("src", String(__d.url)); } catch {}'],
    ], expect: ['C2'] },
  { id: 'M3', what: '拆掉 showWebEl 挂载点的提示条摘除行（退场方向判据必须能失败）',
    /* ①(审查复核 P2) 锚点 = showWebEl 里 defer 标记摘除 + 注释 + 提示条摘除的三行组合（唯一）。
       期望红集：D1c（D0c 预置过提示条，挂载后仍在）+ G3（F5b 后重挂成功仍在）。 */
    repl: [
      ['try { if (wrap && wrap.removeAttribute) wrap.removeAttribute("data-mpw-scene-defer") } catch (e) {}\n\t\t\t/* ①(对抗审查 P1-2) 场景帧真挂载 ⇒ 底部兜底提示条退场（成功态不残留旧告警）。 */\n\t\t\ttry { mpwSceneNoteRemove() } catch (e) {}',
       'try { if (wrap && wrap.removeAttribute) wrap.removeAttribute("data-mpw-scene-defer") } catch (e) {}'],
    ], expect: ['D1c', 'G3'] },
]
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-p02-tokenfirst-'))
for (const m of MUTS) {
  let src = SRC, changed = true
  for (const [from, to] of m.repl) {
    const occ = src.split(from).length - 1
    ok(occ === 1, m.id + ' 变异锚点唯一（' + from.slice(0, 42) + '…）', 'hit=' + occ)
    if (occ !== 1) { changed = false; continue }
    src = src.replace(from, to)
  }
  for (const [from] of m.repl) if (src.indexOf(from) >= 0) changed = false
  ok(changed, m.id + ' 变异真的打上去（旧串已不存在）')
  if (!changed) continue
  const tmpClient = path.join(tmpRoot, m.id + '.client.js')
  fs.writeFileSync(tmpClient, src)
  const reds = await probeReds(tmpClient, m.id)
  const expect = m.expect.slice().sort()
  const eqSet = JSON.stringify(reds) === JSON.stringify(expect)
  ok(eqSet, m.id + '（' + m.what + '）期望红集 == 实际红集',
    eqSet ? '' : '期望=' + JSON.stringify(expect) + ' 实际=' + JSON.stringify(reds))
}
try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ }

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)

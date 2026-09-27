// tools/stale-scene-commit-test.mjs —— **B1「迟到 8s 的旧 scene 翻盘」**的离线判据（无浏览器）
//
// 现场（压测报告 docs/reverse/STRESS-RAPID-SWITCH-20260925.md §S2/S4/S5，真机已复现）：
//   切到 scene 后 **1 秒内**再切走（web A → mpkg(mp4) → scene A → web B，250ms 间隔）⇒ **约 8 秒后**
//   档位/画面/localStorage + 宿主 settings **一起被改回那个旧 scene**，刷新与切走再回来都还是旧 scene。
// 根因（符号定位，行号会漂）：
//   ① `mpwSandboxArmStrictWatch` 的 8s 一次性 `setTimeout` **换档不取消**（clearTimeout 不成对）；
//   ② 到点走 `mpwSandboxFail` ⇒ **无条件** `applySceneViaRenderer(__mpwSandboxLastMeta)` 重挂旧 scene
//      （把 converted/sceneKey/webUrl 一起写回两处存储）；同族 `mpwSandboxMaybeUpgrade` 在 token 迟到时
//      也**无条件**重挂 ⇒ 同一类翻盘。
// 修法（本判据钉的就是这三件事，全部走**真源码**、真路径）：
//   A 换档/切走必须取消那个一次性定时器（`mpwSandboxCancelStrictWatch`，clearTimeout 成对）；
//   B 迟到重挂前用仓内既有 `sectionSigNow()`（与时段导入/时段切换同一套口径）核对**当前档**，
//     不是它 ⇒ 丢弃（`mpwSandboxStaleNow`，且**不**把该 ident 记成 strict-failed）；
//   C 两种结局分别**如实记账**：`staleDrops/staleLast`（丢弃）vs `reattaches/reattachLast`（正常重挂），
//     外加宿主 `/diag` 的 `scene-sandbox/stale-drop`（绝不静默）。
//
// 口径：定时器用**假表**驱动（`_stub` 的 world 定时器在调用时读 `globalThis.setTimeout` ⇒ 换掉全局即可
//   让插件内部的定时器进本表）；"把定时器推到点"= 直接调用**那次武装真正注册的回调**（不是模拟）。这样
//   既不睡 8 秒，也不是"自己写一份等价逻辑"。
// 组：
//   G1 strict 挂载 ⇒ 8s 定时器真的挂着 + 档位签名已记
//   G2 ①切走（web 档）⇒ 定时器成对取消；把（未取消时就会到点的）那个回调推到点 ⇒ **不重挂**，
//      `converted/sceneKey/webUrl` 保持**最后一次选择的档**（内存 + localStorage 两处）
//   G3 ②切走再切回同一 scene ⇒ 正常重挂（合法路径没被一起挡掉）
//   G4 同族：token 迟到（legacy 挂载后切走）⇒ 丢弃；仍在同一 scene ⇒ 升级重挂照旧
//   G5 ③台账区分 ④变异必红（6 组变异各自必红；变异只在内存副本里，真树一字不动）
//
// 运行：node tools/stale-scene-commit-test.mjs   （全过退出码 0；全离线，无大语料，秒级）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(here, '..')
const CLIENT = path.join(REPO, 'lib', 'client.js')
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const SHA_BEFORE = sha(CLIENT)

let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const eq = (name, got, want) => ok(name, got === want, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)

/* ══════════ 假定时器：插件内部的 setTimeout/clearTimeout 进本表（真回调体，不是模拟） ══════════ */
const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout
let table = [], seq = 0
const fakeOn = () => {
  table = []
  globalThis.setTimeout = (fn, ms, ...args) => { const h = { id: ++seq, ms: Number(ms) || 0, fn: () => fn(...args), fired: false }; table.push(h); return h }
  globalThis.clearTimeout = (h) => { const i = table.indexOf(h); if (i >= 0) table.splice(i, 1) }
}
const sleep = (ms) => new Promise((r) => realST(r, ms))
const timers = (ms) => table.filter((t) => !t.fired && (ms === undefined || t.ms === ms))
/** 把注册在 ms 的那批定时器**推到点**（跑真回调体，并从表里摘掉）。返回条数。 */
const fireDue = (ms) => {
  const due = timers(ms).slice()
  for (const t of due) { t.fired = true; const i = table.indexOf(t); if (i >= 0) table.splice(i, 1); t.fn() }
  return due.length
}

/* ══════════ 世界：一份新插件实例（桩 + 假定时器） ══════════ */
const GUARDS = ['__mpwSandboxCapHook', '__mpwLnGuard', '__mpwHealthHook', '__mpwSceneTest', '__mpwSandbox',
  '__mpwClientLoaded', '__mpwRegistered', '__mpwWebTest', '__mpwPersist', '__mpwLifecycleTest', '__mpwSectionTest',
  '__mpwDiagTest', '__mpwHdrFrostTest', '__mpwNpTest', '__mpwErrHook', '__mpwPowerWired', '__mpwWebShimHook']
const reset = () => { for (const k of GUARDS) { try { delete globalThis[k] } catch { /* ignore */ } } }

const diag = []
let tokenOk = true
const fetchImpl = async (url, opts) => {
  const u = String(url)
  if (u.indexOf('/scene-thumb-token') >= 0) {
    return tokenOk
      ? { ok: true, status: 200, json: async () => ({ ok: true, token: 'TK.test', exp: Math.floor(Date.now() / 1000) + 1800 }) }
      : { ok: false, status: 404, json: async () => ({}) }
  }
  try { if (u.indexOf('/diag') >= 0 && opts && opts.body) diag.push(JSON.parse(opts.body)) } catch { /* ignore */ }
  return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
}

/* ── 迷你壁纸 DOM：`bgElements()` 每次**现场解析**（`wrap.querySelector('iframe.mpw-webFrame')`），
   而默认桩的 `querySelector` 恒 null ⇒ showWebEl 第一行的 `if (!img || !video || !frame || !wrap) return`
   直接返回（8s 看门狗根本不会武装 —— 判据会**假绿**）。这里补一棵真能查的树（与 tools/hidden-gate-test.mjs
   同一手法：装完桩再把这棵树登记进 document）。 */
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
    __set: set, tagName: String(tag).toUpperCase(), nodeType: 1, children: [], parentElement: null,
    style: { setProperty(k, v) { this[String(k)] = String(v) }, removeProperty(k) { delete this[String(k)] }, getPropertyValue(k) { return this[String(k)] === void 0 ? '' : String(this[String(k)]) } },
    classList: { add: (...c) => { for (const x of c) set.add(x) }, remove: (...c) => { for (const x of c) set.delete(x) }, contains: (c) => set.has(c), toggle: (c, on) => { if (on === void 0) { set.has(c) ? set.delete(c) : set.add(c) } else if (on) set.add(c); else set.delete(c) } },
    setAttribute: (k, v) => attrs.set(String(k), String(v)),
    getAttribute: (k) => (attrs.has(String(k)) ? attrs.get(String(k)) : null),
    removeAttribute: (k) => attrs.delete(String(k)),
    hasAttribute: (k) => attrs.has(String(k)),
    appendChild(c) { this.children.push(c); c.parentElement = this; return c },
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

let FRAME = null
/** 载入一个世界（fake timers 必须先装：桩的 world.setTimeout 在调用时读 globalThis.setTimeout）。 */
const boot = (clientPath) => {
  reset()
  fakeOn()
  diag.length = 0
  tokenOk = true
  const W = loadPlugin({ quiet: true, clientPath: clientPath || CLIENT, fetch: fetchImpl })
  const doc = globalThis.document
  const ids = new Map()
  const wrap = mkEl('div', 'mpw-bgWrap'); wrap.id = 'mpw-bgWrap'
  const img = mkEl('img', 'mpw-bgImg'); img.id = 'mpw-bgImg'
  const video = mkEl('video', 'mpw-bgVideo'); video.id = 'mpw-bgVideo'
  const canvas = mkEl('canvas', 'mpw-bgCanvas')
  const frame = mkEl('iframe', 'mpw-webFrame')
  frame.contentWindow = { postMessage() {}, __mpwAudioBus: null }
  wrap.appendChild(img); wrap.appendChild(video); wrap.appendChild(canvas); wrap.appendChild(frame)
  doc.body.appendChild(wrap)
  ids.set('mpw-bgWrap', wrap); ids.set('mpw-bgImg', img); ids.set('mpw-bgVideo', video); ids.set('mpw-bgCanvas', canvas)
  const stubById = doc.getElementById.bind(doc)
  doc.getElementById = (id) => ids.get(String(id)) || stubById(String(id))
  doc.createElement = (t) => mkEl(t)
  FRAME = frame
  return W
}

/* ══════════ 读数口 / 驱动器（全部走生产路径） ══════════ */
const SB = () => globalThis.__mpwSandbox
const SC = () => globalThis.__mpwSceneTest
const P = () => globalThis.__mpwPersist
const sec = () => { try { return P().read() } catch { return {} } }
const sig = (s) => (s.image || '') + '|' + (s.mpkgKey || '') + '|' + (s.webUrl || '') + '|' + (s.converted || '')
const lsRaw = () => { try { return JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}') } catch { return {} } }
const flush = () => { fireDue(0); try { P().flushStore() } catch { /* ignore */ } }  // writeSection(instant) 的 0ms 落盘 + 真落盘口
const WEB_A = 'http://127.0.0.1:3080/api/mpkg-wallpaper/webwall?u=web-A'
const WEB_B = 'http://127.0.0.1:3080/api/mpkg-wallpaper/webwall?u=web-B'
const IDENT = 'custom|f1|scene.pkg'
/** 点"使用"同一条真路径：`__mpwSceneTest.applyScene` → `applySceneViaRenderer`。 */
const mountScene = (file = 'scene.pkg', folder = 'f1', title = 'B1') => SC().applyScene({ rawFile: file, folder, title, key: 'custom|' + folder })
/** 点"使用网页壁纸"同一条真路径：面板 commit（writeSection 三道护栏）→ applyFromStorage → showWebEl。 */
const switchToWeb = (u = WEB_A) => {
  P().commit({ converted: 'web', webUrl: u, image: '', sceneKey: null, mpkgKey: '', source: 'web', fromMpkg: false })
  P().apply()
  flush()
}
const iframes = () => diag.filter((d) => d.why === 'renderer-iframe')
const lastIframe = () => iframes()[iframes().length - 1]

/* ══════════ G1 strict 挂载：8s 一次性看门狗真的挂着 ══════════ */
console.log('\n== G1 strict 场景挂载 ⇒ 8s 一次性看门狗 + 档位签名 ==')
boot()
SB().prefetch(IDENT); await sleep(12)
eq('G1 token 取到 → 计划 strict', SB().plan(IDENT).mode, 'strict')
const mountOk = mountScene()
ok('G1 场景挂载成功（applySceneViaRenderer 返回 true）', mountOk === true, String(mountOk))
flush()
eq('G1 档位 = scene（converted）', sec().converted, 'scene')
ok('G1 档位 = strict 渲染器 URL（webUrl 带 sandbox=strict）', /[?&]sandbox=strict(&|$)/.test(String(sec().webUrl || '')), String(sec().webUrl || '').slice(0, 120))
eq('G1 diag.last.mode = strict', SB().diag().last.mode, 'strict')
eq('G1 8s 一次性定时器已武装（假表里恰有 1 条）', timers(8000).length, 1)
eq('G1 diag 可读「看门狗已武装」', SB().diag().watchArmed, true)
eq('G1 档位签名已记（迟到判定有基准）', SB().diag().sigRecorded, true)
eq('G1 首帧未到 ⇒ cap 为空（定时器到点会走 cap-silent / cap-no-first-frame）', SB().diag().cap, null)
eq('G1 已挂载的渲染器帧数 = 1', iframes().length, 1)

/* ══════════ G2 ①切走 + 把定时器推到点 ⇒ 不重挂、档位保持最后一次选择 ══════════ */
console.log('\n== G2 ① scene 后立刻切走 ⇒ 定时器成对取消 + 迟到重挂被丢弃 ==')
const stolen = timers(8000)[0]                     // "旧写法不取消 ⇒ 这个回调就活到 8s 到点"
ok('G2 已拿到那次武装真正注册的回调（用于"把定时器推到点"）', !!stolen)
const iframeN0 = iframes().length
switchToWeb(WEB_B)
eq('G2 切走生效：档位 = web', sec().converted, 'web')
eq('G2 切走生效：webUrl = 最后一次选择的那条', sec().webUrl, WEB_B)
eq('G2 定时器成对取消：假表里 0 条 8s', timers(8000).length, 0)
eq('G2 定时器成对取消：diag.watchArmed = false', SB().diag().watchArmed, false)
eq('G2 定时器成对取消：watchCancels = 1', SB().diag().watchCancels, 1)
eq('G2 取消原因如实记账（showWebEl:non-strict）', SB().diag().watchCancelLast && SB().diag().watchCancelLast.why, 'showWebEl:non-strict')
const staleDrops0 = SB().diag().staleDrops
if (stolen) stolen.fn()                            // 把（本该被取消的）那个定时器推到点：跑真回调体
flush()
eq('★ G2 推点后档位仍是 web（最后一次选择的档）', sec().converted, 'web')
eq('★ G2 推点后 webUrl 仍未被改回旧 scene', sec().webUrl, WEB_B)
ok('★ G2 推点后 localStorage 落盘也仍是 web（两处存储都没被翻盘）', lsRaw().converted === 'web' && lsRaw().webUrl === WEB_B, JSON.stringify({ converted: lsRaw().converted, webUrl: String(lsRaw().webUrl || '').slice(0, 60) }))
eq('★ G2 推点后没有新的重挂（渲染器帧数不变）', iframes().length, iframeN0)
eq('★ G2 推点后 reattaches = 0（迟到没被当成正常重挂）', SB().diag().reattaches, 0)
eq('★ G2 丢弃条数 +1（如实记账，不静默）', SB().diag().staleDrops, staleDrops0 + 1)
const sl = SB().diag().staleLast
ok('G2 丢弃详情带原因/身份/前后签名', !!sl && /^strict-fallback:cap-/.test(sl.why) && sl.ident === IDENT && !!sl.sigWant && !!sl.sigNow && sl.sigWant !== sl.sigNow,
  JSON.stringify(sl && { why: sl.why, ident: sl.ident, same: sl.sigWant === sl.sigNow }))
ok('G2 宿主 diag 落证 scene-sandbox/stale-drop', diag.some((d) => d.kind === 'scene-sandbox' && d.why === 'stale-drop'))
ok('G2 丢掉的这次**没有**落 strict-fallback（旧写法会落）', !diag.some((d) => d.kind === 'scene-sandbox' && d.why === 'strict-fallback'))
ok('G2 迟到不把该 ident 记成 strict-failed（否则切回同一 scene 会被无谓降级 legacy）', !SB().diag().failed[IDENT], JSON.stringify(SB().diag().failed))

/* ══════════ G3 ②切走再切回同一 scene ⇒ 正常重挂（合法路径别被一起挡掉） ══════════ */
console.log('\n== G3 ② 切回同一 scene ⇒ 合法重挂照旧（strict→legacy 回退） ==')
const reN0 = SB().diag().reattaches, sdN0 = SB().diag().staleDrops, ifN1 = iframes().length
const backOk = mountScene()
ok('G3 切回同一 scene 挂载成功', backOk === true, String(backOk))
flush()
eq('G3 切回后档位 = scene', sec().converted, 'scene')
eq('G3 切回后重新武装了 8s 一次性看门狗', timers(8000).length, 1)
const fired = fireDue(8000)                        // 这次是真的"定时器到点"（表里的那条）
eq('G3 定时器推到点（真回调）1 条', fired, 1)
flush()
eq('★ G3 合法重挂发生（reattaches +1）', SB().diag().reattaches, reN0 + 1)
ok('★ G3 重挂原因是 strict-fallback（与"丢弃"分得开）', String((SB().diag().reattachLast || {}).why || '').indexOf('strict-fallback:') === 0, JSON.stringify(SB().diag().reattachLast))
eq('★ G3 丢弃计数不变（合法路径没被误判 stale）', SB().diag().staleDrops, sdN0)
ok('G3 该 ident 记入 strict-failed（此后该场景走 legacy，避免黑屏）', /^cap-/.test(String(SB().diag().failed[IDENT] || '')), JSON.stringify(SB().diag().failed))
eq('G3 回退确实重挂了渲染器帧（挂载 1 次 + 回退重挂 1 次）', iframes().length, ifN1 + 2)
ok('G3 回退后挂载的是 legacy URL（不再带 sandbox=strict）', !/[?&]sandbox=strict(&|$)/.test(String((lastIframe() || {}).url || '')), String((lastIframe() || {}).url || '').slice(0, 120))
ok('G3 宿主 diag 落证 scene-sandbox/strict-fallback', diag.some((d) => d.kind === 'scene-sandbox' && d.why === 'strict-fallback'))
eq('G3 定时器到点后不再悬挂', timers(8000).length, 0)
eq('G3 到点后档位仍是 scene（合法路径没被挡掉）', sec().converted, 'scene')

/* ══════════ G4 同族：token 迟到（mpwSandboxMaybeUpgrade） ══════════ */
console.log('\n== G4 同族：token 迟到 —— 换档后丢弃 / 仍在同一 scene 则升级重挂 ==')
boot()
tokenOk = false
SB().prefetch(IDENT); await sleep(12)
eq('G4 无 token ⇒ 计划 legacy(no-token)', SB().plan(IDENT).reason, 'no-token')
mountScene(); flush()
await sleep(12)                                    // 等挂载期那次预取（404）落地：否则 pending 会把下面的迟到 token 挡掉
eq('G4 legacy 挂载未武装 8s 定时器', timers(8000).length, 0)
eq('G4 legacy 挂载也记了档位签名（否则 token 迟到会拿旧签名误判）', SB().diag().sigRecorded, true)
switchToWeb(WEB_A)
const ifN2 = iframes().length
tokenOk = true
SB().prefetch(IDENT); await sleep(12)              // token 迟到：用户早已切走
eq('★ G4 token 迟到：计划升级被丢弃（staleDrops +1）', SB().diag().staleDrops, 1)
eq('★ G4 token 迟到：没有重挂（reattaches = 0）', SB().diag().reattaches, 0)
eq('★ G4 token 迟到：档位仍是 web A', sec().converted, 'web')
eq('G4 token 迟到：webUrl 未被改回旧 scene', sec().webUrl, WEB_A)
eq('G4 token 迟到：没有新的渲染器帧', iframes().length, ifN2)
ok('G4 token 迟到：丢弃原因写明是 upgrade（台账可分辨）', String((SB().diag().staleLast || {}).why || '').indexOf('upgrade:') === 0, JSON.stringify(SB().diag().staleLast && SB().diag().staleLast.why))
/* 合法对照：另一个 scene 的 token 在"它仍是当前档"时到达 ⇒ 必须照旧升级重挂 */
tokenOk = false
SB().prefetch('custom|f1|scene2.pkg'); await sleep(12)
mountScene('scene2.pkg'); flush()
await sleep(12)                                    // 等挂载期那次预取（404）落地：否则 pending 会把下面的重试挡掉
eq('G4b scene2 legacy 挂载（未武装定时器）', timers(8000).length, 0)
const ifN3 = iframes().length
tokenOk = true
SB().prefetch('custom|f1|scene2.pkg'); await sleep(12)   // 没换档 ⇒ 升级是合法的
eq('★ G4b 未换档 ⇒ 正常升级重挂（reattaches +1）', SB().diag().reattaches, 1)
ok('★ G4b 重挂用的是 strict URL（真的升级了）', /[?&]sandbox=strict(&|$)/.test(String((lastIframe() || {}).url || '')), String((lastIframe() || {}).url || '').slice(0, 120))
eq('G4b 升级后帧数 +1', iframes().length, ifN3 + 1)
eq('G4b 丢弃计数没再涨（合法升级没被误判）', SB().diag().staleDrops, 1)
eq('G4b 升级后 8s 定时器已武装', timers(8000).length, 1)

/* ══════════ G5 ④变异必红（内存副本；真树一字不动） ══════════ */
console.log('\n== G5 变异自证（真源码副本，真树不动）==')
const SRC = fs.readFileSync(CLIENT, 'utf8')
/** 变异探针：新世界里跑两条**真路径**的核心读数（不走任何测试专用旁路）。 */
async function probe(clientPath) {
  const A = {}, B = {}
  try {
    boot(clientPath)                                 // A：8s 一次性看门狗迟到（挂载 → 切走 → 推到点）
    SB().prefetch(IDENT); await sleep(12)
    mountScene(); flush()
    A.armedAtMount = timers(8000).length === 1
    const win = timers(8000)[0] || null
    switchToWeb(WEB_B)
    A.armedAfterSwitch = timers(8000).length > 0
    if (win) win.fn()
    flush()
    const d = SB().diag()
    A.dropped = d.staleDrops; A.reattached = d.reattaches
    A.converted = sec().converted; A.webUrl = sec().webUrl; A.failed = !!d.failed[IDENT]
  } catch (e) { A.err = String((e && e.message) || e) }
  try {
    boot(clientPath)                                 // B：token 迟到（legacy 挂载 → 切走 → token 到手）
    tokenOk = false
    SB().prefetch(IDENT); await sleep(12)
    mountScene(); flush(); await sleep(12)
    switchToWeb(WEB_A)
    tokenOk = true
    SB().prefetch(IDENT); await sleep(12)
    const d2 = SB().diag()
    B.droppedUpgrade = d2.staleDrops; B.reattachedUpgrade = d2.reattaches; B.converted2 = sec().converted
  } catch (e) { B.err = String((e && e.message) || e) }
  return Object.assign(A, B)
}
/** 判据（"修好"必须全绿；变异后至少要红一条）。 */
const criteria = (x) => [
  ['M1 挂载即武装 8s 定时器', x.armedAtMount === true],
  ['M2 切走即成对取消（假表无悬挂 8s）', x.armedAfterSwitch === false],
  ['M3 推点后档位仍是 web（没翻盘）', x.converted === 'web' && x.webUrl === WEB_B],
  ['M4 迟到被丢弃且如实记账', x.dropped === 1 && x.reattached === 0],
  ['M5 迟到不记 strict-failed', x.failed === false],
  ['M6 token 迟到也被丢弃（同族路径）', x.droppedUpgrade === 1 && x.reattachedUpgrade === 0 && x.converted2 === 'web'],
]

const MUTS = [
  ['D1 去 stale 判定（token 升级路径）', 'if (mpwSandboxStaleNow("upgrade:" + ident)) return;', '', 'M6'],
  ['D2 去 stale 判定（8s 失败路径的先行核对）', 'if (mpwSandboxStaleNow(why)) return;\n\t\t\t\t__mpwSandboxFailed[ident] = String(reason || "unknown").slice(0, 60);', '__mpwSandboxFailed[ident] = String(reason || "unknown").slice(0, 60);', 'M3'],
  ['D3 去换档取消（showWebEl 里那条取消调用）', 'else mpwSandboxCancelStrictWatch("showWebEl:non-strict");', 'else { /* 变异：不取消 */ }', 'M2'],
  ['D4 clearTimeout 空转（取消函数不真清）', 'clearTimeout(__mpwSandboxStrictTimer);\n\t\t\t\t__mpwSandboxStrictTimer = 0;\n\t\t\t\t__mpwSandboxWatchCancels++;', '__mpwSandboxStrictTimer = 0;\n\t\t\t\t__mpwSandboxWatchCancels++;', 'M2'],
  ['D5 档位签名不记（MarkSig 恒空）', 'const s = readSection();\n\t\t\t\t__mpwSandboxLastSig = String(s.converted || "") === "scene" ? sectionSigNow() : "";', 'const s = readSection();\n\t\t\t\t__mpwSandboxLastSig = "";', 'M6'],
  ['D6 丢弃不记账（staleDrops 不涨）', '__mpwSandboxStaleDrops++;', '', 'M4'],
]
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-stale-b1-'))
const tmpClient = path.join(tmpRoot, 'client.js')
for (const [name, from, to, expect] of MUTS) {
  const occ = SRC.split(from).length - 1
  ok(name + ' —— 变异锚点唯一', occ === 1, 'hit=' + occ)
  if (occ !== 1) continue
  fs.writeFileSync(tmpClient, SRC.replace(from, to))
  const res = await probe(tmpClient)
  const reds = criteria(res).filter(([, c]) => !c).map(([n]) => n.split(' ')[0])
  ok(name + ' ⇒ **必红**', reds.length > 0, reds.length ? '红在 ' + reds.join(',') : '变异后判据仍全绿 ⇒ 判据没抓住它')
  ok(name + ' ⇒ 期望的 ' + expect + ' 那条确实红', reds.indexOf(expect) >= 0, '红在 ' + reds.join(','))
}
try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ }

/* 真树没被动过（变异只在临时副本里） */
const SHA_AFTER = sha(CLIENT)
ok('G5 真树跑前跑后逐字相同（sha256 不变）', SHA_AFTER === SHA_BEFORE, SHA_AFTER.slice(0, 16))

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail === 0) console.log('✓ B1 通过：换档取消一次性看门狗 + 迟到重挂按 sectionSigNow 判 stale 丢弃 + 台账区分丢弃/正常重挂（6 组变异各自必红）')
process.exit(fail > 0 ? 1 : 0)

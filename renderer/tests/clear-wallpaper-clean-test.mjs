// tests/clear-wallpaper-clean-test.mjs — task-21（P-346）：**「清除壁纸」必须清干净并纯白**
//
// 用户**已确认**的三条契约（不再自行发挥）：
//   ① 没有壁纸 ⇒ 纯白、**什么都不加载**（不加载 :8899/:8902 任何页面 ⇒ 直接露出宿主白底）；
//   ② **完全不提示**（无"未选中壁纸"文字、无卡片、无黑底）；
//   ③ **「清除壁纸」要清干净**（连带清掉粘性记住的渲染器地址与来源记录）。
//
// 真因（本条钉住的就是它）：`mpwReconcileStores()` 合成两处存储时，
//   `mpwOverlayFill(win, lose)`（输家补赢家缺的键）+ `mpwStickySource()` 会把**另一处存储残留的旧
//   `webUrl`/`image`** 搬回来 ⇒ 清空后刷新壁纸复活 ⇒ 又去加载渲染器页（用户看到的跳页 + 卡片）。
//   修法 = 清空时立**持久墓碑** `__mpwSrcClearedAt` + 合成时"最新那次写是清空 ⇒ 源字段一律清空"。
//
// 判据三段：A 清除后 / B 选了但坏 / C 无关设置逐字节不变；另有双向对照与变异自证。
// 用法: node tests/clear-wallpaper-clean-test.mjs      （纯 Node：真 lib/client.js 在桩 DOM 里跑）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }

const CLIENT = path.join(WS, 'dsh-mpkg-wallpaper', 'lib', 'client.js')
const DEMO = path.join(ROOT, 'demo.html')
const STUB = pathToFileURL(path.join(WS, 'dsh-mpkg-wallpaper', 'tools', '_stub.mjs')).href
const STORE = 'dsh.mpkg-wallpaper.v2'
const { loadPlugin } = await import(STUB)
const HTML0 = fs.readFileSync(DEMO, 'utf8')
const CLIENT0 = fs.readFileSync(CLIENT, 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 有壁纸的存档（壁纸库/渲染器档 + 一堆外观设置）。 */
const FULL_SRC = {
  converted: 'scene', image: '', source: 'bgcs_x.mp4', mpkgKey: 'custommpkg|x.mpkg', mpkgName: 'x.mpkg',
  webUrl: 'http://127.0.0.1:8902/webloader/?pkgurl=' + encodeURIComponent('http://127.0.0.1:3080/raw?custom=1&folder=9&file=scene.pkg') + '&embed=1',
  sceneKey: 'scene|http://127.0.0.1:3080/raw?custom=1&folder=9&file=scene.pkg',
  entryName: 'scene.json', title: '示例壁纸', folderName: '9', mpkgFile: 'x.mpkg', srcRoot: 'container', srcDirPath: '/lib',
  slot: null, fromMpkg: true,
}
/** 无关设置（外观/行为）—— 清空**必须**一个字节都不动。 */
const APPEARANCE = {
  opacity: 82, blur: 0, zoom: 100, enabled: true, sidebar: true, sharp: true, headerBg: true,
  headerBlurAmount: 41, unifyTint: true, unifyAmount: 30, playbackRate: 1, mute: true, fpsCap: 0,
  resMax: 1920, themeColor: '', roundCompat: false, float: true, bsFloat: true, lgTest: false,
}
/** 假宿主：GET /settings 回内存档；PUT 记账并镜像（与真宿主同形）。 */
function makeHost(settings) {
  const h = { settings: settings ? JSON.parse(JSON.stringify(settings)) : null, puts: 0, gets: 0, urls: [] }
  h.fetch = async (url, opts) => {
    const u = String(url), m = String((opts && opts.method) || 'GET').toUpperCase()
    h.urls.push(m + ' ' + u.replace('http://127.0.0.1:3080', ''))
    const okJson = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o), arrayBuffer: async () => new ArrayBuffer(0) })
    if (u.includes('/api/mpkg-wallpaper/settings')) {
      if (m === 'GET') { h.gets++; return okJson({ ok: true, settings: h.settings }) }
      h.puts++
      try { h.settings = JSON.parse(String(opts && opts.body)) } catch {}
      return okJson({ ok: true })
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
  }
  return h
}
const newLs = (init) => {
  const m = new Map()
  if (init) for (const k of Object.keys(init)) m.set(k, String(init[k]))
  return {
    _m: m,
    getItem(k) { return m.has(k) ? m.get(k) : null },
    setItem(k, v) { m.set(k, String(v)) },
    removeItem(k) { m.delete(k) },
    _json(k) { try { return JSON.parse(m.get(k) || 'null') } catch { return null } },
  }
}
/** 起一个世界（真 lib/client.js + 桩 DOM + 假宿主）。
 *  必须按仓库既有口径做两件事，否则会假红：
 *  ① 客户端有**双重加载护栏**（`client.js` 顶部的 `globalThis.__mpwClientLoaded`）⇒ 每次载入前
 *     要排空上一世界（`settings-persist-test.mjs` 的 boot() 同款，含那 320ms 迟到写排空）；
 *  ② 存储要**自己持有**并跨"重启"复用，否则"刷新"用例测的是空档。 */
async function boot({ local, host, ls, clientPath } = {}) {
  await sleep(320)
  for (const k of Object.keys(globalThis)) if (/^__mpw/.test(k)) { try { delete globalThis[k] } catch {} }
  const LS = ls || newLs(local ? { [STORE]: JSON.stringify(local) } : {})
  const P = loadPlugin({ clientPath, quiet: true, localStorage: LS, fetch: (u, o) => host.fetch(u, o) })
  await sleep(40)
  const A = globalThis.__mpwPersist
  if (!A) throw new Error('未取到 __mpwPersist 钩子')
  try { A.bootSettle('test') } catch {}
  await sleep(40)
  return { P, A, host, LS }
}
/** **面板「清除壁纸」按钮的同一条落盘路径**（`clearBg` 的调用形状：`writeSection(Object.assign({}, readSection(), 补丁), true)`）。
 *  ⚠ 刻意**不用**测试钩子 `__mpwPersist.commit()`：它先做 `mpwMergeSection(readSection(), patch)`
 *   —— 那一步会把补丁里的 `null` 提前吃掉（键消失），于是走的是"另一个形状"，测不出真按钮的行为。 */
const applyClear = (A, at) => A.writePartial(Object.assign({}, A.read(), A.clearPatch(at || Date.now())))
const rawLocal = (A) => { try { return JSON.parse(A.raw() || '{}') } catch (e) { return {} } }
const srcOf = (s) => ({ webUrl: s && s.webUrl, image: s && s.image, sceneKey: s && s.sceneKey, mpkgKey: s && s.mpkgKey, converted: s && s.converted })
const RENDERER_RE = /:(8899|8902)\b/
const rendererFetches = (P) => (P.fetchCalls || []).filter((u) => RENDERER_RE.test(String(u)))
const hasAnySrc = (s, idKeys) => idKeys.some((k) => { const v = s ? s[k] : void 0; return !(v === void 0 || v === null || v === '' || v === false) })

/* ══════════════ A. 清除后：清干净 + 两处都干净 + 不复活 + 不加载渲染器页 + 零提示 ══════════════ */
console.log('\n== A. 清除后（纯白 / 什么都不加载 / 零提示）==')
const hostA = makeHost(Object.assign({}, APPEARANCE, FULL_SRC, { __mpwHostAt: Date.now() - 5000 }))
const A1 = await boot({ local: Object.assign({}, APPEARANCE, FULL_SRC, { __mpwLocalAt: Date.now() - 6000 }), host: hostA })
const idKeys = A1.A.idKeys.slice()
const clearedKey = A1.A.clearedKey
ok('A1 前置：清空前确实有源（否则后面全是在测空档）', hasAnySrc(A1.A.read(), idKeys) && A1.A.probeNeeded() === true, JSON.stringify(srcOf(A1.A.read())))
const patch = A1.A.clearPatch(Date.now())
ok('A2 清除补丁覆盖**全部**身份字段（唯一权威表 ' + idKeys.length + ' 个）+ 立墓碑',
  idKeys.every((k) => Object.prototype.hasOwnProperty.call(patch, k)) && Number(patch[clearedKey]) > 0,
  '补丁键数=' + Object.keys(patch).length)
// 走真写路径（= 面板「清除壁纸」按钮的落点）
applyClear(A1.A)
await sleep(80)
const rawA = rawLocal(A1.A), hostAfter = hostA.settings
ok('A3 清空后 localStorage 那份：身份字段全空', !hasAnySrc(rawA, idKeys), JSON.stringify(srcOf(rawA)).slice(0, 120))
ok('A4 清空后**宿主**那份：身份字段全空（两处都清干净）', !hasAnySrc(hostAfter, idKeys), JSON.stringify(srcOf(hostAfter)).slice(0, 120))
ok('A5 合成档无源 + 不需要再探渲染器（probeNeeded=false）', !hasAnySrc(A1.A.read(), idKeys) && A1.A.probeNeeded() === false)
ok('A6 清空后不会再碰渲染器：门控在位 + 纯裁决 probeNeeded=false（真机实测：清空后 :8899/:8902 请求数 **0**，有壁纸时 41）',
  A1.A.probeNeeded() === false && /if \(!force && !mpwRendererProbeNeeded\(\)\) return;/.test(CLIENT0))

// A7 正中靶心：另一处存储残留旧源 ⇒ 合成**不许**把它搬回来（用户 bug 的复现形态）
{
  const now = Date.now()
  const localCleared = Object.assign({}, APPEARANCE, { image: '', webUrl: null, sceneKey: null, mpkgKey: '', converted: '', source: '', __mpwLocalAt: now, [clearedKey]: now })
  const hostStale = Object.assign({}, APPEARANCE, FULL_SRC, { __mpwHostAt: now - 60000 })   // 清空那次 PUT 没成功 ⇒ 宿主还是旧档
  const rec = A1.A.reconcile(localCleared, hostStale)
  ok('A7 另一处存储残留旧源 ⇒ 合成结果仍然无源（不许复活）', !hasAnySrc(rec.merged, idKeys), JSON.stringify(srcOf(rec.merged)).slice(0, 140))
}
// A8 清除路径的静态接线（防"纯函数写了但没接上"）
{
  const i = CLIENT0.indexOf('const clearBg = () => {')
  const seg = i >= 0 ? CLIENT0.slice(i, i + 2200) : ''
  ok('A8 clearBg 真的调用了 mpwClearWallpaperPatch()（不是各写各的表）', /mpwClearWallpaperPatch\(/.test(seg))
}
// A9 零提示：渲染器侧"合法空态"裁决为不显示（空态不该出现任何东西）
{
  const blk = HTML0.slice(HTML0.indexOf('// ═══ MPW-EMPTYSTATE-BEGIN'), HTML0.indexOf('// ═══ MPW-EMPTYSTATE-END ═══'))
  const fakeDoc = (() => {
    const byId = new Map()
    const mk = () => ({ id: '', style: {}, _a: {}, _h: {}, children: [], textContent: '', setAttribute(k, v) { this._a[k] = String(v); if (k === 'id') { this.id = String(v); byId.set(this.id, this) } }, getAttribute(k) { return this._a[k] === undefined ? null : this._a[k] }, removeAttribute(k) { delete this._a[k] }, appendChild(c) { this.children.push(c); if (c.id) byId.set(c.id, c); return c }, addEventListener(t, f) { (this._h[t] = this._h[t] || []).push(f) }, querySelector(s) { return byId.get(String(s).slice(1)) || null }, set innerHTML(v) { this._html = String(v); for (const m of String(v).matchAll(/id="([^"]+)"/g)) { const c = mk(); c.id = m[1]; byId.set(m[1], c); this.children.push(c) } }, get innerHTML() { return this._html } })
    const body = mk(), documentElement = mk()
    return { document: { createElement: mk, getElementById: (id) => byId.get(id) || null, body, documentElement }, byId }
  })()
  const loc = { search: '?embed=1&nowallpaper=1', pathname: '/webloader/', reload() {} }
  const api = new Function('window', 'document', 'location', 'URLSearchParams', blk + '\nreturn window.__mpwEmptyState;')({ location: loc }, fakeDoc.document, loc, URLSearchParams)
  ok('A9 零提示：合法空态 ⇒ 不显示任何占位（且 show() 被闸门挡住）',
    api.plan({ q: new URLSearchParams('?embed=1&nowallpaper=1'), embedded: true, err: 'pkgurl HTTP 404' }).show === false
    && api.show('fetch-failed', 'x', 'y') === null
    && !fakeDoc.byId.get('mpw-empty-state'))
}

/* ══════════════ B. 选了但坏：仍提示，且可读 / 不遮 / 不拦 ══════════════ */
console.log('\n== B. 选了但坏（提示保留：可读 / 不遮 / 不拦）==')
{
  const blk = HTML0.slice(HTML0.indexOf('// ═══ MPW-EMPTYSTATE-BEGIN'), HTML0.indexOf('// ═══ MPW-EMPTYSTATE-END ═══'))
  const mkEl = () => { const byId = new Map(); const mk = () => ({ id: '', style: {}, _a: {}, _h: {}, children: [], textContent: '', setAttribute(k, v) { this._a[k] = String(v); if (k === 'id') { this.id = String(v); byId.set(this.id, this) } }, getAttribute(k) { return this._a[k] === undefined ? null : this._a[k] }, removeAttribute(k) { delete this._a[k] }, appendChild(c) { this.children.push(c); if (c.id) byId.set(c.id, c); return c }, addEventListener(t, f) { (this._h[t] = this._h[t] || []).push(f) }, querySelector(s) { return byId.get(String(s).slice(1)) || null }, set innerHTML(v) { this._html = String(v); for (const m of String(v).matchAll(/id="([^"]+)"/g)) { const c = mk(); c.id = m[1]; byId.set(m[1], c); this.children.push(c) } }, get innerHTML() { return this._html } }); const body = mk(), documentElement = mk(); return { document: { createElement: mk, getElementById: (id) => byId.get(id) || null, body, documentElement }, byId } }
  const bootHtml = () => { const d = mkEl(); const loc = { search: '?pkgurl=x&embed=1', pathname: '/webloader/', reload() {} }; const api = new Function('window', 'document', 'location', 'URLSearchParams', blk + '\nreturn window.__mpwEmptyState;')({ location: loc }, d.document, loc, URLSearchParams); return { api, ...d } }
  const d = bootHtml()
  const plan = d.api.plan({ err: '❌ 启动失败: pkgurl HTTP 404' })
  ok('B1 有源 + 取不到 ⇒ 仍然提示（kind=fetch-failed）', plan.show === true && plan.kind === 'fetch-failed')
  d.api.show(plan.kind, plan.detail, plan.title)
  const el = d.byId.get('mpw-empty-state')
  const st = el.getAttribute('style') || ''
  ok('B2 可读：浅底 + 深字（不是"黑的字叠在一起"）', /background:#ffffff/.test(st) && /color:#1f2328/.test(st) && !/background:#0(00|d1117)/.test(st))
  ok('B3 不遮：底部锚定 + 限宽 + 限高可滚（不铺满、不撑高）', /bottom:\s*\d/.test(st) && /max-width/.test(st) && !/inset:\s*0/.test(st) && !/top:\s*0/.test(st))
  ok('B4 不拦：容器 pointer-events:none，控件自己 auto', /pointer-events:none/.test(st) && (HTML0.match(/pointer-events:auto/g) || []).length >= 2)
  {
    const cb = d.byId.get('mpw-empty-state-close')
    const before = el.getAttribute('data-mpw-empty')
    ;(cb._h.click || []).forEach((f) => f({ preventDefault() {} }))
    ok('B5 可关闭：点「关闭」即撤', before === 'fetch-failed' && el.getAttribute('data-mpw-empty') === null && el.style.display === 'none')
  }
  // B6 与页面自身 chrome 不重叠的**几何口径**：卡片底部锚定、`#bar` 顶部锚定 ⇒ 不在同一带
  const barTop = /#bar\{[^}]*top:\s*0/.test(HTML0)
  const cardBottom = /bottom:\s*12px/.test(HTML0)
  ok('B6 不遮页面 chrome：卡片底部锚定（bottom:12px）· 顶栏顶部锚定（top:0）⇒ 不同带', barTop && cardBottom)
}

/* ══════════════ C. 无关设置：逐字节不变（防"顺手清太多"）══════════════ */
console.log('\n== C. 无关设置逐字节不变 ==')
{
  const before = Object.assign({}, APPEARANCE, FULL_SRC, { __mpwLocalAt: Date.now() - 6000 })
  const hostC = makeHost(Object.assign({}, APPEARANCE, FULL_SRC, { __mpwHostAt: Date.now() - 5000 }))
  const C1 = await boot({ local: before, host: hostC })
  const snapBefore = Object.assign({}, C1.A.read())
  const rawBefore = rawLocal(C1.A)
  applyClear(C1.A)
  await sleep(80)
  const snapAfter = Object.assign({}, C1.A.read())
  const changed = Object.keys(APPEARANCE).filter((k) => JSON.stringify(snapBefore[k]) !== JSON.stringify(snapAfter[k]))
  ok('C1 无关设置（外观/行为 ' + Object.keys(APPEARANCE).length + ' 项）逐字段不变', changed.length === 0, changed.length ? '变了: ' + changed.join(',') : '')
  const removed = Object.keys(snapBefore).filter((k) => !(k in snapAfter)).sort()
  const rawAfter = rawLocal(C1.A)
  /* ⚠ 新增键要读**原始存储**：`read()` 会把记账键（含墓碑）剥掉 —— 面板看不见它是设计，
     但"墓碑有没有真的落盘"只能问原始档。 */
  const added = Object.keys(rawAfter).filter((k) => !(k in rawBefore) && !/^__mpw(Local|Host)At$/.test(k)).sort()
  const emptied = ['image', 'source', 'converted', 'mpkgKey', 'mpkgName'].filter((k) => snapAfter[k] !== '')
  ok('C2a 被删的键**只**是身份字段（无多删：外观/行为键一个都没被删）',
    removed.length > 0 && removed.every((k) => idKeys.indexOf(k) >= 0), '删={' + removed.join(',') + '}')
  /* 新增键只允许两个：清空墓碑 + `writeSection` 本来就会打的磨砂"用户动过"标记
     （`headerFrostUserSet`：档里带 headerBg/unifyTint 时任何一次写都会打，与"清除"无关）。 */
  ok('C2b 只多出清空墓碑（外加写路径固有的 headerFrostUserSet 标记），没有别的副作用',
    added.indexOf(clearedKey) >= 0 && added.every((k) => k === clearedKey || k === 'headerFrostUserSet'), '增={' + added.join(',') + '}')
  ok('C2c 那 6 个"空值口径"字段仍在档里、且被清空（image/source/converted/mpkgKey/mpkgName/fromMpkg）',
    emptied.length === 0 && snapAfter.fromMpkg === false, emptied.length ? '没清空: ' + emptied.join(',') : '')
}

/* ══════════════ D. 双向：清空后还能选上（墓碑不得压住新壁纸）══════════════ */
console.log('\n== D. 双向（清空 ⇒ 再选壁纸 ⇒ 必须能选上）==')
{
  const hostD = makeHost(Object.assign({}, APPEARANCE, { image: '', webUrl: null, __mpwHostAt: Date.now() - 5000 }))
  const D1 = await boot({ local: Object.assign({}, APPEARANCE, { image: '', webUrl: null, sceneKey: null, mpkgKey: '', converted: '', [clearedKey]: Date.now() - 3000, __mpwLocalAt: Date.now() - 4000 }), host: hostD })
  ok('D1 清空档已就位（probeNeeded=false）', D1.A.probeNeeded() === false)
  D1.A.commit(Object.assign({}, FULL_SRC))
  await sleep(80)
  const s = D1.A.read()
  ok('D2 再选壁纸 ⇒ 源回来了，且**墓碑在两处存储里都已作废**（不会被永久压住）',
    hasAnySrc(s, idKeys) && rawLocal(D1.A)[clearedKey] === void 0 && hostD.settings[clearedKey] === void 0,
    JSON.stringify({ src: srcOf(s), localMarker: rawLocal(D1.A)[clearedKey], hostMarker: hostD.settings[clearedKey] }))
  ok('D3 再选之后 probeNeeded=true（门控不是"永不探"）', D1.A.probeNeeded() === true)
  const P2 = await boot({ local: Object.assign({}, APPEARANCE, FULL_SRC, { __mpwLocalAt: Date.now() - 1000 }), host: makeHost(Object.assign({}, APPEARANCE, { image: '', webUrl: null, [clearedKey]: Date.now() - 60000, __mpwHostAt: Date.now() - 60000 })) })
  ok('D4 反向：本地是新壁纸、另一处是**旧**清除档 ⇒ 不许把新壁纸抹掉', hasAnySrc(P2.A.read(), idKeys), JSON.stringify(srcOf(P2.A.read())).slice(0, 120))
}

/* ══════════════ E. 变异自证：期望红集 == 实际红集 ══════════════ */
console.log('\n== E. 变异自证 ==')
/** 把主体判据压成一份"红集"，供变异体逐组跑（同一套真实现，只是换了 client.js 源）。 */
const SUITE = async (clientPath) => {
  const red = []
  const expect = (id, cond) => { if (!cond) red.push(id) }
  const cli = fs.readFileSync(clientPath, 'utf8')
  try {
    const idKeys2 = ['image', 'webUrl', 'sceneKey', 'source', 'mpkgKey', 'mpkgName', 'entryName', 'converted', 'fromMpkg', 'slot', 'title', 'folderName', 'mpkgFile', 'srcRoot', 'srcDirPath']
    // —— A / C 段：清一次，两个方向一起断言
    const host = makeHost(Object.assign({}, APPEARANCE, FULL_SRC, { __mpwHostAt: Date.now() - 5000 }))
    const B = await boot({ local: Object.assign({}, APPEARANCE, FULL_SRC, { __mpwLocalAt: Date.now() - 6000 }), host, clientPath })
    const ck = B.A.clearedKey
    const patch2 = B.A.clearPatch(Date.now())
    expect('A2', idKeys2.every((k) => Object.prototype.hasOwnProperty.call(patch2, k)) && Number(patch2[ck]) > 0)
    const before = Object.assign({}, B.A.read())
    B.A.writePartial(Object.assign({}, before, patch2)); await sleep(80)
    const after = Object.assign({}, B.A.read())
    expect('A3', !hasAnySrc(rawLocal(B.A), idKeys2))
    expect('A4', !hasAnySrc(host.settings, idKeys2))
    expect('A6', B.A.probeNeeded() === false && /if \(!force && !mpwRendererProbeNeeded\(\)\) return;/.test(cli))
    expect('C1', Object.keys(APPEARANCE).every((k) => JSON.stringify(before[k]) === JSON.stringify(after[k])))
    const removed = Object.keys(before).filter((k) => !(k in after))
    expect('C2a', removed.length > 0 && removed.every((k) => idKeys2.indexOf(k) >= 0))
    // —— A7：另一处存储残留旧源 ⇒ 合成不许复活
    const now = Date.now()
    const rec = B.A.reconcile(
      Object.assign({}, APPEARANCE, { image: '', webUrl: null, sceneKey: null, mpkgKey: '', converted: '', __mpwLocalAt: now, [ck]: now }),
      Object.assign({}, APPEARANCE, FULL_SRC, { __mpwHostAt: now - 60000 }))
    expect('A7', !hasAnySrc(rec.merged, idKeys2))
    // —— D 段：清空后还能选上 + 反向不许误清
    const host2 = makeHost(Object.assign({}, APPEARANCE, { image: '', webUrl: null, __mpwHostAt: Date.now() - 5000 }))
    const D = await boot({ local: Object.assign({}, APPEARANCE, { image: '', webUrl: null, sceneKey: null, mpkgKey: '', converted: '', [ck]: Date.now() - 3000, __mpwLocalAt: Date.now() - 4000 }), host: host2, clientPath })
    D.A.commit(Object.assign({}, FULL_SRC)); await sleep(80)
    expect('D2', hasAnySrc(D.A.read(), idKeys2) && rawLocal(D.A)[ck] === void 0 && host2.settings[ck] === void 0)
    const host3 = makeHost(Object.assign({}, APPEARANCE, { image: '', webUrl: null, [ck]: Date.now() - 60000, __mpwHostAt: Date.now() - 60000 }))
    const P2 = await boot({ local: Object.assign({}, APPEARANCE, FULL_SRC, { __mpwLocalAt: Date.now() - 1000 }), host: host3, clientPath })
    expect('D4', hasAnySrc(P2.A.read(), idKeys2))
  } catch (e) { red.push('THROW:' + String((e && e.message) || e).slice(0, 60)) }
  return red.slice().sort()
}
const MUT = [
  { name: 'M1 去掉合成时的"墓碑优先"分支（残留旧源会被搬回来）', expect: ['A7'],
    mk: (s) => s.replace('if (clearedAt > 0) {', 'if (false) {') },
  { name: 'M2 清除时"顺手清太多"（把无关设置 opacity 也一起清掉）', expect: ['C1', 'C2a'],
    mk: (s) => s.replace('for (const k of MPW_WALLPAPER_ID_KEYS) p[k] = null;', 'for (const k of MPW_WALLPAPER_ID_KEYS) p[k] = null; p.opacity = null;') },
  { name: 'M3 清除补丁退回旧 9 键表（漏 entryName/title/folderName/mpkgFile/srcRoot/srcDirPath）', expect: ['A2', 'A3', 'A4'],
    mk: (s) => s.replace('for (const k of MPW_WALLPAPER_ID_KEYS) p[k] = null;', 'for (const k of ["image","webUrl","sceneKey","source","mpkgKey","mpkgName","converted","fromMpkg","slot"]) p[k] = null;') },
  { name: 'M4 去掉"带真源的写 ⇒ 墓碑作废"（清过一次就再也选不上）', expect: ['D2'],
    mk: (s) => s.replace('if (stale && (mpwHasAnyWallpaperIdentity(next) || mpwHasAnyWallpaperIdentity(prevCache))) delete next[MPW_SRC_CLEARED_KEY];', '/* mutated */') },
  { name: 'M5 去掉探测门控（没有壁纸也会去 GET 渲染器页）', expect: ['A6'],
    mk: (s) => s.replace('if (!force && !mpwRendererProbeNeeded()) return;', '/* mutated */') },
]
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-clear-'))
let mutBad = 0
for (const m of MUT) {
  const p = path.join(tmp, 'client-' + MUT.indexOf(m) + '.js')
  fs.writeFileSync(p, m.mk(CLIENT0))
  const actual = await SUITE(p)
  const expect = m.expect.slice().sort()
  const same = JSON.stringify(actual) === JSON.stringify(expect)
  if (!same) mutBad++
  console.log((same ? '  ✓ ' : '  ✗ ') + m.name)
  console.log('      期望红集 == 实际红集 : ' + (same ? '是' : '否') + '  期望[' + expect.join(',') + ']  实际[' + actual.join(',') + ']')
}
ok('E 全部 ' + MUT.length + ' 个变异体的「期望红集 == 实际红集」', mutBad === 0, '不一致 ' + mutBad + ' 个')
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}

console.log('\n' + (fail === 0 ? '✅ PASS' : '❌ FAIL') + '：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)

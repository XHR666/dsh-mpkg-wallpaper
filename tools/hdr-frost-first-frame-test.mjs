// tools/hdr-frost-first-frame-test.mjs —— 2026-10-28 任务书 §2「切换会话标题栏首帧透明」判据
//
// 根因链（frost-rail-test remount 场景已证）：
//   会话切换（会话↔会话 / 子代理↔主对话）时宿主把 header.wSkVaW_root/[data-slot=conversation.session.header]
//   整块重建 ⇒ 我们注入的 .mpw-hdrFrost 随旧节点被卸载、旧节点上的 data-mpw-hdr-translucent 一并消失；
//   唯一补挂通路 = 重挂载观察器 → **50ms 去抖** syncHeaderFrost ⇒ 首帧 1~2 帧落到宿主默认（透明）。
// 修法（a6a7dce「观察器同步快路」同家族）：观察器回调（微任务、绘制前）同步跑 headerFrostFastInject：
//   只信最近一次 sync 的结论（hdrFrostState.injected/px），ensureHeaderFrost(px) 幂等补层 + 补
//   data-mpw-hdr-translucent。半透明底色 --mpw-hdr-frost-bg 在 documentElement 上，重建不丢。
//
// 本文件断言（每条都能被变异变红，见文末 M1–M3）：
//   A1 静态接线：回调具名化 + 快路调用在位 + 判据出口（fastInject/watchOn）暴露
//   A2 无新 containing-block：快路只做 ensureHeaderFrost + setAttribute，不碰 header 祖先的
//      transform/filter/backdrop-filter（静态：函数体内无此类写入）
//   B1 稳态：sync 后磨砂已注入（记录稳态 px 与 blur 值）
//   B2 首帧采样：模拟切会话（换 header 节点）→ 走**真观察器回调**（watchOn）→
//      t=0/16/50/100/200ms 采样，每帧 backdrop-filter 与半透明属性都与稳态一致（epsilon=逐字相等）
//   B3 反向（关档）：?hdrfrost=off ⇒ fastInject 恒 0、不注入
//   B4 反向（空栏）：新顶栏是 headerBlank ⇒ 快路不画（层被摘 + data-mpw-hdr-blank 广播）
//   B5 幂等：同帧重复 fire 不自激（第二次 fastInject=0）
//   M1 变异：回调里的快路调用删除 ⇒ B2 必红（首帧只能等 50ms 去抖）
//   M2 变异：fastInject 的 injected/px 门槛删除 ⇒ B3 必红（关档被注入）
//   M3 变异：快路的半透明底属性补打删除 ⇒ B2b 必红（层在、底色属性不在）
//
// 用法: node tools/hdr-frost-first-frame-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin, cancelWorldTimers } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce',
  '__mpwBuildCss', '__mpwSectionTest', '__mpwHdrFrostTest', '__mpwGlobalWired', '__mpwNpCtlSeq', '__mpwNowPlaying',
  '__mpwNowPlayingSlotAction', '__mpwPersist', '__mpwStyleWatch', '__mpwHeavyTest', '__mpwPopUntruncTest', '__mpwBsTabState']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }

console.log('== A. 静态接线 ==')
ok('A1 同步快路接线在位：headerFrostFastInject 定义 + 观察器回调调用 + 具名回调 new MO(headerFrostWatchOnRecords) + 判据出口',
  CLIENT.includes('function headerFrostFastInject()')
  && CLIENT.includes('try { headerFrostFastInject() } catch (e) {}')
  && CLIENT.includes('new MO(headerFrostWatchOnRecords)')
  && CLIENT.includes('fastInject: () => { try { return headerFrostFastInject() } catch (e) { return 0 } }')
  && CLIENT.includes('watchOn: (records) => { try { return headerFrostWatchOnRecords(records) } catch (e) { return false } }'))
{
  /* A2：截出 headerFrostFastInject 函数体，断言它不写任何 transform/filter/backdrop-filter
     （任务书 §2 红线：不得引入新的 containing-block —— 不给 header 祖先加这三样）。 */
  const i = CLIENT.indexOf('function headerFrostFastInject() {')
  const j = CLIENT.indexOf('\n\t\t}', CLIENT.indexOf('return out ? 1 : 0;', i))
  const body = CLIENT.slice(i, j > 0 ? j : i + 1600)
  ok('A2 快路函数体零 containing-block 写入（无 transform/filter/backdrop-filter 赋值）',
    !/\.style\.(setProperty\(\s*["'](transform|filter|backdrop-filter)|transform\s*=|filter\s*=|backdropFilter\s*=)/.test(body),
    'len=' + body.length)
}

/* ---------- 夹具（frost-rail-test 同款：FakeEl + 可手动 fire 的 FakeMO + 定向 querySelector） ---------- */
class FakeStyle {
  constructor() { this._m = new Map() }
  setProperty(k, v) { this._m.set(String(k), String(v)) }
  removeProperty(k) { this._m.delete(String(k)) }
  getPropertyValue(k) { return this._m.has(String(k)) ? this._m.get(String(k)) : '' }
  set cssText(v) { this._raw = String(v) }
  get cssText() { return this._raw || '' }
}
class FakeEl {
  constructor(tag = 'div', cls = '') {
    this.tagName = String(tag).toUpperCase(); this.className = cls; this.style = new FakeStyle()
    this.children = []; this._attrs = new Map(); this.parentElement = null; this.nodeType = 1
    const self = this
    this.classList = {
      contains: (c) => String(self.className || '').split(/\s+/).includes(c),
      add: (c) => { if (!self.classList.contains(c)) self.className = (self.className ? self.className + ' ' : '') + c },
      remove: (c) => { self.className = String(self.className || '').split(/\s+/).filter((x) => x && x !== c).join(' ') },
    }
  }
  setAttribute(k, v) { this._attrs.set(k, v === undefined ? '' : String(v)) }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null }
  removeAttribute(k) { this._attrs.delete(k) }
  hasAttribute(k) { return this._attrs.has(k) }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c }
  insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : 0; this.children.splice(i < 0 ? 0 : i, 0, c); c.parentElement = this; return c }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c }
  remove() { if (this.parentElement) this.parentElement.removeChild(this) }
  querySelector(sel) {
    const m = /^:scope\s*>\s*\.([\w-]+)$/.exec(sel)
    if (m) return this.children.find((c) => String(c.className).split(/\s+/).includes(m[1])) || null
    return null
  }
  querySelectorAll() { return [] }
  getBoundingClientRect() { return { x: 0, y: 0, width: 1200, height: 48, top: 0, left: 0, right: 1200, bottom: 48 } }
  get firstChild() { return this.children[0] || null }
}
class FakeMO {
  constructor(cb) { this.cb = cb; this.targets = []; FakeMO.instances.push(this); FakeMO.created++ }
  observe(t, o) { this.targets.push({ t, o }) }
  disconnect() { this.targets = [] }
  takeRecords() { return [] }
  static fire(target, added, removed) {
    const rec = { target, addedNodes: added || [], removedNodes: removed || [] }
    for (const inst of FakeMO.instances) {
      if (!inst.targets.some((x) => x.t === target)) continue
      try { inst.cb([rec], inst) } catch {}
    }
  }
}
FakeMO.instances = []; FakeMO.created = 0

function boot({ search = '', blankHeader = false, clientPath } = {}) {
  reset()
  FakeMO.instances = []; FakeMO.created = 0
  globalThis.MutationObserver = FakeMO
  const world = loadPlugin({ quiet: true, search, clientPath, settings: { enabled: true, image: true, unifyTint: true, unifyAmount: 30 } })
  const hdr = new FakeEl('header', 'wSkVaW_header' + (blankHeader ? ' wSkVaW_headerBlank' : ''))
  const body = new FakeEl('body', '')
  const html = new FakeEl('html', '')
  const convRoot = new FakeEl('div', ''); convRoot.setAttribute('data-slot', 'main.conversation')
  convRoot.appendChild(hdr)
  globalThis.__hdrNow = hdr
  globalThis.document.querySelector = (sel) => {
    if (/wSkVaW_header/.test(sel)) return globalThis.__hdrNow
    if (/main\.conversation/.test(sel)) return convRoot
    return null
  }
  const bgImgEl = new FakeEl('img', 'mpw-bgImg'); bgImgEl.id = 'mpw-bgImg'; bgImgEl.setAttribute('src', 'data:image/png;base64,iVBORw0KGgo=')
  const bgWrapEl = new FakeEl('div', 'mpw-bgWrap'); bgWrapEl.id = 'mpw-bgWrap'
  const bgVideoEl = new FakeEl('video', 'mpw-bgVideo'); bgVideoEl.id = 'mpw-bgVideo'
  globalThis.document.getElementById = (id) => (id === 'mpw-bgWrap' ? bgWrapEl : id === 'mpw-bgImg' ? bgImgEl : id === 'mpw-bgVideo' ? bgVideoEl : null)
  globalThis.document.createElement = (tag) => new FakeEl(tag)
  globalThis.document.body = body
  globalThis.document.documentElement = html
  globalThis.getComputedStyle = (el) => ({
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    backdropFilter: (el && el.style && el.style.getPropertyValue && el.style.getPropertyValue('backdrop-filter')) || 'none',
    position: 'relative', overflow: 'visible', zIndex: 'auto', display: 'block', visibility: 'visible', opacity: '1',
    getPropertyValue: (k) => (el && el.style && el.style.getPropertyValue ? el.style.getPropertyValue(k) : ''),
  })
  return { hdr, body, html, convRoot, T: globalThis.__mpwHdrFrostTest }
}
/* ensureHeaderFrost 用 el.style.cssText = "…" 之后再 el.style.backdropFilter = bf（直接属性赋值）
   —— 桩的 FakeStyle 只有 getPropertyValue 映射表，直接赋值落在实例属性上 ⇒ 两处都要读。 */
const frostOf = (hdr) => { try { return hdr.querySelector(':scope > .mpw-hdrFrost') } catch { return null } }
const frostBlur = (hdr) => {
  const el = frostOf(hdr)
  if (!el) return null
  const s = el.style || {}
  const direct = s.backdropFilter || s.webkitBackdropFilter
  return direct !== undefined && direct !== '' ? String(direct) : (s.getPropertyValue('backdrop-filter') || null)
}

console.log('\n== B. 行为（真 syncHeaderFrost + 真观察器回调）==')
/* B1–B2/B5：稳态 → 切会话 → 首帧采样 */
let steadyPx = null, steadyBlur = null
{
  const F = boot()
  const T = F.T
  ok('B0 判据出口在（fastInject/watchOn）', !!T && typeof T.fastInject === 'function' && typeof T.watchOn === 'function')
  T.sync()
  const st = T.state() || {}
  steadyPx = st.px; steadyBlur = frostBlur(globalThis.__hdrNow)
  ok('B1 稳态：磨砂已注入（px>0、层在、blur 值记录）',
    st.injected === true && steadyPx > 0 && steadyBlur === 'blur(' + steadyPx + 'px)', 'px=' + steadyPx + ' blur=' + steadyBlur)

  /* 模拟切会话：header 节点整块换新（真机结构：convRoot 不换、顶栏换） */
  const oldHdr = globalThis.__hdrNow
  const hdr2 = new FakeEl('header', 'wSkVaW_header')
  F.convRoot.removeChild(oldHdr); F.convRoot.appendChild(hdr2)
  globalThis.__hdrNow = hdr2
  /* 走**真观察器回调**（生产里 new MO(headerFrostWatchOnRecords) 跑的就是这一段） */
  const interesting = T.watchOn([{ target: F.convRoot, addedNodes: [hdr2], removedNodes: [oldHdr] }])
  /* —— t=0 采样（回调同步返回后立即读 = 微任务内、绘制前） —— */
  const t0Blur = frostBlur(hdr2)
  const t0Translucent = hdr2.hasAttribute('data-mpw-hdr-translucent')
  ok('B2a 首帧（t=0）：观察器回调同步给新顶栏补上磨砂层，blur 与稳态逐字一致',
    interesting === true && !!frostOf(hdr2) && t0Blur === steadyBlur, 't0=' + t0Blur + ' 稳态=' + steadyBlur)
  ok('B2b 首帧（t=0）：半透明底属性同步补上（背景 alpha 不再落到宿主默认）',
    t0Translucent === true, 'attr=' + t0Translucent)
  /* t=16/50/100/200ms 连续采样：每一帧都与稳态一致（去抖补跑只做幂等收口，不再有"空窗"） */
  const samples = []
  let allSteady = true
  for (const t of [16, 50, 100, 200]) {
    await sleep(t === 16 ? 16 : t - samples[samples.length - 1].t)
    const blur = frostBlur(hdr2)
    samples.push({ t, blur, ok: blur === steadyBlur && hdr2.hasAttribute('data-mpw-hdr-translucent') })
    if (!samples[samples.length - 1].ok) allSteady = false
  }
  ok('B2c t=16/50/100/200ms 采样：每帧 backdrop-filter 与半透明属性都与稳态一致',
    allSteady, samples.map((s) => 't=' + s.t + ':' + (s.ok ? '稳' : s.blur)).join(' '))
  /* 幂等：同帧再 fire 一次（或再调 fastInject）不得重复注入/重复打标 */
  const fastAgain = T.fastInject()
  ok('B5 幂等：层与属性已在 ⇒ fastInject 返回 0（不自激、不重复打标）', fastAgain === 0, 'ret=' + fastAgain)
  cancelWorldTimers()
}
/* B3：关档（?hdrfrost=off）⇒ 快路恒不动手 */
{
  const F = boot({ search: '?hdrfrost=off' })
  const T = F.T
  T.sync()
  const st = T.state() || {}
  const n = T.fastInject()
  ok('B3 反向（关档）：?hdrfrost=off ⇒ injected=false，fastInject=0、层不存在',
    st.injected === false && n === 0 && !frostOf(globalThis.__hdrNow), 'n=' + n + ' injected=' + st.injected)
  cancelWorldTimers()
}
/* B4：空栏（wSkVaW_headerBlank）⇒ 快路不画（ensureHeaderFrost 空栏分支照常生效） */
{
  const F = boot({ blankHeader: true })
  const T = F.T
  T.sync()
  const n = T.fastInject()
  ok('B4 反向（空栏）：headerBlank ⇒ 不注入磨砂、body 广播 data-mpw-hdr-blank',
    n === 0 && !frostOf(globalThis.__hdrNow) && F.body.hasAttribute('data-mpw-hdr-blank'), 'n=' + n)
  cancelWorldTimers()
}

console.log('\n== M. 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const MUT = [
  { id: 'M1', what: '观察器回调里的快路调用删除 ⇒ 首帧只能等 50ms 去抖 ⇒ B2a 必红', expect: ['B2a'],
    patch: (s) => s.replace('try { headerFrostFastInject() } catch (e) {}', '/* 快路调用已变异移除 */'),
    verify: (s) => s.indexOf('try { headerFrostFastInject() } catch (e) {}') < 0 },
  { id: 'M2', what: 'fastInject 的 injected/px 门槛删除 ⇒ 关档也被注入 ⇒ B3 必红', expect: ['B3'],
    patch: (s) => s.replace('if (!hdrFrostState.injected || !(hdrFrostState.px > 0)) return 0;', '/* 门槛已变异移除 */'),
    verify: (s) => s.indexOf('if (!hdrFrostState.injected || !(hdrFrostState.px > 0)) return 0;') < 0 },
  { id: 'M3', what: '快路的半透明底属性补打删除 ⇒ 层在、属性不在 ⇒ B2b 必红', expect: ['B2b'],
    patch: (s) => s.replace('try { if (out && hdr.hasAttribute && !hdr.hasAttribute("data-mpw-hdr-translucent")) hdr.setAttribute("data-mpw-hdr-translucent", "") } catch (e) {}', '/* 半透明底属性补打已变异移除 */'),
    verify: (s) => s.indexOf('!hdr.hasAttribute("data-mpw-hdr-translucent")) hdr.setAttribute') < 0 },
]
async function runOnCopy(mut) {
  const raw = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const mutated = mut.patch(raw)
  if (!mut.verify(mutated)) return { inert: true }
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-hdrff-'))
  process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
  const p = path.join(TMP, 'client-mut.js')
  fs.writeFileSync(p, mutated)
  const r = { inert: false }
  try {
    const F = boot({ clientPath: p })
    const T = F.T
    T.sync()
    const st = T.state() || {}
    steadyPx = st.px; steadyBlur = frostBlur(globalThis.__hdrNow)
    const oldHdr = globalThis.__hdrNow
    const hdr2 = new FakeEl('header', 'wSkVaW_header')
    F.convRoot.removeChild(oldHdr); F.convRoot.appendChild(hdr2)
    globalThis.__hdrNow = hdr2
    T.watchOn([{ target: F.convRoot, addedNodes: [hdr2], removedNodes: [oldHdr] }])
    r['B2a'] = !!frostOf(hdr2) && frostBlur(hdr2) === steadyBlur
    r['B2b'] = hdr2.hasAttribute('data-mpw-hdr-translucent')
    cancelWorldTimers()
  } catch (e) { r.err = String(e && e.message || e) }
  try {
    const F = boot({ search: '?hdrfrost=off', clientPath: p })
    const T = F.T
    T.sync()
    const n = T.fastInject()
    r['B3'] = n === 0 && !frostOf(globalThis.__hdrNow)
    cancelWorldTimers()
  } catch (e) { r.err2 = String(e && e.message || e) }
  return r
}
for (const m of MUT) {
  const r = await runOnCopy(m)
  if (r.inert) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id + '：变异没有真的打上去（R2）'); continue }
  const red = m.expect.filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + ' ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red) + (r.err ? ' err=' + r.err : '')) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

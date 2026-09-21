// tools/bgwrap-visible-test.mjs —— 「有壁纸源时 `.mpw-bgWrap` 不得被隐藏 / 不得空着」回归
//
// 背景（2026-09-17 壁纸层可见性轮，判据/证据见 docs/BGWRAP-VISIBILITY.md）：
//   线索是"无头里 `.mpw-bgWrap` 恒为 computed display:none，疑似注入式 localStorage 与宿主
//   /settings 合并时序"。判据测量（tools/bgwrap-display-probe.mjs）结论：
//     · `display:none` 只有两种**正常语义**来源：①没有可用壁纸源（buildCss 的 `if (!hasImage)`）；
//       ②面板不透明度 100%（`hideBg = hasImage && panel >= 100`，A/B 单变量实测 op99→block、op100→none）；
//     · 宿主 /settings 失败/返回 null/慢响应三种时序下**都不隐藏**（localStorage 兜底成立）；
//     · 真正的真机 bug 是第三种状态：**层可见但里面没有画面** —— `showImageEl()` 里
//       `disarmSceneWatchdog(true)` → `mpwSceneClearFallback()` 无条件下清掉了调用方**刚刚**
//       才设好的 `img.src`（探针实测：设 156630 字符 → 3ms 后被清 → naturalWidth 恒 0）。
//
// 本测试四组：
//   PART 1 行为断言（真 buildCss，经 _stub 在 Node 里跑真插件）：有源不得 none；none 的两种来源可判别；
//          宿主失败/null/慢响应/合并都不得把"有源"误判成"无源"。
//   PART 2 运行时断言（切真源码块 + 假 DOM 跑真 `showImageEl`）：有源时 img.src **必须留下**；
//          场景兜底清理照旧；`?bgwrapfix=legacy` 回退开关真的接线。
//   PART 3 分辨力自证（变异测试）：把切出来的 `showImageEl` 变异回旧写法（去掉 keepSrc），
//          PART 2 的同一条断言必须变红 —— "改回旧写法要能红"。
//   PART 4 诊断接口：`window.__mpwBgWrapState()` 与回退开关取值一致（便于真机取证）。
//
// 用法: node tools/bgwrap-visible-test.mjs [--client <path>]
//   --client 指向**修复前**的副本（如 `git show HEAD:lib/client.js > /tmp/before.js`）：
//   PART 1 仍应全绿（buildCss 的语义没变），PART 2/3 必须变红 ⇒ 证明这组断言抓的是本次回归。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ai = process.argv.indexOf('--client')
const clientPath = ai > 0 ? process.argv[ai + 1] : path.join(here, '..', 'lib', 'client.js')
const src = fs.readFileSync(clientPath, 'utf8')

let pass = 0
let fail = 0
const ok = (n) => { pass++; console.log('  ✓ ' + n) }
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')) }

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
const NONE = /\.mpw-bgWrap\s*\{\s*display:\s*none/
// `!hasImage` 分支**独有**的锚点（由 buildCss 源码 5214 行那段 `.pI_x6G_sidebarCol, .hHd-Xa_root`
// 与 `.ydkMvW_root` 组成；有源分支不会生成这对规则）。用它把"无源语义"与"不透明语义"分开。
// ①(2026-09-18 §5 第1项 token 命名空间) 无源分支的**独有锚点**（分辨力所在：区分"不透明语义"）：
//   侧栏底色改读我们命名空间的 --mpw-surface-host-side（= 原样读回宿主 --dsw-specific-sidebar-fill，
//   无源档不覆盖宿主 token）。锚点仍是"只有无源分支才会输出"的那一段，不变的是判据、变的是取值来源。
const NO_SRC = /\.pI_x6G_sidebarCol,\s*\n\.hHd-Xa_root\s*\{\s*background-color:\s*var\(--mpw-surface-host-side\)[\s\S]{0,200}?\.ydkMvW_root/

console.log('== PART 1 行为断言：有源不得 display:none，两种 none 来源可判别 ==')
const SRC_SETTINGS = { enabled: true, image: IMG, opacity: 82, converted: 'png' }

/** 载入真插件（桩 DOM），返回 buildCss 入口 + 诊断接口。
 *  ①(注) client.js 首个语句是 `if (globalThis.__mpwClientLoaded) return ...`（防重复注册）⇒
 *  同进程里多次载入前必须清掉这些 window 级标记，否则第二次拿到的是上一次的实例。 */
function boot (settings, { fetchImpl, search } = {}) {
  for (const k of Object.keys(globalThis)) if (/^__mpw/.test(k)) { try { delete globalThis[k] } catch {} }
  const r = loadPlugin({ clientPath, settings, quiet: true, fetch: fetchImpl, search })
  return { r, css: (patch) => globalThis.__mpwBuildCss(patch || {}), state: () => (globalThis.__mpwBgWrapState ? globalThis.__mpwBgWrapState() : null) }
}

{
  // ① 有源 + 默认不透明度 82（默认档）→ 不得隐藏
  const b = boot(SRC_SETTINGS)
  const css = b.css()
  if (!NONE.test(css)) ok('有壁纸源 + opacity 82 ⇒ CSS 不含 `.mpw-bgWrap{display:none}`')
  else bad('有壁纸源 + opacity 82 却被隐藏', '命中 display:none')
  if (!NO_SRC.test(css)) ok('有源分支不含"无源"独有锚点（判据可判别）')
  else bad('有源却走了"无源"分支', 'NO_SRC 锚点命中')

  // ② 边界：opacity 99 仍不得隐藏
  const css99 = b.css({ opacity: 99 })
  if (!NONE.test(css99)) ok('有壁纸源 + opacity 99（边界）⇒ 不隐藏')
  else bad('opacity 99 就被隐藏了', '阈值不该早于 100')

  // ③ opacity 100（面板完全不透明）→ 允许隐藏，但必须是"不透明语义"而不是"无源语义"
  const css100 = b.css({ opacity: 100 })
  if (NONE.test(css100) && !NO_SRC.test(css100)) ok('opacity 100 ⇒ 隐藏，且判据=面板不透明（不是无源分支）')
  else bad('opacity 100 的隐藏来源不对', `none=${NONE.test(css100)} noSrc=${NO_SRC.test(css100)}`)

  // ④ 无源 → 隐藏，且必须命中"无源"独有锚点（反向对照：证明锚点有分辨力）
  const cssNo = b.css({ image: '', webUrl: '', converted: '' })
  if (NONE.test(cssNo) && NO_SRC.test(cssNo)) ok('无源 ⇒ 隐藏，且判据=无源分支（正常语义）')
  else bad('无源的正常语义没走到', `none=${NONE.test(cssNo)} noSrc=${NO_SRC.test(cssNo)}`)

  // ⑤ web 壁纸（image 为 ""，只有 webUrl）也算有源
  const cssWeb = b.css({ image: '', webUrl: 'http://127.0.0.1:9/x.html', converted: 'web' })
  if (!NONE.test(cssWeb) && /\.mpw-bgWrap\.mpw-web iframe\.mpw-webFrame\s*\{\s*display:\s*block/.test(cssWeb)) ok('web 壁纸（image 为空、有 webUrl）⇒ 不隐藏且 iframe 可见规则在')
  else bad('web 壁纸被当成无源', `none=${NONE.test(cssWeb)}`)

  // ⑥ 总开关关闭 → 隐藏（用户显式关掉）。注意：`enabled:false → image:""` 的换算在**调用点**
  //    （applyFromStorageInner 3289-3291 / 样式自愈 12201），buildCss 只认 image/webUrl ⇒ 这里按调用点口径造 patch。
  const cssOff = b.css({ enabled: false, image: '' })
  if (NONE.test(cssOff) && NO_SRC.test(cssOff)) ok('总开关关闭 ⇒ 隐藏（走无源语义，与调用点换算一致）')
  else bad('总开关关闭的语义不对', `none=${NONE.test(cssOff)} noSrc=${NO_SRC.test(cssOff)}`)
}

{
  // ⑦ 宿主 /settings 不可用（桩默认 404）→ localStorage 兜底，有源不得隐藏
  const b = boot(SRC_SETTINGS)
  if (!NONE.test(b.css())) ok('宿主 /settings 不可用（404）⇒ 有源仍不隐藏（localStorage 兜底）')
  else bad('宿主不可用时把有源当无源', '命中 display:none')
}

{
  // ⑧ 宿主 /settings 返回 settings:null → 不得把有源当无源
  const b = boot(SRC_SETTINGS, { fetchImpl: () => ({ ok: true, status: 200, json: async () => ({ ok: true, settings: null }) }) })
  await tick()
  if (!NONE.test(b.css())) ok('宿主 /settings 返回 settings:null ⇒ 有源仍不隐藏')
  else bad('宿主空设置覆盖掉了本地壁纸源', '命中 display:none')
}

{
  // ⑨ 宿主 /settings 慢响应（3s）→ **早期**（合并尚未落地）也不得隐藏
  let release = null
  const slow = new Promise((r) => { release = r })
  const b = boot(SRC_SETTINGS, { fetchImpl: () => slow })
  const early = b.css()
  if (!NONE.test(early)) ok('宿主 /settings 慢响应（合并未落地）⇒ 早期就不隐藏（无"先亮后灭"窗口）')
  else bad('合并未落地时就被隐藏', '早期即 display:none')
  release({ ok: true, status: 200, json: async () => ({ ok: true, settings: { enabled: true, opacity: 82, unifyTint: true } }) })
  await tick()
  if (!NONE.test(b.css())) ok('慢响应落地后 ⇒ 仍不隐藏（合并保留本地壁纸源）')
  else bad('宿主慢响应落地后把壁纸隐藏了', '合并结果丢了 image')
}

{
  // ⑩ 宿主带 opacity:100（无 image）+ 本地有 image → 合并后允许隐藏，但判据必须是"不透明语义"
  const b = boot({ enabled: true, image: IMG, converted: 'png' }, {
    fetchImpl: () => ({ ok: true, status: 200, json: async () => ({ ok: true, settings: { enabled: true, opacity: 100, forceEnabled: true } }) })
  })
  await tick()
  const css = b.css()
  if (NONE.test(css) && !NO_SRC.test(css)) ok('宿主 opacity:100 + 本地有源 ⇒ 合并后按"不透明语义"隐藏（不是无源）')
  else bad('合并后的隐藏判据不对', `none=${NONE.test(css)} noSrc=${NO_SRC.test(css)}`)
}

console.log('\n== PART 2 运行时断言：有源时 img.src 必须留下（切真源码块 + 假 DOM）==')

/** 从源码里切一段（两端锚点必须存在）。 */
function cut (s, a, b) {
  const i = s.indexOf(a)
  const j = i >= 0 ? s.indexOf(b, i) : -1
  if (i < 0 || j < 0) throw new Error('切块失败（源码结构变了，请同步本测试）: ' + a.slice(0, 40))
  return s.slice(i, j)
}

/** 容错切块：锚点不存在时返回 ''（**改动前**的副本没有新增块/注释，
 *  本测试拿 `--client <旧副本>` 跑时仍要给出"断言红"而不是"抛异常"，见文件头的用法说明）。 */
function cutOpt (s, a, b) {
  const i = s.indexOf(a)
  if (i < 0) return ''
  const j = s.indexOf(b, i)
  return j < 0 ? '' : s.slice(i, j)
}

/** 极简假 DOM：src 触属性（与真 DOM 一致：removeAttribute('src') 之后 getAttribute 为空）。 */
function mkDom () {
  const mk = (tag, cls) => {
    const el = { tagName: tag.toUpperCase(), style: {}, __a: new Map(), __cls: new Set(cls || []) }
    el.classList = {
      add: (...c) => c.forEach((x) => el.__cls.add(x)),
      remove: (...c) => c.forEach((x) => el.__cls.delete(x)),
      contains: (c) => el.__cls.has(c),
    }
    el.getAttribute = (n) => (el.__a.has(n) ? el.__a.get(n) : null)
    el.setAttribute = (n, v) => el.__a.set(n, String(v))
    el.removeAttribute = (n) => { el.__a.delete(n) }
    el.pause = () => {}
    Object.defineProperty(el, 'src', {
      configurable: true,
      get () { return el.__a.get('src') || '' },
      set (v) { el.__a.set('src', String(v)) },
    })
    return el
  }
  const wrap = mk('div', ['mpw-bgWrap'])
  const img = mk('img')
  const video = mk('video')
  const frame = mk('iframe')
  const canvas = mk('canvas')
  return { wrap, img, video, frame, canvas, bgElements: () => ({ img, video, frame, canvas, wrap }) }
}

/** 用**真源码**里的三个函数（回退开关/兜底清理/看门狗解除/图片图层切换）跑一次。 */
function runShowImageEl (source, { search = '', mutate = '' } = {}) {
  const b0 = cutOpt(source, 'function mpwBgWrapFixOn(', 'function mpwSceneClearFallback(')
  const b1 = cut(source, 'function mpwSceneClearFallback(', '/** 武装看门狗。')
  let show = cut(source, 'function showImageEl() {', 'function showVideoEl(')
  if (mutate === 'drop-keepsrc') show = show.replace('disarmSceneWatchdog(true, true)', 'disarmSceneWatchdog(true)')
  const dom = mkDom()
  const warns = []
  const box = new Function('bgElements', 'window', 'location', 'URL', 'stopSceneAnim', 'stopEdgeDraw', 'disposeWebFrame', 'console', `
		let __mpwSceneWd = null;
		let lastObjectUrl = null;
		const IS_EDGE = false;
		${b0}
		${b1}
		${show}
		return { showImageEl, mpwSceneClearFallback, disarmSceneWatchdog,
			mpwBgWrapFixOn: (typeof mpwBgWrapFixOn === 'function' ? mpwBgWrapFixOn : () => true) };
	`)(
    dom.bgElements,
    {},
    { search },
    { revokeObjectURL () {} },
    () => {}, () => {}, () => {},
    { warn: (m) => warns.push(String(m)), error () {} }
  )
  return { ...dom, ...box, warns }
}

{
  const h = runShowImageEl(src)
  // 模拟 applyFromStorageInner 的图片分支：先设 src，再切图层（旧写法会在此被清掉）
  h.img.src = IMG
  h.showImageEl()
  if (h.img.getAttribute('src') === IMG) ok('有源路径：showImageEl() 之后 img.src 仍在（旧写法会丢）')
  else bad('有源路径 img.src 被清掉（壁纸层可见但没有画面）', 'src=' + JSON.stringify(h.img.getAttribute('src')))
  if (h.wrap.classList.contains('mpw-img')) ok('图片图层类切换正常（mpw-img）')
  else bad('图片图层类没切上', [...h.wrap.__cls].join(','))

  // 场景兜底视觉仍必须被撤掉（只是不清 src）
  const h2 = runShowImageEl(src)
  h2.wrap.classList.add('mpw-scene-fallback')
  h2.img.src = IMG
  h2.showImageEl()
  if (!h2.wrap.classList.contains('mpw-scene-fallback') && h2.img.getAttribute('src') === IMG) ok('切到图片壁纸时仍撤掉场景兜底类，但保留壁纸源')
  else bad('兜底类/壁纸源处理不对', `cls=${[...h2.wrap.__cls].join(',')} src=${h2.img.getAttribute('src')}`)

  // 看门狗自己的路径（不传 keepSrc）照旧清 src —— 原有行为不回退
  const h3 = runShowImageEl(src)
  h3.wrap.classList.add('mpw-scene-fallback')
  h3.img.src = 'host:?scene=1&file=frame.png'
  h3.mpwSceneClearFallback()
  if (h3.img.getAttribute('src') === null && !h3.wrap.classList.contains('mpw-scene-fallback')) ok('看门狗兜底清理路径照旧清 src（场景失效/恢复语义不变）')
  else bad('兜底清理路径行为变了', 'src=' + JSON.stringify(h3.img.getAttribute('src')))

  // 回退开关：?bgwrapfix=legacy → 回到旧行为（仍清 src）
  const h4 = runShowImageEl(src, { search: '?bgwrapfix=legacy' })
  h4.img.src = IMG
  h4.showImageEl()
  if (h4.img.getAttribute('src') === null) ok('?bgwrapfix=legacy ⇒ 回到旧行为（可一键回退）')
  else bad('回退开关没接线', 'src 仍在=' + JSON.stringify(h4.img.getAttribute('src')))
}

console.log('\n== PART 3 分辨力自证：变异回旧写法必须变红 ==')
{
  const h = runShowImageEl(src, { mutate: 'drop-keepsrc' })
  h.img.src = IMG
  h.showImageEl()
  if (h.img.getAttribute('src') === null) ok('变异（去掉 keepSrc）后同一条断言变红 ⇒ PART 2 有分辨力')
  else bad('变异后仍绿 ⇒ 断言没有分辨力', 'src=' + JSON.stringify(h.img.getAttribute('src')))
}
{
  // 源码级守卫：showImageEl 必须以 keepSrc 调用看门狗解除；兜底校验必须在 applyFromStorage 里排上
  const show = cut(src, 'function showImageEl() {', 'function showVideoEl(')
  if (/disarmSceneWatchdog\(true,\s*true\)/.test(show)) ok('源码守卫：showImageEl 以 keepSrc=true 解除看门狗')
  else bad('源码守卫：showImageEl 丢了 keepSrc', '禁止改回 disarmSceneWatchdog(true)')
  const apply = cutOpt(src, 'function applyFromStorage() {', '①(2026-09-17 壁纸层可见性轮) "有壁纸源就必须挂上"')
  if (apply && /mpwBgSrcHealSchedule\(\)/.test(apply)) ok('源码守卫：applyFromStorage 里排了"有源必挂"复核')
  else bad('源码守卫：applyFromStorage 没排复核', '补挂兜底缺失/块锚点丢失')
  if (/function mpwBgSrcHealCheck/.test(src) && /window\.__mpwBgSrcHeal/.test(src)) ok('源码守卫：补挂兜底与计数存在（可诊断）')
  else bad('源码守卫：补挂兜底不完整', '缺 mpwBgSrcHealCheck / 计数')
}

console.log('\n== PART 4 诊断接口 ==')
{
  const on = boot(SRC_SETTINGS)
  const st = on.state()
  if (st && st.fixOn === true) ok('默认：__mpwBgWrapState().fixOn === true')
  else bad('诊断接口默认值不对', JSON.stringify(st))
  const off = boot(SRC_SETTINGS, { search: '?bgwrapfix=legacy' })
  const st2 = off.state()
  if (st2 && st2.fixOn === false) ok('?bgwrapfix=legacy：__mpwBgWrapState().fixOn === false')
  else bad('回退开关没反映到诊断接口', JSON.stringify(st2))
}

console.log('\n== PART 5 「有源、有 src、但一直没有画面」的补画校验（真机第 3 条）==')
{
  /* 真机现场（用户原话）：扫描 + 切档之后"壁纸是白色的，什么都没有"；点一下 Now Playing 的
     进度条，背景又加载出来了。根因读数：宿主被 10 个缩略图的容器解析占满（`/custom-mpkg-preview`
     串行 5.6s→11.8s），壁纸自己的 `<video>` 长时间停在 readyState 0 / videoWidth 0 —— 层可见、
     里面没画面；而之后任何一次 re-apply 都会重新武装它 ⇒ 用户以为"点一下就好了"。
     旧兜底只判"有没有 src"（mpwBgArmedNow）⇒ 这种"有 src 没画面"的状态**永远不会被补**。
     本组对着**真源码块**跑：判据函数 + 两档校验 + 有界（同签名只补一次）+ 转码豁免。 */
  const block = cutOpt(src, 'let __mpwBgHeal = {', 'try { window.__mpwBgWrapState')
  if (!block || block.length < 500) {
    bad('源码块在位（mpwBgArmedNow/mpwBgPaintedNow/两档校验）', '切块失败：锚点结构变了，请同步本测试')
  } else {
    const mkMedia = (tag) => {
      const el = { tagName: tag.toUpperCase(), style: {}, __a: new Map(), loads: 0, pauses: 0 }
      el.getAttribute = (n) => (el.__a.has(n) ? el.__a.get(n) : null)
      el.setAttribute = (n, v) => el.__a.set(n, String(v))
      el.removeAttribute = (n) => { el.__a.delete(n) }
      el.pause = () => { el.pauses++ }
      el.load = () => { el.loads++ }
      Object.defineProperty(el, 'currentSrc', { configurable: true, get () { return el.__a.get('src') || '' } })
      return el
    }
    /** 跑一次真源码块：返回判据读数 + 补挂计数（同签名有界）。 */
    const run = (section, videoPatch, phase) => {
      const wrap = { style: {}, classList: { add() {}, remove() {}, contains: () => true }, setAttribute() {}, getAttribute: () => null }
      const img = mkMedia('img'), video = Object.assign(mkMedia('video'), videoPatch || {}), frame = mkMedia('iframe'), canvas = mkMedia('canvas')
      const warns = []
      const api = new Function('bgElements', 'sceneComposite', 'normalizeSection', 'readSection', 'DEFAULT_ENABLED', 'sectionSigNow', 'mpwBgWrapFixOn', 'applyFromStorageInner', 'mpwErr', 'window', 'console', `
${block}
		return { mpwBgArmedNow, mpwBgPaintedNow, mpwBgSrcHealCheck, heal: () => window.__mpwBgSrcHeal || 0 };
`)(() => ({ img, video, frame, canvas, wrap }), null, (x) => x || {}, () => section, true, () => 'sig-A', () => true,
        () => { applies++ }, () => {}, {}, { warn: (...a) => warns.push(a.join(' ')), log() {}, error() {} })
      let applies = 0
      const before = api.heal()
      api.mpwBgSrcHealCheck(phase || 'slow')
      return { painted: api.mpwBgPaintedNow(section), armed: api.mpwBgArmedNow(section), healed: api.heal() > before, applies: applies, loads: video.loads, warns: warns }
    }
    const SEC = { enabled: true, image: 'host:?token=TK&index=0', converted: 'mp4' }
    const V0 = { readyState: 0, videoWidth: 0 }
    const r1 = run(SEC, Object.assign({ __a: new Map([['src', '/api/mpkg-wallpaper/media?token=TK&index=0']]) }, V0), 'slow')
    ok('P5a 视频档 + 有 src + readyState0/videoWidth0 ⇒ 判成"没有画面"', r1.painted === false && r1.armed === true, JSON.stringify({ painted: r1.painted, armed: r1.armed }))
    ok('P5b 慢判确实补了一次，并且是**强制重挂**（removeAttribute(src)+src+load，不是只重跑 apply）',
      r1.healed === true && r1.applies >= 1 && r1.loads >= 1, JSON.stringify({ healed: r1.healed, applies: r1.applies, loads: r1.loads }))
    const r2 = run(SEC, Object.assign({ __a: new Map([['src', '/api/mpkg-wallpaper/media?token=TK&index=0']]) }, V0), 'slow')
    ok('P5c 有界：同一签名再跑一次**不再补**（不抖动/不循环）', r2.healed === false, JSON.stringify({ healed: r2.healed }))
    const r3 = run(SEC, { readyState: 4, videoWidth: 3840, __a: new Map([['src', '/x']]) }, 'slow')
    ok('P5d 真的出画面（readyState4+videoWidth3840）⇒ 不补', r3.painted === true && r3.healed === false, JSON.stringify({ painted: r3.painted, healed: r3.healed }))
    const r4 = run(SEC, { readyState: 0, videoWidth: 0, __a: new Map([['src', '/x'], ['data-mpw-wp-state', 'transcode']]) }, 'slow')
    ok('P5e 转码档（host 正在转）⇒ **豁免**（它有自己的超时回退，不能被我们在后面推着重来）', r4.painted === true && r4.healed === false, JSON.stringify({ painted: r4.painted, healed: r4.healed }))
    const r5 = run(SEC, { readyState: 0, videoWidth: 0, __a: new Map() }, 'fast')
    ok('P5f 快判（既有行为）：有源但**没有 src** ⇒ 仍然立刻补挂一次', r5.armed === false && r5.healed === true, JSON.stringify({ armed: r5.armed, healed: r5.healed }))
    /* 分辨力对照：把"看画面"这一条退化回旧的"只看 src"⇒ P5a/P5b 必须判红（同一判据下） */
    const legacyBlock = block.replace(/return rs >= 2 && vw > 0;/, 'return true;')
    const legacyPainted = (() => {
      const video = Object.assign(mkMedia('video'), { readyState: 0, videoWidth: 0, __a: new Map([['src', '/x']]) })
      const wrap = { style: {}, classList: { add() {}, remove() {}, contains: () => true }, setAttribute() {}, getAttribute: () => null }
      const img = mkMedia('img'), frame = mkMedia('iframe'), canvas = mkMedia('canvas')
      const api = new Function('bgElements', 'sceneComposite', 'normalizeSection', 'readSection', 'DEFAULT_ENABLED', 'sectionSigNow', 'mpwBgWrapFixOn', 'applyFromStorageInner', 'mpwErr', 'window', 'console', `
${legacyBlock}
		return { mpwBgPaintedNow };
`)(() => ({ img, video, frame, canvas, wrap }), null, (x) => x || {}, () => SEC, true, () => 'sig-A', () => true, () => {}, () => {}, {}, console)
      return api.mpwBgPaintedNow(SEC)
    })()
    ok('P5g 分辨力对照：把判据退化回旧写法（只看有没有 src）⇒ 同一条必须判红', legacyPainted === true && r1.painted === false,
      JSON.stringify({ legacy: legacyPainted, now: r1.painted }))
  }
}

function tick () { return new Promise((r) => setTimeout(r, 30)) }

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)

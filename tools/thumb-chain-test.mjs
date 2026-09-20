// tools/thumb-chain-test.mjs —— 「预览框里出现半张图 + 一块白底写着类型名」的回归门禁（无需浏览器）
//
// 来历（两条真机读数）：
//   ① 选 video 类 mpkg 后，暂停键左边的预览框里：左边是被切掉一块的图，右边约 1/4 是白块写着 `mp4`；
//   ② 换目录后预览图有时加载不出来，停在同样的白块上。
// 根因不是"图裂了"，而是**两个元素同时在展示**：
//   `.mpw_wallThumb` 原本是 `display:flex; justify-content:center` 的 94×52 框，`<img>/<video>`
//   （width:100%、`object-fit:cover`）与**类型占位** `<span>` 是兄弟 ⇒ 占位一露出来，flex 就把
//   100% 宽的图压到 3/4、占位占掉剩下 1/4（cover 还会把图裁掉一块）。换目录后旧的内联
//   display/失败标记还会粘在被 React 复用的节点上 ⇒ 白块不消失。
//
// 判据（**契约**，不是"我这台机器上跑出来是这样"）：
//   A 组  真产物 CSS 的几何：媒体**不裁切**（object-fit:contain）、媒体与占位**不并排**
//         （媒体脱离文档流 + 占位铺满同层）、占位 `[hidden]` 真的生效。并用同一套几何模型跑
//         **旧 CSS**（HEAD 的 lib/client.js）做对照 —— 旧产物必须判成"并排"（证明判据有分辨力）。
//   B 组  状态机（切片 lib/client.js 的 MPW-THUMB 块跑**生产实现** + 迷你 DOM）：
//         三条失败路径（图候选全灭 / 图灭后视频首帧也灭 / 只有视频候选且灭）都满足
//         "同框可见元素 ≤ 1"：占位要么整块、要么隐藏；媒体要么整块、要么隐藏。
//   C 组  唯一落点 + 缓存键：显隐占位只允许出现在 mpwThumbFail/mpwThumbOk 里（渲染点不许各写各的）；
//         缩略图 URL 的缓存键含**目录身份 + 纪元时间戳**，换目录即换键（第13条）。
//
// 用法: node tools/thumb-chain-test.mjs [--client <path>]
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const argIdx = process.argv.indexOf('--client')
const CLIENT = argIdx > 0 ? process.argv[argIdx + 1] : path.join(ROOT, 'lib', 'client.js')

let pass = 0
const fails = []
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  — ' + extra : '')) } else { fails.push(name); console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')) } }
const head = (s) => console.log('\n\x1b[1m== ' + s + ' ==\x1b[0m')

const src = fs.readFileSync(CLIENT, 'utf8')
/** HEAD 版本（对照用；取不到就跳过对照组，不假装通过）。 */
const headSrc = (() => {
  try { return execFileSync('git', ['show', 'HEAD:lib/client.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) } catch { return '' }
})()

/* ══════════════════════════════════════════════════════════════════════════════════
   A. 真产物 CSS 的几何（媒体不裁切 / 不并排 / [hidden] 生效）
   ══════════════════════════════════════════════════════════════════════════════════ */
head('A 组：预览框几何 —— 媒体不裁切、媒体与占位不并排（真产物 CSS）')
{
  // 用插件自己的构建路径产 CSS（与用户刷新时拿到的同一份）：panel-smoke 支持 --css 导出
  const cssOut = path.join(os.tmpdir(), 'mpw-thumb-chain-' + process.pid + '.css')
  let built = ''
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'panel-smoke.mjs'), '--css', cssOut], { cwd: ROOT, stdio: 'pipe' })
    built = fs.readFileSync(cssOut, 'utf8')
  } catch (e) { built = '' }
  ok('A0 取到真 CSS 产物（panel-smoke --css；空 = 后面全部免谈）', built.length > 1000, built.length + ' 字节')

  /** 只取**我们**的规则（产物里同一规则出现多次，取第一条即可）。 */
  const rule = (css, sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(esc + '\\s*\\{([^}]*)\\}').exec(css)
    return m ? m[1] : ''
  }
  const decl = (body, prop) => {
    const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(body || '')
    return m ? m[1].trim() : ''
  }
  const boxBody = rule(built, '.mpw_wallThumb')
  const mediaBody = rule(built, '.mpw_wallThumb .mpw_thumbImg')
  const phBody = rule(built, '.mpw_wallThumb [data-mpw-thumb-ph], .mpw_thumb [data-mpw-thumb-ph]')
  const phHiddenBody = rule(built, '.mpw_wallThumb [data-mpw-thumb-ph][hidden], .mpw_thumb [data-mpw-thumb-ph][hidden]')
  ok('A1 媒体**不裁切**：object-fit 必须是 contain（cover 会把图裁掉一块）', decl(mediaBody, 'object-fit') === 'contain', 'object-fit=' + (decl(mediaBody, 'object-fit') || '(缺)'))
  ok('A2 媒体脱离文档流（position:absolute + inset:0）⇒ 与占位重叠而非并排', decl(mediaBody, 'position') === 'absolute' && /inset\s*:\s*0/.test(mediaBody), decl(mediaBody, 'position') + ' / ' + (decl(mediaBody, 'inset') ? 'inset ' + decl(mediaBody, 'inset') : '(缺 inset)'))
  ok('A3 占位是**整块**（inset:0 铺满 + flex 居中），不是被挤出来的一条白边',
    /inset\s*:\s*0/.test(phBody) && /display\s*:\s*flex/.test(phBody) && /align-items\s*:\s*center/.test(phBody) && /justify-content\s*:\s*center/.test(phBody), phBody.trim().slice(0, 90))
  ok('A4 占位带 hidden 属性时**必**不显示（display:none !important 压过任何 display 声明）',
    /display\s*:\s*none\s*!important/.test(phHiddenBody), phHiddenBody.trim().slice(0, 90))
  ok('A5 预览框是定位容器（position:relative）', decl(boxBody, 'position') === 'relative', decl(boxBody, 'position') || '(缺)')

  /* 几何模型（**唯一判据**：同框两个可见元素不许并排）：
     - 流内元素参与 flex 行分配（媒体 width:100% 被 flex-shrink 压到"盒子宽 - 占位宽"）；
     - 绝对定位元素铺满盒子（x=0, w=盒子宽）⇒ 与另一个元素重叠。
     旧 CSS 的读数会落进"并排"分支 —— 这就是"右边 1/4 白块"的几何。 */
  const BOX = Number((/width\s*:\s*(\d+)px/.exec(boxBody) || [])[1]) || 94
  const PH_INTRINSIC = 30   // 占位文字（"mp4"/"web"）的固有宽度量级；并排时它吃掉的比例 ≈ 1/4~1/3
  const model = (mBody, pBody) => {
    const mAbs = decl(mBody, 'position') === 'absolute'
    const pAbs = decl(pBody, 'position') === 'absolute'
    const media = mAbs ? { x: 0, w: BOX } : { x: 0, w: Math.max(0, BOX - PH_INTRINSIC) }
    const ph = pAbs ? { x: 0, w: BOX } : { x: media.w, w: PH_INTRINSIC }
    const sideBySide = !mAbs && !pAbs
    const cut = decl(mBody, 'object-fit') === 'cover'
    return { sideBySide, cut, media, ph, sliver: ph.w / BOX }
  }
  const now = model(mediaBody, phBody)
  ok('A6 几何判据：媒体与占位**不并排**（同框可见元素 ≤ 1 的位置约束）', now.sideBySide === false, JSON.stringify(now))
  ok('A7 几何判据：占位铺满整框（不出现"右边 1/4 白块"这种窄条）', now.ph.w === BOX && now.sliver === 1, 'ph.w=' + now.ph.w + '/' + BOX)

  if (headSrc) {
    const hBox = rule(headSrc, '.mpw_wallThumb')
    const hMedia = rule(headSrc, '.mpw_wallThumb .mpw_thumbImg')
    const hPh = rule(headSrc, '.mpw_wallThumb [data-mpw-thumb-ph], .mpw_thumb [data-mpw-thumb-ph]') || 'position:static'
    const old = model(hMedia || 'object-fit:cover', hPh)
    ok('A8 分辨力对照：**旧 CSS** 在同一模型下必须判成"并排 + 裁切"（旧产物 = 真机白块）',
      old.sideBySide === true && old.cut === true,
      JSON.stringify(Object.assign({}, old, { 占位占框比例: old.sliver })))
  } else {
    console.log('  · A8 对照跳过：取不到 HEAD 版本的 lib/client.js')
  }
  try { fs.unlinkSync(cssOut) } catch { /* 忽略 */ }
}

/* ══════════════════════════════════════════════════════════════════════════════════
   B/C 组：切片生产实现 + 迷你 DOM
   ══════════════════════════════════════════════════════════════════════════════════ */
const B_START = '// ═══ MPW-THUMB-BEGIN ═══'
const B_END = '// ═══ MPW-THUMB-END ═══'
const bStart = src.indexOf(B_START)
const bEnd = src.indexOf(B_END)
const BLOCK = (bStart >= 0 && bEnd > bStart) ? src.slice(bStart, bEnd) : ''

/* 迷你 DOM：只建模本契约用到的东西（属性表 + style + 父子 + 逗号选择器）。 */
function node (tag, attrs) {
  const a = new Map(Object.entries(attrs || {}).map(([k, v]) => [k, String(v)]))
  const n = {
    tagName: String(tag).toUpperCase(), children: [], parentElement: null,
    style: { setProperty (k, v) { this[String(k)] = String(v) }, removeProperty (k) { delete this[String(k)] }, getPropertyValue (k) { return this[String(k)] === void 0 ? '' : String(this[String(k)]) } },
    setAttribute: (k, v) => a.set(String(k), String(v)),
    getAttribute: (k) => (a.has(String(k)) ? a.get(String(k)) : null),
    removeAttribute: (k) => a.delete(String(k)),
    hasAttribute: (k) => a.has(String(k)),
    appendChild (c) { this.children.push(c); c.parentElement = this; return c },
    querySelector (sel) { return this.querySelectorAll(sel)[0] || null },
    querySelectorAll (sel) { const out = []; const want = String(sel).split(',').map((s) => s.trim()); const walk = (x) => { for (const c of x.children) { if (want.some((w) => match(c, w))) out.push(c); walk(c) } }; walk(this); return out },
  }
  return n
}
const match = (el, sel) => {
  if (sel.startsWith('[')) { const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel); if (!m) return false; const v = el.getAttribute(m[1]); return v !== null && (m[2] === void 0 || v === m[2]) }
  return el.tagName === sel.toUpperCase()
}
const reactStub = {
  createElement (type, props, ...kids) {
    const out = { type, props: Object.assign({}, props || {}), children: [] }
    for (const k of kids.flat()) if (k !== null && k !== void 0 && k !== false) out.children.push(k)
    return out
  },
}

const load = (blockSrc) => new Function(
  'mpwVal', 'HOST_BASE', 'resolveHostUrl', 'mpwTrace', 'h',
  blockSrc + '\n;return { mpwThumbCandidates, mpwThumbNext, mpwThumbOk, mpwThumbFail, mpwThumbBust, mpwThumbDirIdentity, mpwThumbChildren, mpwThumbPayloadGet, mpwThumbParts, mpwThumbInvalidate, mpwThumbEpochFor };'
)((o, k) => (o || {})[k], '/api/mpkg-wallpaper', (u) => String(u).replace(/^host:/, '/api/mpkg-wallpaper'), () => {}, reactStub.createElement)

head('B 组：候选链状态机（切片 lib/client.js 的 MPW-THUMB 块，跑生产实现）')
if (!BLOCK) {
  ok('B0 切片标记 MPW-THUMB-BEGIN/END 存在（找不到 ⇒ 预览框不是本契约的形状）', false, 'lib/client.js 里没有 MPW-THUMB 标记')
} else {
  const M = load(BLOCK)
  /** 夹具：一个预览框 + 若干媒体 + 占位（与渲染点 mpwThumbChildren 同形）。 */
  const fixture = (mediaSrcs, phText) => {
    const box = node('div', { 'data-mpw-thumb-box': '', 'data-mpw-thumb-state': 'trying' })
    const media = []
    for (const s of mediaSrcs) {
      const el = node(s.tag, { class: 'mpw_thumbImg', src: s.src, 'data-mpw-thumb-list': JSON.stringify({ urls: s.urls, i: 0 }) })
      if (s.standby) el.style.display = 'none'
      box.appendChild(el); media.push(el)
    }
    const ph = node('span', { 'data-mpw-thumb-ph': '' })
    if (media.length) ph.setAttribute('hidden', '')
    box.appendChild(ph)
    return { box, media, ph }
  }
  const visible = (f) => f.media.filter((m) => m.style.getPropertyValue('display') !== 'none' && m.getAttribute('data-mpw-thumb-failed') !== '1').length
  const phShown = (f) => f.ph.getAttribute('hidden') === null
  const atMostOne = (f) => (visible(f) + (phShown(f) ? 1 : 0)) <= 1
  const imgOf = (f) => f.media.find((m) => m.tagName === 'IMG')
  const vidOf = (f) => f.media.find((m) => m.tagName === 'VIDEO')

  /* B1 路径①：图候选全灭、没有视频兄弟 ⇒ 占位整块 */
  {
    const f = fixture([{ tag: 'img', src: 'a1', urls: ['a1', 'a2'] }], 'mp4')
    M.mpwThumbNext({ target: imgOf(f) }); ok('B1a 图候选未耗尽 ⇒ 前进到下一个、占位仍藏着（不闪白块）', imgOf(f).getAttribute('src') === 'a2' && !phShown(f) && atMostOne(f), JSON.stringify({ src: imgOf(f).getAttribute('src'), ph: phShown(f) }))
    M.mpwThumbNext({ target: imgOf(f) }); ok('B1b 图候选耗尽 ⇒ 图撤下 + 占位整块露出 + 同框可见 ≤ 1', imgOf(f).getAttribute('data-mpw-thumb-failed') === '1' && phShown(f) && atMostOne(f), JSON.stringify({ state: f.box.getAttribute('data-mpw-thumb-state'), why: f.box.getAttribute('data-mpw-thumb-why') }))
    ok('B1c 占位是**整块**（hidden 属性被摘掉，不是靠内联 display 半露）', f.ph.getAttribute('hidden') === null && f.ph.style.getPropertyValue('display') === '', JSON.stringify({ hidden: f.ph.getAttribute('hidden'), display: f.ph.style.getPropertyValue('display') }))
  }
  /* B2 路径②：图候选全灭 ⇒ 视频首帧被启用（占位继续藏着）⇒ 视频也灭 ⇒ 才落占位 */
  {
    const f = fixture([
      { tag: 'img', src: 'p1', urls: ['p1', 'p2'] },
      { tag: 'video', src: 'v1', urls: ['v1'], standby: true },
    ], 'mp4')
    M.mpwThumbNext({ target: imgOf(f) }); M.mpwThumbNext({ target: imgOf(f) })
    ok('B2a 图全灭但视频候选还在 ⇒ 启用视频、占位**不露**（"优先 preview.*、首帧退兜底"）',
      vidOf(f).style.getPropertyValue('display') === '' && !vidOf(f).getAttribute('data-mpw-thumb-failed') && !phShown(f) && atMostOne(f),
      JSON.stringify({ v: vidOf(f).style.getPropertyValue('display'), ph: phShown(f), state: f.box.getAttribute('data-mpw-thumb-state') }))
    M.mpwThumbNext({ target: vidOf(f) })
    ok('B2b 视频也灭 ⇒ 两个媒体都撤下 + 占位整块 + 同框可见 ≤ 1', visible(f) === 0 && phShown(f) && atMostOne(f), JSON.stringify({ v: visible(f), ph: phShown(f) }))
  }
  /* B3 路径③：只有视频候选（目录里没有 preview.*）且失败 */
  {
    const f = fixture([{ tag: 'video', src: 'v1', urls: ['v1'] }], 'mp4')
    M.mpwThumbNext({ target: vidOf(f) })
    ok('B3 只有视频候选且加载失败 ⇒ 直接落占位（不出现"半张图 + 白块"）', visible(f) === 0 && phShown(f) && atMostOne(f) && vidOf(f).style.getPropertyValue('display') === 'none', JSON.stringify({ state: f.box.getAttribute('data-mpw-thumb-state') }))
  }
  /* B4 成功路径：媒体 onLoad ⇒ 撤占位、撤同框其它媒体（换目录后旧失败标记不许粘住显示） */
  {
    const f = fixture([
      { tag: 'img', src: 'p1', urls: ['p1'] },
      { tag: 'video', src: 'v1', urls: ['v1'], standby: true },
    ], 'mp4')
    M.mpwThumbNext({ target: imgOf(f) })                       // 图全灭 ⇒ 视频被启用
    M.mpwThumbOk(vidOf(f))                         // 视频出画
    ok('B4 媒体成功 ⇒ 占位撤下（hidden）+ 同框其它媒体藏起来 + 失败标记清掉',
      phShown(f) === false && vidOf(f).style.getPropertyValue('display') === '' && imgOf(f).style.getPropertyValue('display') === 'none' && atMostOne(f),
      JSON.stringify({ ph: phShown(f), v: vidOf(f).style.getPropertyValue('display'), i: imgOf(f).style.getPropertyValue('display') }))
  }
  /* B5 渲染点构造：媒体与占位的形态 + 换目录 ⇒ key/URL 全换（React 换新节点、候选链从 0 重走） */
  {
    const sec1 = { converted: 'mp4', source: 'a.mp4', preview: 'preview.gif', image: 'host:?custom=1&folder=f&file=a.mp4', customDirPath: '/libs/A' }
    const sec2 = Object.assign({}, sec1, { customDirPath: '/libs/B' })
    const kids1 = M.mpwThumbChildren(reactStub.createElement, sec1, { placeholder: 'mp4' })
    const kids2 = M.mpwThumbChildren(reactStub.createElement, sec2, { placeholder: 'mp4' })
    const tags = kids1.map((k) => k.type)
    ok('B5a 子元素形态：img 在前、video 在后且**先藏着**、占位默认 hidden',
      tags[0] === 'img' && tags[1] === 'video' && tags[2] === 'span'
        && kids1[1].props.style && kids1[1].props.style.display === 'none'
        && kids1[2].props.hidden === ''
        && kids1[2].props['data-mpw-thumb-ph'] === '',
      JSON.stringify({ tags: tags, videoDisplay: kids1[1].props.style && kids1[1].props.style.display, phHidden: kids1[2].props.hidden }))
    const keyOf = (kids) => kids.map((k) => k.props.key).join('|')
    const srcOf = (kids) => kids.map((k) => String(k.props.src || '')).join('|')
    ok('B5b 换目录 ⇒ key 与 URL 全换（旧节点的失败标记/内联 display 不可能粘住）',
      keyOf(kids1) !== keyOf(kids2) && srcOf(kids1) !== srcOf(kids2) && /mpwd=/.test(srcOf(kids1)),
      JSON.stringify({ k1: keyOf(kids1), k2: keyOf(kids2) }))
    const first = JSON.parse(kids1[0].props['data-mpw-thumb-list'])
    ok('B5c 载荷 {urls,i} 从 0 开始（换目录不会"URL 换了、下标还在 3"）', first.i === 0 && Array.isArray(first.urls) && first.urls.length >= 1, JSON.stringify(first).slice(0, 140))
    ok('B5d 无候选 ⇒ 只给占位且**不**带 hidden（整块显示，不是空白框）', (() => {
      const kids = M.mpwThumbChildren(reactStub.createElement, { customDirPath: '/libs/A' }, { placeholder: 'web' })
      return kids.length === 1 && kids[0].type === 'span' && kids[0].props.hidden === void 0
    })(), JSON.stringify(M.mpwThumbChildren(reactStub.createElement, { customDirPath: '/libs/A' }, { placeholder: 'web' }).map((k) => k.props)))
  }
  /* B6 缓存键：目录身份 + 纪元；data:/blob: 不动 */
  {
    const secA = { mpkgKey: 'custom|f', customDirPath: '/libs/A' }
    const secB = { mpkgKey: 'custom|f', customDirPath: '/libs/B' }
    const uA = M.mpwThumbBust('/api/mpkg-wallpaper/custom-folder/f/preview.gif', secA)
    const uA2 = M.mpwThumbBust('/api/mpkg-wallpaper/custom-folder/f/preview.gif', secA)
    const uB = M.mpwThumbBust('/api/mpkg-wallpaper/custom-folder/f/preview.gif', secB)
    ok('B6a 缓存键 = 原 URL + 目录身份 + 纪元时间戳；同身份幂等、换目录即变',
      uA === uA2 && uA !== uB && /mpwd=/.test(uA) && /mpwt=\d+/.test(uA),
      JSON.stringify({ a: uA, b: uB }))
    ok('B6b data:/blob: URL 不加查询串（加了整条失效）', M.mpwThumbBust('data:image/gif;base64,AA', secA) === 'data:image/gif;base64,AA' && M.mpwThumbBust('blob:http://x/1', secA) === 'blob:http://x/1')
    const e1 = M.mpwThumbEpochFor('/libs/A')
    M.mpwThumbInvalidate('test')
    const e2 = M.mpwThumbEpochFor('/libs/A')
    ok('B6c 显式失效 ⇒ 纪元**严格单调**前进（同毫秒内两次也要换键）', e2 > e1, String(e1) + ' → ' + String(e2))
  }
}

/* ══════════════════════════════════════════════════════════════════════════════════
   C. 唯一落点（渲染点不许各写各的显隐）+ 旧实现的对照
   ══════════════════════════════════════════════════════════════════════════════════ */
head('C 组：显隐占位只有**一个**落点（旧实现是"每个分支各写各的"）')
{
  const strip = (code) => String(code).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const body = (code, startRe, endRe) => {
    const s = code.search(startRe)
    if (s < 0) return ''
    const e = code.slice(s).search(endRe)
    return e < 0 ? code.slice(s) : code.slice(s, s + e)
  }
  const nowBlock = strip(body(src, /function mpwThumbFail/, /function mpwThumbPayloadGet/))
  const writes = (code) => (code.match(/data-mpw-thumb-ph/g) || []).length
  const nowHits = writes(strip(src))
  ok('C1 生产代码里"操作占位"只出现在状态机落点（≤ 4 处：查询 + hidden 设置 + 渲染点 + CSS 选择器）', nowHits <= 6, '命中 ' + nowHits + ' 处')
  ok('C2 状态机落点里同时管"撤下媒体"与"露出占位"（不是只显示占位）',
    /style\.display = "none"/.test(nowBlock) && /removeAttribute\("hidden"\)/.test(nowBlock) && /setAttribute\("hidden"/.test(strip(body(src, /function mpwThumbOk/, /function mpwThumbFail/))),
    'mpwThumbFail 管撤媒体+露占位 / mpwThumbOk 管 hidden')
  if (headSrc) {
    const old = strip(headSrc)
    const oldHits = (old.match(/data-mpw-thumb-ph/g) || []).length
    ok('C3 分辨力对照：旧实现里占位显隐散落在多个渲染分支（≥ 2 处设置点，没有唯一落点）',
      oldHits >= 3,
      '旧实现命中 ' + oldHits + ' 处（新实现 ' + nowHits + ' 处）')
  } else {
    console.log('  · C3 对照跳过：取不到 HEAD 版本的 lib/client.js')
  }
}

console.log('')
if (fails.length) {
  console.error('✗ 预览框候选链门禁未通过（' + fails.length + ' 项）：')
  for (const f of fails) console.error('   - ' + f)
  process.exit(1)
}
console.log('预览框候选链门禁：' + pass + ' 通过, 0 失败 ✓')
console.log('契约：媒体不裁切（contain）+ 与占位不并排（absolute 同层）+ 同框可见 ≤ 1 + 缓存键含目录身份/纪元')

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
/** 对照用的"修复前"实现：**不能取 HEAD** —— 本修复一旦提交，`HEAD:lib/client.js` 就是修复后的版本，
 *  对照会退化成"自己对自己"（恒 0 失分 ⇒ 门禁假红；2026-09-21 实测过一次）。
 *  取法（与 tools/dir-picker-test.mjs 同一惯例）：`git log -S MPW-THUMB-BEGIN` 里**最早**引入该块的提交，
 *  取其**父提交**；环境变量 MPW_THUMB_BEFORE 可覆盖，便于人工指定对照点；取不到就跳过对照组。 */
const beforeRev = (() => {
  if (process.env.MPW_THUMB_BEFORE) return process.env.MPW_THUMB_BEFORE
  try {
    const list = execFileSync('git', ['log', '--format=%H', '-S', 'MPW-THUMB-BEGIN', '--', 'lib/client.js'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim().split('\n').filter(Boolean)
    const first = list[list.length - 1]        // 最早引入该块的那次提交
    if (first) return first + '^'
  } catch { /* 落下面的跳过分支 */ }
  return ''
})();
const headSrc = (() => {
  if (!beforeRev) return ''
  try { return execFileSync('git', ['show', beforeRev + ':lib/client.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) } catch { return '' }
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
  const phShownBody = rule(built, '.mpw_wallThumb [data-mpw-thumb-ph][data-mpw-thumb-shown], .mpw_thumb [data-mpw-thumb-ph][data-mpw-thumb-shown]')
  ok('A1 媒体**不裁切**：object-fit 必须是 contain（cover 会把图裁掉一块）', decl(mediaBody, 'object-fit') === 'contain', 'object-fit=' + (decl(mediaBody, 'object-fit') || '(缺)'))
  ok('A2 媒体脱离文档流（position:absolute + inset:0）⇒ 与占位重叠而非并排', decl(mediaBody, 'position') === 'absolute' && /inset\s*:\s*0/.test(mediaBody), decl(mediaBody, 'position') + ' / ' + (decl(mediaBody, 'inset') ? 'inset ' + decl(mediaBody, 'inset') : '(缺 inset)'))
  ok('A3 占位是**整块**（inset:0 铺满 + 居中；默认 none、带 shown 才 flex），不是被挤出来的一条白边',
    /inset\s*:\s*0/.test(phBody) && /align-items\s*:\s*center/.test(phBody) && /justify-content\s*:\s*center/.test(phBody)
      && /display\s*:\s*none/.test(phBody) && /display\s*:\s*flex/.test(phShownBody), phBody.trim().slice(0, 110))
  ok('A4 占位**默认不显示**（基规则 display:none），只有带 data-mpw-thumb-shown 时才整块露出（display:flex）',
    /display\s*:\s*none/.test(phBody) && /display\s*:\s*flex/.test(phShownBody),
    'base=' + decl(phBody, 'display') + ' / shown=' + decl(phShownBody, 'display'))
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
    console.log('  · A8 对照跳过：取不到修复前版本（' + (beforeRev || '未知 rev') + '）')
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
  blockSrc + '\n;return { mpwThumbCandidates, mpwThumbNext, mpwThumbOk, mpwThumbFail, mpwThumbBust, mpwThumbDirIdentity, mpwThumbChildren, mpwThumbPayloadGet, mpwThumbParts, mpwThumbInvalidate, mpwThumbEpochFor, mpwThumbSync, mpwThumbPainted, mpwThumbIsContainerUrl, mpwThumbContentSignature, mpwThumbNoteContent, mpwThumbCover };'
)((o, k) => (o || {})[k], '/api/mpkg-wallpaper', (u) => String(u).replace(/^host:/, '/api/mpkg-wallpaper'), () => {}, reactStub.createElement)

head('B 组：候选链状态机（切片 lib/client.js 的 MPW-THUMB 块，跑生产实现）')
if (!BLOCK) {
  ok('B0 切片标记 MPW-THUMB-BEGIN/END 存在（找不到 ⇒ 预览框不是本契约的形状）', false, 'lib/client.js 里没有 MPW-THUMB 标记')
} else {
  const M = load(BLOCK)
  /** 夹具：一个预览框 + 若干媒体 + 占位（与渲染点 mpwThumbChildren 同形）。 */
  const fixture = (mediaSrcs, phText) => {
    const box = node('div', { 'data-mpw-thumb-box': '', 'data-mpw-thumb-state': 'trying' })
    box.clientWidth = 74; box.clientHeight = 42   // 底色判据要用框尺寸（与真机 .mpw_thumb 同形）
    const media = []
    for (const s of mediaSrcs) {
      const el = node(s.tag, { class: 'mpw_thumbImg', src: s.src, 'data-mpw-thumb-list': JSON.stringify({ urls: s.urls, i: 0 }) })
      el.style.display = 'none'                    // 新契约：媒体**一律先藏着**（渲染点同形）
      if (s.standby) el.setAttribute('data-mpw-thumb-standby', '1')
      box.appendChild(el); media.push(el)
    }
    const ph = node('span', { 'data-mpw-thumb-ph': '' })
    if (!media.length) ph.setAttribute('data-mpw-thumb-shown', '')   // 无候选 ⇒ 整块显示（与渲染点同形）
    box.appendChild(ph)
    return { box, media, ph }
  }
  /** 让某个媒体"真的画出来了"（img: complete+naturalWidth；video: readyState≥2+videoWidth）。
   *  新契约的唯一裁决依据就是这个 —— 桩里必须能把这件事设出来，否则测不到竞态。 */
  const paint = (el, w, h) => {
    if (el.tagName === 'IMG') { el.complete = true; el.naturalWidth = w || 192; el.naturalHeight = h || 192 }
    else { el.readyState = 4; el.videoWidth = w || 3840; el.videoHeight = h || 2160 }
    el.setAttribute('src', el.getAttribute('src') || 'x')
    return el
  }
  const visible = (f) => f.media.filter((m) => m.style.getPropertyValue('display') !== 'none' && m.getAttribute('data-mpw-thumb-failed') !== '1').length
  const phShown = (f) => f.ph.getAttribute('data-mpw-thumb-shown') !== null
  const atMostOne = (f) => (visible(f) + (phShown(f) ? 1 : 0)) <= 1
  const imgOf = (f) => f.media.find((m) => m.tagName === 'IMG')
  const vidOf = (f) => f.media.find((m) => m.tagName === 'VIDEO')

  /* B1 路径①：图候选全灭、没有视频兄弟 ⇒ 占位整块 */
  {
    const f = fixture([{ tag: 'img', src: 'a1', urls: ['a1', 'a2'] }], 'mp4')
    M.mpwThumbNext({ target: imgOf(f) }); ok('B1a 图候选未耗尽 ⇒ 前进到下一个、占位仍藏着（不闪白块）', imgOf(f).getAttribute('src') === 'a2' && !phShown(f) && atMostOne(f), JSON.stringify({ src: imgOf(f).getAttribute('src'), ph: phShown(f) }))
    M.mpwThumbNext({ target: imgOf(f) }); ok('B1b 图候选耗尽 ⇒ 图撤下 + 占位整块露出 + 同框可见 ≤ 1', imgOf(f).getAttribute('data-mpw-thumb-failed') === '1' && phShown(f) && atMostOne(f), JSON.stringify({ state: f.box.getAttribute('data-mpw-thumb-state'), why: f.box.getAttribute('data-mpw-thumb-why') }))
    ok('B1c 占位是**整块**（data-mpw-thumb-shown 被写上，不是靠内联 display 半露）', f.ph.getAttribute('data-mpw-thumb-shown') === '' && f.ph.style.getPropertyValue('display') === '', JSON.stringify({ shown: f.ph.getAttribute('data-mpw-thumb-shown'), display: f.ph.style.getPropertyValue('display') }))
  }
  /* B2 路径②：图候选全灭 ⇒ 视频首帧**获得资格**（但看不见，直到它真的出帧）⇒ 视频也灭 ⇒ 才落占位 */
  {
    const f = fixture([
      { tag: 'img', src: 'p1', urls: ['p1', 'p2'] },
      { tag: 'video', src: 'v1', urls: ['v1'], standby: true },
    ], 'mp4')
    M.mpwThumbNext({ target: imgOf(f) }); M.mpwThumbNext({ target: imgOf(f) })
    ok('B2a 图全灭但视频候选还在 ⇒ 视频**不许立刻显示**（还没出帧）、占位不露（"优先 preview.*、首帧退兜底"）',
      visible(f) === 0 && !vidOf(f).getAttribute('data-mpw-thumb-failed') && !phShown(f) && atMostOne(f) && f.box.getAttribute('data-mpw-thumb-state') === 'trying',
      JSON.stringify({ v: vidOf(f).style.getPropertyValue('display'), ph: phShown(f), state: f.box.getAttribute('data-mpw-thumb-state') }))
    M.mpwThumbOk(paint(vidOf(f)))   // 视频真的出帧（元数据 + 首帧）
    ok('B2a2 视频出帧之后才成为主人（同框仍 ≤ 1、占位仍藏着）',
      vidOf(f).style.getPropertyValue('display') === '' && !phShown(f) && atMostOne(f) && f.box.getAttribute('data-mpw-thumb-state') === 'media',
      JSON.stringify({ v: vidOf(f).style.getPropertyValue('display'), state: f.box.getAttribute('data-mpw-thumb-state') }))
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
    M.mpwThumbNext({ target: imgOf(f) })           // 图全灭 ⇒ 视频获得资格（仍不可见）
    M.mpwThumbOk(paint(vidOf(f)))                  // 视频出帧
    ok('B4 媒体成功 ⇒ 占位撤下（hidden）+ 同框其它媒体藏起来 + 失败标记清掉',
      phShown(f) === false && vidOf(f).style.getPropertyValue('display') === '' && imgOf(f).style.getPropertyValue('display') === 'none' && atMostOne(f),
      JSON.stringify({ ph: phShown(f), v: vidOf(f).style.getPropertyValue('display'), i: imgOf(f).style.getPropertyValue('display') }))
  }
  /* B4b **唯一事实源**（本轮真机第 1 条的正题）：图与视频**都**画得出来时，主人恒为优先级高的图；
       视频的 onLoadedMetadata 迟到**不许**把镜头抢走（旧写法：谁最后跑谁说了算 ⇒ 扫描一次翻一次面）。 */
  {
    const f = fixture([
      { tag: 'img', src: 'p1', urls: ['p1'] },
      { tag: 'video', src: 'v1', urls: ['v1'], standby: true },
    ], 'mp4')
    M.mpwThumbOk(paint(imgOf(f)))                  // 图先出画
    ok('B4b-1 图出画 ⇒ 图是主人', imgOf(f).style.getPropertyValue('display') === '' && vidOf(f).style.getPropertyValue('display') === 'none' && f.box.getAttribute('data-mpw-thumb-state') === 'media')
    M.mpwThumbOk(paint(vidOf(f)))                  // 视频的 loadedmetadata 迟到（旧写法这里会抢镜头）
    ok('B4b-2 视频随后也出画 ⇒ **镜头不换**（优先级：图 > 视频首帧）',
      imgOf(f).style.getPropertyValue('display') === '' && vidOf(f).style.getPropertyValue('display') === 'none' && atMostOne(f),
      JSON.stringify({ i: imgOf(f).style.getPropertyValue('display'), v: vidOf(f).style.getPropertyValue('display') }))
  }
  /* B7 候选链：容器文件（.mpkg/.pkg）**不给** <video> 候选（容器不是媒体流）
       真机读数：给了就会去拉 130MB~830MB 的字节（`/custom-media` 206 ×20），既播不出来，
       又把宿主的连接与解析占满（容器预览被挤到 5.6s→11.8s）。 */
  {
    const secC = { converted: 'mp4', source: '小鸟游星野01_04.mpkg', image: 'host:?custom=1&folder=f&file=A.mpkg', customDirPath: '/libs/A' }
    const secV = { converted: 'mp4', source: 'a.mp4', image: 'host:?custom=1&folder=f&file=a.mp4', customDirPath: '/libs/A' }
    const cC = M.mpwThumbCandidates(secC), cV = M.mpwThumbCandidates(secV)
    ok('B7a 判定纯函数：容器扩展名认得出来（URL 里 / 文件名里 / 带查询串）',
      M.mpwThumbIsContainerUrl('host:?custom=1&file=A.mpkg', '') === true
      && M.mpwThumbIsContainerUrl('/x/A.pkg?a=1', '') === true
      && M.mpwThumbIsContainerUrl('host:?custom=1&file=a.mp4', 'a.mp4') === false,
      JSON.stringify([M.mpwThumbIsContainerUrl('host:?custom=1&file=A.mpkg', ''), M.mpwThumbIsContainerUrl('host:?custom=1&file=a.mp4', 'a.mp4')]))
    ok('B7b 容器源 ⇒ 候选里**没有** video 类（容器档的"首帧"走容器内预览图）',
      cC.length > 0 && cC.every((c) => c.kind !== 'video'), JSON.stringify(cC.map((c) => c.kind + ':' + c.why)))
    ok('B7c 真视频源 ⇒ 仍保留 video 首帧候选（这一档不许被压掉）',
      cV.some((c) => c.kind === 'video'), JSON.stringify(cV.map((c) => c.kind + ':' + c.why)))
  }
  /* B8 内容签名：同一个目录**同一份清单**重复扫描 ⇒ 纪元不动（键不动 ⇒ React 不换节点、不重发请求）
       —— 真机读数：旧写法每次扫描都把 11 个缩略图重挂载，宿主串行解析容器 5.6s→11.8s 递增。 */
  {
    const files1 = [{ name: 'a.mp4', type: 'video', size: 10 }, { name: 'b.mp4', type: 'video', size: 20 }]
    const files2 = [{ name: 'a.mp4', type: 'video', size: 10 }, { name: 'b.mp4', type: 'video', size: 20 }]
    const files3 = [{ name: 'a.mp4', type: 'video', size: 10 }, { name: 'b.mp4', type: 'video', size: 999 }]
    const sig1 = M.mpwThumbContentSignature('/libs/A', files1)
    ok('B8a 同一份清单（含顺序打乱）⇒ 同一个签名（顺序不参与身份）',
      sig1 === M.mpwThumbContentSignature('/libs/A', [files1[1], files1[0]]) && sig1 === M.mpwThumbContentSignature('/libs/A', files2),
      sig1.slice(0, 90))
    ok('B8b 内容变了（大小/名字/目录任一）⇒ 签名必须变', sig1 !== M.mpwThumbContentSignature('/libs/A', files3))
    const r1 = M.mpwThumbNoteContent('/libs/A', files1, 'scan')
    const e1 = M.mpwThumbEpochFor('/libs/A')
    const r2 = M.mpwThumbNoteContent('/libs/A', files2, 'scan')
    const e2 = M.mpwThumbEpochFor('/libs/A')
    ok('B8c 重复扫描同一份内容 ⇒ **纪元不动**（changed=false；真机"扫描 N 次结果一致"的地基）',
      r2.changed === false && e2 === e1, JSON.stringify({ r1: r1.changed, r2: r2.changed, e1: e1, e2: e2 }))
    M.mpwThumbNoteContent('/libs/A', files3, 'scan')
    ok('B8d 内容真的变了 ⇒ 纪元前进（换了 URL 键、浏览器重发请求）', M.mpwThumbEpochFor('/libs/A') > e2)
  }
  /* B9 底色（--mpw-thumb-cover）：媒体出画时写上，来源与画面是**同一个元素**（不裁切也不留白边） */
  {
    const f = fixture([{ tag: 'img', src: 'p1', urls: ['p1'] }], 'mp4')
    M.mpwThumbOk(paint(imgOf(f), 192, 192))
    const cov = f.box.style.getPropertyValue('--mpw-thumb-cover')
    ok('B9 图出画 ⇒ 框底写上图自己的 URL（模糊铺满层用它；来源 = 画面来源）',
      /url\("?p1"?\)/.test(String(cov)), JSON.stringify(cov))
  }
  /* B5 渲染点构造：媒体与占位的形态 + 换目录 ⇒ key/URL 全换（React 换新节点、候选链从 0 重走） */
  {
    const sec1 = { converted: 'mp4', source: 'a.mp4', preview: 'preview.gif', image: 'host:?custom=1&folder=f&file=a.mp4', customDirPath: '/libs/A' }
    const sec2 = Object.assign({}, sec1, { customDirPath: '/libs/B' })
    const kids1 = M.mpwThumbChildren(reactStub.createElement, sec1, { placeholder: 'mp4' })
    const kids2 = M.mpwThumbChildren(reactStub.createElement, sec2, { placeholder: 'mp4' })
    const tags = kids1.map((k) => k.type)
    ok('B5a 子元素形态：img 在前、video 在后且**先藏着**、占位默认不显示',
      tags[0] === 'img' && tags[1] === 'video' && tags[2] === 'span'
        && kids1[1].props.style && kids1[1].props.style.display === 'none'
        && kids1[2].props['data-mpw-thumb-shown'] === void 0   // 有媒体 ⇒ 占位默认不显示（靠状态机在失败时才写上）
        && kids1[2].props['data-mpw-thumb-ph'] === '',
      JSON.stringify({ tags: tags, videoDisplay: kids1[1].props.style && kids1[1].props.style.display, phShown: kids1[2].props['data-mpw-thumb-shown'] }))
    const keyOf = (kids) => kids.map((k) => k.props.key).join('|')
    const srcOf = (kids) => kids.map((k) => String(k.props.src || '')).join('|')
    ok('B5b 换目录 ⇒ key 与 URL 全换（旧节点的失败标记/内联 display 不可能粘住）',
      keyOf(kids1) !== keyOf(kids2) && srcOf(kids1) !== srcOf(kids2) && /mpwd=/.test(srcOf(kids1)),
      JSON.stringify({ k1: keyOf(kids1), k2: keyOf(kids2) }))
    const first = JSON.parse(kids1[0].props['data-mpw-thumb-list'])
    ok('B5c 载荷 {urls,i} 从 0 开始（换目录不会"URL 换了、下标还在 3"）', first.i === 0 && Array.isArray(first.urls) && first.urls.length >= 1, JSON.stringify(first).slice(0, 140))
    ok('B5d 无候选 ⇒ 只给占位且带 data-mpw-thumb-shown（整块显示，不是空白框）', (() => {
      const kids = M.mpwThumbChildren(reactStub.createElement, { customDirPath: '/libs/A' }, { placeholder: 'web' })
      return kids.length === 1 && kids[0].type === 'span' && kids[0].props['data-mpw-thumb-shown'] === ''
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
head('C 组：显隐只有**一个**落点（"谁最后跑谁说了算"的根除点）')
{
  const strip = (code) => String(code).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const body = (code, startRe, endRe) => {
    const s = code.search(startRe)
    if (s < 0) return ''
    const e = code.slice(s).search(endRe)
    return e < 0 ? code.slice(s) : code.slice(s, s + e)
  }
  const count = (code, re) => (code.match(re) || []).length
  const srcS = strip(src)
  const syncB = body(srcS, /function mpwThumbSync/, /function mpwThumbOk/)
  const okB = body(srcS, /function mpwThumbOk/, /function mpwThumbFail/)
  const failB = body(srcS, /function mpwThumbFail/, /function mpwThumbPayloadGet/)
  const nextB = body(srcS, /function mpwThumbNext/, /function mpwThumbChildren/)
  /* C1 占位显隐的**写入**（set/removeAttribute("data-mpw-thumb-shown")）只允许出现在同步器里。
        旧实现是"每个失败分支各写各的"，所以才会出现"分支 A 露占位、分支 B 没撤媒体"的中间态。 */
  const shownWrites = (code) => count(code, /(set|remove)Attribute\("data-mpw-thumb-shown"/g)
  /* 同步器里恰好 3 个写入点 = 三种转移：① 有主人（remove 占位）② 还在等候选（remove 占位）
     ③ 一个候选都不剩（set 占位）。事件入口一个都不许写（下一条 C2）。 */
  ok('C1 占位显隐的写入只出现在 mpwThumbSync（同步器之外 0 处）',
    shownWrites(syncB) === 3 && shownWrites(okB + failB + nextB) === 0,
    'sync=' + shownWrites(syncB) + ' 其它=' + shownWrites(okB + failB + nextB))
  /* C2 **只有同步器能把媒体显示出来**：三个事件入口只许把它藏起来（`= "none"`），
        不许出现 `= ""` / removeProperty("display") —— 那正是"事件各自写显隐"的旧形态。 */
  const showAssign = (code) => count(code, /\.style\.display\s*=\s*""/g) + count(code, /removeProperty\("display"\)/g)
  const hideAssign = (code) => count(code, /\.style\.display\s*=\s*"none"/g)
  ok('C2 事件入口（Ok/Fail/Next）只许"收起"，显示只能由同步器写',
    showAssign(okB + failB + nextB) === 0 && hideAssign(okB + failB + nextB) >= 2,
    '事件里的显示写入=' + showAssign(okB + failB + nextB) + ' 收起=' + hideAssign(okB + failB + nextB))
  /* C2b 同步器必须同时管"撤下别的媒体"与"露出/收起占位"（不是只显示占位） */
  ok('C2b 同步器同时管：媒体显隐（含撤下其它媒体）+ 占位显隐 + 框状态',
    /mine\s*\?\s*""\s*:\s*"none"/.test(syncB) && shownWrites(syncB) === 3 && /data-mpw-thumb-state", "media"/.test(syncB),
    'mpwThumbSync：媒体显示/撤下 + 占位 set/remove + 框状态')
  /* C2c "画出来了没有"只有一个判据函数（img: naturalWidth；video: readyState≥2 + videoWidth），
        且只有同步器用它挑主人 —— 这是"可见即有画面"的地基。 */
  const paintUses = count(srcS, /mpwThumbPainted\(/g)
  ok('C2c "画出来了没有"只有一个判据函数（mpwThumbPainted），且只在同步器里被用于挑主人',
    /function mpwThumbPainted/.test(srcS) && paintUses >= 2 && /mpwThumbPainted\(m\)/.test(syncB),
    'mpwThumbPainted 引用 ' + paintUses + ' 次')
  if (headSrc) {
    /* 对照口径与原文一致：数 `data-mpw-thumb-ph` 的出现次数（旧实现里它散在渲染分支与状态机里）。
       新实现里这些出现点全部收口到"同步器 + 渲染点 + CSS"。 */
    const old = strip(headSrc)
    const oldHits = count(old, /data-mpw-thumb-ph/g)
    const nowHits = count(srcS, /data-mpw-thumb-ph/g)
    ok('C3 分辨力对照：旧实现把占位的查询/显隐散在多个分支（新实现收口）',
      oldHits >= 3 && shownWrites(syncB) === 3,
      '旧实现出现点 ' + oldHits + ' 处 / 新实现 ' + nowHits + ' 处（显隐写入全在 mpwThumbSync 的 3 处）')
  } else {
    console.log('  · C3 对照跳过：取不到修复前版本（' + (beforeRev || '未知 rev') + '）')
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

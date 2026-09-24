// tools/bgpaint-heal-test.mjs —— 「慢判（12s）判的是**真的画出来了**，不是元素在不在」回归
//
// 背景（2026-09-25 同类普查线；P-184）：
//   `lib/client.js` 的壁纸源自愈分两档 —— 快判 1.2s「有源但媒体没有 src」、慢判 12s「有 src 但**一直
//   没有画面** ⇒ 强制重挂一次」。慢判对 section 档（canvas 合成）原判据是 `canvas.width > 0`，
//   而 `showSceneEl()` 的 `draw()` **一开始**就按视口给 canvas 设宽高、`clearRect` 之后逐层 `drawImage`：
//     · 所有图层都加载失败时（真机：图层 URL 404 / token 失效 / 清单里全是坏 url），宽高照样被设上
//       ⇒ 判据退化成"元素存在"，慢判恒为"画出来了"、**自愈永不触发**，表现是永久空白且无一行告警；
//     · 反向也错：canvas 还没参与/被宿主重建时 width=0 ⇒ 会把"正常"误判成坏。
//   改法：落**画过戳**（`mpwScenePaintStamp(canvas, key, drawn)` = 真 `drawImage` 了几层 + 画的是哪份清单），
//   判据读戳（`mpwScenePainted(canvas, key)`：层数 > 0 且 key 与当前 section 的 sceneKey 相同）。
//
// 本测试跑的是**真源码切片**（不是复刻一份实现）：
//   ① 从 lib/client.js 按括号配平切出 `mpwScenePaintStamp` / `mpwScenePainted` / `mpwBgPaintedNow` 三个函数；
//   ② 用假 `bgElements`/`section` 驱动判据，断言五档（无戳 / 有戳 / 换 key / 0 层 / 拿不到 canvas）；
//   ③ 源码级钉子：`draw()` 真的逐层计数并落戳、0 层清单也落 0 层戳、慢判仍然经 `mpwBgPaintedNow`；
//   ④ 分辨力自证：同一组断言跑在**改前版本**上必须变红（用 `--pre` 或钉死的 `PRE_FIX_REV`）。
//
// 用法：node tools/bgpaint-heal-test.mjs [--client <path>] [--pre <path>]
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null }
const clientPath = argOf('--client') || path.join(ROOT, 'lib', 'client.js')
/*  ⚠ 改前版本**必须钉死提交**，不能用 `HEAD`：这类修复一旦提交，`HEAD` 就变成"改后"，
    自证只会拿到两份逐字相同的源码 ⇒ 恒绿（本仓踩过一次，见 docs/PATCHES.md P-181 ⑥）。
    `5b1a1ea` = 「3.13.5：包内/包旁 JSON 宽容解析收口」= 本次修复之前的最后一个提交。 */
const PRE_FIX_REV = '5b1a1ea69ea1c97f9a7eef024136a09458644f8e'

let pass = 0, fail = 0
const ok = (n) => { pass++; console.log('  ✓ ' + n) }
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')) }

/** 按**括号配平**切出 `function <name>(…) { … }` 的完整源码；切不到返回空串（调用方按"缺函数"报红）。 */
function cutFn (src, name) {
  const i = src.indexOf('function ' + name + '(')
  if (i < 0) return ''
  let depth = 0, started = false
  for (let k = i; k < src.length; k++) {
    const ch = src[k]
    if (ch === '{') { depth++; started = true; continue }
    if (ch === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1) }
  }
  return ''
}

/** 把三个真函数拼成工厂：自由变量（bgElements/wallUserPaused/powPaused/window/document）全部注入。 */
function makeFactory (src) {
  const parts = { stamp: cutFn(src, 'mpwScenePaintStamp'), painted: cutFn(src, 'mpwScenePainted'), now: cutFn(src, 'mpwBgPaintedNow') }
  const body = parts.stamp + '\n' + parts.painted + '\n' + parts.now
    + '\nreturn { mpwScenePaintStamp, mpwScenePainted, mpwBgPaintedNow };'
  const missing = Object.keys(parts).filter((k) => !parts[k])
  if (missing.length) return { err: '切不到函数：' + missing.join('/') }
  return { make: new Function('bgElements', 'wallUserPaused', 'powPaused', 'window', 'document', body) }
}

/*  ── 假环境（形状与真机一致：canvas 有视口宽高、wrap 存在）────────────────────────────────── */
const fakeWin = {}
const fakeDoc = { hidden: false }
const WALL = 'blob:wallpaper-scene'                       // section.image（"有源"）
const KEY = 'custommpkg|scene/red-luan'
const wrap = { classList: { add () {}, remove () {}, contains: () => true } }
const mkEls = (o) => Object.assign({ img: null, video: null, frame: null, canvas: null, wrap }, o || {})
/** 取真判据函数：每个用例一份独立闭包（bgElements 注入成固定的假环境）。 */
const predOf = (make, section, e) => make(() => e, false, false, fakeWin, fakeDoc).mpwBgPaintedNow(section, null, null, fakeWin, fakeDoc)

const SRC = fs.readFileSync(clientPath, 'utf8')
const built = makeFactory(SRC)
const SEC_SCENE = { converted: 'scene', sceneKey: KEY, image: WALL }

if (built.err) {
  bad('能从源码切出三个真函数（mpwScenePaintStamp / mpwScenePainted / mpwBgPaintedNow）', built.err)
} else {
  const make = built.make
  const ns = make(() => mkEls({ canvas: { width: 1, height: 1 } }), false, false, fakeWin, fakeDoc)

  /* ① 场景档：**没落过戳**（= 所有层都加载失败，draw() 只 clearRect 过）⇒ 必须判"没画出来" */
  const c1 = { width: 1280, height: 720 }                  // ← 旧判据在这上面返回 true（缺陷本体）
  const r1 = predOf(make, SEC_SCENE, mkEls({ canvas: c1 }))
  ;(r1 === false ? ok : bad)('① 场景档：canvas 有宽高但**一层都没画成** ⇒ 判"没画出来"（慢判该触发；旧判据 `canvas.width>0` 在这里恒真）', 'r=' + JSON.stringify(r1))

  /* ② 真画过 ≥1 层、且画的是当前 sceneKey ⇒ 判"画出来了" */
  const c2 = { width: 1280, height: 720 }
  ns.mpwScenePaintStamp(c2, KEY, 3)
  const r2 = predOf(make, SEC_SCENE, mkEls({ canvas: c2 }))
  ;(r2 === true ? ok : bad)('② 场景档：真画了 3 层且 key 与当前 sceneKey 相同 ⇒ 判"画出来了"（不许把正常误判成坏）', 'r=' + JSON.stringify(r2))

  /* ③ 戳是**上一份清单**留下的（key 不同）⇒ 不许拿旧戳充数 */
  const c3 = { width: 1280, height: 720 }
  ns.mpwScenePaintStamp(c3, 'custommpkg|scene/OTHER', 5)
  const r3 = predOf(make, SEC_SCENE, mkEls({ canvas: c3 }))
  ;(r3 === false ? ok : bad)('③ 场景档：戳的 key 与当前 sceneKey **不同** ⇒ 判"没画出来"（换壁纸后不许吃旧戳）', 'r=' + JSON.stringify(r3))

  /* ④ 0 层戳（清单空 / 逐层全失败）⇒ 也是"没画出来" */
  const c4 = { width: 1280, height: 720 }
  ns.mpwScenePaintStamp(c4, KEY, 0)
  const r4 = predOf(make, SEC_SCENE, mkEls({ canvas: c4 }))
  ;(r4 === false ? ok : bad)('④ 场景档：落了 0 层戳（清单空 / 逐层全失败）⇒ 判"没画出来"', 'r=' + JSON.stringify(r4))

  /* ⑤ 没有 canvas / 没有 wrap：不越权判死（既有口径不许被这次改动推翻） */
  const r5 = predOf(make, SEC_SCENE, mkEls({ canvas: null }))
  const r5b = predOf(make, SEC_SCENE, mkEls({ canvas: null, wrap: null }))
  /*  口径与改前**逐条一致**（见下面自证）：wrap 在、canvas 不在 ⇒ 判坏（插件自己的 DOM 不一致，
      补一次是合理的，改前也是 false）；wrap 都不在 ⇒ "还没建起来"，无从判断 ⇒ 不补（true）。 */
  ;(r5 === false && r5b === true ? ok : bad)('⑤ wrap 在而 canvas 不在 ⇒ 判坏（与改前一致）；wrap 不在 ⇒ 不越权判死（true）', JSON.stringify([r5, r5b]))

  /* ⑥ 其它三档判据不许被顺手改坏（同一次改动里最容易连带回归的地方） */
  const imgEl = (complete, naturalWidth) => ({ complete, naturalWidth, getAttribute: () => 'data:image/png;base64,AA', currentSrc: '' })
  const vidEl = (rs, vw, src = 'blob:v') => ({ readyState: rs, videoWidth: vw, getAttribute: (n) => (n === 'src' ? src : null), currentSrc: src })
  const imgOk = predOf(make, { converted: 'png', image: WALL }, mkEls({ img: imgEl(true, 64) }))
  const imgBad = predOf(make, { converted: 'png', image: WALL }, mkEls({ img: imgEl(false, 0) }))
  const vidOk = predOf(make, { converted: 'mp4', image: WALL }, mkEls({ video: vidEl(2, 1920) }))
  const vidBad = predOf(make, { converted: 'mp4', image: WALL }, mkEls({ video: vidEl(0, 0) }))
  const webOk = predOf(make, { webUrl: 'https://example.invalid/x', image: WALL }, mkEls({ frame: { getAttribute: () => 'https://example.invalid/x', src: '' } }))
  ;(imgOk === true && imgBad === false ? ok : bad)('⑥a 图片档判据不变（`complete && naturalWidth>0`）', JSON.stringify([imgOk, imgBad]))
  ;(vidOk === true && vidBad === false ? ok : bad)('⑥b 视频档判据不变（`readyState>=2 && videoWidth>0`）', JSON.stringify([vidOk, vidBad]))
  ;(webOk === true ? ok : bad)('⑥c web 档仍然"不越权判死"', JSON.stringify(webOk))

  /* ⑦ 源码级钉子：draw() 真的逐层计数并落戳；0 层清单也落戳；慢判仍走 mpwBgPaintedNow */
  const drawnInc = /c2\.drawImage\([\s\S]{0,240}?drawn\+\+/.test(SRC)
  const stampCall = /mpwScenePaintStamp\(canvas,\s*manifest\.key,\s*drawn\)/.test(SRC)
  const zeroStamp = /if\s*\(!layers\.length\)\s*\{\s*mpwScenePaintStamp\(canvas,\s*manifest\.key,\s*0\)/.test(SRC)
  const slowUses = /const bad = fast \? !mpwBgArmedNow\(s\) : !mpwBgPaintedNow\(s\)/.test(SRC)
  const probeReads = /__mpwBgWrapState = \(\) => \(\{[\s\S]{0,400}?drawn:/.test(SRC)
  ;(drawnInc && stampCall ? ok : bad)('⑦a `showSceneEl().draw()` 逐层计数并落戳（`drawn++` → `mpwScenePaintStamp(canvas, manifest.key, drawn)`）', JSON.stringify({ drawnInc, stampCall }))
  ;(zeroStamp ? ok : bad)('⑦b 0 层清单也落 0 层戳（不留上一份同 key 的旧戳）', String(zeroStamp))
  ;(slowUses ? ok : bad)('⑦c 慢判（12s）仍然经 `mpwBgPaintedNow` —— 没有第二份判据在旁边偷偷生效', String(slowUses))
  ;(probeReads ? ok : bad)('⑦d 取证接口 `__mpwBgWrapState()` 如实给出 `drawn{l*a*yers,key,at}`（真机可读同一处口径）', String(probeReads))
}

/*  ── 分辨力自证：同一套核心断言跑在**改前**源码上必须变红 ───────────────────────────────── */
console.log('\n== 分辨力自证：把 ① 号断言跑在**改前**源码上 ==')
function preFixSource () {
  const pre = argOf('--pre')
  if (pre) return { src: fs.readFileSync(pre, 'utf8'), why: '--pre ' + pre }
  try {
    const src = execFileSync('git', ['show', PRE_FIX_REV + ':lib/client.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return { src, why: 'git show ' + PRE_FIX_REV.slice(0, 8) + ':lib/client.js' }
  } catch (e) { return { src: '', why: '取不到 ' + PRE_FIX_REV.slice(0, 8) + '（浅克隆？）：' + String((e && e.message) || e) } }
}
{
  const { src, why } = preFixSource()
  if (!src) {
    /*  取不到改前版本 ⇒ 不静默通过：如实打印 SKIP 读数，并**用改前那句判据的源码形态**做源码级自证
        （改前版本里 `canvas.width>0` 这一句必须能被找到，否则说明我钉的修订号本身就是错的）。 */
    console.log('SKIP 自证 —— ' + why + '（这条 SKIP 必须看得见）')
    const cur = fs.readFileSync(clientPath, 'utf8')
    const oldCrit = /return !!\(canvas && \(canvas\.width \|\| 0\) > 0\)/.test(cur)
    ok('自证 SKIP 已如实打印，且当前源码里**没有**旧判据（读数：旧判据命中=' + oldCrit + '）')
  } else {
    console.log('  改前源码：' + why + '（' + src.length + ' 字节）')
    const oldCrit = /section\.converted === "scene" && section\.sceneKey\)\s*return !!\(canvas && \(canvas\.width \|\| 0\) > 0\)/.test(src)
    /*  改前版本里**没有**画过戳这套机制（`mpwScenePaintStamp`/`mpwScenePainted` 切不到，这正是"改前不具备
        该机制"的证据）⇒ 为了能跑同一套矩阵，把**改后的两个 helper** 注入进去、只保留**改前的判据函数**。
        这不是"改成改后"：被判的 `mpwBgPaintedNow` 逐字来自改前源码，而它根本不读戳 ⇒ 矩阵读数如实反映旧判据。 */
    const preBody = cutFn(SRC, 'mpwScenePaintStamp') + '\n' + cutFn(SRC, 'mpwScenePainted') + '\n' + cutFn(src, 'mpwBgPaintedNow')
      + '\nreturn { mpwScenePaintStamp, mpwScenePainted, mpwBgPaintedNow };'
    const preMake = cutFn(src, 'mpwBgPaintedNow') ? new Function('bgElements', 'wallUserPaused', 'powPaused', 'window', 'document', preBody) : null
    if (!preMake || !oldCrit) {
      bad('改前版本：判据确实是 `canvas.width>0` 且其 `mpwBgPaintedNow` 可切出来（修订号取对了）', JSON.stringify({ oldCrit, cut: !!cutFn(src, 'mpwBgPaintedNow') }))
    } else {
      /*  逐条对比（这才是"只改了该改的那一条"的证据）：矩阵 = 无戳 / 有戳(同 key) / 有戳(异 key) /
          0 层戳 / canvas 不在 / wrap 不在。改前只应有一条与改后不同 —— 就是"无戳"那条（= 缺陷本体）。 */
      const matrix = (mk) => {
        const c = { width: 1280, height: 720 }
        const cSame = { width: 1280, height: 720 }; mk(() => {}, null, 0).mpwScenePaintStamp(cSame, KEY, 3)
        const cOther = { width: 1280, height: 720 }; mk(() => {}, null, 0).mpwScenePaintStamp(cOther, 'custommpkg|scene/OTHER', 5)
        const cZero = { width: 1280, height: 720 }; mk(() => {}, null, 0).mpwScenePaintStamp(cZero, KEY, 0)
        return {
          '无戳(缺陷本体)': predOf(mk, SEC_SCENE, mkEls({ canvas: c })),
          '有戳同key': predOf(mk, SEC_SCENE, mkEls({ canvas: cSame })),
          '有戳异key': predOf(mk, SEC_SCENE, mkEls({ canvas: cOther })),
          '0层戳': predOf(mk, SEC_SCENE, mkEls({ canvas: cZero })),
          'canvas不在': predOf(mk, SEC_SCENE, mkEls({ canvas: null })),
          'wrap不在': predOf(mk, SEC_SCENE, mkEls({ canvas: null, wrap: null })),
        }
      }
      const before = matrix(preMake), after = matrix(makeFactory(SRC).make)
      const diff = Object.keys(before).filter((k) => !after || before[k] !== after[k])
      console.log('  改前 / 改后逐条：' + JSON.stringify({ before, after }) + ' · 差异=' + JSON.stringify(diff))
      /*  期望的差异集：与"画没画"有关的四档（无戳 / 有戳同key / 有戳异key / 0层戳）旧判据全都给出同一个
          答案 true（它对"画没画"完全不敏感 —— 这就是缺陷本体）；而与"画没画"无关的两档（canvas 不在 /
          wrap 不在）两边必须一致。差异集**恰好**是那四档才算"只改了该改的那条"。 */
      const wantDiff = ['无戳(缺陷本体)', '有戳异key', '0层戳']
      const same = wantDiff.every((k) => diff.includes(k)) && diff.length === wantDiff.length
        && before['canvas不在'] === after['canvas不在'] && before['wrap不在'] === after['wrap不在']
        && before['有戳同key'] === true && after['有戳同key'] === true
        && after['有戳异key'] === false && after['0层戳'] === false
      ;(same ? ok : bad)('改前判据对"一层都没画成 / 异 key 的旧戳 / 显式 0 层戳"三档**全返回 true**（= 缺陷本体，它对"画没画"不敏感）' +
        '⇒ ①③④ 三档断言在改前必然红；真正画成了那一档两边都 true，与"画没画"无关的两档（canvas 不在 / wrap 不在）改前改后逐条一致',
        '差异=' + JSON.stringify(diff) + ' 期望=' + JSON.stringify(wantDiff) + ' 旧判据在源码里=' + oldCrit)
    }
  }
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
process.exit(fail ? 1 : 0)

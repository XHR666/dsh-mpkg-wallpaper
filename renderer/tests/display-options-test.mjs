// display-options-test.mjs — P-113 壁纸显示选项验收（翻转 / 播放速度 0.5–2× / 颜色选项四项）
//
// 契约（测试台「壁纸设置」页的表 + 插件 dsh-mpkg-wallpaper）与口径/区间/优先级：docs/DISPLAY-OPTIONS.md。
// 断言对象分三层：
//   ① **纯函数**（`core/we-scene-bundle.js` 的「显示选项」节）：解析 / 钳位 / filter 串 / 合成 / 时钟；
//   ② **接线**（`demo.html` 的 `MPW-DISPLAY` 块真源码切片 + 注入桩 DOM/localStorage/window）：
//      `__wp.setDisplay/setPlaybackRate/displayState`、CSS 写在哪、工具条 UI 的事件绑定；
//   ③ **指针与动画的数值后果**：flipH 下的 client→帧内换算（`framePointerMap`）、rate=2 下的
//      **被求值的动画值**（`evalPropAnimation`）—— 都不是"看着像"，是逐值对拍。
//
// 手法与 `tests/web-frame-geometry-wiring-test.mjs` / `tests/baseline-test.mjs` 同款：
// 真源码切片 + 桩注入，不碰 DOM/GPU/网络（本机无 GPU ⇒ 只做 DOM/数值级断言，不做像素级断言）。
// 关键结论都带 **RED-IF-REVERTED**：把真源码改回"忽略该选项"的旧写法 ⇒ 同一断言必须变红。
//
// 运行：node tests/display-options-test.mjs   （全过输出 ALL PASS，退出码 0）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from './_root.mjs'

const lib = await import('../core/we-scene-bundle.js')

let failed = 0, total = 0
const check = (cond, label, detail) => {
  total++
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  ' + detail : ''))
  if (!cond) failed++
}
const near = (a, b, eps = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const BUNDLE = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
function slice(src, begin, end) {
  const i = src.indexOf(begin)
  if (i < 0) throw new Error('切片起点缺失: ' + begin)
  const j = src.indexOf(end, i)
  if (j < 0) throw new Error('切片终点缺失: ' + end)
  return src.slice(i, j + end.length)
}
/** 从源码里切出 `export function NAME(...) {…}` 整段（函数结束 = 行首的 `}`） */
function sliceFn(src, decl) {
  const i = src.indexOf(decl)
  if (i < 0) throw new Error('函数切片起点缺失: ' + decl)
  const j = src.indexOf('\n}\n', i)
  if (j < 0) throw new Error('函数切片终点缺失: ' + decl)
  return src.slice(i, j + 2)
}
const BLOCK = slice(HTML, '// ═══ MPW-DISPLAY-BEGIN', '// ═══ MPW-DISPLAY-END ═══')

// ── 夹具（mkdtemp；`process.on('exit')` 保证失败/抛异常时也删干净；< 1 MB）──
const FIXDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-display-'))
process.on('exit', () => { try { fs.rmSync(FIXDIR, { recursive: true, force: true }) } catch { /* ignore */ } })
const CASES = path.join(FIXDIR, 'cases.json')
fs.writeFileSync(CASES, JSON.stringify({
  note: 'P-113 真值表夹具（自造，无第三方内容；< 1 KB）',
  rates: [['', 1], ['abc', 1], ['0', 0.5], ['0.1', 0.5], ['0.5', 0.5], ['1.5', 1.5], ['2', 2], ['9', 2], ['-3', 0.5], ['1e0', 1]],
  nums: [
    ['brightness', '1.1', 1.1], ['brightness', '9', 2], ['brightness', '-1', 0], ['brightness', 'abc', 1], ['brightness', '', 1],
    ['contrast', '1.05', 1.05], ['contrast', '3', 2], ['saturation', '1.2', 1.2], ['saturation', '0', 0],
    ['hue', '15', 15], ['hue', '-400', -180], ['hue', '999', 180], ['hue', 'nope', 0],
  ],
}, null, 1))
const FIX = JSON.parse(fs.readFileSync(CASES, 'utf8'))

/* ── 桩：假 localStorage / 假画布 / 假 document / 假 window ── */
function fakeLs(initial) {
  const m = new Map(Object.entries(initial || {}))
  return {
    get length() { return m.size },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)) },
    removeItem: (k) => { m.delete(String(k)) },
    _map: m,
  }
}
function fakeCanvas(filter, transform) { return { style: { filter: filter || '', transform: transform || '' } } }
function fakeEl(value, checked) { return { value: String(value), checked: !!checked, addEventListener() {}, disabled: false, textContent: '' } }
function fakeDoc(opts = {}) {
  return {
    getElementById: (id) => (opts.els && opts.els[id]) || null,
    querySelectorAll: (sel) => (sel === 'video' ? (opts.videos || []) : []),
  }
}
const RETURN = '\nreturn { MPW_DISPLAY_URL, MPW_DISPLAY, MPW_DISPLAY_FLAGS, MPW_DISPLAY_LS_KEY, MPW_DISPLAY_LS_MAX, MPW_DISPLAY_CANVASES,'
  + ' mpwDisplayState, mpwDisplaySet, mpwDisplayPersist, mpwDisplayLoadStored, mpwDisplaySave, mpwDisplayApplyAll,'
  + ' mpwDisplayRegisterCanvas, mpwSceneClockAt, mpwSceneDt, mpwSyncVideoRates, mpwDisplayUiInit, mpwDisplaySyncUI }'
/** 跑真源码切片（依赖全注入）。`els` 给了就是"有工具条"，不给就是"无控件环境" */
function makeEnv(opts = {}) {
  const logs = []
  const canvas = opts.canvas || fakeCanvas(opts.canvasFilter, opts.canvasTransform)
  const store = opts.store || fakeLs(opts.ls)
  const win = opts.win || {}
  const doc = fakeDoc({ els: opts.els, videos: opts.videos })
  const api = new Function('lib', 'location', 'document', 'window', 'localStorage', 'logf', 'cv', BLOCK + RETURN)(
    lib, { search: opts.search || '' }, doc, win, store, (m) => logs.push(String(m)), canvas)
  return { api, logs, canvas, win, store, doc }
}

console.log('\n== T1 纯函数：播放速度解析与钳位（0.5–2×，非法 ⇒ 1）==')
{
  let bad = 0
  for (const [raw, want] of FIX.rates) if (lib.parsePlaybackRate(raw) !== want) { bad++; console.log('   ✗ rate=' + JSON.stringify(raw) + ' → ' + lib.parsePlaybackRate(raw)) }
  check(bad === 0, 'T1a ' + FIX.rates.length + ' 条倍率真值表（夹具 ' + path.basename(CASES) + '）：空/非数 ⇒ 1，超范围钳到 0.5/2', '坏 ' + bad)
  check(lib.parsePlaybackRate(null) === 1 && lib.parsePlaybackRate(undefined) === 1 && lib.parsePlaybackRate({}) === 1,
    'T1b null/undefined/对象 ⇒ 1（不抛、不产生 NaN）')
  check(lib.PLAYBACK_RATE_MIN === 0.5 && lib.PLAYBACK_RATE_MAX === 2 && eq(lib.DISPLAY_LIMITS.playbackRate, [0.5, 2]),
    'T1c 区间常量 = [0.5, 2]（与 docs/DISPLAY-OPTIONS.md §2 同一份口径）')
}

console.log('\n== T2 纯函数：四项数值钳位 + 颜色串（唯一实现处）==')
{
  let bad = 0
  for (const [key, raw, want] of FIX.nums) if (lib.clampDisplayNumber(key, raw) !== want) { bad++; console.log('   ✗ ' + key + '=' + JSON.stringify(raw) + ' → ' + lib.clampDisplayNumber(key, raw)) }
  check(bad === 0, 'T2a ' + FIX.nums.length + ' 条数值真值表（0–2 / ±180 钳位，非法 ⇒ 中性）', '坏 ' + bad)
  check(eq(lib.DISPLAY_LIMITS.brightness, [0, 2]) && eq(lib.DISPLAY_LIMITS.contrast, [0, 2]) && eq(lib.DISPLAY_LIMITS.saturation, [0, 2]) && eq(lib.DISPLAY_LIMITS.hue, [-180, 180]),
    'T2b 区间常量：亮/对比/饱和 [0,2]、色相 [−180,180]（UI 滑条同源 —— T10b 断言 DOM）')
  const st = lib.parseDisplayOptions('?bright=1.1&contrast=1.05&satur=1.2&hue=15')
  check(lib.buildDisplayFilter(st) === 'brightness(1.1) contrast(1.05) saturate(1.2) hue-rotate(15deg)',
    'T2c 契约里的那一条 filter 串逐字命中（顺序 = brightness contrast saturate hue-rotate）', lib.buildDisplayFilter(st))
  check(lib.buildDisplayFilter(lib.parseDisplayOptions('?bright=1&contrast=1&satur=1&hue=0')) === '',
    'T2d 四项全中性 ⇒ **空串**（不是 brightness(1)…）：缺省不多一个合成层（红线①的一半）')
  check(lib.buildDisplayFilter(lib.parseDisplayOptions('?bright=1.4&coloropts=0')) === '',
    'T2e `?coloropts=0` 总开关关 ⇒ 四项**完全排除**在 filter 链之外（即使写了 bright）')
  check(lib.buildDisplayFilter(lib.parseDisplayOptions('?display=legacy&bright=1.4')) === ''
    && lib.buildDisplayTransform(lib.parseDisplayOptions('?display=legacy&fliph=1')) === '',
    'T2f `?display=legacy` 总回退：连 URL 里的四项/翻转一起忽略')
  check(lib.buildDisplayTransform(lib.parseDisplayOptions('?fliph=1')) === 'scaleX(-1)'
    && lib.buildDisplayTransform(lib.parseDisplayOptions('?fliph=0')) === ''
    && lib.buildDisplayTransform(lib.parseDisplayOptions('?fliph=off')) === '',
    'T2g 翻转串 = `scaleX(-1)`；`?fliph=0|off` = 关（每个开关都有自己的 off 值）')
}

console.log('\n== T3 与既有 filter 写入者（?fx= / 宿主）合成而非覆盖 ==')
{
  const own = lib.buildDisplayFilter(lib.parseDisplayOptions('?bright=1.1'))
  check(lib.composeFilterCss('sepia(0.5)', own) === 'sepia(0.5) ' + own,
    'T3a 既有串在前、颜色串在后（CSS 从左到右作用 ⇒ 颜色项看到的是既有滤镜的输出）', lib.composeFilterCss('sepia(0.5)', own))
  check(lib.composeFilterCss('sepia(0.5)', '') === 'sepia(0.5)',
    'T3b 关掉显示选项 ⇒ **逐字还原**既有串（不把自己的空串写上去）')
  check(lib.composeFilterCss('', own) === own && lib.composeFilterCss(null, '') === '',
    'T3c 既有为空（缺省）⇒ 只有本次串；两边都空 ⇒ 空串')
  check(lib.composeTransformCss('translateX(4px)', 'scaleX(-1)') === 'scaleX(-1) translateX(4px)'
    && lib.composeTransformCss('translateX(4px)', '') === 'translateX(4px)',
    'T3d transform 合成：镜像在最外层；关 ⇒ 还原（demo.html 当前 0 处 transform 写入者，属前瞻口径）')
}

console.log('\n== T4 缺省零行为变化（红线①：参数全缺省 ⇒ 不写 filter/transform、时钟逐位不变）==')
{
  const e = makeEnv({})
  const st = e.api.mpwDisplayState()
  check(e.api.MPW_DISPLAY_URL.present.length === 0 && st.filterPending === '' && st.transformPending === '',
    'T4a 无参数：`present` 为空、待写 filter/transform 都是空串')
  check(e.canvas.style.filter === '' && e.canvas.style.transform === '',
    'T4b 真源码切片跑完（含画布注册）：画布 style 上**一个字符都没写**', 'filter="' + e.canvas.style.filter + '" transform="' + e.canvas.style.transform + '"')
  check(st.clockTouched === false && e.api.mpwSceneClockAt(4321.5, 1.23456) === 1.23456,
    'T4c 场景时钟没被碰过 ⇒ `at()` **原样返回**调用方给的改动前算式值（逐位相同，含任意小数）')
  check(e.api.mpwSceneDt(0.016666666666666666) === 0.016666666666666666 && e.logs.length === 0,
    'T4d frametime 倍率：rate=1 ⇒ 逐位返回原值；且不产生任何日志（缺省静默）')
  check(typeof e.win.__wp === 'object' && typeof e.win.__wp.setDisplay === 'function'
    && typeof e.win.__wp.setPlaybackRate === 'function' && typeof e.win.__wp.displayState === 'function'
    && typeof e.win.__wp.displayState().filter === 'string',
    'T4e `__wp` 三个新方法在位（setDisplay/setPlaybackRate/displayState，后者的返回可 JSON 化给宿主读）')
  const kept = { keep: 1 }
  const e2 = makeEnv({ win: { __wp: kept } })
  check(e2.win.__wp === kept && e2.win.__wp.keep === 1 && typeof e2.win.__wp.setDisplay === 'function',
    'T4f `__wp` 已存在的字段**不被覆盖**（宿主/测试台先放的键原样保留）')
  const pre = makeEnv({ canvasFilter: 'sepia(0.5)', canvasTransform: 'translateX(4px)' })
  check(pre.canvas.style.filter === 'sepia(0.5)' && pre.canvas.style.transform === 'translateX(4px)',
    'T4g 缺省下连**既有**的内联 filter/transform 也一字不动（把"别人写的"原样留着）')
}

console.log('\n== T5 翻转：CSS 写在输出元素上 + 指针映射只镜像一次 ==')
{
  const e = makeEnv({ search: '?fliph=1' })
  check(e.canvas.style.transform === 'scaleX(-1)' && e.canvas.style.filter === '',
    'T5a `?fliph=1` ⇒ 画布 transform = scaleX(-1)（filter 仍为空 ⇒ 只翻转不变色）', 'transform="' + e.canvas.style.transform + '"')
  check(e.api.mpwDisplayState().flipH === true && e.win.__mpwDisplay.flipH === true,
    'T5b 生效状态与 `window.__mpwDisplay`（引擎指针路径读的那个实时对象）同步为 true')

  // 画布：显示盒 1000×500 @(100,20)（未缩放）；指针在左半 ⇒ 归一 nx=0.2
  const el = { getBoundingClientRect: () => ({ left: 100, top: 20, width: 1000, height: 500 }), clientWidth: 1000, clientHeight: 500 }
  const ev = { clientX: 300, clientY: 120 }
  const off = lib.framePointerMap(ev, el, 'legacy', false)
  const on = lib.framePointerMap(ev, el, 'legacy', true)
  check(near(off.nx, 0.2) && near(on.nx, 0.8) && near(on.nx, 1 - off.nx),
    'T5c 关：nx=0.2；开：nx=0.8 = 1−0.2（镜像**恰好一次**：scaleX(-1) 让屏幕左半看到的是内容右半）',
    'off=' + off.nx + ' on=' + on.nx)
  check(lib.framePointerMap(ev, el, 'legacy', undefined).nx === off.nx,
    'T5c2 第四参数缺省（老调用点）⇒ 与改动前逐位同值（向后兼容）')
  const covOff = lib.framePointerMap(ev, el, 'cover', false), covOn = lib.framePointerMap(ev, el, 'cover', true)
  check(near(covOn.nx, 1 - covOff.nx) && near(covOn.x, 1000 - covOff.x) && covOn.inside === covOff.inside && near(covOn.scaleX, covOff.scaleX),
    'T5d `?framegeom=cover` 档同口径（帧内 client 像素也镜像：x → 宽度−x；inside/scale 不变）')
  const dOff = 1920 + (off.nx - 0.5) * 3840, dOn = 1920 + (on.nx - 0.5) * 3840   // 设计坐标（framed=3840 满幅）
  check(dOn > 1920 && dOff < 1920 && near(dOn - 1920, -(dOff - 1920)),
    'T5e **端到端**：屏幕左半边(300px) 在翻转下映射到设计 x=' + Math.round(dOn) + '（右半），不翻转是 ' + Math.round(dOff) + '（左右互为镜像）')
  check(lib.displayFlipH(true, false, false) === true && lib.displayFlipH(undefined, { flipH: true }, false) === true
    && lib.displayFlipH(undefined, undefined, true) === true && lib.displayFlipH(undefined, undefined, false) === false
    && lib.displayFlipH(undefined, { flipH: false }, true) === false,
    'T5f 优先级链：显式 opts > `window.__mpwDisplay.flipH`（页面实时） > `?fliph=`（加载时读一次）')
  check(/framePointerMap\(ev, el, FRAME_GEOM, __pointerFlip\(\)\)/.test(BUNDLE)
    && /displayFlipH\(opts\.displayFlipH, \(typeof window[^\n]*window\.__mpwDisplay/.test(BUNDLE),
    'T5g 引擎真源码接线：DOM pointermove 路径带上了 `__pointerFlip()`（不是旁边放了个没用的 helper）')
  check(/return \[inj\.x, inj\.y\]/.test(BUNDLE) && /inj\.space === 'css' && cam && FRAME_GEOM === 'cover'/.test(BUNDLE),
    'T5h 注入通道（`window.__mpwPointer` = **设计坐标**）原样透传 `[inj.x, inj.y]` ⇒ 只镜像一次，不是镜像两次（红线②）')
}

console.log('\n== T6 播放速度：场景时钟 + 被求值的动画值（advance N 帧，rate 1 vs 2）==')
{
  // 合成一条动画（c0 通道 0→100 线性、30fps、10 帧长）：t 处被"求值"出一个数
  const anim = { animation: { options: { fps: 30, length: 10, mode: 'single' }, c0: [{ frame: 0, value: 0 }, { frame: 10, value: 100 }] } }
  const DT_MS = 1000 / 64          // 15.625ms —— 二进制精确，16 帧累计是精确值（可做 === 断言）
  const N = 16
  const run = (search) => {
    const e = makeEnv({ search })
    const rows = []
    for (let i = 1; i <= N; i++) { const now = i * DT_MS; rows.push(e.api.mpwSceneClockAt(now, now / 1000)) }
    return { e, rows, first: rows[0], last: rows[N - 1], advance: rows[N - 1] - rows[0] }
  }
  const r1 = run(''), r2 = run('?rate=2')
  check(r1.advance === (N - 1) * DT_MS / 1000, 'T6a rate=1：场景时间推进 = 墙上时间推进（' + r1.advance + ' s = 15 × 15.625ms）')
  check(r2.advance === 2 * r1.advance, 'T6b rate=2：**同一批时间戳**下推进恰好翻倍（' + r2.advance + ' = 2 × ' + r1.advance + '，`===` 精确相等）')
  let perFrame = true
  for (let i = 0; i < N; i++) if (r2.rows[i] - r2.first !== 2 * (r1.rows[i] - r1.first)) perFrame = false
  check(perFrame, 'T6c 不只是终点：**逐帧**（16 帧全部）都满足 Δ₂ = 2 × Δ₁（确定性，不看帧率抖动）')
  check(r1.e.api.mpwSceneClockAt(1000, 1) === 1 && r1.e.api.mpwSceneClockAt(1000, 1) === 1,
    'T6d rate=1 仍走"原样返回 legacyTime"的缺省路径（时钟没被标记 touched）')
  const v1 = lib.evalPropAnimation(anim, r1.last)[0]
  const v2 = lib.evalPropAnimation(anim, r2.last)[0]
  const v2x = lib.evalPropAnimation(anim, r1.last + r1.advance)[0]     // 时间翻倍处的独立求值
  check(v2 === v2x && v2 !== v1,
    'T6e **被求值的动画值**：rate=2 的层属性值 ' + v2 + ' === 时间翻倍处独立求值 ' + v2x + '（rate=1 时是 ' + v1 + '，可区分）')
  check(lib.evalPropAnimation(anim, r1.last)[0] === v1 && v1 !== v2 && lib.evalPropAnimation(anim, 0)[0] === 0,
    'T6f 判别力对照：同一时刻重复求值稳定（确定性）、该窗口内动画确实在变、t=0 处回到初值（等式不是巧合）')
  check(r2.e.api.mpwSceneDt(0.016) === 0.032 && r1.e.api.mpwSceneDt(0.016) === 0.016,
    'T6g `engine.frametime` 同倍率：rate=2 ⇒ 0.032；rate=1 ⇒ 逐位 0.016')
  check(/mpwSceneClockAt\(now, \(now - last0\) \/ 1000\)/.test(HTML) && /runSceneScripts\(tSec, mpwSceneDt\(mpwCapScriptDt\(frameDt\)\)\)/.test(HTML),
    'T6h demo.html 帧循环真源码：`tSec` 与传给场景脚本的 frametime 都走了倍率（不是只在 API 里存了个数）')
}

console.log('\n== T7 播放速度：video.playbackRate（rate=1 时零写入）==')
{
  const vids = [{ playbackRate: 1 }, { playbackRate: 1 }]
  const e1 = makeEnv({ videos: vids })
  check(e1.api.mpwSyncVideoRates() === 0 && vids.every((v) => v.playbackRate === 1),
    'T7a rate=1：**一个属性都不写**（返回 0；缺省零行为变化）')
  const e15 = makeEnv({ search: '?rate=1.5', videos: vids })
  check(e15.api.mpwSyncVideoRates() === 2 && vids.every((v) => v.playbackRate === 1.5),
    'T7b rate=1.5：两个 `<video>` 都设成 1.5（canvas 精灵播放吃 tSec，视频吃 playbackRate，两条一致）')
  e15.api.mpwDisplaySet({ playbackRate: 1 })
  check(vids.every((v) => v.playbackRate === 1) && e15.api.mpwDisplayState().playbackRate === 1,
    'T7c 同一会话里从 1.5 切回 1：视频被**写回** 1（倍率是双向的，不是只往快里调）')
  const e2 = makeEnv({ search: '?rate=2', videos: vids })
  vids[0].playbackRate = 2
  check(e2.api.mpwSyncVideoRates() === 1 && vids.every((v) => v.playbackRate === 2),
    'T7d rate=2：只改"值不对"的那个元素（已在 2 的不重写 —— 幂等的同一口径）')
  const e3 = makeEnv({ videos: vids })
  check(e3.api.mpwSyncVideoRates() === 0 && vids.every((v) => v.playbackRate === 2),
    'T7e 全新会话 + rate=1（本会话从未施加过非 1 倍）⇒ 零写入（不回写"别的会话留下的值"）')
  check(/mpwSyncVideoRates\(\)/.test(HTML) && /syncVideoPlaybackRate\(document, r, force\)/.test(BLOCK),
    'T7f demo.html 真源码：帧循环/纯视频路径都在同步；唯一写入点是纯函数 `syncVideoPlaybackRate(document, r, force)`')
}

console.log('\n== T8 __wp API：幂等 / 返回生效状态 / 非法值 ⇒ 默认 / legacy 只读 ==')
{
  const e = makeEnv({ search: '?bright=1.1' })
  const s1 = e.win.__wp.setDisplay({ saturation: 1.2 })
  const f1 = e.canvas.style.filter
  const s2 = e.win.__wp.setDisplay({ saturation: 1.2 })          // 同值再打一次
  check(s1.filter === s2.filter && e.canvas.style.filter === f1 && eq(s1, s2),
    'T8a 幂等：同一个 patch 打两次 ⇒ 状态与画布 style 都不变（第二次一个属性都没写）', 'filter=' + f1)
  check(s1.brightness === 1.1 && s1.saturation === 1.2 && s1.filter === 'brightness(1.1) contrast(1) saturate(1.2) hue-rotate(0deg)',
    'T8b `setDisplay` 返回**生效后的完整状态**（含真的写进元素的 filter 串）', s1.filter)
  const s3 = e.win.__wp.setDisplay({ brightness: 99, hue: 'abc', flipH: 1 })
  check(s3.brightness === 2 && s3.hue === 0 && s3.flipH === true,
    'T8c 越界/非法值在 API 这一层也被钳位（brightness 99 → 2、hue abc → 0、flipH → true）')
  const s4 = e.win.__wp.setPlaybackRate(99)
  check(s4.playbackRate === 2 && e.win.__wp.setPlaybackRate('nope').playbackRate === 1,
    'T8d `setPlaybackRate` 钳到 2；非法值 ⇒ 回落 1')
  const noDom = makeEnv({})
  check(noDom.api.mpwDisplaySet({ brightness: 1.4 }).brightness === 1.4 && typeof noDom.api.mpwDisplayApplyAll() === 'number',
    'T8e 无控件/DOM 也不抛（切片在 Node 里能裸跑 = 接线与 DOM 解耦）')
  const legacy = makeEnv({ search: '?display=legacy' })
  const sl = legacy.win.__wp.setDisplay({ flipH: true, brightness: 1.5 })
  check(sl.legacy === true && sl.flipH === false && sl.brightness === 1
    && legacy.canvas.style.filter === '' && legacy.canvas.style.transform === '',
    'T8f `?display=legacy` ⇒ **连 API 也只读**：状态中性、画布一字未写（总回退是最硬的开关）')
  const legacyRate = makeEnv({ search: '?display=legacy' })
  check(legacyRate.win.__wp.setPlaybackRate(2).playbackRate === 1 && legacyRate.api.mpwSceneDt(0.032) === 0.032,
    'T8g legacy 档连倍率也不生效（frametime 逐位原值）')
}

console.log('\n== T9 持久化（同一套 mpw-* 键 + 单值上限 + 逐键覆盖）==')
{
  const box = { classList: { add() {}, remove() {} } }
  const e = makeEnv({ els: { 'mpw-display-box': box } })
  check(e.api.MPW_DISPLAY_LS_KEY === 'mpw-display' && e.api.MPW_DISPLAY_LS_MAX === 512,
    'T9a 键名 `mpw-display`（与 `mpw-log-h`/`mpw-props:`/`mpw-audio-open` 同一套 mpw-* 命名）+ 单值上限 512B（P-104 纪律）')
  e.win.__wp.setDisplay({ brightness: 1.3, flipH: true })
  const saved = JSON.parse(e.store.getItem('mpw-display'))
  check(saved.brightness === 1.3 && saved.flipH === true && saved.playbackRate === 1 && !('legacy' in saved),
    'T9b 改一次就落一次盘（JSON，七个可设置键；不存 legacy/present 这类派生字段）', JSON.stringify(saved))
  const e2 = makeEnv({ ls: { 'mpw-display': JSON.stringify({ brightness: 1.4, hue: 30 }) } })
  check(e2.api.MPW_DISPLAY.brightness === 1.4 && e2.api.MPW_DISPLAY.hue === 30
    && e2.canvas.style.filter === 'brightness(1.4) contrast(1) saturate(1) hue-rotate(30deg)',
    'T9c 无 URL 参数时读回上次的 UI 状态（刷新后滑块不回弹）')
  const e3 = makeEnv({ search: '?bright=0.5', ls: { 'mpw-display': JSON.stringify({ brightness: 1.4, hue: 30, flipH: true }) } })
  check(e3.api.MPW_DISPLAY.brightness === 0.5 && e3.api.MPW_DISPLAY.hue === 30 && e3.api.MPW_DISPLAY.flipH === true,
    'T9d URL **逐键**覆盖：`?bright=0.5` 只改亮度，存储里的 hue/翻转照旧生效（不是整表复位）')
  const e4 = makeEnv({ search: '?display=legacy', ls: { 'mpw-display': JSON.stringify({ brightness: 1.4, flipH: true }) } })
  check(e4.api.MPW_DISPLAY.brightness === 1 && e4.api.MPW_DISPLAY.flipH === false && e4.canvas.style.transform === '',
    'T9e `?display=legacy` 连持久化状态一起忽略（真·一键回到改动前）')
  const big = makeEnv({})
  const okBig = big.api.mpwDisplaySave(Object.assign(lib.defaultDisplayState(), { brightness: 'x'.repeat(600) }))
  check(okBig === false && big.store.getItem('mpw-display') === null && big.logs.some((l) => /显示选项未持久化/.test(l)),
    'T9f 单值超上限 ⇒ **拒写 + 记日志**（不静默截断），已有的键一个不动')
}

console.log('\n== T10 工具条 UI（控件 id / 区间与钳位同源 / 事件绑到 API）==')
{
  const ids = ['mpw-flip-h', 'mpw-rate', 'mpw-coloropts', 'mpw-bright', 'mpw-contrast', 'mpw-satur', 'mpw-hue', 'mpw-display-reset']
  const missing = ids.filter((id) => !new RegExp('id="' + id + '"').test(HTML))
  check(missing.length === 0, 'T10a demo.html 里 8 个控件 id 全在位（' + ids.join('/') + '）', missing.length ? '缺 ' + missing.join(',') : '')
  const i0 = HTML.indexOf('<span id="mpw-display-box"')
  const group = HTML.slice(i0, HTML.indexOf('<a href="/?id=3544152633">', i0))
  const KEY = { 'mpw-bright': 'brightness', 'mpw-contrast': 'contrast', 'mpw-satur': 'saturation', 'mpw-hue': 'hue' }
  const ranges = [...group.matchAll(/<input type="range" id="(mpw-[a-z]+)" min="(-?[\d.]+)" max="(-?[\d.]+)"/g)]
  const badRange = ranges.filter((m) => !KEY[m[1]] || Number(m[2]) !== lib.DISPLAY_LIMITS[KEY[m[1]]][0] || Number(m[3]) !== lib.DISPLAY_LIMITS[KEY[m[1]]][1])
  check(ranges.length === 4 && badRange.length === 0,
    'T10b 四个滑条的 min/max 与 `DISPLAY_LIMITS` **同源**（改区间只改一处，UI 不可能与钳位不一致）',
    ranges.map((m) => m[1] + '[' + m[2] + ',' + m[3] + ']').join(' '))
  check(/on\('mpw-bright', 'input'/.test(BLOCK) && /on\('mpw-flip-h', 'change'/.test(BLOCK)
    && /on\('mpw-rate', 'change'/.test(BLOCK) && /on\('mpw-coloropts', 'change'/.test(BLOCK)
    && /on\('mpw-display-reset', 'click'/.test(BLOCK) && /^\s*mpwDisplayUiInit\(\)/m.test(BLOCK),
    'T10c 事件接线在位（四个滑条 input、勾选/倍率 change、重置 click，且初始化真的被调用）')
  const els = {
    'mpw-display-box': { classList: { _c: new Set(), add(c) { this._c.add(c) }, remove(c) { this._c.delete(c) } } },
    'mpw-flip-h': fakeEl('', false), 'mpw-coloropts': fakeEl('', true), 'mpw-rate': fakeEl('1'),
    'mpw-bright': fakeEl('1'), 'mpw-bright-v': fakeEl('1'), 'mpw-contrast': fakeEl('1'), 'mpw-contrast-v': fakeEl('1'),
    'mpw-satur': fakeEl('1'), 'mpw-satur-v': fakeEl('1'), 'mpw-hue': fakeEl('0'), 'mpw-hue-v': fakeEl('0'),
  }
  const e = makeEnv({ search: '?bright=1.25&coloropts=0', els })
  e.api.mpwDisplaySyncUI()
  check(String(els['mpw-bright'].value) === '1.25' && els['mpw-bright-v'].textContent === '1.25'
    && els['mpw-flip-h'].checked === false && els['mpw-display-box'].classList._c.has('off'),
    'T10d `displayState()` → 控件回填：滑条与数值标签同步、总开关关时加 `.off` 变灰')
  const legacyEls = { 'mpw-display-box': { classList: { add() {}, remove() {} } }, 'mpw-flip-h': fakeEl('', false), 'mpw-rate': fakeEl('1') }
  const le = makeEnv({ search: '?display=legacy', els: legacyEls })
  check(legacyEls['mpw-flip-h'].disabled === true && legacyEls['mpw-rate'].disabled === true,
    'T10e legacy 档把控件置灰（用户看得出"这页现在不接受显示选项"）')
  check(le.api.mpwDisplayUiInit() === true && makeEnv({}).api.mpwDisplayUiInit() === false,
    'T10f UI 初始化对"有工具条/无工具条"都返回明确结果（无 DOM 的切片环境安全）')
}

console.log('\n== T11 RED-IF-REVERTED：把真源码改回"忽略该选项"⇒ 结论必须变红 ==')
{
  const red = []
  /* 变异①：删掉指针换算里的镜像支（= 翻转被忽略）⇒ T5c/T5e 必红 */
  const fnSrc = sliceFn(BUNDLE, 'export function framePointerMap(')
  const mutFn = fnSrc.replace('export function framePointerMap(', 'function framePointerMap(')
    .replace('const x = flipX ? (r.width - x0) : x0', 'const x = x0')
  const mutMap = new Function(mutFn + '\nreturn framePointerMap')()
  const el = { getBoundingClientRect: () => ({ left: 100, top: 20, width: 1000, height: 500 }), clientWidth: 1000, clientHeight: 500 }
  const m = mutMap({ clientX: 300, clientY: 120 }, el, 'legacy', true)
  if (near(m.nx, 0.2) && !near(m.nx, 0.8)) red.push('变异①(指针不镜像)：flipH 下 nx=0.2（与不翻转同值）⇒ T5c/T5e 变红')
  /* 变异②：把显示块里的时钟倍率写死成 1（= 播放速度被忽略）⇒ T6b/T6c/T6e 必红 */
  const mutBlock = BLOCK.replace('lib.createSceneClock({ rate: MPW_DISPLAY.playbackRate })', 'lib.createSceneClock({ rate: 1 })')
  const mEnv = new Function('lib', 'location', 'document', 'window', 'localStorage', 'logf', 'cv', mutBlock + RETURN)(
    lib, { search: '?rate=2' }, fakeDoc({}), {}, fakeLs(), () => {}, fakeCanvas())
  const rows = []
  for (let i = 1; i <= 16; i++) { const now = i * (1000 / 64); rows.push(mEnv.mpwSceneClockAt(now, now / 1000)) }
  const mAdv = rows[15] - rows[0], want = 2 * (15 * (1000 / 64) / 1000)
  if (mAdv !== want) red.push('变异②(时钟忽略 rate)：推进 ' + mAdv + ' ≠ 2 × ' + (15 * (1000 / 64) / 1000) + ' ⇒ T6b/T6c/T6e 变红')
  /* 变异③：颜色串永远返回空（= 颜色选项被忽略）⇒ T2c/T2e 必红 */
  const colorSrc = sliceFn(BUNDLE, 'export function buildDisplayFilter(')
  const mutFilter = new Function('clampDisplayNumber', 'fmtNum', colorSrc.replace('export function buildDisplayFilter(', 'function buildDisplayFilter(')
    .replace("if (b === 1 && c === 1 && s === 1 && h === 0) return ''", "return ''") + '\nreturn buildDisplayFilter')(lib.clampDisplayNumber, String)
  const mf = mutFilter({ colorOptions: true, brightness: 1.1, contrast: 1.05, saturation: 1.2, hue: 15 })
  if (mf === '' && mf !== 'brightness(1.1) contrast(1.05) saturate(1.2) hue-rotate(15deg)') red.push('变异③(filter 串空实现)：颜色选项不再产生 CSS ⇒ T2c/T2e 变红')
  check(red.length === 3, 'T11a 三条最关键的结论在"改回旧行为"后确实变红（指针镜像 / 时钟倍率 / 颜色串）', '红 ' + red.length + '/3')
  for (const r of red) console.log('   RED ' + r)
  check(mutFn !== fnSrc && mutBlock !== BLOCK && mutFilter && true, 'T11b 三个变异都真的改到了源码（不是空替换 ⇒ 上面的"红"有意义）')
}

console.log('\n== T12 登记与文档（门禁 / README 主表 / 规格文档 / PATCHES 编号）==')
{
  const RUNNER = fs.readFileSync(path.join(ROOT, 'tests', 'run-all-tests.sh'), 'utf8')
  const addLines = RUNNER.split('\n').filter((l) => /^add "/.test(l))
  const myIdx = addLines.findIndex((l) => /^add "display-options"\s+"node tests\/display-options-test\.mjs"/.test(l))
  // 判据用"在 add 列表**末尾段**"而不是"严格最后一行"：`run-all-tests.sh` 是多条工作流共写的文件，
  // 别人随后追加新项是**预期行为**，不该把本项判红（登记要求是"追加在末尾"，不是"永远占住最后一行"）。
  // ①(2026-09-18 稳定性修正) 原判据要求"本项在 add 列表**最后 8 行**内" —— 那是**登记当时**的位置快照，
  //   而 `run-all-tests.sh` 是多条工作流共写的文件，"后来者追加在末尾"是**预期行为**：本轮 `secret-scan`
  //   登记一次就把本项挤出末尾 8 行 ⇒ 门禁会周期性假红（这不是"被挪走"，是文件在长大）。
  //   真正该钉的两条不变量：①**恰好登记一次**（防重复/丢失）②明显是**追加**而不是被插到头部（不在前 10）。
  //   位置本身降级为消息里的信息项。
  const dupCount = addLines.filter((l) => /display-options-test/.test(l)).length
  check(myIdx >= 0 && dupCount === 1 && myIdx >= 10,
    'T12a 门禁恰好登记一次、且是追加而非插队（共 ' + addLines.length + ' 项，本项第 ' + (myIdx + 1) + ' 项，重复 ' + dupCount + ' 次）', addLines[myIdx] || '未找到')
  const README = fs.readFileSync(path.join(ROOT, 'docs', 'README-DIAGNOSTICS.md'), 'utf8')
  const tbl = README.slice(README.indexOf('<!-- FLAG-TABLE-BEGIN -->'), README.indexOf('<!-- FLAG-TABLE-END -->'))
  const flags = ['fliph', 'rate', 'coloropts', 'bright', 'contrast', 'satur', 'hue', 'display']
  const absent = flags.filter((f) => !new RegExp('^\\| `' + f + '` \\|', 'm').test(tbl))
  check(absent.length === 0, 'T12b 8 个新开关在主表里各有一行（7 列格式 ⇒ diag-flag-check 双向比对归零）', absent.length ? '缺 ' + absent.join(',') : '')
  const DOC = path.join(ROOT, 'docs', 'DISPLAY-OPTIONS.md')
  check(fs.existsSync(DOC), 'T12c 规格文档 docs/DISPLAY-OPTIONS.md 存在')
  if (fs.existsSync(DOC)) {
    const d = fs.readFileSync(DOC, 'utf8')
    check(/0\.5/.test(d) && /2×/.test(d) && /scaleX\(-1\)/.test(d) && /brightness/.test(d) && /hue-rotate/.test(d),
      'T12d 文档写了区间与那条 filter 串（0.5–2× / scaleX(-1) / brightness…hue-rotate）')
    check(/优先级/.test(d) && /legacy/.test(d) && /mpw-display/.test(d) && /display-options-test\.mjs/.test(d),
      'T12e 文档写了优先级（legacy > URL > localStorage > 默认）、持久化键与复现命令')
  }
  const PATCHES = fs.readFileSync(path.join(ROOT, 'docs', 'PATCHES.md'), 'utf8')
  check(/^## P-113（/m.test(PATCHES), 'T12f docs/PATCHES.md 有 `## P-113（…）` 节（编号唯一且非降 —— docs-check 会复核）')
}

console.log(failed ? `\n${failed}/${total} 项失败` : `\nALL PASS（${total} 断言）`)
process.exit(failed ? 1 : 0)

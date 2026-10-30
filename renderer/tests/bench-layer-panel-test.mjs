#!/usr/bin/env node
/**
 * bench-layer-panel-test.mjs —— ①(2026-10-11 用户 :8902 实测第 1/2 条) 「图层开关」两处修复的**纯 Node 门禁**
 *
 * 用户原话（两条）：
 *   ① 「层数勾选面板右侧超出屏幕」⇒ 需按视口自适应（最大宽度 / 右边界约束 / 必要时滚动），
 *      在窄屏（800×600、1280×720、1920×1080）都不越界；
 *   ② 「勾选态与壁纸文件不一致」：除 mp3 等不可显示项外**所有层都被勾上**（含 `scene.json` 里
 *      `visible:false` 的），而**勾上之后该层并没有真的显示** ⇒ 期望：缺省勾选 = 文件语义，
 *      勾上 ⇒ 该层必须真的显示出来。
 *
 * 覆盖（A~E 段；F 段是变异自证，防"判据恒真"）：
 *   A 面板定位：`layerPanelFit()` 在 3 个目标视口 × 多按钮位置下，面板矩形**完全落在视口内**（留 8px），
 *     且"下方不够 ⇒ 翻到上方"这条降级真的会发生；
 *   B 勾选态：`layerSwitchState()` 的缺省勾选 = **文件语义**（`visible:false` 不勾）、可显示性
 *     （容器 / 光源 / 无绘制源 = 语料 sound 层）、勾上文件-false 层 ⇒ `plan.shown = true`、
 *     取消勾选 ⇒ 回到文件状态、`plan` **每层都显式给两个布尔**（防幽灵显示）、`?hide=` 只装用户隐藏；
 *   C 渲染器侧通道：`core/we-scene-bundle.js` 的 `__lnShown` 强制显示**恰一处**、位置在"可见性跳过"
 *     **之前**、**没有任何渲染器代码写它**（只有测试台写 ⇒ 不可能被逐帧重算冲掉）、`demo.html` 的
 *     可见性报告认它；
 *   D 真语料：`allwallpaper/dd/3544152633`（实测 70 层 / 字面 `visible:false` 17 层 + 1 个 sound 层）
 *     —— 用 core 自己的 `parseScene` + `applyRenderConfig`（与 demo.html 同一条装载链）算出可见性，
 *     再断言"文件里 false 的层缺省不勾 + 勾上 ⇒ 计划里 shown:true"，并断言**所有 sound 层**都被判
 *     "不可显示"（0 漏判）；
 *   E 静态接线：`demo/index.html` 的弹层 CSS 是**右对齐**锚点（不再是 `left:0`）、`ls wPlacePanel()`
 *     挂在打开/重建/resize/scroll 四处、两个状态片（用户第 3 条）已从 UI 移除、读数改由探针提供；
 *   F 变异自证：把 A/B/C 的关键实现各做一次"改坏"，对应判据必红（真树只读，变异只落 /tmp 副本）。
 *
 * 运行：node tests/bench-layer-panel-test.mjs   （全过 ALL PASS，退出码 0）
 * 纪律：真树只读（只有 /tmp 副本会被改写）；无浏览器、无网络、无 GPU；不启任何服务。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WS = path.resolve(ROOT, '..')
const read = (f) => fs.readFileSync(f, 'utf8')
const INDEX = read(path.join(ROOT, 'demo/index.html'))
const PATCH_TEXT = read(path.join(ROOT, 'demo/bench-patch.js'))
const CORE_TEXT = read(path.join(ROOT, 'core/we-scene-bundle.js'))
const DEMO_TEXT = read(path.join(ROOT, 'demo.html'))
const P = await import(pathToFileURL(path.join(ROOT, 'demo/bench-patch.js')).href)
const lib = await import(pathToFileURL(path.join(ROOT, 'core/we-scene-bundle.js')).href)

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (why) => { console.log('SKIP ' + why) }

/* ═══════════════════════════ A 面板定位（用户第 1 条） ═══════════════════════════ */
console.log('== A 面板定位：三视口都不越界（纯函数 layerPanelFit） ==')
{
  const VIEWPORTS = [[800, 600], [1280, 720], [1920, 1080]]
  const M = 8
  let worst = ''
  let bad = 0
  let cases = 0
  for (const [vw, vh] of VIEWPORTS) {
    //  按钮位置：最右端（用户报障的形态）/ 贴视口右缘（病态）/ 屏幕中间 / 左下 / 右下（下方空间告急）
    const rects = [
      { tag: '最右端', right: vw - 8, bottom: 300, top: 276, left: vw - 88 },
      { tag: '贴右缘', right: vw, bottom: 300, top: 276, left: vw - 80 },
      { tag: '中间', right: vw / 2, bottom: 240, top: 216, left: vw / 2 - 80 },
      { tag: '右下', right: vw - 8, bottom: vh - 8, top: vh - 32, left: vw - 88 },
      { tag: '左下', right: 90, bottom: vh - 8, top: vh - 32, left: 10 },
    ]
    for (const r of rects) {
      const f = P.layerPanelFit(r, { prefW: 360 }, { w: vw, h: vh }, M)
      cases++
      const inside = f.left >= M && f.right <= vw - M && f.top >= M && f.bottom <= vh - M
      const sane = f.width > 0 && f.maxHeight > 0 && (f.placement === 'below' || f.placement === 'above')
      if (!(inside && sane)) { bad++; if (!worst) worst = `${vw}x${vh} ${r.tag} → ${JSON.stringify(f)}` }
    }
  }
  ok(bad === 0, `A1 面板矩形完全落在视口内（留 ${M}px）：3 视口 × 5 按钮位置 = ${cases} 组`,
    bad ? `${bad} 组越界，首个：${worst}` : `全部 ${cases} 组 ⊆ [${M}, 视口−${M}]`)
  //  右对齐锚点：面板右缘 == 按钮右缘（CSS `right:0` 的语义），且宽度不超按钮右缘到左边距的余量
  const r1 = { right: 792, bottom: 300, top: 276, left: 712 }
  const f1 = P.layerPanelFit(r1, { prefW: 360 }, { w: 800, h: 600 }, M)
  ok(f1.right === 792 && f1.width === 360 && f1.left === 432,
    'A2 右对齐到按钮右缘（右边界天然不越界）', JSON.stringify(f1))
  //  窄视口：宽度必须收窄（不是硬撑 360px）
  const f2 = P.layerPanelFit({ right: 352, bottom: 300, top: 276, left: 272 }, { prefW: 360 }, { w: 360, h: 600 }, M)
  ok(f2.width <= 360 - 2 * M && f2.left >= M && f2.right <= 360 - M,
    'A3 窄视口（360px 宽）⇒ 面板宽度收窄到视口内（`width ≤ 视口 − 2×margin`）', JSON.stringify(f2))
  const f3 = P.layerPanelFit({ right: 632, bottom: 592, top: 568 }, { prefW: 360 }, { w: 640, h: 600 }, M)
  ok(f3.placement === 'above' && f3.top >= M && f3.bottom <= 592,
    'A4 下方空间告急（640×600、按钮贴底）⇒ 翻到按钮**上方**展开（降级可用）', JSON.stringify(f3))
  //  病态输入不产生 NaN / 负尺寸（缺 viewport、按钮矩形为 0）
  const f4 = P.layerPanelFit(null, null, null, undefined)
  const f5 = P.layerPanelFit({ right: 0, bottom: 0, top: 0 }, { prefW: 0 }, { w: 0, h: 0 }, -5)
  const num = (v) => Number.isFinite(v) && v > 0
  ok(num(f4.width) && num(f4.maxHeight) && num(f4.left) && num(f4.top) &&
    num(f5.width) && f5.left >= 0 && f5.top >= 0,
    'A5 病态输入（无视口 / 0 尺寸 / 负 margin）不产生 NaN 或负尺寸（兜底矩形仍然合法）',
    JSON.stringify({ f4, f5 }))
}

/* ═══════════════════════ B 勾选态 = 文件语义（用户第 2 条） ═══════════════════════ */
console.log('== B 勾选态与写入计划（纯函数 layerSwitchState） ==')
const FIX = [
  { name: 'background', visible: true, image: 'models/a.json' },                 // 可显示 + 文件可见
  { name: 'motion', visible: true, image: 'models/util/composelayer.json', isContainer: true },
  { name: 'variantOff', visible: false, image: 'models/b.json' },                // ★ 字面 visible:false
  { name: 'song', visible: true },                                              // ★ sound 层形态（无绘制源）
  { name: 'lamp', visible: true, light: 'point', __light: { type: 'point' } },   // 光源（不画像素）
  { name: 'text', visible: true, __text: { text: 'x' } },                        // 文本层（可显示）
]
{
  const st = P.layerSwitchState(FIX, [], [])
  const by = (n) => st.rows.find((r) => r.name === n)
  ok(by('background').checked === true && by('variantOff').checked === false,
    'B1 缺省勾选 = **文件语义**：可见层勾、`visible:false` 层**不勾**',
    st.rows.map((r) => r.name + '=' + (r.checked ? '✓' : '✗')).join(' '))
  ok(by('motion').drawable === false && by('song').drawable === false && by('lamp').drawable === false &&
    by('motion').checked === false && by('song').checked === false && by('lamp').checked === false,
    'B2 「不可显示」= 容器 / 无绘制源（语料 sound 层）/ 光源 ⇒ 不勾（且置灰由 UI 侧的 drawable 决定）',
    st.rows.map((r) => r.name + ':' + r.kind + ':' + (r.drawable ? 'drawable' : 'no')).join(' '))
  ok(P.layerDrawKind({ sound: ['a.mp3'] }) === 'none' && P.layerDrawable({}) === false,
    'B3 语料 sound 层的页面形态（`__sceneLayers` 上没有 sound 字段）判为 `none` ⇒ 不可显示')
  ok(st.checkedCount === 2 && st.drawableCount === 3 && st.hiddenCount === 1 && st.fileHiddenCount === 1,
    'B4 计数只数可显示层：checked=2（background/text）/ drawable=3 / 未勾=1 / 文件-false=1',
    JSON.stringify({ checked: st.checkedCount, drawable: st.drawableCount, unchecked: st.hiddenCount, fileHidden: st.fileHiddenCount }))
  //  勾上文件-false 层 ⇒ 强制显示计划
  const s2 = P.layerSwitchState(FIX, [], [2])
  ok(s2.rows[2].checked === true && s2.rows[2].forced === true &&
    s2.plan[2].shown === true && s2.plan[2].hidden === false,
    'B5 ★勾上文件里 `visible:false` 的层 ⇒ 计划 `shown:true`（渲染期 `__lnShown` = 强制显示）',
    JSON.stringify(s2.plan[2]))
  //  取消勾选 ⇒ 回到文件状态（不进 ?hide=、也不留强制显示）
  const s3 = P.layerSwitchState(FIX, [], [])
  ok(s3.plan[2].shown === false && s3.plan[2].hidden === false && s3.rows[2].checked === false,
    'B6 取消勾选文件-false 层 ⇒ 回到文件状态（`shown:false`；`?hide=` 不需要它）', JSON.stringify(s3.plan[2]))
  //  用户隐藏一个文件可见层 ⇒ hidden:true + checked:false
  const s4 = P.layerSwitchState(FIX, [0], [])
  ok(s4.plan[0].hidden === true && s4.plan[0].shown === false && s4.rows[0].checked === false &&
    s4.hiddenCount === 2 && s4.drawableCount === 3,
    'B7 用户取消勾选可见层 ⇒ `hidden:true`（进 `?hide=`）；状态行读数 2/3（含文件隐藏的那层）', JSON.stringify(s4.plan[0]))
  //  生命周期：plan 每层都显式给两个布尔（防"点过一次永远亮"的幽灵显示）
  ok(s4.plan.length === FIX.length &&
    s4.plan.every((p) => typeof p.hidden === 'boolean' && typeof p.shown === 'boolean') &&
    s4.plan.every((p, i) => p.i === i),
    'B8 写入计划**每层都显式赋值** `{hidden, shown}`（不适用也写 false）⇒ 取消勾选后标记不可能残留',
    `plan=${s4.plan.length}/${FIX.length}`)
  const plan = s4.plan.map((p) => (p.hidden ? 'H' : (p.shown ? 'S' : '.'))).join('')
  ok(plan === 'H.....', 'B9 计划形态可逐位断言（H=隐藏 / S=强制显示 / .=文件语义）', plan)
  //  ?hide= 只装用户隐藏、不装文件隐藏、也不装强制显示
  const copy = P.layerSwitchCopyPlan('http://x/?a=1', [0], { 0: 'background' }, FIX.length, [2], { 2: 'variantOff' })
  ok(/hide=0(?!\d)/.test(copy.url) && !/hide=0,2/.test(copy.url) && copy.shown === '2' &&
    /强制显示 1 层/.test(copy.text) && copy.text.split('\n').length === 3,
    'B10 「复制当前状态」：URL 只带 `?hide=`（用户隐藏）+ 追加"强制显示"一行（`__lnShown` 进不了 URL）',
    JSON.stringify(copy.text.split('\n')))
  const copyOld = P.layerSwitchCopyPlan('http://x/', [], {}, 3)
  ok(copyOld.text.split('\n').length === 2 && copyOld.shown === '',
    'B11 旧调用形态（不传强制集）文案逐字不变（两行）', JSON.stringify(copyOld.text))
  //  重挂载对账：层名对不上就放弃（宁可少强制，不能强制错层）
  const rematch = P.rematchHiddenIndices([2], new Map([[2, 'variantOff']]), [{ name: 'other', visible: false, image: 'x' }])
  ok(rematch.length === 0, 'B12 重挂载后"下标+层名"对不上 ⇒ 放弃该下标（不强制错层）', JSON.stringify(rematch))
}

/* ═══════════════════════ C 渲染器侧通道（core 1 行 + 读数诚实） ═══════════════════════ */
console.log('== C 渲染器侧 __lnShown（绘制期强制显示） ==')
{
  //  只数"代码里"的命中：注释里讨论它不算（本仓注释密度高，直接数原文会假红）
  const CORE_CODE = CORE_TEXT.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
  const hits = [...CORE_CODE.matchAll(/__lnShown/g)].length
  ok(hits === 1 && /if \(layer\.__lnShown\) __layerVis = true/.test(CORE_CODE),
    'C1 core 里 `__lnShown` **恰一处**、且形态就是"把可见性这一票翻过来"（最小改动、可一键回退）',
    `代码命中 ${hits} 处（注释不计）`)
  const iShown = CORE_TEXT.indexOf('if (layer.__lnShown) __layerVis = true')
  const iHiddenSkip = CORE_TEXT.indexOf('if (layer.__lnHidden) { if (__audit)')
  const iVisSkip = CORE_TEXT.indexOf('if (!__layerVis || (layer.isContainer')
  const iHelperSkip = CORE_TEXT.indexOf('跳过(逻辑helper)')
  ok(iHiddenSkip > 0 && iShown > iHiddenSkip && iVisSkip > iShown && iHelperSkip > iVisSkip,
    'C2 位置正确：`__lnHidden` 跳过 → **`__lnShown` 翻票** → `!__layerVis` 跳过 → 逻辑 helper 跳过（其余判据逐条不动）',
    `hide@${iHiddenSkip} shown@${iShown} vis@${iVisSkip} helper@${iHelperSkip}`)
  ok(!/\.__lnShown\s*=/.test(CORE_TEXT) && !/\.__lnShown\s*=/.test(DEMO_TEXT),
    'C3 **渲染器侧没有任何代码写 `__lnShown`**（core/demo.html 都是只读）⇒ 不存在"被逐帧重算冲掉"的通道',
    '唯一写入方 = bench-patch.js（测试台）')
  ok(/if \(l\.__lnShown && l\.visible === false\) return \{ visible: true, visibleBy: 'ln-shown' \}/.test(DEMO_TEXT) &&
    /else if \(!l\.visible && !l\.__lnShown\) skipReason = 'invisible'/.test(DEMO_TEXT),
    'C4 demo.html 的可见性报告（`visOf` / `skipReason`）认 `__lnShown`：归因写 `ln-shown`、"不可见"这条跳过理由不再成立',
    '读数与绘制循环同序')
  ok(/L\[i\]\.__lnShown = shown/.test(PATCH_TEXT) && /L\[i\]\.__lnHidden = hidden/.test(PATCH_TEXT),
    'C5 测试台侧 `lswApply()` 同时落 `__lnHidden`/`__lnShown`（同一份计划，两个标记都显式写）')
  ok(/L\[i\]\.__lnShown = \(index >= 0\) && \(i === index\)/.test(PATCH_TEXT),
    'C6 调试模式隔离也认它（翻到文件-false 的层时不会看到空白画面），退出隔离显式写 false')
}

/* ═══════════════════════ D 真语料（用户第 2 条的"真包可证"） ═══════════════════════ */
console.log('== D 真语料：dd 库里的 visible:false + sound 层 ==')
/*  夹具选择（只读扫描，不改语料）：优先挑"既有字面 `visible:false` 层、又有 sound 层"的真包 ——
    `dd/3660962877`（实测 127 层 / 字面 false 18 / sound 1）就是这种形态；备选 `3327063360`、
   `3544152633`（17 层字面 false，无 sound ⇒ D7 会如实 SKIP）。`MPW_LSW_PKG=<id>` 可显式覆盖。 */
function pickFixture() {
  const env = String(process.env.MPW_LSW_PKG || '').trim()
  const cands = env ? [env] : ['3660962877', '3327063360', '3544152633', '3470764447', '0923/2887099508']
  let fallback = null
  for (const c of cands) {
    const p = path.join(WS, 'allwallpaper', 'dd', c, 'scene.pkg')
    const p2 = c.includes('/') ? path.join(WS, 'allwallpaper', c, 'scene.pkg') : null
    const use = fs.existsSync(p) ? p : (p2 && fs.existsSync(p2) ? p2 : null)
    if (!use) continue
    let litFalse = -1, sounds = -1
    try {
      const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(use)))
      const e = lib.getEntry(pkg, 'scene.json')
      const objs = (JSON.parse(new TextDecoder().decode(new Uint8Array(e)).replace(/^\uFEFF/, '')).objects) || []
      litFalse = objs.filter((o) => o && o.visible === false).length
      sounds = objs.filter((o) => o && o.sound != null).length
    } catch (err) { continue }
    if (litFalse <= 0) continue
    const hit = { id: c, pkgPath: use, projPath: path.join(path.dirname(use), 'project.json'), litFalse, sounds }
    if (sounds > 0) return hit
    if (!fallback) fallback = hit
  }
  return fallback
}
const FIXTURE = pickFixture()
const PKG_ID = FIXTURE ? FIXTURE.id : (process.env.MPW_LSW_PKG || '3660962877')
if (FIXTURE) console.log(`  夹具 = allwallpaper/${FIXTURE.id}/scene.pkg（字面 visible:false ${FIXTURE.litFalse} 层 / sound 层 ${FIXTURE.sounds} 个）`)
{
  const pkgPath = FIXTURE ? FIXTURE.pkgPath : path.join(WS, 'allwallpaper', 'dd', PKG_ID, 'scene.pkg')
  const projPath = FIXTURE ? FIXTURE.projPath : path.join(WS, 'allwallpaper', 'dd', PKG_ID, 'project.json')
  if (!FIXTURE || !fs.existsSync(pkgPath)) {
    skip(`D 段：语料缺 ${pkgPath}（只读扫描，不下载不生成）`)
  } else {
    const DEC = new TextDecoder()
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
    const entry = lib.getEntry(pkg, 'scene.json')
    const sceneRaw = JSON.parse(DEC.decode(new Uint8Array(entry)).replace(/^\uFEFF/, ''))
    const objects = sceneRaw.objects || []
    const soundIdx = objects.map((o, i) => (o && o.sound != null ? i : -1)).filter((i) => i >= 0)
    let schema = null, props = null
    try {
      const proj = JSON.parse(fs.readFileSync(projPath, 'utf8'))
      schema = (proj && proj.general && proj.general.properties) || null
      props = schema ? Object.fromEntries(Object.entries(schema).map(([k, d]) => [k, d && d.value])) : null
    } catch (e) { schema = null; props = null }
    //  与 demo.html 同一条装载链：parseScene → applyRenderConfig（hideUI 缺省 = 隐 UI 层，与真机一致）
    const scene = lib.parseScene(sceneRaw, null, { uniformFlipY: true })
    const schemaFull = schema ? Object.assign({}, schema, scene.properties || {}) : (scene.properties || null)
    lib.applyRenderConfig(scene, {
      properties: props, propertiesSchema: schemaFull, sceneId: PKG_ID,
      hideUI: true, showClock: true, showDate: true, showWeekday: true, showFps: false,
    })
    const layers = scene.layers
    const fileFalse = layers.map((l, i) => (l.visible === false ? i : -1)).filter((i) => i >= 0)
    const st = P.layerSwitchState(layers, [], [])
    ok(layers.length > 0 && fileFalse.length > 0,
      'D1 夹具：真包 ' + PKG_ID + ' 装载后 ' + layers.length + ' 层，其中**文件里 visible:false** ' + fileFalse.length + ' 层',
      `字面 false ${objects.filter((o) => o.visible === false).length} 层 + 属性/隐藏名单带来的其余`)
    ok(fileFalse.every((i) => st.rows[i].checked === false),
      'D2 ★缺省勾选 = 文件语义：**所有** visible:false 的层都不勾（不再"全勾"）',
      `不勾 ${fileFalse.length} 层全部命中`)
    const visTrue = layers.map((l, i) => (l.visible !== false && st.rows[i].drawable ? i : -1)).filter((i) => i >= 0)
    ok(st.checkedCount === visTrue.length && visTrue.every((i) => st.rows[i].checked === true),
      'D3 反向也成立：所有"可显示且文件可见"的层都勾上（没有误伤）',
      `checked=${st.checkedCount} 期望=${visTrue.length}`)
    const target = fileFalse.find((i) => st.rows[i].drawable)
    ok(target !== undefined, 'D4 夹具里存在"文件 false 但**可显示**"的层（= 用户报障的那一类）',
      `目标下标 ${target}`)
    if (target !== undefined) {
      const st2 = P.layerSwitchState(layers, [], [target])
      ok(st2.rows[target].checked === true && st2.plan[target].shown === true,
        'D5 ★勾上第 ' + target + ' 层（文件里 visible:false）⇒ 计划 shown:true（渲染期强制显示）',
        `${P.layerDisplayName(layers[target], target)} ← ${JSON.stringify(st2.plan[target])}`)
      const st3 = P.layerSwitchState(layers, [], [])
      ok(st3.plan[target].shown === false,
        'D6 不勾 ⇒ 不强制的标记（计划随勾选态走，不是一次性粘住）', JSON.stringify(st3.plan[target]))
    }
    //  sound 层（语料里 o.sound != null）在页面形态上一律"不可显示" ⇒ 缺省不勾、置灰、点了也不动
    const soundMiss = soundIdx.filter((i) => P.layerDrawable(layers[i]) === true)
    if (FIXTURE.sounds === 0) {
      skip(`D7 夹具 ${PKG_ID} 里没有 sound 层（合成形态已由 B3 钉住）`)
    } else {
      ok(soundIdx.length > 0 && soundMiss.length === 0,
        'D7 真包的 **' + soundIdx.length + ' 个 sound 层**全部判"不可显示"（0 漏判）⇒ 缺省不勾、勾选框置灰',
        soundMiss.length ? `漏判下标 ${soundMiss.join(',')}` : '0 漏判')
    }
    ok(P.layerSwitchState(layers, [], []).drawableCount === layers.filter((l) => P.layerDrawable(l)).length,
      'D8 可显示层计数与实际逐层判据一致（读数不自相矛盾）',
      `${P.layerSwitchState(layers, [], []).drawableCount} 层`)
  }
}

/* ═══════════════════════ E 静态接线（CSS 锚点 / 挂点 / 用户第 3 条） ═══════════════════════ */
console.log('== E 静态接线 ==')
{
  const css = (/<style id="layer-switch-css">([\s\S]*?)<\/style>/.exec(INDEX) || [])[1] || ''
  ok(css.length > 800, 'E1 弹层样式块在位（`<style id="layer-switch-css">`）', `${css.length}B`)
  const panelRule = (css.split('\n').find((l) => l.includes('#layer-switch-panel{')) || '')
  ok(/right:0/.test(panelRule) && /left:auto/.test(panelRule) && !/[^-]left:0/.test(panelRule),
    'E2 弹层锚点 = **右对齐**（`right:0;left:auto`）—— 用户报障的 `left:0` 已不存在',
    panelRule.slice(0, 120))
  ok(/max-height:min\(70vh,520px\)/.test(panelRule) && /overflow:auto/.test(panelRule),
    'E3 弹层有高度兜底 + 自身滚动（没有 JS 时也不出屏、不撑破）')
  ok(/function lswPlacePanel\(\)/.test(PATCH_TEXT) && /layerPanelFit\(\{ right: r\.right/.test(PATCH_TEXT) &&
    /searchParams\.set\('hide', v\)/.test(PATCH_TEXT),
    'E4 `lswPlacePanel()` 真的用 `layerPanelFit()` 的算式（不是另写一套）')
  const placeCalls = (PATCH_TEXT.match(/lswPlacePanel\(\)/g) || []).length
  ok(placeCalls >= 4 && /addEventListener\('resize'[\s\S]{0,80}lswPlacePanel\(\)/.test(PATCH_TEXT) &&
    /addEventListener\('scroll'[\s\S]{0,80}lswPlacePanel\(\)/.test(PATCH_TEXT),
    'E5 定位在**四处**触发（打开 / 行重建 / resize / scroll），事件驱动、无常驻定时器', `调用点 ${placeCalls} 处`)
  ok(!/id="status-bandfeed"/.test(INDEX) && !/id="status-renderer-src"/.test(INDEX) &&
    /bandFeedStatus: \(\) => paintBandFeedStatus\(\)/.test(PATCH_TEXT) &&
    /rendererSrcStatus: \(\) => paintRendererSrcStatus\(\)/.test(PATCH_TEXT),
    'E6 用户第 3 条：两个状态片已从 UI 移除，逻辑与读数保留在 `__benchPatch` 探针上（形状不变）')
  //  D8 反漂移：静态块仍要覆盖 SITE_LAYOUT_CSS（删掉那三条 id 规则会撞 D8 ⇒ 有意保留）
  const mStatic = (/<style id="bench-shell-static">([\s\S]*?)<\/style>/.exec(INDEX) || [])[1] || ''
  ok(/#status-bandfeed\{/.test(mStatic) && /#status-renderer-src\{/.test(mStatic),
    'E7 移除状态片**只删 DOM**：静态 CSS 里那两条 id 规则保留（D8 要求覆盖 `SITE_LAYOUT_CSS`，删了会红）')
  //  弹层残留 id 不会撞现有门禁：LS 组读的是 `#layer-switch-list`（仍在）
  ok(/id="layer-switch-list"/.test(INDEX) && /id="layer-switch-panel"/.test(INDEX) &&
    /id="layer-all"/.test(INDEX) && /id="layer-none"/.test(INDEX),
    'E8 面板 DOM 未动（列表/面板/三个批量键都在）—— 只改了定位与勾选态口径')
}

/* ═══════════════════════ F 变异自证（判据不许恒真） ═══════════════════════ */
console.log('== F RED-IF-REVERTED（变异只落 /tmp 副本；真树只读） ==')
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-lsw-'))
  /*  bench-patch.js 有一个同目录相对 import（`./mpw-select.js`）⇒ 变异副本必须能解析它：
      把这两个依赖**拷到变异目录**（只读源、只写 /tmp），真树一个字节都不动。 */
  for (const dep of ['mpw-select.js', 'mpw-select-math.mjs']) {
    const src = path.join(ROOT, 'demo', dep)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpDir, dep))
  }
  const sha = (f) => { const b = fs.readFileSync(f); return b.length + ':' + createHash('sha256').update(b).digest('hex').slice(0, 12) }
  const before = { patch: sha(path.join(ROOT, 'demo/bench-patch.js')), core: sha(path.join(ROOT, 'core/we-scene-bundle.js')) }
  const mutantModule = async (name, from, to) => {
    const src = PATCH_TEXT
    if (!src.includes(from)) throw new Error('变异锚点未命中: ' + name)
    const dst = path.join(tmpDir, name + '.mjs')
    fs.writeFileSync(dst, src.replace(from, to))
    return import(pathToFileURL(dst).href)
  }
  //  M1：勾选态退回"不看文件语义"（= 用户报障的旧行为）
  try {
    const M = await mutantModule('m1-no-filevis', 'const checked = drawable && !isHidden && (fileVisible || isForced)',
      'const checked = drawable && !isHidden')
    const st = M.layerSwitchState(FIX, [], [])
    ok(st.rows.find((r) => r.name === 'variantOff').checked === true,
      'M1 变异生效：把"缺省不勾文件-false 层"改回去 ⇒ 该层必然被勾上（B1 判据会红）',
      'checked=' + st.rows.find((r) => r.name === 'variantOff').checked)
  } catch (e) { ok(false, 'M1 变异体构造失败', String(e.message)) }
  //  M2：定位算式退回"固定 360px、不夹取"
  try {
    const M = await mutantModule('m2-nofit', 'width = Math.min(width, Math.max(1, vw - 2 * m))', 'width = prefW')
    const f = M.layerPanelFit({ right: 352, bottom: 300, top: 276 }, { prefW: 360 }, { w: 360, h: 600 }, 8)
    ok(!(f.left >= 8 && f.right <= 352), 'M2 变异生效：去掉视口夹取 ⇒ 窄视口下必越界（A3 判据会红）', JSON.stringify(f))
  } catch (e) { ok(false, 'M2 变异体构造失败', String(e.message)) }
  //  M3：删掉 core 的强制显示那一行（= 一键回退的形态）
  {
    const mutant = CORE_TEXT.replace('if (layer.__lnShown) __layerVis = true', '')
    ok(!/if \(layer\.__lnShown\) __layerVis = true/.test(mutant) && /if \(layer\.__lnShown\) __layerVis = true/.test(CORE_TEXT),
      'M3 变异生效：注释/删掉 core 那一行 ⇒ C1/C2 判据会红（这就是"2 行可一键回退"的回退形态）')
  }
  //  M4：计划只输出"被置位的层"（残留即幽灵显示）
  try {
    const M = await mutantModule('m4-sparse-plan', 'plan.push({ i, hidden: isHidden, shown: isForced })',
      'if (isHidden || isForced) plan.push({ i, hidden: isHidden, shown: isForced })')
    const st = M.layerSwitchState(FIX, [], [])
    ok(st.plan.length !== FIX.length, 'M4 变异生效：计划改成"稀疏"（不适用就不输出）⇒ B8 判据会红（幽灵显示的口子）',
      `plan=${st.plan.length}/${FIX.length}`)
  } catch (e) { ok(false, 'M4 变异体构造失败', String(e.message)) }
  const after = { patch: sha(path.join(ROOT, 'demo/bench-patch.js')), core: sha(path.join(ROOT, 'core/we-scene-bundle.js')) }
  ok(before.patch === after.patch && before.core === after.core,
    'F5 真树跑前跑后同哈希（变异只落在 /tmp 副本）', JSON.stringify(after))
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) { /* 清理失败不影响判据 */ }
}

console.log(`\n── 汇总：PASS=${pass} FAIL=${fail} ──`)
if (fail === 0) console.log('ALL PASS')
process.exit(fail === 0 ? 0 : 1)
